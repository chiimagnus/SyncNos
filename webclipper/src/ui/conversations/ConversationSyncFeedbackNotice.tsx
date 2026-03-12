import { useEffect, useRef, useState } from 'react';

import { t } from '../../i18n';
import type { ConversationSyncFeedbackState } from './useConversationSyncFeedback';
import { buttonIconCircleCardClassName } from '../shared/button-styles';
import { useConversationsApp } from './conversations-context';
import { openConversation } from './open-conversation';

type ConversationSyncFeedbackNoticeProps = {
  feedback: ConversationSyncFeedbackState;
  onDismiss: () => void;
  onOpenConversation?: (conversationId: number) => void;
};

type NoticeTones = {
  panel: string;
  badge: string;
  progress: string;
};

const NOTICE_TONE_CLASSES: Record<'info' | 'success' | 'warning' | 'error', NoticeTones> = {
  info: {
    panel: 'tw-border-[color-mix(in_srgb,var(--info)_45%,var(--border))] tw-bg-[color-mix(in_srgb,var(--info)_10%,var(--bg-card))] tw-text-[var(--text-primary)]',
    badge: 'tw-border-[color-mix(in_srgb,var(--info)_70%,var(--border))] tw-bg-[color-mix(in_srgb,var(--info)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    progress: 'tw-bg-[var(--info)]',
  },
  success: {
    panel: 'tw-border-[color-mix(in_srgb,var(--success)_45%,var(--border))] tw-bg-[color-mix(in_srgb,var(--success)_10%,var(--bg-card))] tw-text-[var(--text-primary)]',
    badge: 'tw-border-[color-mix(in_srgb,var(--success)_70%,var(--border))] tw-bg-[color-mix(in_srgb,var(--success)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    progress: 'tw-bg-[var(--success)]',
  },
  warning: {
    panel: 'tw-border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] tw-bg-[color-mix(in_srgb,var(--warning)_10%,var(--bg-card))] tw-text-[var(--text-primary)]',
    badge: 'tw-border-[color-mix(in_srgb,var(--warning)_70%,var(--border))] tw-bg-[color-mix(in_srgb,var(--warning)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    progress: 'tw-bg-[var(--warning)]',
  },
  error: {
    panel: 'tw-border-[color-mix(in_srgb,var(--error)_45%,var(--border))] tw-bg-[color-mix(in_srgb,var(--error)_10%,var(--bg-card))] tw-text-[var(--text-primary)]',
    badge: 'tw-border-[color-mix(in_srgb,var(--error)_70%,var(--border))] tw-bg-[color-mix(in_srgb,var(--error)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    progress: 'tw-bg-[var(--error)]',
  },
};

function makeToneClasses(colorToken: 'info' | 'success' | 'warning' | 'error'): NoticeTones {
  return NOTICE_TONE_CLASSES[colorToken];
}

function toneClasses(phase: ConversationSyncFeedbackState['phase']) {
  if (phase === 'running') {
    return makeToneClasses('info');
  }
  if (phase === 'success') {
    return makeToneClasses('success');
  }
  if (phase === 'partial-failed') {
    return makeToneClasses('warning');
  }
  return makeToneClasses('error');
}

function phaseLabel(phase: ConversationSyncFeedbackState['phase']) {
  if (phase === 'running') return t('phaseRunning');
  if (phase === 'success') return t('phaseSuccess');
  if (phase === 'partial-failed') return t('phasePartialFailed');
  if (phase === 'failed') return t('phaseFailed');
  return '';
}

function conversationLabel(title: unknown, conversationId: unknown) {
  const resolvedTitle = String(title || '').trim();
  if (resolvedTitle) return resolvedTitle;
  const resolvedId = Number(conversationId);
  return resolvedId > 0 ? `${t('conversationLabel')} #${resolvedId}` : t('conversationLabel');
}

