import { useMemo, useRef } from 'react';

import { t } from '@i18n';
import type { LocalDataSearchResult } from '@services/local-data/contracts';
import type { ConversationSearchResultState } from '@viewmodels/conversations/search-sheet-types';
import { splitSearchSnippetHighlights } from '@ui/conversations/search-highlight';
import { buttonTintClassName } from '@ui/shared/button-styles';

function stableKey(result: Pick<LocalDataSearchResult, 'source' | 'conversationKey'>): string {
  return `${String(result.source || '')}\u0000${String(result.conversationKey || '')}`;
}

function formatTimestamp(value: unknown): string {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '';
  }
}

export type ConversationSearchResultsProps = Readonly<{
  cursorStale: boolean;
  errorMessage: string | null;
  loading: boolean;
  query: string;
  result: ConversationSearchResultState | null;
  selectedReference: Readonly<{ conversationKey: string; source: string }> | null;
  onLoadMore: () => void;
  onSelect: (result: LocalDataSearchResult) => void;
}>;

export function ConversationSearchResults(props: ConversationSearchResultsProps) {
  const { cursorStale, errorMessage, loading, query, result, selectedReference, onLoadMore, onSelect } = props;
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedKey = selectedReference ? stableKey(selectedReference) : '';
  const selectedIndex = useMemo(
    () => result?.items.findIndex((item) => stableKey(item) === selectedKey) ?? -1,
    [result?.items, selectedKey],
  );

  const choose = (index: number) => {
    const item = result?.items[index];
    if (!item) return;
    onSelect(item);
    itemRefs.current[index]?.focus();
  };

  let status: string | null = null;
  if (!String(query || '').trim() && !result) status = t('localSearchNoQuery');
  else if (loading && !result) status = t('localSearchSearching');
  else if (errorMessage) status = errorMessage;
  else if (result && !result.items.length) status = t('localSearchEmpty');

  return (
    <section
      aria-label={t('localSearchResultsAria')}
      className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-border-r tw-border-[var(--border)] tw-bg-[var(--bg-primary)]"
    >
      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-p-3">
        <div className="tw-sr-only" aria-live="polite">
          {loading ? t('localSearchSearching') : status || (result ? String(result.items.length) : '')}
        </div>

        {status ? (
          <div className="tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-4 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
            {status}
          </div>
        ) : null}

        {result?.items.length ? (
          <div role="listbox" aria-label={t('localSearchResultsAria')} className="tw-flex tw-flex-col tw-gap-2">
            {result.items.map((item, index) => {
              const selected = stableKey(item) === selectedKey;
              const timestamp = formatTimestamp(item.lastCapturedAt);
              return (
                <button
                  key={stableKey(item)}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selectedIndex < 0 ? (index === 0 ? 0 : -1) : selected ? 0 : -1}
                  className={[
                    'tw-w-full tw-rounded-[var(--radius-card)] tw-border tw-p-3 tw-text-left tw-transition-colors',
                    selected
                      ? 'tw-border-[var(--accent)] tw-bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-card))]'
                      : 'tw-border-[var(--border)] tw-bg-[var(--bg-card)] hover:tw-bg-[var(--bg-sunken)]',
                  ].join(' ')}
                  onClick={() => onSelect(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      choose(Math.min(result.items.length - 1, index + 1));
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      choose(Math.max(0, index - 1));
                    } else if (event.key === 'Home') {
                      event.preventDefault();
                      choose(0);
                    } else if (event.key === 'End') {
                      event.preventDefault();
                      choose(result.items.length - 1);
                    }
                  }}
                >
                  <div className="tw-truncate tw-text-sm tw-font-extrabold tw-text-[var(--text-primary)]">
                    {item.title || item.conversationKey}
                  </div>
                  <div className="tw-mt-0.5 tw-flex tw-flex-wrap tw-gap-x-2 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
                    <span>{item.source}</span>
                    {item.siteKey && item.siteKey !== 'unknown' ? (
                      <span>{item.siteKey.replace(/^domain:/, '')}</span>
                    ) : null}
                    {timestamp ? <span>{timestamp}</span> : null}
                  </div>
                  <div className="tw-mt-2 tw-line-clamp-4 tw-whitespace-pre-wrap tw-break-words tw-text-xs tw-leading-5 tw-text-[var(--text-secondary)]">
                    {splitSearchSnippetHighlights(item.snippet, item.highlights).map((segment, segmentIndex) =>
                      segment.highlighted ? (
                        <mark
                          key={`${segmentIndex}:${segment.text}`}
                          className="tw-bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] tw-px-0.5 tw-text-inherit"
                        >
                          {segment.text}
                        </mark>
                      ) : (
                        <span key={`${segmentIndex}:${segment.text}`}>{segment.text}</span>
                      ),
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {result?.truncatedByScanLimit ? (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
            {t('localSearchTruncated')}
          </p>
        ) : null}
        {cursorStale ? (
          <p className="tw-mt-3 tw-text-xs tw-font-bold tw-text-[var(--error)]">{t('localSearchCursorStale')}</p>
        ) : null}
      </div>

      {result?.hasMore && result.cursor ? (
        <div className="tw-border-t tw-border-[var(--border)] tw-p-3">
          <button
            type="button"
            className={[buttonTintClassName(), 'tw-w-full'].join(' ')}
            disabled={loading}
            onClick={onLoadMore}
          >
            {loading ? t('localSearchLoadingMore') : t('localSearchLoadMore')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
