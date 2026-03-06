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

export function ConversationSyncFeedbackNotice(props: ConversationSyncFeedbackNoticeProps) {
  const { feedback, onDismiss } = props;
  if (feedback.phase === 'idle' || !feedback.provider) return null;

  const tones = toneClasses(feedback.phase);
  const failures = Array.isArray(feedback.failures) ? feedback.failures.slice(0, 3) : [];
  const provider = feedback.provider === 'notion' ? 'Notion' : 'Obsidian';
  const canDismiss = feedback.phase !== 'running';
  const liveMode = feedback.phase === 'failed' || feedback.phase === 'partial-failed' ? 'assertive' : 'polite';
  const progressWidth = feedback.total > 0
    ? feedback.done <= 0
      ? 0
      : Math.min(100, Math.max(8, Math.round((feedback.done / feedback.total) * 100) || 0))
    : 0;
  const currentItemLabel = feedback.currentConversationTitle.trim()
    || (feedback.currentConversationId ? `Conversation #${feedback.currentConversationId}` : '');
  const currentStageLabel = feedback.currentStage.trim();

  return (
    <div
      id="conversationSyncFeedback"
      data-phase={feedback.phase}
      className={[
        'tw-mt-2 tw-rounded-2xl tw-border tw-px-3 tw-py-2.5 tw-shadow-[0_8px_24px_rgba(15,23,42,0.06)]',
        tones.panel,
      ].join(' ')}
      role={feedback.phase === 'failed' || feedback.phase === 'partial-failed' ? 'alert' : 'status'}
      aria-live={liveMode}
    >
      <div className="tw-flex tw-items-start tw-gap-2">
        <div className="tw-min-w-0 tw-flex-1">
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
          </div>

          <div className="tw-mt-1 tw-text-xs tw-font-semibold">{feedback.message}</div>

          {feedback.phase === 'running' && currentItemLabel ? (
            <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-opacity-90">
              Current: {currentItemLabel}
            </div>
          ) : null}

          {feedback.phase === 'running' && currentStageLabel ? (
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

          {failures.length ? (
            <div className="tw-mt-2 tw-space-y-1">
              {failures.map((failure, index) => (
                <div
                  key={`${failure.conversationId || 'unknown'}-${index}`}
                  className="tw-text-[11px] tw-font-semibold tw-opacity-90"
                >
                  {failure.conversationId > 0 ? `#${failure.conversationId}: ${failure.error}` : failure.error}
                </div>
              ))}
            </div>
          ) : null}
        </div>

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
    </div>
  );
}
