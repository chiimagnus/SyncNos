import { useEffect, useRef, useState } from 'react';

import type { ConversationSyncFeedbackState } from './useConversationSyncFeedback';

type ConversationSyncFeedbackNoticeProps = {
  feedback: ConversationSyncFeedbackState;
  onDismiss: () => void;
};

function toneClasses(phase: ConversationSyncFeedbackState['phase']) {
  if (phase === 'running') {
    return {
      panel: 'tw-border-[#bfdbfe] tw-bg-[#eff6ff] tw-text-[#1d4ed8]',
      badge: 'tw-border-[#93c5fd] tw-bg-[#dbeafe] tw-text-[#1d4ed8]',
    };
  }
  if (phase === 'success') {
    return {
      panel: 'tw-border-[#bbf7d0] tw-bg-[#f0fdf4] tw-text-[#166534]',
      badge: 'tw-border-[#86efac] tw-bg-[#dcfce7] tw-text-[#166534]',
    };
  }
  if (phase === 'partial-failed') {
    return {
      panel: 'tw-border-[#fde68a] tw-bg-[#fffbeb] tw-text-[#92400e]',
      badge: 'tw-border-[#fcd34d] tw-bg-[#fef3c7] tw-text-[#92400e]',
    };
  }
  return {
    panel: 'tw-border-[#fecaca] tw-bg-[#fef2f2] tw-text-[#b91c1c]',
    badge: 'tw-border-[#fca5a5] tw-bg-[#fee2e2] tw-text-[#b91c1c]',
  };
}

function phaseLabel(phase: ConversationSyncFeedbackState['phase']) {
  if (phase === 'running') return 'Syncing';
  if (phase === 'success') return 'Completed';
  if (phase === 'partial-failed') return 'Partial failure';
  if (phase === 'failed') return 'Failed';
  return '';
}

function SummaryBody(props: {
  tones: ReturnType<typeof toneClasses>;
  provider: string;
  feedback: ConversationSyncFeedbackState;
  primaryMessage: string;
  showRunningStageDetail: boolean;
  currentStageLabel: string;
  progressWidth: number;
  failureCount: number;
  detailsOpen: boolean;
  canShowDetails: boolean;
  onToggleDetails: () => void;
}) {
  const {
    tones,
    provider,
    feedback,
    primaryMessage,
    showRunningStageDetail,
    currentStageLabel,
    progressWidth,
    failureCount,
    detailsOpen,
    canShowDetails,
    onToggleDetails,
  } = props;

  const content = (
    <>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <span
          className={[
            'tw-inline-flex tw-items-center tw-rounded-full tw-border tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-black tw-uppercase tw-tracking-[0.08em]',
            tones.badge,
          ].join(' ')}
        >
          {provider}
        </span>
        <span className="tw-text-[11px] tw-font-black tw-uppercase tw-tracking-[0.08em]">{phaseLabel(feedback.phase)}</span>
        {feedback.total > 0 ? (
          <span className="tw-text-[11px] tw-font-semibold tw-opacity-80">
            {feedback.done}/{feedback.total}
          </span>
        ) : null}
        {canShowDetails ? (
          <span className="tw-text-[11px] tw-font-semibold tw-opacity-75">
            {failureCount} issue{failureCount === 1 ? '' : 's'} · {detailsOpen ? 'Hide details' : 'View details'}
          </span>
        ) : null}
      </div>

      <div className="tw-mt-1 tw-text-xs tw-font-semibold">{primaryMessage}</div>

      {showRunningStageDetail ? (
        <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-opacity-75">
          Stage: {currentStageLabel}
        </div>
      ) : null}

      {feedback.total > 0 ? (
        <div className="tw-mt-2 tw-h-1.5 tw-overflow-hidden tw-rounded-full tw-bg-white/60">
          <div
            className="tw-h-full tw-rounded-full tw-bg-current tw-transition-[width] tw-duration-300"
            style={{ width: `${progressWidth}%` }}
          />
        </div>
      ) : null}
    </>
  );

  if (!canShowDetails) {
    return <div className="tw-min-w-0 tw-flex-1">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onToggleDetails}
      aria-expanded={detailsOpen}
      aria-haspopup="dialog"
      aria-label={`Open ${provider} sync details`}
      className="tw-min-w-0 tw-flex-1 tw-text-left"
    >
      {content}
    </button>
  );
}