function SummaryBody(props: {
  tones: NoticeTones;
  provider: string;
  feedback: ConversationSyncFeedbackState;
  message: string;
  showRunningStageDetail: boolean;
  currentStageLabel: string;
  currentConversationId: number | null;
  currentConversationLabel: string;
  progressWidth: number;
  issueCount: number;
  detailsOpen: boolean;
  canShowDetails: boolean;
  onToggleDetails: () => void;
  onJumpToConversation?: (conversationId: number) => void;
}) {
  const {
    tones,
    provider,
    feedback,
    message,
    showRunningStageDetail,
    currentStageLabel,
    currentConversationId,
    currentConversationLabel,
    progressWidth,
    issueCount,
    detailsOpen,
    canShowDetails,
    onToggleDetails,
    onJumpToConversation,
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
          <button
            type="button"
            onClick={onToggleDetails}
            aria-expanded={detailsOpen}
            aria-haspopup="dialog"
            aria-label={`Open ${provider} ${t('syncDetails')}`}
            className={[
              'tw-inline-flex tw-items-center tw-text-[11px] tw-font-semibold tw-opacity-80 hover:tw-opacity-100',
              'tw-appearance-none tw-border-0 tw-bg-transparent tw-p-0 tw-text-inherit tw-shadow-none',
              'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
            ].join(' ')}
          >
            {issueCount} {issueCount === 1 ? t('issuesSingular') : t('issuesPlural')} · {detailsOpen ? t('hideDetails') : t('viewDetails')}
          </button>
        ) : null}
      </div>

      <div className="tw-mt-1 tw-text-xs tw-font-semibold">
        {feedback.phase === 'running' && currentConversationLabel ? (
          <span>
            {t('currentPrefix')}{' '}
            {onJumpToConversation && currentConversationId && currentConversationId > 0 ? (
              <button
                type="button"
                onClick={() => onJumpToConversation(currentConversationId)}
                className={[
                  'tw-inline-flex tw-max-w-full tw-items-baseline tw-text-left tw-font-bold tw-text-inherit',
                  'tw-appearance-none tw-border-0 tw-bg-transparent tw-p-0 tw-shadow-none',
                  'hover:tw-underline tw-underline-offset-2',
                  'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
                ].join(' ')}
                title={currentConversationLabel}
                aria-label={currentConversationLabel}
              >
                <span className="tw-min-w-0 tw-truncate">{currentConversationLabel}</span>
              </button>
            ) : (
              <span title={currentConversationLabel}>{currentConversationLabel}</span>
            )}
          </span>
        ) : (
          message
        )}
      </div>

      {showRunningStageDetail ? (
        <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-opacity-75">
          {t('stagePrefix')} {currentStageLabel}
        </div>
      ) : null}

      {feedback.total > 0 ? (
        <div className="tw-mt-2 tw-h-1.5 tw-overflow-hidden tw-rounded-full tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))]">
          <div
            className={['tw-h-full tw-rounded-full tw-transition-[width] tw-duration-300', tones.progress].join(' ')}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
      ) : null}
    </>
  );

  return <div className="tw-min-w-0 tw-flex-1">{content}</div>;
}

