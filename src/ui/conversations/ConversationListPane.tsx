import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Conversation } from '@services/conversations/domain/models';
import { writeTextToClipboard } from '@services/shared/clipboard';
import { createTwoStepConfirmController } from '@services/shared/two-step-confirm';
import { sanitizeHttpUrl } from '@services/url-cleaning/http-url';
import { openOrFocusExtensionAppTab } from '@services/shared/webext';
import { buildConversationSidebarRenderItems } from '@services/conversations/domain/sidebar-time-groups';

import { t, formatConversationTitle, getCurrentLocale } from '@i18n';
import type { SyncProvider } from '@services/sync/models';
import { getSyncProviderDefinition } from '@services/sync/sync-provider-registry';
import {
  resolveConversationListTag,
  resolveConversationSourceOptionLabel,
} from '@ui/conversations/conversation-list-tags';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { ConversationSyncFeedbackNotice } from '@ui/conversations/ConversationSyncFeedbackNotice';
import { navItemClassName } from '@ui/shared/nav-styles';
import {
  buttonDangerClassName,
  buttonDangerTintClassName,
  buttonFilledClassName,
  buttonCompactMutedClassName,
  buttonMenuItemClassName,
  buttonMiniIconClassName,
  buttonTintClassName,
} from '@ui/shared/button-styles';
import { MenuPopover } from '@ui/shared/MenuPopover';
import { SelectMenu } from '@ui/shared/SelectMenu';
import { tooltipAttrs } from '@ui/shared/AppTooltip';

const SITE_FILTER_ALL_KEY = 'all';
const SITE_FILTER_UNKNOWN_KEY = 'unknown';
const MAX_LOCATE_LOAD_ROUNDS = 8;

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function providerButtonLabel(provider: SyncProvider) {
  const definition = getSyncProviderDefinition(provider);
  const labelKey = definition?.labelKey;
  const label = labelKey ? t(labelKey as any) : '';
  return label || String(provider || '');
}

function isPopupUi() {
  try {
    const p = String(globalThis.location?.pathname || '').toLowerCase();
    return p.includes('popup.html');
  } catch (_e) {
    return false;
  }
}

function syncMenuItemLabel(provider: SyncProvider, syncing: boolean) {
  const labels: Record<SyncProvider, { idle: string; busy: string }> = {
    notion: { idle: t('notionSync'), busy: t('notionSyncing') },
    obsidian: { idle: t('obsidianSync'), busy: t('obsidianSyncing') },
    feishu: { idle: t('feishuSync'), busy: t('feishuSyncing') },
    github: { idle: t('githubSync'), busy: t('githubSyncing') },
  };
  return syncing ? labels[provider].busy : labels[provider].idle;
}

const SYNC_MENU_ITEM_IDS: Record<SyncProvider, string> = {
  obsidian: 'menuSyncToObsidian',
  notion: 'menuSyncToNotion',
  feishu: 'menuSyncToFeishu',
  github: 'menuSyncToGithub',
};

export type ConversationListPaneProps = {
  onOpenConversation?: (conversationId: number) => void;
  onOpenInsightsSection?: () => void;
  onOpenSettingsSection?: (section: string) => void;
  activeRowId?: number | null;
  onPopupNotionSyncStarted?: () => void;
  onPopupFeishuSyncStarted?: () => void;
  initialScrollTop?: number;
  scrollRestoreKey?: number;
  onListScrollTopChange?: (scrollTop: number) => void;
};

