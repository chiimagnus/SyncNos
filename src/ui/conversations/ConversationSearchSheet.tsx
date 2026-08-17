import { useEffect, useMemo, useRef } from 'react';
import { Search, X } from 'lucide-react';

import { t } from '@i18n';
import type { ConversationListFacet, ConversationListFacets } from '@services/conversations/domain/list-pagination';
import type { LocalDataSearchResult } from '@services/local-data/contracts';
import type { ConversationSearchSheetController } from '@viewmodels/conversations/search-sheet-types';
import { resolveConversationSourceOptionLabel } from '@ui/conversations/conversation-list-tags';
import { ConversationSearchDisabledPrompt } from '@ui/conversations/ConversationSearchDisabledPrompt';
import { ConversationSearchPreview } from '@ui/conversations/ConversationSearchPreview';
import { ConversationSearchResults } from '@ui/conversations/ConversationSearchResults';
import { SelectMenu } from '@ui/shared/SelectMenu';
import { buttonFilledClassName, buttonIconCircleGhostClassName } from '@ui/shared/button-styles';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function searchErrorMessage(controller: ConversationSearchSheetController): string | null {
  if (!controller.searchError) return null;
  switch (controller.searchErrorCode) {
    case 'FTS_UNAVAILABLE':
      return t('localSearchFtsUnavailable');
    case 'MIGRATION_IN_PROGRESS':
      return t('localSearchMigrationBusy');
    case 'HOST_UNAVAILABLE':
    case 'DATABASE_NOT_INITIALIZED':
      return t('localSearchHostUnavailable');
    default:
      return controller.searchError || t('localSearchGenericError');
  }
}

function uniqueFacetOptions(
  facets: readonly ConversationListFacet[],
  current: string,
): Array<{ label: string; value: string }> {
  const byKey = new Map<string, string>();
  byKey.set('all', t('allFilter'));
  for (const facet of facets || []) {
    const key = String(facet?.key || '')
      .trim()
      .toLowerCase();
    if (!key || key === 'all') continue;
    byKey.set(key, resolveConversationSourceOptionLabel({ sourceKey: key, fallbackLabel: facet?.label, translate: t }));
  }
  if (current && !byKey.has(current)) {
    byKey.set(current, resolveConversationSourceOptionLabel({ sourceKey: current, translate: t }));
  }
  return [...byKey.entries()].map(([value, label]) => ({ value, label }));
}

function uniqueSiteOptions(
  facets: readonly ConversationListFacet[],
  current: string,
): Array<{ label: string; value: string }> {
  const byKey = new Map<string, string>();
  byKey.set('all', t('allFilter'));
  for (const facet of facets || []) {
    const key = String(facet?.key || '')
      .trim()
      .toLowerCase();
    if (!key || key === 'all') continue;
    const fallback = key.startsWith('domain:') ? key.slice('domain:'.length) : key;
    byKey.set(key, String(facet?.label || '').trim() || fallback);
  }
  if (current && !byKey.has(current)) byKey.set(current, current.replace(/^domain:/, ''));
  return [...byKey.entries()].map(([value, label]) => ({ value, label }));
}

export type ConversationSearchSheetProps = Readonly<{
  controller: ConversationSearchSheetController;
  initialFacets: ConversationListFacets;
  onClose: () => void;
  onOpenFullConversation: (result: LocalDataSearchResult) => void;
  onOpenSettings: () => void;
}>;

