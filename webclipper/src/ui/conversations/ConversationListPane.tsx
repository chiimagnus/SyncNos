import { useEffect, useMemo, useRef, useState } from 'react';

import type { Conversation } from '../../conversations/domain/models';
import { formatConversationMarkdown } from '../../conversations/domain/markdown';
import { getConversationDetail } from '../../conversations/client/repo';
import { tabsCreate } from '../../platform/webext/tabs';
import { storageOnChanged } from '../../platform/storage/local';
import { openOrFocusExtensionAppTab } from '../../platform/webext/extension-app';

import { t, formatConversationTitle } from '../../i18n';
import type { SyncProvider } from '../../sync/models';
import { getEnabledSyncProviders, syncProviderEnabledStorageKey } from '../../sync/sync-provider-gate';
import { useConversationsApp } from './conversations-context';
import { ConversationSyncFeedbackNotice } from './ConversationSyncFeedbackNotice';
import { navItemClassName } from '../shared/nav-styles';
import { buttonDangerTintClassName, buttonMenuItemClassName, buttonMiniIconClassName, buttonTintClassName } from '../shared/button-styles';
import { MenuPopover } from '../shared/MenuPopover';
import { SelectMenu } from '../shared/SelectMenu';
import { parseHostnameFromUrl } from '../shared/domain';

type SourceMeta = { key: string; label: string };

const SITE_FILTER_ALL_KEY = 'all';
const SITE_FILTER_UNKNOWN_KEY = 'unknown';

function toSiteFilterKey(domain: string) {
  const safe = String(domain || '').trim().toLowerCase();
  if (!safe) return SITE_FILTER_UNKNOWN_KEY;
  return `domain:${safe}`;
}

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

function isSameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function hasWarningFlags(conversation: Conversation) {
  return Array.isArray((conversation as any).warningFlags) && ((conversation as any).warningFlags as any[]).length > 0;
}

function isArticleConversation(conversation: Conversation): boolean {
  return String((conversation as any)?.sourceType || '').trim().toLowerCase() === 'article';
}