export function ConversationSyncFeedbackNotice(props: ConversationSyncFeedbackNoticeProps) {
  const { feedback, onDismiss, onOpenConversation } = props;
  const { setActiveId, clearSelected } = useConversationsApp();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevProviderRef = useRef<ConversationSyncFeedbackState['provider']>(feedback.provider);
  const prevPhaseRef = useRef<ConversationSyncFeedbackState['phase']>(feedback.phase);

  const failures = Array.isArray(feedback.failures) ? feedback.failures : [];
  const warnings = Array.isArray(feedback.warnings) ? feedback.warnings : [];
  const issueCount = failures.length + warnings.length;
  const canShowDetails = issueCount > 0;

  useEffect(() => {
    const prevProvider = prevProviderRef.current;
    const prevPhase = prevPhaseRef.current;
    prevProviderRef.current = feedback.provider;
    prevPhaseRef.current = feedback.phase;

    if (prevProvider !== feedback.provider) {
      setDetailsOpen(false);
      return;
    }

    // Close details when a new run starts, so we don't keep an old "open" state
    // and surprise-open later when new issues appear.
    if (feedback.phase === 'running' && prevPhase !== 'running') {
      setDetailsOpen(false);
      return;
    }

    if (!canShowDetails) setDetailsOpen(false);
  }, [canShowDetails, feedback.phase, feedback.provider]);

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
  const provider = feedback.provider === 'notion' ? 'Notion' : 'Obsidian';
  const canDismiss = feedback.phase !== 'running';
  const iconCircleButtonClassName = buttonIconCircleCardClassName();
  const liveMode = feedback.phase === 'failed' || feedback.phase === 'partial-failed' ? 'assertive' : 'polite';
  const progressWidth = feedback.total > 0
    ? feedback.done <= 0
      ? 0
      : Math.min(100, Math.max(8, Math.round((feedback.done / feedback.total) * 100) || 0))
    : 0;
  const currentItemLabel = feedback.currentConversationTitle.trim()
    || (feedback.currentConversationId ? `${t('conversationLabel')} #${feedback.currentConversationId}` : '');
  const currentStageLabel = feedback.currentStage.trim();
  const message = feedback.phase === 'running'
    ? currentItemLabel
      ? `${t('currentPrefix')} ${currentItemLabel}`
      : currentStageLabel
        ? `${t('stagePrefix')} ${currentStageLabel}`
        : feedback.message
    : feedback.message;
  const showRunningStageDetail = feedback.phase === 'running' && !!currentItemLabel && !!currentStageLabel;

  const onJumpToConversation = (conversationId: unknown) => {
    const id = openConversation(conversationId, { clearSelected, setActiveId, onOpenConversation });
    if (id) setDetailsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      id="conversationSyncFeedback"
      data-phase={feedback.phase}
      className={[
        'tw-relative tw-mt-2 tw-rounded-2xl tw-border tw-px-3 tw-py-2.5 tw-shadow-none',
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
          message={message}
          showRunningStageDetail={showRunningStageDetail}
          currentStageLabel={currentStageLabel}
          currentConversationId={feedback.currentConversationId}
          currentConversationLabel={currentItemLabel}
          progressWidth={progressWidth}
          issueCount={issueCount}
          detailsOpen={detailsOpen}
          canShowDetails={canShowDetails}
          onToggleDetails={() => setDetailsOpen((open) => !open)}
          onJumpToConversation={(conversationId) => onJumpToConversation(conversationId)}
        />

        {canDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className={iconCircleButtonClassName}
            aria-label={t('dismissSyncFeedback')}
          >
            ×
          </button>
        ) : null}
      </div>

      {canShowDetails && detailsOpen ? (
        <div
          role="dialog"
          aria-label={`${provider} ${t('syncDetails')}`}
          className="tw-absolute tw-bottom-[calc(100%+8px)] tw-left-0 tw-right-0 tw-z-30 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-3 tw-text-[var(--text-primary)] tw-shadow-none"
        >
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
              <div className="tw-text-xs tw-font-extrabold">{provider} {t('syncDetails')}</div>
            <button
              type="button"
              onClick={() => setDetailsOpen(false)}
              className={iconCircleButtonClassName}
              aria-label={`Close ${provider} ${t('syncDetails')}`}
            >
              ×
            </button>
            </div>

          <div className="tw-mt-2 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
            {feedback.message}
          </div>

          <div className="tw-mt-3 tw-max-h-[min(45vh,320px)] tw-space-y-2 tw-overflow-auto tw-pr-1">
            {warnings.length ? (
              <div className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))] tw-p-2.5">
                <div className="tw-text-[11px] tw-font-black tw-text-[var(--text-primary)]">{t('warningsHeading')}</div>
                <div className="tw-mt-2 tw-space-y-2">
                  {warnings.map((warning, index) => (
                    <div
                      key={`${warning?.conversationId || 'unknown'}-${warning?.code || 'warning'}-${index}`}
                      className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-2.5"
                    >
                      {Number(warning?.conversationId) > 0 ? (
                        <button
                          type="button"
                          onClick={() => onJumpToConversation(warning?.conversationId)}
                          className={[
                            'tw-w-full tw-text-left tw-text-[11px] tw-font-black tw-text-[var(--text-primary)]',
                            'tw-appearance-none tw-border-0 tw-bg-transparent tw-p-0 tw-shadow-none',
                            'hover:tw-underline tw-underline-offset-2',
                            'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
                          ].join(' ')}
                          title={conversationLabel(warning?.conversationTitle, warning?.conversationId)}
                          aria-label={conversationLabel(warning?.conversationTitle, warning?.conversationId)}
                        >
                          {conversationLabel(warning?.conversationTitle, warning?.conversationId)}
                        </button>
                      ) : (
                        <div className="tw-text-[11px] tw-font-black tw-text-[var(--text-primary)]">
                          {conversationLabel(warning?.conversationTitle, warning?.conversationId)}
                        </div>
                      )}
                      <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
                        {String(warning?.message || warning?.code || 'warning')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {failures.map((failure, index) => (
              <div
                key={`${failure.conversationId || 'unknown'}-${index}`}
                className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))] tw-p-2.5"
              >
                {Number(failure.conversationId) > 0 ? (
                  <button
                    type="button"
                    onClick={() => onJumpToConversation(failure.conversationId)}
                    className={[
                      'tw-w-full tw-text-left tw-text-[11px] tw-font-black tw-text-[var(--text-primary)]',
                      'tw-appearance-none tw-border-0 tw-bg-transparent tw-p-0 tw-shadow-none',
                      'hover:tw-underline tw-underline-offset-2',
                      'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
                    ].join(' ')}
                    title={conversationLabel(failure.conversationTitle, failure.conversationId)}
                    aria-label={conversationLabel(failure.conversationTitle, failure.conversationId)}
                  >
                    {conversationLabel(failure.conversationTitle, failure.conversationId)}
                  </button>
                ) : (
                  <div className="tw-text-[11px] tw-font-black tw-text-[var(--text-primary)]">
                    {conversationLabel(failure.conversationTitle, failure.conversationId)}
                  </div>
                )}
                <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
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