export function ConversationSearchSheet({
  controller,
  initialFacets,
  onClose,
  onOpenFullConversation,
  onOpenSettings,
}: ConversationSearchSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const queryRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const resultFacets = controller.result?.facets;
  const sourceOptions = useMemo(
    () =>
      uniqueFacetOptions(
        resultFacets?.sources?.length ? resultFacets.sources : initialFacets.sources,
        controller.draft.sourceKey,
      ),
    [controller.draft.sourceKey, initialFacets.sources, resultFacets?.sources],
  );
  const siteOptions = useMemo(
    () =>
      uniqueSiteOptions(
        resultFacets?.sites?.length ? resultFacets.sites : initialFacets.sites,
        controller.draft.siteKey,
      ),
    [controller.draft.siteKey, initialFacets.sites, resultFacets?.sites],
  );
  const selectedResult = useMemo(() => {
    const reference = controller.preview.reference;
    if (!reference) return null;
    return (
      controller.result?.items.find(
        (item) => item.source === reference.source && item.conversationKey === reference.conversationKey,
      ) ?? null
    );
  }, [controller.preview.reference, controller.result?.items]);
  const errorMessage = searchErrorMessage(controller);
  const showSiteFilter = controller.draft.sourceKey === 'all' || controller.draft.sourceKey === 'web';
  const canSubmit = Boolean(controller.draft.query.trim());

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const target = restoreFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (controller.mode === 'search') queryRef.current?.focus();
      else closeRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [controller.capabilityLoading, controller.mode]);

  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    if (!focusable.length) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('localSearchDialogAria')}
      onKeyDown={trapFocus}
    >
      <div
        data-conversation-search-backdrop=""
        className="tw-absolute tw-inset-0 tw-bg-[var(--bg-overlay)]"
        role="presentation"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="tw-relative tw-z-10 tw-flex tw-h-[min(760px,calc(100vh-40px))] tw-w-[min(1120px,calc(100vw-40px))] tw-min-w-0 tw-flex-col tw-overflow-hidden tw-rounded-[var(--radius-outer)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('localSearchCloseAria')}
          className={['tw-absolute tw-right-2 tw-top-2 tw-z-20', buttonIconCircleGhostClassName()].join(' ')}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>

        {controller.capabilityLoading ? (
          <div
            className="tw-flex tw-h-full tw-items-center tw-justify-center tw-p-6 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]"
            aria-live="polite"
          >
            {t('localSearchCapabilityLoading')}
          </div>
        ) : controller.mode === 'disabled' ? (
          <ConversationSearchDisabledPrompt onOpenSettings={onOpenSettings} />
        ) : (
          <>
            <form
              className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-p-3 tw-pr-12"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit) void controller.submit();
              }}
            >
              <label className="tw-relative tw-min-w-[220px] tw-flex-1">
                <span className="tw-sr-only">{t('localSearchQueryAria')}</span>
                <Search
                  size={15}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="tw-pointer-events-none tw-absolute tw-left-3 tw-top-1/2 -tw-translate-y-1/2 tw-text-[var(--text-secondary)]"
                />
                <input
                  ref={queryRef}
                  value={controller.draft.query}
                  onChange={(event) => controller.setQuery(event.target.value)}
                  placeholder={t('localSearchQueryPlaceholder')}
                  aria-label={t('localSearchQueryAria')}
                  className="tw-h-9 tw-w-full tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-pl-9 tw-pr-3 tw-text-sm tw-text-[var(--text-primary)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--focus-ring)]"
                />
              </label>
              <SelectMenu<string>
                value={controller.draft.sourceKey}
                onChange={controller.setSourceKey}
                ariaLabel={t('localSearchSourceFilterAria')}
                minWidth={150}
                options={sourceOptions}
              />
              {showSiteFilter ? (
                <SelectMenu<string>
                  value={controller.draft.siteKey}
                  onChange={controller.setSiteKey}
                  ariaLabel={t('localSearchSiteFilterAria')}
                  minWidth={160}
                  options={siteOptions}
                />
              ) : null}
              <SelectMenu<'best' | 'recent'>
                value={controller.draft.sort}
                onChange={controller.setSort}
                ariaLabel={t('localSearchSortAria')}
                minWidth={140}
                options={[
                  { value: 'best', label: t('localSearchSortBest') },
                  { value: 'recent', label: t('localSearchSortRecent') },
                ]}
              />
              <button type="submit" className={buttonFilledClassName()} disabled={!canSubmit}>
                {t('localSearchSearchAction')}
              </button>
            </form>

            <div
              className="tw-grid tw-min-h-0 tw-flex-1 tw-grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)]"
              aria-busy={controller.searchLoading}
            >
              <ConversationSearchResults
                query={controller.draft.query}
                result={controller.result}
                loading={controller.searchLoading}
                errorMessage={errorMessage}
                cursorStale={controller.cursorStale}
                selectedReference={controller.preview.reference}
                onSelect={(result) => void controller.selectResult(result)}
                onLoadMore={() => void controller.loadMore()}
              />
              <ConversationSearchPreview
                preview={controller.preview}
                selectedResult={selectedResult}
                onOpenFullConversation={onOpenFullConversation}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