export function ConversationSyncFeedbackNotice(props: ConversationSyncFeedbackNoticeProps) {
  const { feedback, onDismiss } = props;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDetailsOpen(false);
  }, [feedback.provider, feedback.phase, feedback.updatedAt]);

  useEffect(() => {
    if (!detailsOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      setDetailsOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDetailsOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [detailsOpen]);

  if (feedback.phase === 'idle' || !feedback.provider) return null;

  const tones = toneClasses(feedback.phase);
  const failures = Array.isArray(feedback.failures) ? feedback.failures : [];
  const provider = feedback.provider === 'notion' ? 'Notion' : 'Obsidian';
  const canDismiss = feedback.phase !== 'running';
  const canShowDetails = failures.length > 0;
  const liveMode = feedback.phase === 'failed' || feedback.phase === 'partial-failed' ? 'assertive' : 'polite';
  const progressWidth = feedback.total > 0
    ? feedback.done <= 0
      ? 0
      : Math.min(100, Math.max(8, Math.round((feedback.done / feedback.total) * 100) || 0))
    : 0;
  const currentItemLabel = feedback.currentConversationTitle.trim()
    || (feedback.currentConversationId ? `Conversation #${feedback.currentConversationId}` : '');
  const currentStageLabel = feedback.currentStage.trim();
  const primaryMessage = feedback.phase === 'running'
    ? currentItemLabel
      ? `Current: ${currentItemLabel}`
      : currentStageLabel
        ? `Stage: ${currentStageLabel}`
        : feedback.message
    : feedback.message;
  const showRunningStageDetail = feedback.phase === 'running' && !!currentItemLabel && !!currentStageLabel;

  return (
    <div
      ref={containerRef}
      id="conversationSyncFeedback"
      data-phase={feedback.phase}
      className={[
        'tw-relative tw-mt-2 tw-rounded-2xl tw-border tw-px-3 tw-py-2.5 tw-shadow-[0_8px_24px_rgba(15,23,42,0.06)]',
        tones.panel,
      ].join(' ')}
      role={feedback.phase === 'failed' || feedback.phase === 'partial-failed' ? 'alert' : 'status'}
      aria-live={liveMode}
    >
      <div className="tw-flex tw-items-start tw-gap-2">
        <SummaryBody
          tones={tones}
          provider={provider}
          feedback={feedback}
          primaryMessage={primaryMessage}
          showRunningStageDetail={showRunningStageDetail}
          currentStageLabel={currentStageLabel}
          progressWidth={progressWidth}
          failureCount={failures.length}
          detailsOpen={detailsOpen}
          canShowDetails={canShowDetails}
          onToggleDetails={() => setDetailsOpen((open) => !open)}
        />

        {canDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="tw-inline-flex tw-size-7 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-current/20 tw-bg-white/65 tw-text-[11px] tw-font-black tw-transition-colors tw-duration-150 hover:tw-bg-white"
            aria-label="Dismiss sync feedback"
          >
            ×
          </button>
        ) : null}
      </div>

      {canShowDetails && detailsOpen ? (
        <div
          role="dialog"
          aria-label={`${provider} sync details`}
          className="tw-absolute tw-bottom-[calc(100%+8px)] tw-left-0 tw-right-0 tw-z-30 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--panel)] tw-p-3 tw-text-[var(--text)] tw-shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
        >
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <div className="tw-text-xs tw-font-extrabold">{provider} sync details</div>
            <button
              type="button"
              onClick={() => setDetailsOpen(false)}
              className="tw-inline-flex tw-size-7 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-white/65 tw-text-[11px] tw-font-black tw-transition-colors tw-duration-150 hover:tw-bg-white"
              aria-label={`Close ${provider} sync details`}
            >
              ×
            </button>
          </div>

          <div className="tw-mt-2 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
            {feedback.message}
          </div>

          <div className="tw-mt-3 tw-max-h-[min(45vh,320px)] tw-space-y-2 tw-overflow-auto tw-pr-1">
            {failures.map((failure, index) => (
              <div
                key={`${failure.conversationId || 'unknown'}-${index}`}
                className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-p-2.5"
              >
                <div className="tw-text-[11px] tw-font-black tw-text-[var(--text)]">
                  {failure.conversationId > 0 ? `Conversation #${failure.conversationId}` : 'Conversation'}
                </div>
                <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
                  {failure.error}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
