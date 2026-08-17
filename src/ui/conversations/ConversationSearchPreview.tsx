import { t } from '@i18n';
import type { LocalDataSearchResult } from '@services/local-data/contracts';
import type { ConversationSearchPreviewState } from '@viewmodels/conversations/search-sheet-types';
import { buttonFilledClassName } from '@ui/shared/button-styles';

export type ConversationSearchPreviewProps = Readonly<{
  preview: ConversationSearchPreviewState;
  selectedResult: LocalDataSearchResult | null;
  onOpenFullConversation: (result: LocalDataSearchResult) => void;
}>;

export function ConversationSearchPreview({
  preview,
  selectedResult,
  onOpenFullConversation,
}: ConversationSearchPreviewProps) {
  return (
    <section aria-label={t('localSearchPreviewAria')} className="tw-flex tw-min-h-0 tw-flex-col tw-bg-[var(--bg-card)]">
      <div className="tw-flex tw-min-h-14 tw-items-center tw-justify-between tw-gap-3 tw-border-b tw-border-[var(--border)] tw-px-4 tw-py-2">
        <div className="tw-min-w-0">
          <div className="tw-truncate tw-text-sm tw-font-extrabold tw-text-[var(--text-primary)]">
            {selectedResult?.title || selectedResult?.conversationKey || t('localSearchPreviewAria')}
          </div>
          {selectedResult ? (
            <div className="tw-mt-0.5 tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
              {selectedResult.source}
            </div>
          ) : null}
        </div>
        {selectedResult ? (
          <button
            type="button"
            className={buttonFilledClassName()}
            onClick={() => onOpenFullConversation(selectedResult)}
          >
            {t('localSearchOpenConversation')}
          </button>
        ) : null}
      </div>

      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-p-4">
        {preview.loading ? (
          <div aria-live="polite" className="tw-flex tw-flex-col tw-gap-3">
            <span className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('localSearchPreviewLoading')}
            </span>
            <div className="tw-h-16 tw-animate-pulse tw-rounded-[var(--radius-card)] tw-bg-[var(--bg-sunken)]" />
            <div className="tw-h-24 tw-animate-pulse tw-rounded-[var(--radius-card)] tw-bg-[var(--bg-sunken)]" />
          </div>
        ) : preview.error ? (
          <div
            role="alert"
            className="tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-4 tw-text-sm tw-font-semibold tw-text-[var(--error)]"
          >
            {preview.error}
          </div>
        ) : preview.detail ? (
          <div className="tw-flex tw-flex-col tw-gap-3">
            {preview.detail.messages.map((message) => {
              const text = String(message.contentMarkdown || message.contentText || '');
              return (
                <article
                  key={`${message.id}:${message.messageKey}`}
                  className="tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-p-3"
                >
                  <div className="tw-mb-2 tw-text-[11px] tw-font-extrabold tw-uppercase tw-tracking-wide tw-text-[var(--text-secondary)]">
                    {message.authorName || message.role}
                  </div>
                  <div className="tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-leading-6 tw-text-[var(--text-primary)]">
                    {text}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-4 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
            {t('localSearchPreviewHint')}
          </div>
        )}
      </div>
    </section>
  );
}