export function ConversationListPane({
  onOpenConversation,
  onOpenInsightsSection,
  onOpenSettingsSection,
  activeRowId,
  onPopupNotionSyncStarted,
  onPopupFeishuSyncStarted,
  initialScrollTop = 0,
  scrollRestoreKey = 0,
  onListScrollTopChange,
}: ConversationListPaneProps) {
  const {
    items,
    activeId,
    selectedIds,
    toggleAll,
    toggleSelected,
    activateLoadedConversation,
    clearSelected,
    openConversationInListScopeById,
    exporting,
    listError,
    syncFeedback,
    syncingNotion,
    syncingObsidian,
    syncingFeishu,
    syncingGithub,
    enabledSyncProviders,
    deleting,
    listSourceFilterKey,
    listSiteFilterKey,
    listSummary,
    listFacets,
    listHasMore,
    loadingInitialList,
    loadingMoreList,
    setListSourceFilterKeyPersistent,
    setListSiteFilterKeyPersistent,
    pendingListLocateId,
    consumeListLocate,
    loadMoreList,
    copyConversationMarkdown,
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    syncSelectedFeishu,
    syncSelectedGithub,
    clearSyncFeedback,
    deleteSelected,
    refreshList,
  } = useConversationsApp();

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const locateLoadRoundRef = useRef<{ id: number; rounds: number }>({ id: 0, rounds: 0 });

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  const copiedLinkTimerRef = useRef<number | null>(null);

  const [, forceDeleteConfirmRender] = useState(0);
  const deleteConfirm = useMemo(
    () =>
      createTwoStepConfirmController<string>({
        onChange: () => forceDeleteConfirmRender((v) => v + 1),
      }),
    [],
  );

  const sourceOptions = useMemo(() => {
    const facets = Array.isArray((listFacets as any)?.sources) ? (listFacets as any).sources : [];
    const normalized = facets
      .map((facet: any) => {
        const key = String(facet?.key || '')
          .trim()
          .toLowerCase();
        if (!key) return null;
        const label = resolveConversationSourceOptionLabel({
          sourceKey: key,
          fallbackLabel: facet?.label,
          translate: t,
        });
        const count = Number(facet?.count) || 0;
        if (count <= 0) return null;
        return { key, label, count };
      })
      .filter((item: any): item is { key: string; label: string; count: number } => Boolean(item));
    return [{ key: 'all', label: t('allFilter') }, ...normalized];
  }, [listFacets]);

  const siteOptions = useMemo(() => {
    const key =
      String(listSourceFilterKey || 'all')
        .trim()
        .toLowerCase() || 'all';
    if (key !== 'web') return [{ key: SITE_FILTER_ALL_KEY, label: t('allFilter') }];
    const facets = Array.isArray((listFacets as any)?.sites) ? (listFacets as any).sites : [];
    const options = facets
      .map((facet: any) => {
        const facetKey = String(facet?.key || '')
          .trim()
          .toLowerCase();
        if (!facetKey || facetKey === SITE_FILTER_ALL_KEY) return null;
        const rawLabel = String(facet?.label || '').trim();
        const fallbackLabel = facetKey.startsWith('domain:') ? facetKey.slice('domain:'.length) : facetKey;
        const label = facetKey === SITE_FILTER_UNKNOWN_KEY ? t('insightUnknownLabel') : rawLabel || fallbackLabel;
        const count = Number(facet?.count) || 0;
        if (count <= 0) return null;
        return { key: facetKey, label };
      })
      .filter((item: any): item is { key: string; label: string } => Boolean(item));
    return [{ key: SITE_FILTER_ALL_KEY, label: t('allFilter') }, ...options];
  }, [listFacets, listSourceFilterKey]);

  const filteredItems = items;
  const sidebarLocale = getCurrentLocale();
  const todayGroupLabel = t('insightRangeToday');
  const yesterdayGroupLabel = t('conversationGroupYesterday');
  const earlierGroupLabel = t('conversationGroupEarlier');
  const renderedItems = useMemo(
    () =>
      buildConversationSidebarRenderItems({
        conversations: filteredItems,
        locale: sidebarLocale,
        labels: {
          today: todayGroupLabel,
          yesterday: yesterdayGroupLabel,
          earlier: earlierGroupLabel,
        },
      }),
    [earlierGroupLabel, filteredItems, sidebarLocale, todayGroupLabel, yesterdayGroupLabel],
  );
  const sectionIdsByKey = useMemo(() => {
    const idsByKey = new Map<string, number[]>();
    let activeSectionKey = '';
    for (const entry of renderedItems) {
      if (entry.type === 'section') {
        activeSectionKey = entry.key;
        idsByKey.set(activeSectionKey, []);
        continue;
      }
      if (!activeSectionKey) continue;
      const id = Number((entry.conversation as any)?.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      idsByKey.get(activeSectionKey)?.push(id);
    }
    return idsByKey;
  }, [renderedItems]);
  const todayCount = Number((listSummary as any)?.todayCount) || 0;
  const totalCount = Number((listSummary as any)?.totalCount) || 0;

  const visibleIds = useMemo(
    () => filteredItems.map((c) => Number((c as any).id)).filter((x) => Number.isFinite(x) && x > 0),
    [filteredItems],
  );

  const visibleIdSet = useMemo(() => new Set(visibleIds.map((x) => Number(x))), [visibleIds]);
  const selectedInView = useMemo(
    () => selectedIds.filter((id) => visibleIdSet.has(Number(id))),
    [selectedIds, visibleIdSet],
  );

  const total = visibleIds.length;
  const selectedCount = selectedInView.length;
  const selectStateTotal = totalCount > 0 ? totalCount : total;
  const allSelected = selectStateTotal > 0 && selectedCount === selectStateTotal;
  const indeterminate = selectedCount > 0 && selectedCount < selectStateTotal;
  const selectedTotalCount = selectedIds.length;
  const hasLoadedItems = filteredItems.length > 0;
  const showPaginationLoadingMore = hasLoadedItems && loadingMoreList;
  const showPaginationError = hasLoadedItems && !loadingMoreList && Boolean(listError);
  const showPaginationDone = hasLoadedItems && !loadingInitialList && !loadingMoreList && !listError && !listHasMore;
  const paginationErrorMessage = String(listError || '').trim();

  useLayoutEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = indeterminate;
  }, [indeterminate, selectStateTotal, selectedCount]);

  const hasSelection = selectedTotalCount > 0;
  const actionBusy = exporting || deleting;
  const providerSyncing: Record<SyncProvider, boolean> = {
    notion: syncingNotion,
    obsidian: syncingObsidian,
    feishu: syncingFeishu,
    github: syncingGithub,
  };
  const syncingAny = Object.values(providerSyncing).some(Boolean);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
      if (copiedLinkTimerRef.current) window.clearTimeout(copiedLinkTimerRef.current);
      copiedLinkTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (hasSelection) return;
    deleteConfirm.clear();
    setExportOpen(false);
    setSyncOpen(false);
  }, [deleteConfirm, hasSelection]);

  useEffect(() => {
    if (!syncingAny) return;
    deleteConfirm.clear();
  }, [deleteConfirm, syncingAny]);

  useEffect(() => {
    if (!actionBusy) return;
    deleteConfirm.clear();
  }, [actionBusy, deleteConfirm]);

  useEffect(() => {
    if (syncFeedback.phase !== 'success') return;
    const timer = window.setTimeout(() => {
      clearSyncFeedback();
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [clearSyncFeedback, syncFeedback.phase, syncFeedback.updatedAt]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nextTop = Math.max(0, Number(initialScrollTop) || 0);
    el.scrollTop = nextTop;
  }, [initialScrollTop, scrollRestoreKey]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel) return;
    if (typeof IntersectionObserver !== 'function') return;
    if (!listHasMore) return;
    if (listError) return;

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        const entry = entries[0];
        if (!entry || !entry.isIntersecting) return;
        if (loadingMoreList) return;
        if (!listHasMore) return;
        if (listError) return;
        void loadMoreList();
      },
      {
        root,
        threshold: 0.01,
        rootMargin: '0px 0px 240px 0px',
      },
    );
    observer.observe(sentinel);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [listError, listHasMore, loadMoreList, loadingMoreList]);

  useEffect(() => {
    const id = Number(pendingListLocateId);
    if (!Number.isFinite(id) || id <= 0) {
      locateLoadRoundRef.current = { id: 0, rounds: 0 };
      return;
    }

    if (locateLoadRoundRef.current.id !== id) {
      locateLoadRoundRef.current = { id, rounds: 0 };
    }

    const container = scrollRef.current;
    const selector = `[data-conversation-id="${id}"]`;
    const row = container ? (container.querySelector(selector) as HTMLElement | null) : null;
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
      locateLoadRoundRef.current = { id: 0, rounds: 0 };
      consumeListLocate();
      return;
    }

    // The list may not have been loaded yet. Keep the pending locate request
    // until we have at least one page (or an error) to avoid clearing it too early.
    if (loadingInitialList || loadingMoreList) return;

    if (listError) {
      locateLoadRoundRef.current = { id: 0, rounds: 0 };
      consumeListLocate();
      return;
    }

    if (!listHasMore) {
      if (!items.length) return;
      locateLoadRoundRef.current = { id: 0, rounds: 0 };
      consumeListLocate();
      return;
    }

    if (locateLoadRoundRef.current.rounds >= MAX_LOCATE_LOAD_ROUNDS) {
      locateLoadRoundRef.current = { id: 0, rounds: 0 };
      consumeListLocate();
      return;
    }

    locateLoadRoundRef.current = { id, rounds: locateLoadRoundRef.current.rounds + 1 };
    void loadMoreList();
  }, [
    consumeListLocate,
    listError,
    listHasMore,
    loadMoreList,
    loadingInitialList,
    loadingMoreList,
    pendingListLocateId,
    items,
  ]);

  const onSetFilterKey = (key: string) => {
    const next =
      String(key || 'all')
        .trim()
        .toLowerCase() || 'all';
    setListSourceFilterKeyPersistent(next);
    clearSelected();
    deleteConfirm.clear();
    setExportOpen(false);
    setSyncOpen(false);
  };

  const onSetSiteFilterKey = (key: string) => {
    const next =
      String(key || SITE_FILTER_ALL_KEY)
        .trim()
        .toLowerCase() || SITE_FILTER_ALL_KEY;
    setListSiteFilterKeyPersistent(next);
    clearSelected();
    deleteConfirm.clear();
    setExportOpen(false);
    setSyncOpen(false);
  };

  const onRetryPagination = () => {
    if (listHasMore) {
      void loadMoreList();
      return;
    }
    void refreshList();
  };

  const activateRow = (conversationId: number) => {
    onListScrollTopChange?.(scrollRef.current?.scrollTop || 0);
    const id = Number(conversationId);
    activateLoadedConversation(id);
    onOpenConversation?.(id);
  };

  const onRowClick = (e: React.MouseEvent, conversationId: number) => {
    if (!e || e.button !== 0) return;
    const target = e.target as any;
    if (target && target.closest) {
      if (target.closest("input[type='checkbox'], label")) return;
      if (target.closest('button')) return;
      if (target.closest('a')) return;
    }
    activateRow(conversationId);
  };

  const onRowKeyDown = (e: React.KeyboardEvent, conversationId: number) => {
    if (!e) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as any;
    if (target && target.closest) {
      if (target.closest("input[type='checkbox'], label, button, a")) return;
    }
    e.preventDefault();
    e.stopPropagation();
    activateRow(conversationId);
  };

  const onCopyConversation = async (conversation: Conversation, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = Number((conversation as any).id);
    try {
      await copyConversationMarkdown(id);
      setCopiedId(id);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedId(null);
        copiedTimerRef.current = null;
      }, 1100);
    } catch (err) {
      alert((err as any)?.message ?? t('copyFailed'));
    }
  };

  const onCopyConversationUrl = async (conversation: Conversation, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const safe = sanitizeHttpUrl((conversation as any).url || '');
    if (!safe) return;
    const id = Number((conversation as any).id);
    try {
      const copied = await writeTextToClipboard(safe);
      if (!copied) throw new Error(t('copyFailed'));
      setCopiedLinkId(id);
      if (copiedLinkTimerRef.current) window.clearTimeout(copiedLinkTimerRef.current);
      copiedLinkTimerRef.current = window.setTimeout(() => {
        setCopiedLinkId(null);
        copiedLinkTimerRef.current = null;
      }, 1100);
    } catch (err) {
      alert((err as any)?.message ?? t('copyFailed'));
    }
  };

  const effectiveActiveRowId = activeRowId != null ? activeRowId : activeId;
  const actionButton = buttonTintClassName();
  const dangerSurfaceButton = buttonDangerTintClassName();
  const menuItemButtonClassName = buttonMenuItemClassName();

  const syncMenuBaseLabel = t('syncTo');
  const syncMenuButtonLabel =
    syncFeedback.phase === 'running' && syncFeedback.provider
      ? syncMenuItemLabel(syncFeedback.provider, true)
      : syncMenuBaseLabel;

  const singleSyncProvider = enabledSyncProviders.length === 1 ? enabledSyncProviders[0] : null;
  const singleSyncLabel = singleSyncProvider
    ? syncFeedback.phase === 'running' && syncFeedback.provider === singleSyncProvider
      ? syncMenuItemLabel(singleSyncProvider, true)
      : providerButtonLabel(singleSyncProvider)
    : '';

  const syncProviderActions: Record<SyncProvider, () => void> = {
    obsidian: () => {
      void syncSelectedObsidian().catch(() => {});
    },
    notion: () => {
      void syncSelectedNotion().catch(() => {});
      onPopupNotionSyncStarted?.();
    },
    feishu: () => {
      void syncSelectedFeishu().catch(() => {});
      onPopupFeishuSyncStarted?.();
    },
    github: () => {
      void syncSelectedGithub().catch(() => {});
    },
  };

  const startSyncProvider = (provider: SyncProvider) => {
    syncProviderActions[provider]();
  };

  const onNoticeJumpToConversation = (conversationId: number) => {
    const id = Number(conversationId);
    if (!Number.isFinite(id) || id <= 0) return;
    openConversationInListScopeById(id);
    onOpenConversation?.(id);
  };

  const onConfirmDelete = async () => {
    deleteConfirm.clear();
    await deleteSelected();
  };

  useEffect(() => {
    return () => {
      deleteConfirm.dispose();
    };
  }, [deleteConfirm]);

  const deleteConfirmKey = useMemo(() => {
    if (!hasSelection) return '';
    const normalized = Array.from(new Set(selectedIds.map((x) => Number(x) || 0)))
      .filter((id) => Number.isFinite(id) && id > 0)
      .sort((a, b) => a - b);
    return normalized.join(',');
  }, [hasSelection, selectedIds]);

  const armedDeleteKey = deleteConfirm.getArmedKey();
  const deleteConfirming = !!deleteConfirmKey && armedDeleteKey != null && deleteConfirm.isArmed(deleteConfirmKey);
  const loadedVisibleScopeHint = t('tooltipLoadedVisibleSelectionScope');
  const loadedSelectionAction = total > 0 && selectedCount === total ? t('deselectLoadedItems') : t('selectAll');
  const loadedSelectionTooltip = total > 0 ? `${loadedSelectionAction} (${total})` : loadedSelectionAction;
  const deleteTooltip = deleteConfirming
    ? `${t('tooltipDeleteSelectedConfirmDetailed')} · ${loadedVisibleScopeHint}`
    : hasSelection
      ? `${t('tooltipDeleteSelectedDetailed')} (${selectedTotalCount}) · ${loadedVisibleScopeHint}`
      : t('tooltipDeleteSelectedDetailed');
  const exportTooltip = hasSelection
    ? `${t('tooltipExportDetailed')} (${selectedTotalCount}) · ${loadedVisibleScopeHint}`
    : t('tooltipExportSelectFirstDetailed');
  const singleSyncTooltip = hasSelection
    ? `${t('tooltipSyncDetailed')} (${selectedTotalCount}) · ${singleSyncLabel} · ${loadedVisibleScopeHint}`
    : t('tooltipSyncSelectFirstDetailed');
  const syncMenuTooltip =
    enabledSyncProviders.length === 0
      ? t('tooltipSyncProvidersDisabledDetailed')
      : hasSelection
        ? `${t('tooltipSyncDetailed')} (${selectedTotalCount}) · ${loadedVisibleScopeHint}`
        : t('tooltipSyncSelectFirstDetailed');

  useEffect(() => {
    if (armedDeleteKey == null) return;
    if (armedDeleteKey === deleteConfirmKey) return;
    deleteConfirm.clear();
  }, [armedDeleteKey, deleteConfirm, deleteConfirmKey]);

  useEffect(() => {
    if (armedDeleteKey == null) return;
    const onPointerDown = (event: Event) => {
      const target = (event as any).target as Node | null;
      const btn = deleteButtonRef.current;
      if (btn && target && btn.contains(target)) return;
      deleteConfirm.clear();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      deleteConfirm.clear();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [armedDeleteKey, deleteConfirm]);

  const sourceFilterActive =
    String(listSourceFilterKey || 'all')
      .trim()
      .toLowerCase() !== 'all';

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div
        ref={scrollRef}
        className="route-scroll tw-relative tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden"
        onScroll={() => onListScrollTopChange?.(scrollRef.current?.scrollTop || 0)}
      >
        <div className="tw-grid tw-gap-2 tw-p-3">
          {filteredItems.length ? null : (
            <div className="tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('noConversations')}
            </div>
          )}

          {renderedItems.map((entry) => {
            if (entry.type === 'section') {
              const sectionIds = sectionIdsByKey.get(entry.key) || [];
              const selectedInSection = sectionIds.filter((id) => selectedIds.includes(id)).length;
              const sectionAllSelected = sectionIds.length > 0 && selectedInSection === sectionIds.length;
              return (
                <div key={entry.key} className="tw-sticky tw-top-0 tw-z-10 tw-w-fit tw-justify-self-start tw-py-1.5">
                  <button
                    type="button"
                    className={buttonCompactMutedClassName()}
                    data-conversation-section-select={entry.key}
                    aria-pressed={sectionAllSelected}
                    onClick={() => toggleAll(sectionIds)}
                  >
                    {entry.label}
                  </button>
                </div>
              );
            }

            const conversation = entry.conversation;
            const id = Number((conversation as any).id);
            const checked = selectedIds.includes(id);
            const sourceTag = resolveConversationListTag({
              conversation: conversation as Conversation,
              translate: t,
            });
            const commentThreadCount = Number((conversation as any).commentThreadCount);
            const safeUrl = sanitizeHttpUrl((conversation as any).url || '');
            const isActive = Number(id) === Number(effectiveActiveRowId);

            const rowSurfaceClass = isActive
              ? 'tw-border tw-border-[color-mix(in_srgb,var(--accent)_58%,var(--border))] tw-shadow-[inset_0_1px_0_var(--surface-inset-highlight)]'
              : 'tw-border tw-border-[color-mix(in_srgb,var(--border)_82%,transparent)] tw-bg-[var(--bg-card)] hover:tw-border-[color-mix(in_srgb,var(--border)_96%,transparent)]';
            const rowClass = [
              navItemClassName(isActive),
              'tw-group tw-relative tw-items-start tw-gap-2.5 tw-rounded-[var(--radius-card)]',
              rowSurfaceClass,
            ].join(' ');

            const checkboxInputClass = isActive
              ? 'tw-size-4 tw-cursor-pointer tw-accent-[var(--accent-foreground)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]'
              : 'tw-size-4 tw-cursor-pointer tw-accent-[var(--accent)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]';

            return (
              <div
                key={entry.key}
                className={rowClass}
                data-conversation-id={String((conversation as any).id)}
                aria-label={formatConversationTitle((conversation as any).title)}
                onClick={(e) => onRowClick(e, id)}
                onKeyDown={(e) => onRowKeyDown(e, id)}
                role="button"
                tabIndex={0}
              >
                <label className="tw-mt-0.5 tw-inline-flex tw-items-start tw-text-inherit tw-opacity-80">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelected(id)}
                    aria-label={t('selectLabel')}
                    className={checkboxInputClass}
                  />
                </label>

                <div className="tw-min-w-0 tw-flex-1">
                  <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                    <div className="tw-min-w-0 tw-flex-1 tw-overflow-hidden tw-font-semibold tw-leading-5 tw-break-words [overflow-wrap:anywhere] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
                      {formatConversationTitle((conversation as any).title)}
                    </div>
                  </div>

                  <div className="tw-mt-1 tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-text-[11px] tw-font-semibold tw-text-inherit tw-opacity-80">
                    <button
                      className={buttonMiniIconClassName(isActive)}
                      type="button"
                      aria-label={t('copyFullMarkdown')}
                      onClick={(e) => void onCopyConversation(conversation as any, e)}
                    >
                      {copiedId === id ? '✓' : '⧉'}
                    </button>

                    <button
                      type="button"
                      className={[buttonCompactMutedClassName(), 'tw-relative'].join(' ')}
                      aria-label={`${t('detailHeaderCopyLinkMenuLabel')}: ${sourceTag.label}`}
                      data-conversation-source-link={String(id)}
                      disabled={!safeUrl}
                      onClick={(e) => void onCopyConversationUrl(conversation as any, e)}
                    >
                      <span className={copiedLinkId === id ? 'tw-invisible' : undefined}>{sourceTag.label}</span>
                      {copiedLinkId === id ? (
                        <span
                          className="tw-absolute tw-inset-0 tw-flex tw-items-center tw-justify-center"
                          data-conversation-source-link-check={String(id)}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                      ) : null}
                    </button>

                    {Number.isFinite(commentThreadCount) && commentThreadCount > 0 ? (
                      <span
                        className="tw-inline-flex tw-items-center tw-text-[10px] tw-font-extrabold"
                        aria-label={`Comment threads ${commentThreadCount}`}
                      >
                        {'💬 '}
                        {commentThreadCount}
                      </span>
                    ) : null}

                    {(conversation as any).lastCapturedAt ? (
                      <span className="tw-text-[11px] tw-font-semibold">
                        {formatTime((conversation as any).lastCapturedAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={loadMoreSentinelRef} aria-hidden="true" className="tw-h-4 tw-w-full tw-shrink-0" />

          {showPaginationLoadingMore ? (
            <div className="tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-2 tw-text-center tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('paginationLoadingMore')}
            </div>
          ) : null}

          {showPaginationError ? (
            <div className="tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--error)] tw-bg-[color-mix(in_srgb,var(--error)_10%,var(--bg-card))] tw-p-2 tw-text-[11px] tw-font-semibold tw-text-[var(--text-primary)]">
              <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
                <span className="tw-truncate">{t('paginationLoadMoreFailed')}</span>
                <button
                  type="button"
                  className={buttonTintClassName()}
                  onClick={onRetryPagination}
                  aria-label={t('paginationRetryLoadMore')}
                >
                  {t('paginationRetryLoadMore')}
                </button>
              </div>
              {paginationErrorMessage ? (
                <p className="tw-mt-1 tw-break-all tw-text-[10px] tw-font-medium tw-text-[var(--error)]">
                  {paginationErrorMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          {showPaginationDone ? (
            <div className="tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-2 tw-text-center tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('paginationAllLoaded')}
            </div>
          ) : null}
        </div>
      </div>

      <div className="tw-border-t tw-border-[var(--border)] tw-bg-[var(--bg-primary)]">
        <div className="tw-px-3 tw-py-2">
          <div
            className={[
              'tw-flex tw-min-h-9 tw-flex-nowrap tw-items-center tw-gap-1.5 tw-p-0',
              hasSelection ? 'hasSelection' : '',
            ].join(' ')}
          >
            <label
              className="tw-inline-flex tw-items-center tw-justify-center tw-text-[var(--text-secondary)]"
              aria-label={t('selectAll')}
              {...tooltipAttrs(hasSelection ? loadedSelectionTooltip : '')}
            >
              <input
                ref={selectAllRef}
                id="chkSelectAll"
                type="checkbox"
                aria-label={t('selectAll')}
                checked={allSelected}
                onChange={() => toggleAll(visibleIds)}
                className="tw-size-4 tw-cursor-pointer tw-accent-[var(--accent)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
              />
              <span className="tw-sr-only">{t('selectAll')}</span>
            </label>

            <SelectMenu<string>
              buttonId="sourceFilterSelect"
              className={hasSelection ? 'tw-hidden' : ''}
              value={listSourceFilterKey}
              onChange={(next) => onSetFilterKey(next)}
              disabled={hasSelection}
              ariaLabel={t('sourceFilterAria')}
              side="top"
              align="start"
              minWidth={150}
              adaptiveMaxHeight
              chevronOverlay
              triggerLabelClassName="tw-min-w-0 tw-flex-1 tw-overflow-hidden tw-whitespace-nowrap tw-text-left"
              buttonClassName={[
                sourceFilterActive ? buttonFilledClassName() : buttonTintClassName(),
                'tw-w-[80px] tw-shrink-0',
              ].join(' ')}
              options={sourceOptions.map((opt) => ({ value: opt.key, label: opt.label }))}
            />

            {String(listSourceFilterKey || 'all')
              .trim()
              .toLowerCase() === 'web' ? (
              <SelectMenu<string>
                buttonId="siteFilterSelect"
                className={hasSelection ? 'tw-hidden' : ''}
                value={listSiteFilterKey}
                onChange={(next) => onSetSiteFilterKey(next)}
                disabled={hasSelection}
                ariaLabel={t('insightArticleDomainsTitle')}
                side="top"
                align="start"
                minWidth={160}
                adaptiveMaxHeight
                chevronOverlay
                triggerLabelClassName="tw-min-w-0 tw-flex-1 tw-overflow-hidden tw-whitespace-nowrap tw-text-left"
                buttonClassName={[buttonTintClassName(), 'tw-w-[80px] tw-shrink-0'].join(' ')}
                options={siteOptions.map((opt) => ({ value: opt.key, label: opt.label }))}
              />
            ) : null}

            <div
              id="chatActionButtons"
              className={[
                [
                  'tw-inline-flex tw-items-center tw-gap-1.5',
                  hasSelection ? 'tw-overflow-visible' : 'tw-overflow-hidden',
                ].join(' '),
                'tw-transition-[max-width,opacity,transform] tw-duration-[220ms] tw-ease-out motion-reduce:tw-transition-none',
                hasSelection
                  ? 'tw-max-w-[360px] tw-opacity-100 tw-translate-x-0 tw-scale-100 tw-pointer-events-auto'
                  : 'tw-max-w-0 tw-opacity-0 tw-translate-x-2 tw-scale-[0.98] tw-pointer-events-none',
              ].join(' ')}
            >
              <span className="tw-inline-flex" {...tooltipAttrs(hasSelection ? deleteTooltip : '')}>
                <button
                  id="btnDelete"
                  type="button"
                  ref={deleteButtonRef}
                  className={
                    deleteConfirming
                      ? buttonDangerClassName()
                      : [dangerSurfaceButton, 'webclipper-btn--icon webclipper-btn--icon-sm'].join(' ')
                  }
                  aria-pressed={deleteConfirming}
                  onClick={() => {
                    if (!hasSelection || actionBusy || syncingAny) return;
                    if (!deleteConfirmKey) return;
                    if (!deleteConfirm.isArmed(deleteConfirmKey)) {
                      deleteConfirm.arm(deleteConfirmKey);
                      return;
                    }
                    void onConfirmDelete();
                  }}
                  disabled={!hasSelection || actionBusy || syncingAny}
                >
                  {deleteConfirming ? (
                    t('deleteButton')
                  ) : (
                    <>
                      <span aria-hidden="true">×</span>
                      <span className="tw-sr-only">{t('deleteButton')}</span>
                    </>
                  )}
                </button>
              </span>

              <MenuPopover
                open={exportOpen}
                onOpenChange={setExportOpen}
                disabled={!hasSelection || actionBusy}
                ariaLabel={t('exportOptions')}
                side="top"
                align="end"
                panelMinWidth={150}
                trigger={(triggerProps) => (
                  <span className="tw-inline-flex" {...tooltipAttrs(hasSelection ? exportTooltip : '')}>
                    <button {...triggerProps} id="btnExport" className={actionButton}>
                      <span className="tw-leading-none">{t('exportButton')}</span>
                      <span
                        className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                        aria-hidden="true"
                      >
                        ▾
                      </span>
                    </button>
                  </span>
                )}
              >
                <button
                  id="menuExportSingleMarkdown"
                  className={menuItemButtonClassName}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    void exportSelectedMarkdown({ mergeSingle: true });
                  }}
                >
                  {t('singleMarkdown')}
                </button>
                <button
                  id="menuExportMultiMarkdown"
                  className={menuItemButtonClassName}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    void exportSelectedMarkdown({ mergeSingle: false });
                  }}
                >
                  {t('multiMarkdown')}
                </button>
              </MenuPopover>

              {singleSyncProvider ? (
                <span className="tw-inline-flex" {...tooltipAttrs(hasSelection ? singleSyncTooltip : '')}>
                  <button
                    id="btnSyncProvider"
                    className={actionButton}
                    type="button"
                    disabled={
                      !hasSelection || exporting || deleting || actionBusy || providerSyncing[singleSyncProvider]
                    }
                    onClick={() => startSyncProvider(singleSyncProvider)}
                  >
                    <span className="tw-leading-none">{singleSyncLabel}</span>
                  </button>
                </span>
              ) : (
                <MenuPopover
                  open={syncOpen}
                  onOpenChange={setSyncOpen}
                  disabled={
                    enabledSyncProviders.length === 0 ? exporting || deleting : !hasSelection || exporting || deleting
                  }
                  ariaLabel={syncMenuBaseLabel}
                  side="top"
                  align="end"
                  panelMinWidth={170}
                  trigger={(triggerProps) => (
                    <span className="tw-inline-flex" {...tooltipAttrs(hasSelection ? syncMenuTooltip : '')}>
                      <button {...triggerProps} id="btnSyncTo" className={actionButton}>
                        <span className="tw-leading-none">{syncMenuButtonLabel}</span>
                        <span
                          className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                          aria-hidden="true"
                        >
                          ▾
                        </span>
                      </button>
                    </span>
                  )}
                >
                  {enabledSyncProviders.map((provider) => (
                    <button
                      key={provider}
                      id={SYNC_MENU_ITEM_IDS[provider]}
                      className={menuItemButtonClassName}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSyncOpen(false);
                        startSyncProvider(provider);
                      }}
                      disabled={actionBusy || providerSyncing[provider]}
                    >
                      {syncMenuItemLabel(provider, providerSyncing[provider])}
                    </button>
                  ))}
                  {enabledSyncProviders.length === 0 ? (
                    <button
                      id="menuSyncProvidersDisabled"
                      className={menuItemButtonClassName}
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setSyncOpen(false);
                        const section = getSyncProviderDefinition('obsidian')?.settingsSectionKey || 'obsidian';
                        if (onOpenSettingsSection) {
                          onOpenSettingsSection(section);
                        } else {
                          await openOrFocusExtensionAppTab({ route: `/settings?section=${section}` }).catch(() => null);
                        }
                        if (isPopupUi()) {
                          try {
                            window.close();
                          } catch (_e) {
                            // ignore
                          }
                        }
                      }}
                      disabled={exporting || deleting}
                    >
                      {t('syncAllProvidersDisabledMenuItem')}
                    </button>
                  ) : null}
                </MenuPopover>
              )}
            </div>

            <div className="tw-flex-1 tw-min-w-0" aria-hidden="true" />

            {onOpenInsightsSection ? (
              <button
                type="button"
                id="stats"
                aria-label={t('section_aboutyou_label')}
                title={t('section_aboutyou_label')}
                onClick={() => onOpenInsightsSection()}
                disabled={hasSelection}
                className={[
                  'tw-flex tw-flex-none tw-items-end tw-gap-0.5 tw-whitespace-nowrap tw-overflow-hidden tw-text-[14px] tw-font-semibold tw-leading-none tw-text-[var(--text-secondary)]',
                  'tw-appearance-none tw-bg-transparent tw-border-0',
                  'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
                  'tw-transition-[max-width,opacity,transform,padding] tw-duration-[220ms] tw-ease-out motion-reduce:tw-transition-none',
                  hasSelection
                    ? 'tw-max-w-0 tw-opacity-0 -tw-translate-x-2 tw-scale-[0.98] tw-p-0 tw-pointer-events-none'
                    : 'tw-max-w-[320px] tw-opacity-100 tw-translate-x-0 tw-scale-100 tw-px-1 tw-py-0',
                  hasSelection ? 'tw-cursor-default' : 'tw-cursor-pointer hover:tw-opacity-90',
                ].join(' ')}
              >
                <span className="tw-text-[var(--text-secondary)]">{t('todayLabel')}</span>
                <span className="tw-text-[30px] tw-font-extrabold tw-text-[var(--success)]">{String(todayCount)}</span>
                <span className="tw-text-[var(--text-secondary)] tw-opacity-70">·</span>
                <span className="tw-text-[var(--text-secondary)]">{t('totalLabel')}</span>
                <span className="tw-text-[30px] tw-font-extrabold tw-text-[#FFA500]">{String(totalCount)}</span>
              </button>
            ) : (
              <div
                id="stats"
                className={[
                  'tw-flex tw-flex-none tw-items-end tw-gap-0.5 tw-whitespace-nowrap tw-overflow-hidden tw-text-[14px] tw-font-semibold tw-leading-none tw-text-[var(--text-secondary)]',
                  'tw-transition-[max-width,opacity,transform,padding] tw-duration-[220ms] tw-ease-out motion-reduce:tw-transition-none',
                  hasSelection
                    ? 'tw-max-w-0 tw-opacity-0 -tw-translate-x-2 tw-scale-[0.98] tw-p-0 tw-pointer-events-none'
                    : 'tw-max-w-[320px] tw-opacity-100 tw-translate-x-0 tw-scale-100 tw-px-1 tw-py-0',
                ].join(' ')}
              >
                <span className="tw-text-[var(--text-secondary)]">{t('todayLabel')}</span>
                <span className="tw-text-[30px] tw-font-extrabold tw-text-[var(--success)]">{String(todayCount)}</span>
                <span className="tw-text-[var(--text-secondary)] tw-opacity-70">·</span>
                <span className="tw-text-[var(--text-secondary)]">{t('totalLabel')}</span>
                <span className="tw-text-[30px] tw-font-extrabold tw-text-[#FFA500]">{String(totalCount)}</span>
              </div>
            )}
          </div>

          <ConversationSyncFeedbackNotice
            feedback={syncFeedback}
            onDismiss={clearSyncFeedback}
            onJumpToConversation={onNoticeJumpToConversation}
          />
        </div>
      </div>
    </div>
  );
}
