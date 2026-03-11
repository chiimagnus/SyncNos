import { useEffect, useMemo, useRef, useState } from 'react';

import type { Conversation } from '../../conversations/domain/models';
import { formatConversationMarkdown } from '../../conversations/domain/markdown';
import { getConversationDetail } from '../../conversations/client/repo';
import { tabsCreate } from '../../platform/webext/tabs';

import { t, formatConversationTitle } from '../../i18n';
import { useConversationsApp } from './conversations-context';
import { ConversationSyncFeedbackNotice } from './ConversationSyncFeedbackNotice';
import { navItemClassName } from '../shared/nav-styles';
import { buttonDangerClassName, buttonTintClassName } from '../shared/button-styles';

type SourceMeta = { key: string; label: string };

const SOURCE_FILTER_STORAGE_KEY = 'webclipper_conversations_source_filter_key';

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

function getSourceMeta(raw: unknown): SourceMeta {
  const text = String(raw || '').trim();
  if (!text) return { key: 'unknown', label: '' };
  const normalized = text.toLowerCase().replace(/[\s_-]+/g, '');
  const map: Record<string, SourceMeta> = {
    chatgpt: { key: 'chatgpt', label: 'ChatGPT' },
    claude: { key: 'claude', label: 'Claude' },
    deepseek: { key: 'deepseek', label: 'DeepSeek' },
    notionai: { key: 'notionai', label: 'Notion AI' },
    gemini: { key: 'gemini', label: 'Gemini' },
    googleaistudio: { key: 'googleaistudio', label: 'Google AI Studio' },
    kimi: { key: 'kimi', label: 'Kimi' },
    doubao: { key: 'doubao', label: 'Doubao' },
    yuanbao: { key: 'yuanbao', label: 'Yuanbao' },
    poe: { key: 'poe', label: 'Poe' },
    zai: { key: 'zai', label: 'z.ai' },
    web: { key: 'web', label: 'Web' },
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
  activeRowId?: number | null;
  initialScrollTop?: number;
  scrollRestoreKey?: number;
  onListScrollTopChange?: (scrollTop: number) => void;
};

export function ConversationListPane({
  onOpenConversation,
  activeRowId,
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
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    clearSyncFeedback,
    deleteSelected,
  } = useConversationsApp();

  const [filterKey, setFilterKey] = useState<string>('all');
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const syncWrapRef = useRef<HTMLDivElement | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const sourceOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const c of items) {
      const meta = getSourceMeta((c as any).source);
      if (!meta.key) continue;
      map.set(meta.key, { key: meta.key, label: meta.label || meta.key });
    }
    const opts = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    return [{ key: 'all', label: t('allFilter') }, ...opts];
  }, [items]);

  useEffect(() => {
    try {
      const raw = String(localStorage.getItem(SOURCE_FILTER_STORAGE_KEY) || '').trim();
      if (raw) {
        setFilterKey(raw.toLowerCase());
        return;
      }
    } catch (_e) {
      // ignore
    }

    // Backward compat: older app stored filter under this key.
    try {
      const v = String(localStorage.getItem('webclipper_app_source_filter_key') || 'all').trim().toLowerCase() || 'all';
      setFilterKey(v);
    } catch (_e) {
      // ignore
    }
  }, []);

  const filteredItems = useMemo(() => {
    const key = String(filterKey || 'all').trim().toLowerCase() || 'all';
    if (key === 'all') return items;
    return items.filter((c) => getSourceMeta((c as any).source).key === key);
  }, [filterKey, items]);

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
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!exportOpen) return;
      const wrap = exportWrapRef.current;
      const target = e.target as any;
      if (!wrap || !target || !wrap.contains(target)) setExportOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [exportOpen]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!syncOpen) return;
      const wrap = syncWrapRef.current;
      const target = e.target as any;
      if (!wrap || !target || !wrap.contains(target)) setSyncOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [syncOpen]);

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
    setFilterKey(next);
    clearSelected();
    setExportOpen(false);
    setSyncOpen(false);
    try {
      localStorage.setItem(SOURCE_FILTER_STORAGE_KEY, next);
    } catch (_e) {
      // ignore
    }
  };

  const onRowClick = (e: React.MouseEvent, conversationId: number) => {
    if (!e || e.button !== 0) return;
    const target = e.target as any;
    if (target && target.closest) {
      if (target.closest("input[type='checkbox'], label")) return;
      if (target.closest('button')) return;
      if (target.closest('a')) return;
    }
    onListScrollTopChange?.(scrollRef.current?.scrollTop || 0);
    const id = Number(conversationId);
    setActiveId(id);
    onOpenConversation?.(id);
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
      alert((err as any)?.message ?? 'Copy failed.');
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
  const dangerButton = buttonDangerClassName();

  const syncMenuBaseLabel = (() => {
    const prefix = commonPrefix(String(t('obsidianSync') || ''), String(t('notionSync') || ''));
    const normalized = normalizeSyncMenuLabel(prefix);
    if (normalized.length >= 2) return normalized;
    return 'Sync to';
  })();

  const syncMenuButtonLabel = syncingNotion
    ? t('notionSyncing')
    : syncingObsidian
      ? t('obsidianSyncing')
      : syncMenuBaseLabel;

  const onConfirmDelete = async () => {
    await deleteSelected();
    setDeleteConfirmOpen(false);
  };

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

            const miniIconBase = [
              'tw-inline-flex tw-size-[18px] tw-appearance-none tw-items-center tw-justify-center tw-rounded-full tw-border-0 tw-bg-transparent',
              'tw-text-[12px] tw-font-black tw-shadow-none',
              'tw-transition-colors tw-duration-150',
              'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
            ].join(' ');
            const miniIconClass = [
              miniIconBase,
              'tw-text-[currentColor] tw-opacity-80 hover:tw-opacity-100',
              isActive ? 'hover:tw-bg-[var(--accent-hover)]' : 'hover:tw-bg-[var(--bg-card)]',
            ].join(' ');
            const miniIconDisabledClass = [
              miniIconBase,
              'tw-text-[currentColor] tw-opacity-[0.38] tw-cursor-not-allowed',
            ].join(' ');

            return (
              <div
                key={String((conversation as any).id)}
                className={rowClass}
                data-conversation-id={String((conversation as any).id)}
                aria-label={formatConversationTitle((conversation as any).title)}
                onClick={(e) => onRowClick(e, id)}
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
                    <div className="tw-min-w-0 tw-flex-1 tw-overflow-hidden tw-text-ellipsis tw-font-semibold tw-leading-5">
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
                      className={miniIconClass}
                      type="button"
                      aria-label={t('copyFullMarkdown')}
                      title={copiedId === id ? t('copied') : t('copyFullMarkdown')}
                      onClick={(e) => void onCopyConversation(conversation as any, e)}
                    >
                      {copiedId === id ? '✓' : '⧉'}
                    </button>

                    <button
                      className={safeUrl ? miniIconClass : miniIconDisabledClass}
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

            <select
              id="sourceFilterSelect"
              value={filterKey}
              onChange={(e) => onSetFilterKey(e.target.value)}
              disabled={hasSelection}
              className={[
                'tw-h-8 tw-max-w-[112px] tw-rounded-lg tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-2 tw-text-xs tw-font-semibold tw-text-[var(--text-primary)] tw-outline-none tw-transition-colors tw-duration-200 hover:tw-bg-[var(--bg-primary)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)] disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
                hasSelection ? 'tw-hidden' : '',
              ].join(' ')}
              aria-label={t('sourceFilterAria')}
            >
              {sourceOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>

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
                  className={dangerButton}
                  title={t('deleteButton')}
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={!hasSelection || actionBusy || syncingAny}
                >
                  {t('deleteButton')}
                </button>

              <div ref={exportWrapRef} className="tw-relative">
                <button
                  id="btnExport"
                  type="button"
                  className={actionButton}
                  aria-haspopup="menu"
                  aria-expanded={exportOpen}
                  onClick={() => {
                    if (!hasSelection || actionBusy) return;
                    setExportOpen((v) => !v);
                  }}
                  disabled={!hasSelection || actionBusy}
                >
                  <span className="tw-leading-none">{t('exportButton')}</span>
                  <span
                    className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>

                <div
                  id="exportMenu"
                  role="menu"
                  aria-label={t('exportOptions')}
                  hidden={!exportOpen}
                  className="tw-absolute tw-right-0 tw-bottom-[calc(100%+8px)] tw-top-auto tw-z-30 tw-min-w-[150px] tw-rounded-[14px] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-1.5"
                >
                  <button
                    id="menuExportSingleMarkdown"
                    className="tw-w-full tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2 tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text-primary)] tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--bg-sunken)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
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
                    className="tw-w-full tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2 tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text-primary)] tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--bg-sunken)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      void exportSelectedMarkdown({ mergeSingle: false });
                    }}
                  >
                    {t('multiMarkdown')}
                  </button>
                </div>
              </div>

              <div ref={syncWrapRef} className="tw-relative">
                <button
                  id="btnSyncTo"
                  type="button"
                  className={actionButton}
                  aria-haspopup="menu"
                  aria-expanded={syncOpen}
                  onClick={() => {
                    if (!hasSelection || exporting || deleting) return;
                    setSyncOpen((v) => !v);
                  }}
                  disabled={!hasSelection || exporting || deleting}
                >
                  <span className="tw-leading-none">{syncMenuButtonLabel}</span>
                  <span
                    className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>

                <div
                  id="syncToMenu"
                  role="menu"
                  aria-label={syncMenuBaseLabel}
                  hidden={!syncOpen}
                  className="tw-absolute tw-right-0 tw-bottom-[calc(100%+8px)] tw-top-auto tw-z-30 tw-min-w-[170px] tw-rounded-[14px] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-1.5"
                >
                  <button
                    id="menuSyncToObsidian"
                    className="tw-w-full tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2 tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text-primary)] tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--bg-sunken)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)] disabled:tw-opacity-[0.38] disabled:hover:tw-border-transparent disabled:hover:tw-bg-transparent"
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
                  <button
                    id="menuSyncToNotion"
                    className="tw-w-full tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2 tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text-primary)] tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--bg-sunken)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)] disabled:tw-opacity-[0.38] disabled:hover:tw-border-transparent disabled:hover:tw-bg-transparent"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSyncOpen(false);
                      void syncSelectedNotion().catch(() => {});
                    }}
                    disabled={actionBusy || syncingNotion}
                  >
                    {syncingNotion ? t('notionSyncing') : t('notionSync')}
                  </button>
                </div>
              </div>
            </div>

            <div className="tw-flex-1 tw-min-w-0" aria-hidden="true" />

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
              <span className="tw-text-[30px] tw-font-extrabold tw-text-[var(--info)]">{String(filteredItems.length)}</span>
            </div>
          </div>

          <ConversationSyncFeedbackNotice feedback={syncFeedback} onDismiss={clearSyncFeedback} />
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
                className={dangerButton}
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
