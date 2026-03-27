import { useEffect, useMemo, useRef, useState } from 'react';

import type { Conversation } from '@services/conversations/domain/models';
import { getConversationDetail } from '@services/conversations/client/repo';
import { formatConversationMarkdownForExternalOutput } from '@services/integrations/chatwith/chatwith-settings';
import { createTwoStepConfirmController } from '@services/shared/two-step-confirm';
import { tabsCreate, openOrFocusExtensionAppTab } from '@services/shared/webext';
import { storageOnChanged } from '@services/shared/storage';

import { t, formatConversationTitle } from '@i18n';
import type { SyncProvider } from '@services/sync/models';
import { getEnabledSyncProviders, syncProviderEnabledStorageKey } from '@services/sync/sync-provider-gate';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { ConversationSyncFeedbackNotice } from '@ui/conversations/ConversationSyncFeedbackNotice';
import { navItemClassName } from '@ui/shared/nav-styles';
import {
  buttonDangerClassName,
  buttonDangerTintClassName,
  buttonFilledClassName,
  buttonMenuItemClassName,
  buttonMiniIconClassName,
  buttonTintClassName,
} from '@ui/shared/button-styles';
import { MenuPopover } from '@ui/shared/MenuPopover';
import { SelectMenu } from '@ui/shared/SelectMenu';
import { tooltipAttrs } from '@ui/shared/AppTooltip';

type SourceMeta = { key: string; label: string };

const SITE_FILTER_ALL_KEY = 'all';
const SITE_FILTER_UNKNOWN_KEY = 'unknown';
const MAX_LOCATE_LOAD_ROUNDS = 8;

function commonPrefix(a: string, b: string) {
  const left = String(a || '');
  const right = String(b || '');
  const limit = Math.min(left.length, right.length);
  let i = 0;
  for (; i < limit; i += 1) {
    if (left[i] !== right[i]) break;
  }
  return left.slice(0, i);
}

function normalizeSyncMenuLabel(text: string) {
  const raw = String(text || '');
  const trimmedRight = raw.replace(/[\s:：·•\-–—]+$/g, '').trimEnd();
  return trimmedRight || raw.trim();
}

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function hasWarningFlags(conversation: Conversation) {
  return Array.isArray((conversation as any).warningFlags) && ((conversation as any).warningFlags as any[]).length > 0;
}

function getSourceMeta(raw: unknown): SourceMeta {
  const text = String(raw || '').trim();
  if (!text) return { key: 'unknown', label: '' };
  const normalized = text.toLowerCase().replace(/[\s_-]+/g, '');
  const map: Record<string, SourceMeta> = {
    chatgpt: { key: 'chatgpt', label: t('sourceChatgpt') },
    claude: { key: 'claude', label: t('sourceClaude') },
    deepseek: { key: 'deepseek', label: t('sourceDeepseek') },
    notionai: { key: 'notionai', label: t('sourceNotionai') },
    gemini: { key: 'gemini', label: t('sourceGemini') },
    googleaistudio: { key: 'googleaistudio', label: t('sourceGoogleAiStudio') },
    kimi: { key: 'kimi', label: t('sourceKimi') },
    doubao: { key: 'doubao', label: t('sourceDoubao') },
    yuanbao: { key: 'yuanbao', label: t('sourceYuanbao') },
    poe: { key: 'poe', label: t('sourcePoe') },
    zai: { key: 'zai', label: t('sourceZai') },
    web: { key: 'web', label: t('sourceWeb') },
  };
  return map[normalized] || { key: 'unknown', label: text };
}