function getConversationSiteFilterKey(conversation: Conversation): string {
  if (!isArticleConversation(conversation)) return SITE_FILTER_UNKNOWN_KEY;
  const hostname = parseHostnameFromUrl((conversation as any).url);
  if (!hostname) return SITE_FILTER_UNKNOWN_KEY;
  return toSiteFilterKey(hostname);
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
  const safe = String(key || '').trim().toLowerCase();
  const map: Record<string, string> = {
    chatgpt: 'tw-border-[var(--info)] tw-bg-[color-mix(in_srgb,var(--info)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    claude: 'tw-border-[var(--secondary)] tw-bg-[color-mix(in_srgb,var(--secondary)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    deepseek: 'tw-border-[var(--success)] tw-bg-[color-mix(in_srgb,var(--success)_14%,var(--bg-card))] tw-text-[var(--text-primary)]',
    notionai: 'tw-border-[var(--warning)] tw-bg-[color-mix(in_srgb,var(--warning)_16%,var(--bg-card))] tw-text-[var(--text-primary)]',
    gemini: 'tw-border-[var(--info)] tw-bg-[color-mix(in_srgb,var(--info)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
    googleaistudio: 'tw-border-[var(--info)] tw-bg-[color-mix(in_srgb,var(--info)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
    kimi: 'tw-border-[var(--warning)] tw-bg-[color-mix(in_srgb,var(--warning)_16%,var(--bg-card))] tw-text-[var(--text-primary)]',
    doubao: 'tw-border-[var(--secondary)] tw-bg-[color-mix(in_srgb,var(--secondary)_12%,var(--bg-card))] tw-text-[var(--text-primary)]',
    yuanbao: 'tw-border-[var(--tertiary)] tw-bg-[color-mix(in_srgb,var(--tertiary)_16%,var(--bg-card))] tw-text-[var(--text-primary)]',
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
    exporting,
    syncFeedback,
    syncingNotion,
    syncingObsidian,
    deleting,
    listSourceFilterKey,
    listSiteFilterKey,
    setListSourceFilterKeyPersistent,
    setListSiteFilterKeyPersistent,
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    clearSyncFeedback,
    deleteSelected,
  } = useConversationsApp();

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const [enabledSyncProviders, setEnabledSyncProviders] = useState<SyncProvider[]>(['obsidian', 'notion']);

  const sourceOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const c of items) {
      const meta = getSourceMeta((c as any).source);
      if (!meta.key) continue;
      const prev = map.get(meta.key);
      if (prev) {
        prev.count += 1;
        continue;
      }
      map.set(meta.key, { key: meta.key, label: meta.label || meta.key, count: 1 });
    }
    const opts = Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
    return [{ key: 'all', label: t('allFilter') }, ...opts];
  }, [items]);

  const sourceFilteredItems = useMemo(() => {
    const key = String(listSourceFilterKey || 'all').trim().toLowerCase() || 'all';
    if (key === 'all') return items;
    return items.filter((c) => getSourceMeta((c as any).source).key === key);
  }, [items, listSourceFilterKey]);

  const siteOptions = useMemo(() => {
    const key = String(listSourceFilterKey || 'all').trim().toLowerCase() || 'all';
    if (key !== 'web') return [{ key: SITE_FILTER_ALL_KEY, label: t('allFilter') }];

    const domainCounts = new Map<string, number>();
    let unknownCount = 0;

    for (const conversation of sourceFilteredItems) {
      if (!isArticleConversation(conversation as any)) continue;
      const hostname = parseHostnameFromUrl((conversation as any).url);
      if (!hostname) {
        unknownCount += 1;
        continue;
      }
      domainCounts.set(hostname, (domainCounts.get(hostname) || 0) + 1);
    }

    const domains = Array.from(domainCounts.entries())
      .map(([hostname, count]) => ({ key: toSiteFilterKey(hostname), label: hostname, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return String(a.label || '').localeCompare(String(b.label || ''));
      });

    const out: Array<{ key: string; label: string }> = [{ key: SITE_FILTER_ALL_KEY, label: t('allFilter') }, ...domains];
    if (unknownCount > 0) out.push({ key: SITE_FILTER_UNKNOWN_KEY, label: t('insightUnknownLabel') });
    return out;
  }, [listSourceFilterKey, sourceFilteredItems]);

  const siteOptionKeys = useMemo(() => new Set(siteOptions.map((opt) => String(opt.key || ''))), [siteOptions]);

  const filteredItems = useMemo(() => {
    const sourceKey = String(listSourceFilterKey || 'all').trim().toLowerCase() || 'all';
    if (sourceKey !== 'web') return sourceFilteredItems;

    const key = String(listSiteFilterKey || SITE_FILTER_ALL_KEY).trim().toLowerCase() || SITE_FILTER_ALL_KEY;
    if (key === SITE_FILTER_ALL_KEY) return sourceFilteredItems;
    return sourceFilteredItems.filter((conversation) => getConversationSiteFilterKey(conversation as any) === key);
  }, [listSiteFilterKey, listSourceFilterKey, sourceFilteredItems]);

  const todayCount = useMemo(() => {
    const now = new Date();
    return filteredItems.filter((c) => {
      const ts = Number((c as any).lastCapturedAt) || 0;
      if (!ts) return false;
      try {
        return isSameLocalDay(new Date(ts), now);
      } catch {
        return false;
      }
    }).length;
  }, [filteredItems]);

  const visibleIds = useMemo(
    () => filteredItems.map((c) => Number((c as any).id)).filter((x) => Number.isFinite(x) && x > 0),
    [filteredItems],
  );

  const visibleIdSet = useMemo(() => new Set(visibleIds.map((x) => Number(x))), [visibleIds]);
  const selectedInView = useMemo(() => selectedIds.filter((id) => visibleIdSet.has(Number(id))), [selectedIds, visibleIdSet]);

  const total = visibleIds.length;
  const selectedCount = selectedInView.length;
  const allSelected = total > 0 && selectedCount === total;
  const indeterminate = selectedCount > 0 && selectedCount < total;

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = indeterminate;
  }, [indeterminate]);

  const hasSelection = selectedIds.length > 0;
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
    setDeleteConfirmOpen(false);
    setExportOpen(false);
    setSyncOpen(false);
  }, [hasSelection]);

  useEffect(() => {
    if (!syncingAny) return;
    setDeleteConfirmOpen(false);
  }, [syncingAny]);

  useEffect(() => {
    if (!deleteConfirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (deleting) return;
      setDeleteConfirmOpen(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [deleteConfirmOpen, deleting]);

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

  const onSetFilterKey = (key: string) => {
    const next = String(key || 'all').trim().toLowerCase() || 'all';
    setListSourceFilterKeyPersistent(next);
    clearSelected();
    setDeleteConfirmOpen(false);
    setExportOpen(false);
    setSyncOpen(false);
  };

  const onSetSiteFilterKey = (key: string) => {
    const next = String(key || SITE_FILTER_ALL_KEY).trim().toLowerCase() || SITE_FILTER_ALL_KEY;
    setListSiteFilterKeyPersistent(next);
    clearSelected();
    setDeleteConfirmOpen(false);
    setExportOpen(false);
    setSyncOpen(false);
  };

  useEffect(() => {
    const sourceKey = String(listSourceFilterKey || 'all').trim().toLowerCase() || 'all';
    if (sourceKey !== 'web') return;
    if (siteOptions.length <= 1) return;

    const current = String(listSiteFilterKey || SITE_FILTER_ALL_KEY).trim().toLowerCase() || SITE_FILTER_ALL_KEY;
    if (current === SITE_FILTER_ALL_KEY) return;
    if (siteOptionKeys.has(current)) return;
    setListSiteFilterKeyPersistent(SITE_FILTER_ALL_KEY);
  }, [listSiteFilterKey, listSourceFilterKey, setListSiteFilterKeyPersistent, siteOptionKeys, siteOptions.length]);

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
      const mdText = formatConversationMarkdown(conversation as any, (d as any).messages || []);
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

  const onConfirmDelete = async () => {
    await deleteSelected();
    setDeleteConfirmOpen(false);
  };

  const sourceFilterActive = String(listSourceFilterKey || 'all').trim().toLowerCase() !== 'all';

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div
        ref={scrollRef}
        className="route-scroll tw-relative tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden"
        onScroll={() => onListScrollTopChange?.(scrollRef.current?.scrollTop || 0)}
      >
        <div className="tw-grid tw-gap-1 tw-px-4 tw-py-4">
          {filteredItems.length ? null : (
            <div className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-3 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('noConversations')}
            </div>
          )}

          {filteredItems.map((conversation) => {
            const id = Number((conversation as any).id);
            const checked = selectedIds.includes(id);
            const { key: sourceKey, label: sourceLabel } = getSourceMeta((conversation as any).source);
            const safeUrl = sanitizeHttpUrl((conversation as any).url || '');
            const isActive = Number(id) === Number(effectiveActiveRowId);

            const rowClass = [
              navItemClassName(isActive),
              'tw-group tw-relative tw-items-start tw-gap-2.5',
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
                      <span className="tw-inline-flex tw-rounded-full tw-border tw-border-[var(--warning)] tw-bg-[color-mix(in_srgb,var(--warning)_18%,var(--bg-card))] tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-extrabold tw-text-[var(--text-primary)]">
                        {t('warningBadge')}
                      </span>
                    ) : null}
                  </div>

                  <div className="tw-mt-1 tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-text-[11px] tw-font-semibold tw-text-inherit tw-opacity-80">
                    <button
                      className={buttonMiniIconClassName(isActive)}
                      type="button"
                      aria-label={t('copyFullMarkdown')}
                      title={copiedId === id ? t('copied') : t('copyFullMarkdown')}
                      onClick={(e) => void onCopyConversation(conversation as any, e)}
                    >
                      {copiedId === id ? '✓' : '⧉'}
                    </button>

                    <button
                      className={buttonMiniIconClassName(isActive)}
                      type="button"
                      aria-label={t('openOriginalChat')}
                      title={safeUrl ? t('openChat') : t('noLinkAvailable')}
                      disabled={!safeUrl}
                      onClick={(e) => void openConversationUrl(String((conversation as any).url || ''), e)}
                    >
                      ↗
                    </button>

                    <span
                      className={[
                        'tw-inline-flex tw-items-center tw-rounded-full tw-border tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-extrabold',
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
        </div>
      </div>

      <div className="tw-border-t tw-border-[var(--border)] tw-bg-[var(--bg-sunken)]">
        <div className="tw-px-3 tw-py-2">
          <div className={['tw-flex tw-min-h-9 tw-flex-nowrap tw-items-center tw-gap-1.5 tw-p-0', hasSelection ? 'hasSelection' : ''].join(' ')}>
            <label className="tw-inline-flex tw-items-center tw-justify-center tw-text-[var(--text-secondary)]" aria-label={t('selectAll')}>
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
                'tw-h-8 tw-w-[80px] tw-shrink-0 tw-rounded-lg tw-border tw-px-2',
                sourceFilterActive
                  ? 'tw-border-[var(--accent)] tw-bg-[var(--accent)] hover:tw-bg-[var(--accent-hover)] active:tw-bg-[var(--accent-active)]'
                  : 'tw-border-[var(--border)] tw-bg-[var(--bg-card)] hover:tw-bg-[var(--bg-primary)]',
                'tw-text-xs tw-font-semibold tw-outline-none tw-transition-colors tw-duration-200',
                sourceFilterActive ? 'tw-text-[var(--accent-foreground)]' : 'tw-text-[var(--text-primary)]',
                'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
                'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
              ].join(' ')}
              options={sourceOptions.map((opt) => ({ value: opt.key, label: opt.label }))}
            />

            {String(listSourceFilterKey || 'all').trim().toLowerCase() === 'web' ? (
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
                buttonClassName={[
                  'tw-h-8 tw-w-[80px] tw-shrink-0 tw-rounded-lg tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-2',
                  'tw-text-xs tw-font-semibold tw-text-[var(--text-primary)] tw-outline-none tw-transition-colors tw-duration-200 hover:tw-bg-[var(--bg-primary)]',
                  'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
                  'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
                ].join(' ')}
                options={siteOptions.map((opt) => ({ value: opt.key, label: opt.label }))}
              />
            ) : null}

            <div
              id="chatActionButtons"
              className={[
                ['tw-inline-flex tw-items-center tw-gap-1.5', hasSelection ? 'tw-overflow-visible' : 'tw-overflow-hidden'].join(' '),
                'tw-transition-[max-width,opacity,transform] tw-duration-[220ms] tw-ease-out motion-reduce:tw-transition-none',
                hasSelection
                  ? 'tw-max-w-[360px] tw-opacity-100 tw-translate-x-0 tw-scale-100 tw-pointer-events-auto'
                  : 'tw-max-w-0 tw-opacity-0 tw-translate-x-2 tw-scale-[0.98] tw-pointer-events-none',
              ].join(' ')}
            >
                <button
                  id="btnDelete"
                  type="button"
                  className={dangerSurfaceButton}
                  title={t('deleteButton')}
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={!hasSelection || actionBusy || syncingAny}
                >
                  {t('deleteButton')}
                </button>

              <MenuPopover
                open={exportOpen}
                onOpenChange={setExportOpen}
                disabled={!hasSelection || actionBusy}
                ariaLabel={t('exportOptions')}
                side="top"
                align="end"
                panelMinWidth={150}
                trigger={(triggerProps) => (
                  <button {...triggerProps} id="btnExport" className={actionButton}>
                    <span className="tw-leading-none">{t('exportButton')}</span>
                    <span
                      className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </button>
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
              ) : (
                <MenuPopover
                  open={syncOpen}
                  onOpenChange={setSyncOpen}
                  disabled={enabledSyncProviders.length === 0 ? exporting || deleting : !hasSelection || exporting || deleting}
                  ariaLabel={syncMenuBaseLabel}
                  side="top"
                  align="end"
                  panelMinWidth={170}
                  trigger={(triggerProps) => (
                    <button {...triggerProps} id="btnSyncTo" className={actionButton}>
                      <span className="tw-leading-none">{syncMenuButtonLabel}</span>
                      <span
                        className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                        aria-hidden="true"
                      >
                        ▾
                      </span>
                    </button>
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
                aria-label={t('section_insight_label')}
                title={t('section_insight_label')}
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
                  {String(filteredItems.length)}
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
                  {String(filteredItems.length)}
                </span>
              </div>
            )}
          </div>

          <ConversationSyncFeedbackNotice feedback={syncFeedback} onDismiss={clearSyncFeedback} onOpenConversation={onOpenConversation} />
        </div>
      </div>

      {deleteConfirmOpen ? (
        <div className="tw-fixed tw-inset-0 tw-z-40 tw-flex tw-items-center tw-justify-center tw-bg-[var(--bg-overlay)] tw-p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('deleteConfirmDialogAria')}
            className="tw-w-full tw-max-w-[340px] tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-4"
          >
            <div className="tw-text-sm tw-font-extrabold tw-text-[var(--text-primary)]">{t('deleteConfirmTitle')}</div>
            <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('deleteConfirmBody')}
            </div>
            <div className="tw-mt-3 tw-flex tw-justify-end tw-gap-2">
              <button
                type="button"
                className={actionButton}
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting || syncingAny}
              >
                {t('cancelButton')}
              </button>
              <button
                type="button"
                className={dangerSurfaceButton}
                onClick={() => {
                  void onConfirmDelete();
                }}
                disabled={deleting || syncingAny}
              >
                {deleting ? t('deletingDots') : t('deleteButton')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