function sourceTagToneClass(key: string) {
  const safe = String(key || '')
    .trim()
    .toLowerCase();
  const map: Record<string, string> = {
    chatgpt:
      'tw-border-[var(--info)] tw-bg-[color-mix(in_srgb,var(--info)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    claude:
      'tw-border-[var(--secondary)] tw-bg-[color-mix(in_srgb,var(--secondary)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    deepseek:
      'tw-border-[var(--success)] tw-bg-[color-mix(in_srgb,var(--success)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    notionai:
      'tw-border-[var(--warning)] tw-bg-[color-mix(in_srgb,var(--warning)_16%,var(--bg-card))] tw-text-[var(--text-primary)]',
    gemini:
      'tw-border-[var(--info)] tw-bg-[color-mix(in_srgb,var(--info)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
    googleaistudio:
      'tw-border-[var(--info)] tw-bg-[color-mix(in_srgb,var(--info)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
    kimi: 'tw-border-[var(--warning)] tw-bg-[color-mix(in_srgb,var(--warning)_16%,var(--bg-card))] tw-text-[var(--text-primary)]',
    doubao:
      'tw-border-[var(--secondary)] tw-bg-[color-mix(in_srgb,var(--secondary)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
    yuanbao:
      'tw-border-[var(--tertiary)] tw-bg-[color-mix(in_srgb,var(--tertiary)_16%,var(--bg-card))] tw-text-[var(--text-primary)]',
    poe: 'tw-border-[var(--secondary)] tw-bg-[color-mix(in_srgb,var(--secondary)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
    zai: 'tw-border-[var(--info)] tw-bg-[color-mix(in_srgb,var(--info)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
    web: 'tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-text-[var(--text-secondary)]',
    unknown: 'tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-text-[var(--text-secondary)]',
  };
  return map[safe] || map.unknown;
}

function sanitizeHttpUrl(url: unknown) {
  const text = String(url || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  return '';
}

function providerButtonLabel(provider: SyncProvider) {
  return provider === 'notion' ? t('providerNotion') : t('providerObsidian');
}

function isPopupUi() {
  try {
    const p = String(globalThis.location?.pathname || '').toLowerCase();
    return p.includes('popup.html');
  } catch (_e) {
    return false;
  }
}

async function copyTextToClipboard(text: string) {
  const raw = String(text || '');
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(raw);
      return;
    }
  } catch (_e) {
    // fallthrough
  }
  const el = document.createElement('textarea');
  el.value = raw;
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  el.style.top = '0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  if (!ok) throw new Error('copy failed');
}

export type ConversationListPaneProps = {
  onOpenConversation?: (conversationId: number) => void;
  onOpenInsightsSection?: () => void;
  onOpenSettingsSection?: (section: string) => void;
  activeRowId?: number | null;
  onPopupNotionSyncStarted?: () => void;
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
    setActiveId,
    clearSelected,
    openConversationExternalById,
    exporting,
    syncFeedback,
    syncingNotion,
    syncingObsidian,
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
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    clearSyncFeedback,
    deleteSelected,
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
  const [enabledSyncProviders, setEnabledSyncProviders] = useState<SyncProvider[]>(['obsidian', 'notion']);

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
        const meta = getSourceMeta(key);
        const label = String(meta.label || facet?.label || key).trim();
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

  const siteOptionKeys = useMemo(() => new Set(siteOptions.map((opt) => String(opt.key || ''))), [siteOptions]);
  const filteredItems = items;
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
  const allSelected = total > 0 && selectedCount === total;
  const indeterminate = selectedCount > 0 && selectedCount < total;
  const selectedTotalCount = selectedIds.length;

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = indeterminate;
  }, [indeterminate]);

  const hasSelection = selectedTotalCount > 0;
  const actionBusy = exporting || deleting;
  const syncingAny = syncingNotion || syncingObsidian;

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const providers = await getEnabledSyncProviders().catch(() => null);
      if (disposed || !providers) return;
      const next = providers as SyncProvider[];
      setEnabledSyncProviders((current) => {
        if (current.length === next.length && current.every((value, idx) => value === next[idx])) return current;
        return next;
      });
    };
    void load();

    const notionKey = syncProviderEnabledStorageKey('notion');
    const obsidianKey = syncProviderEnabledStorageKey('obsidian');
    const unsubscribe = storageOnChanged((changes: any, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes || typeof changes !== 'object') return;
      if (
        Object.prototype.hasOwnProperty.call(changes, notionKey) ||
        Object.prototype.hasOwnProperty.call(changes, obsidianKey)
      ) {
        void load();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
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

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        const entry = entries[0];
        if (!entry || !entry.isIntersecting) return;
        if (loadingMoreList) return;
        if (!listHasMore) return;
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
  }, [listHasMore, loadMoreList, loadingMoreList]);

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

    if (!listHasMore) {
      locateLoadRoundRef.current = { id: 0, rounds: 0 };
      consumeListLocate();
      return;
    }

    if (locateLoadRoundRef.current.rounds >= MAX_LOCATE_LOAD_ROUNDS) {
      locateLoadRoundRef.current = { id: 0, rounds: 0 };
      consumeListLocate();
      return;
    }

    if (loadingInitialList || loadingMoreList) return;
    locateLoadRoundRef.current = { id, rounds: locateLoadRoundRef.current.rounds + 1 };
    void loadMoreList();
  }, [
    consumeListLocate,
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

  useEffect(() => {
    const sourceKey =
      String(listSourceFilterKey || 'all')
        .trim()
        .toLowerCase() || 'all';
    if (sourceKey !== 'web') return;

    const current =
      String(listSiteFilterKey || SITE_FILTER_ALL_KEY)
        .trim()
        .toLowerCase() || SITE_FILTER_ALL_KEY;
    if (current === SITE_FILTER_ALL_KEY) return;
    if (siteOptionKeys.has(current)) return;
    setListSiteFilterKeyPersistent(SITE_FILTER_ALL_KEY);
  }, [listSiteFilterKey, listSourceFilterKey, setListSiteFilterKeyPersistent, siteOptionKeys]);

  const activateRow = (conversationId: number) => {
    onListScrollTopChange?.(scrollRef.current?.scrollTop || 0);
    const id = Number(conversationId);
    setActiveId(id);
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
    e.preventDefault();
    e.stopPropagation();
    activateRow(conversationId);
  };

  const onCopyConversation = async (conversation: Conversation, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = Number((conversation as any).id);
    try {
      const d = await getConversationDetail(id);
      const mdText = await formatConversationMarkdownForExternalOutput(conversation as any, d as any);
      await copyTextToClipboard(mdText);
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

  const openConversationUrl = async (url: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const safe = sanitizeHttpUrl(url);
    if (!safe) return;
    try {
      await tabsCreate({ url: safe });
    } catch (_e) {
      // ignore
    }
  };

  const effectiveActiveRowId = activeRowId != null ? activeRowId : activeId;
  const actionButton = buttonTintClassName();
  const dangerSurfaceButton = buttonDangerTintClassName();
  const menuItemButtonClassName = buttonMenuItemClassName();

  const syncMenuBaseLabel = (() => {
    const prefix = commonPrefix(String(t('obsidianSync') || ''), String(t('notionSync') || ''));
    const normalized = normalizeSyncMenuLabel(prefix);
    if (normalized.length >= 2) return normalized;
    return t('syncTo');
  })();

  const syncMenuButtonLabel = syncingNotion
    ? t('notionSyncing')
    : syncingObsidian
      ? t('obsidianSyncing')
      : syncMenuBaseLabel;

  const singleSyncProvider = enabledSyncProviders.length === 1 ? enabledSyncProviders[0] : null;
  const singleSyncLabel = singleSyncProvider
    ? singleSyncProvider === 'notion'
      ? syncingNotion
        ? t('notionSyncing')
        : providerButtonLabel(singleSyncProvider)
      : syncingObsidian
        ? t('obsidianSyncing')
        : providerButtonLabel(singleSyncProvider)
    : '';

  const onNoticeJumpToConversation = (conversationId: number) => {
    const id = Number(conversationId);
    if (!Number.isFinite(id) || id <= 0) return;
    clearSelected();
    openConversationExternalById(id);
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
  const deleteTooltip = deleteConfirming
    ? t('tooltipDeleteSelectedConfirmDetailed')
    : hasSelection
      ? `${t('tooltipDeleteSelectedDetailed')} (${selectedTotalCount})`
      : t('tooltipDeleteSelectedDetailed');
  const exportTooltip = hasSelection
    ? `${t('tooltipExportDetailed')} (${selectedTotalCount})`
    : t('tooltipExportSelectFirstDetailed');
  const singleSyncTooltip = hasSelection
    ? `${t('tooltipSyncDetailed')} (${selectedTotalCount}) · ${singleSyncLabel}`
    : t('tooltipSyncSelectFirstDetailed');
  const syncMenuTooltip =
    enabledSyncProviders.length === 0
      ? t('tooltipSyncProvidersDisabledDetailed')
      : hasSelection
        ? `${t('tooltipSyncDetailed')} (${selectedTotalCount})`
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

          {filteredItems.map((conversation) => {
            const id = Number((conversation as any).id);
            const checked = selectedIds.includes(id);
            const { key: sourceKey, label: sourceLabel } = getSourceMeta((conversation as any).source);
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
                key={String((conversation as any).id)}
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
                    {hasWarningFlags(conversation as any) ? (
                      <span className="tw-inline-flex tw-rounded-[var(--radius-chip)] tw-border tw-border-[var(--warning)] tw-bg-[color-mix(in_srgb,var(--warning)_18%,var(--bg-card))] tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-extrabold tw-text-[var(--text-primary)]">
                        {t('warningBadge')}
                      </span>
                    ) : null}
                  </div>

                  <div className="tw-mt-1 tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-text-[11px] tw-font-semibold tw-text-inherit tw-opacity-80">
                    <span
                      className="tw-inline-flex"
                      {...tooltipAttrs(
                        copiedId === id
                          ? `${t('copied')} · ${t('tooltipCopyFullMarkdownDetailed')}`
                          : t('tooltipCopyFullMarkdownDetailed'),
                      )}
                    >
                      <button
                        className={buttonMiniIconClassName(isActive)}
                        type="button"
                        aria-label={t('copyFullMarkdown')}
                        onClick={(e) => void onCopyConversation(conversation as any, e)}
                      >
                        {copiedId === id ? '✓' : '⧉'}
                      </button>
                    </span>

                    <span
                      className="tw-inline-flex"
                      {...tooltipAttrs(
                        safeUrl ? t('tooltipOpenChatDetailed') : t('tooltipOpenChatMissingLinkDetailed'),
                      )}
                    >
                      <button
                        className={buttonMiniIconClassName(isActive)}
                        type="button"
                        aria-label={t('openOriginalChat')}
                        disabled={!safeUrl}
                        onClick={(e) => void openConversationUrl(String((conversation as any).url || ''), e)}
                      >
                        ↗
                      </button>
                    </span>

                    <span
                      className={[
                        'tw-inline-flex tw-items-center tw-border tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-extrabold',
                        'tw-rounded-[var(--radius-chip)]',
                        sourceTagToneClass(sourceKey),
                      ].join(' ')}
                    >
                      {sourceLabel}
                    </span>

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
              <span className="tw-inline-flex" {...tooltipAttrs(deleteTooltip)}>
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
                  <span className="tw-inline-flex" {...tooltipAttrs(exportTooltip)}>
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
                <span className="tw-inline-flex" {...tooltipAttrs(singleSyncTooltip)}>
                  <button
                    id="btnSyncProvider"
                    className={actionButton}
                    type="button"
                    disabled={
                      !hasSelection ||
                      exporting ||
                      deleting ||
                      actionBusy ||
                      (singleSyncProvider === 'notion' ? syncingNotion : syncingObsidian)
                    }
                    onClick={() => {
                      if (singleSyncProvider === 'obsidian') {
                        void syncSelectedObsidian().catch(() => {});
                        return;
                      }
                      void syncSelectedNotion().catch(() => {});
                      onPopupNotionSyncStarted?.();
                    }}
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
                    <span className="tw-inline-flex" {...tooltipAttrs(syncMenuTooltip)}>
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
                  {enabledSyncProviders.includes('obsidian') ? (
                    <button
                      id="menuSyncToObsidian"
                      className={menuItemButtonClassName}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSyncOpen(false);
                        void syncSelectedObsidian().catch(() => {});
                      }}
                      disabled={actionBusy || syncingObsidian}
                    >
                      {syncingObsidian ? t('obsidianSyncing') : t('obsidianSync')}
                    </button>
                  ) : null}
                  {enabledSyncProviders.includes('notion') ? (
                    <button
                      id="menuSyncToNotion"
                      className={menuItemButtonClassName}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSyncOpen(false);
                        void syncSelectedNotion().catch(() => {});
                        onPopupNotionSyncStarted?.();
                      }}
                      disabled={actionBusy || syncingNotion}
                    >
                      {syncingNotion ? t('notionSyncing') : t('notionSync')}
                    </button>
                  ) : null}
                  {enabledSyncProviders.length === 0 ? (
                    <button
                      id="menuSyncProvidersDisabled"
                      className={menuItemButtonClassName}
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setSyncOpen(false);
                        const section = 'notion';
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
                <span className="tw-text-[30px] tw-font-extrabold tw-text-[#FFA500]">
                  {String(totalCount)}
                </span>
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
                <span className="tw-text-[30px] tw-font-extrabold tw-text-[#FFA500]">
                  {String(totalCount)}
                </span>
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
