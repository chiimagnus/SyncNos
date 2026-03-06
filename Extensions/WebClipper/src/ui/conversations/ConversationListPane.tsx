import { useEffect, useMemo, useRef, useState } from 'react';

import type { Conversation } from '../../conversations/domain/models';
import { formatConversationMarkdown } from '../../conversations/domain/markdown';
import { getConversationDetail } from '../../conversations/client/repo';
import { tabsCreate } from '../../platform/webext/tabs';

import { useConversationsApp } from './conversations-context';

type SourceMeta = { key: string; label: string };

const SOURCE_FILTER_STORAGE_KEY = 'webclipper_conversations_source_filter_key';

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
    chatgpt: 'tw-border-[#bae6fd] tw-bg-[#e0f2fe] tw-text-[#075985]',
    claude: 'tw-border-[#ddd6fe] tw-bg-[#ede9fe] tw-text-[#5b21b6]',
    deepseek: 'tw-border-[#bbf7d0] tw-bg-[#dcfce7] tw-text-[#166534]',
    notionai: 'tw-border-[#fed7aa] tw-bg-[#ffedd5] tw-text-[#9a3412]',
    gemini: 'tw-border-[#c7d2fe] tw-bg-[#e0e7ff] tw-text-[#3730a3]',
    googleaistudio: 'tw-border-[#c7d2fe] tw-bg-[#e0e7ff] tw-text-[#3730a3]',
    kimi: 'tw-border-[#fecaca] tw-bg-[#fee2e2] tw-text-[#991b1b]',
    doubao: 'tw-border-[#e9d5ff] tw-bg-[#f3e8ff] tw-text-[#6b21a8]',
    yuanbao: 'tw-border-[#fef08a] tw-bg-[#fef9c3] tw-text-[#854d0e]',
    poe: 'tw-border-[#a7f3d0] tw-bg-[#d1fae5] tw-text-[#065f46]',
    zai: 'tw-border-[#bfdbfe] tw-bg-[#dbeafe] tw-text-[#1e40af]',
    web: 'tw-border-[#e5e7eb] tw-bg-[#f3f4f6] tw-text-[#374151]',
    unknown: 'tw-border-[#e5e7eb] tw-bg-[#f3f4f6] tw-text-[#374151]',
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
  suppressActiveRow?: boolean;
};

export function ConversationListPane({ onOpenConversation, activeRowId, suppressActiveRow }: ConversationListPaneProps) {
  const {
    items,
    activeId,
    selectedIds,
    toggleAll,
    toggleSelected,
    setActiveId,
    clearSelected,
    exporting,
    syncingNotion,
    syncingObsidian,
    deleting,
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    deleteSelected,
  } = useConversationsApp();

  const [filterKey, setFilterKey] = useState<string>('all');
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

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
    return [{ key: 'all', label: 'All' }, ...opts];
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
  const busy = exporting || syncingNotion || syncingObsidian || deleting;

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
    if (hasSelection) return;
    setDeleteConfirmOpen(false);
  }, [hasSelection]);

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

  const onSetFilterKey = (key: string) => {
    const next = String(key || 'all').trim().toLowerCase() || 'all';
    setFilterKey(next);
    clearSelected();
    setExportOpen(false);
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
  const actionButtonBase =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-px-3 tw-text-xs tw-font-extrabold tw-transition-colors tw-duration-200 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';
  const actionButton = `${actionButtonBase} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)] hover:tw-bg-[var(--btn-bg-hover)]`;
  const dangerButton = `${actionButtonBase} tw-border-[var(--danger)] tw-bg-[var(--danger-bg)] tw-text-[var(--danger)] hover:tw-bg-[#ffd7d3]`;

  const onConfirmDelete = async () => {
    await deleteSelected();
    setDeleteConfirmOpen(false);
  };

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div className="route-scroll tw-relative tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden">
        <div className="tw-grid tw-gap-2 tw-px-3 tw-py-3">
          {filteredItems.length ? null : (
            <div className="tw-rounded-xl tw-border tw-border-dashed tw-border-[var(--border)] tw-bg-[var(--panel)]/70 tw-p-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
              No conversations yet.
            </div>
          )}

          {filteredItems.map((conversation) => {
            const id = Number((conversation as any).id);
            const checked = selectedIds.includes(id);
            const { key: sourceKey, label: sourceLabel } = getSourceMeta((conversation as any).source);
            const safeUrl = sanitizeHttpUrl((conversation as any).url || '');
            const isActive = !suppressActiveRow && Number(id) === Number(effectiveActiveRowId);

            const rowBase =
              'tw-group tw-relative tw-flex tw-gap-2.5 tw-rounded-2xl tw-border tw-bg-[#fffaf7] tw-p-3 tw-transition tw-duration-150 focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]';
            const rowClass = isActive
              ? `${rowBase} tw-border-[var(--border-strong)] tw-bg-[#fff2ea] tw-shadow-[var(--shadow)]`
              : `${rowBase} tw-border-[var(--border)] hover:tw-border-[var(--border-strong)] hover:tw-shadow-[var(--shadow)] hover:-tw-translate-y-0.5`;

            return (
              <div
                key={String((conversation as any).id)}
                className={rowClass}
                data-conversation-id={String((conversation as any).id)}
                aria-label={(conversation as any).title || '(untitled)'}
                onClick={(e) => onRowClick(e, id)}
                role="button"
                tabIndex={0}
              >
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="tw-absolute tw-left-0 tw-top-2 tw-h-[calc(100%-16px)] tw-w-1 tw-rounded-r-full tw-bg-[var(--text)] tw-shadow-[0_0_0_1px_rgba(217,89,38,0.18)]"
                  />
                ) : null}
                <label className="tw-mt-0.5 tw-inline-flex tw-items-start tw-text-[var(--muted)]">
                  <input type="checkbox" checked={checked} onChange={() => toggleSelected(id)} aria-label="Select" />
                </label>

                <div className="tw-min-w-0 tw-flex-1">
                  <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                    <div className="tw-min-w-0 tw-flex-1 tw-overflow-hidden tw-text-ellipsis tw-text-sm tw-font-extrabold tw-text-[var(--text)]">
                      {(conversation as any).title || '(untitled)'}
                    </div>
                    {hasWarningFlags(conversation as any) ? (
                      <span className="tw-inline-flex tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-[var(--warn-bg)] tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-extrabold tw-text-[var(--muted)]">
                        warning
                      </span>
                    ) : null}
                  </div>

                  <div className="tw-mt-1 tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
                    <button
                      className={
                        'tw-inline-flex tw-size-[18px] tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-white/75 tw-text-[12px] tw-font-black tw-text-[var(--muted)] hover:tw-border-[rgba(217,89,38,0.35)] hover:tw-bg-white hover:tw-text-[var(--text)]'
                      }
                      type="button"
                      aria-label="Copy full markdown"
                      title={copiedId === id ? 'Copied' : 'Copy full markdown'}
                      onClick={(e) => void onCopyConversation(conversation as any, e)}
                    >
                      {copiedId === id ? '✓' : '⧉'}
                    </button>

                    <button
                      className="tw-inline-flex tw-size-[18px] tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-white/75 tw-text-[12px] tw-font-black tw-text-[var(--muted)] hover:tw-border-[rgba(217,89,38,0.35)] hover:tw-bg-white hover:tw-text-[var(--text)] disabled:tw-cursor-not-allowed disabled:tw-opacity-40"
                      type="button"
                      aria-label="Open original chat"
                      title={safeUrl ? 'Open chat' : 'No link available'}
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
                      <span className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
                        {formatTime((conversation as any).lastCapturedAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="tw-sticky tw-bottom-0 tw-z-20 tw-border-t tw-border-[var(--border)]/70 tw-bg-[var(--panel)]/70 tw-backdrop-blur-md">
          <div className="tw-px-3 tw-py-2">
            <div className={['tw-flex tw-min-h-9 tw-flex-nowrap tw-items-center tw-gap-1.5 tw-p-0', hasSelection ? 'hasSelection' : ''].join(' ')}>
              <label className="tw-inline-flex tw-items-center tw-justify-center tw-text-[var(--muted)]" aria-label="Select all">
                <input
                  ref={selectAllRef}
                  id="chkSelectAll"
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() => toggleAll(visibleIds)}
                  className="tw-size-4 tw-cursor-pointer tw-accent-[var(--text)]"
                />
                <span className="tw-sr-only">Select all</span>
              </label>

              <select
                id="sourceFilterSelect"
                value={filterKey}
                onChange={(e) => onSetFilterKey(e.target.value)}
                disabled={hasSelection}
                className={[
                  'tw-h-8 tw-max-w-[112px] tw-rounded-lg tw-border tw-border-[var(--border)] tw-bg-white/70 tw-px-2 tw-text-xs tw-font-semibold tw-text-[var(--text)] tw-outline-none tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]',
                  hasSelection ? 'tw-hidden' : '',
                ].join(' ')}
                aria-label="Source filter"
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
                  title="Delete selected"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={!hasSelection || busy}
                >
                  Delete
                </button>

                <div ref={exportWrapRef} className="tw-relative">
                  <button
                    id="btnExport"
                    type="button"
                    className={actionButton}
                    aria-haspopup="menu"
                    aria-expanded={exportOpen}
                    onClick={() => {
                      if (!hasSelection || busy) return;
                      setExportOpen((v) => !v);
                    }}
                    disabled={!hasSelection || exporting || busy}
                  >
                    <span className="tw-leading-none">Export</span>
                    <span
                      className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--muted)]"
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </button>

                  <div
                    id="exportMenu"
                    role="menu"
                    aria-label="Export options"
                    hidden={!exportOpen}
                    className="tw-absolute tw-right-0 tw-bottom-[calc(100%+8px)] tw-top-auto tw-z-30 tw-min-w-[150px] tw-rounded-[14px] tw-border tw-border-[var(--border)] tw-bg-[var(--panel)] tw-p-1.5 tw-shadow-[var(--shadow)]"
                  >
                    <button
                      id="menuExportSingleMarkdown"
                      className="tw-w-full tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2 tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text)] tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--btn-bg)]"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setExportOpen(false);
                        void exportSelectedMarkdown({ mergeSingle: true });
                      }}
                    >
                      Single Markdown
                    </button>
                    <button
                      id="menuExportMultiMarkdown"
                      className="tw-w-full tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2 tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text)] tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--btn-bg)]"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setExportOpen(false);
                        void exportSelectedMarkdown({ mergeSingle: false });
                      }}
                    >
                      Multi Markdown
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className={actionButton}
                  onClick={() => syncSelectedObsidian().catch(() => {})}
                  disabled={!hasSelection || busy}
                >
                  {syncingObsidian ? 'Obsidian...' : 'Obsidian'}
                </button>
                <button
                  type="button"
                  className={actionButton}
                  onClick={() => syncSelectedNotion().catch(() => {})}
                  disabled={!hasSelection || busy}
                >
                  {syncingNotion ? 'Notion...' : 'Notion'}
                </button>
              </div>

              <div className="tw-flex-1 tw-min-w-0" aria-hidden="true" />

              <div
                id="stats"
                className={[
                  'tw-flex tw-flex-none tw-items-end tw-gap-0.5 tw-whitespace-nowrap tw-overflow-hidden tw-text-[14px] tw-font-semibold tw-leading-none tw-text-[var(--muted)]',
                  'tw-transition-[max-width,opacity,transform,padding] tw-duration-[220ms] tw-ease-out motion-reduce:tw-transition-none',
                  hasSelection
                    ? 'tw-max-w-0 tw-opacity-0 -tw-translate-x-2 tw-scale-[0.98] tw-p-0 tw-pointer-events-none'
                    : 'tw-max-w-[320px] tw-opacity-100 tw-translate-x-0 tw-scale-100 tw-px-1 tw-py-0',
                ].join(' ')}
              >
                <span className="tw-text-[var(--muted)]">Today:</span>
                <span className="tw-text-[30px] tw-font-extrabold tw-text-[var(--wc-ok)]">{String(todayCount)}</span>
                <span className="tw-text-[rgba(184,94,58,0.7)]">·</span>
                <span className="tw-text-[var(--muted)]">Total:</span>
                <span className="tw-text-[30px] tw-font-extrabold tw-text-[#2563eb]">{String(filteredItems.length)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {deleteConfirmOpen ? (
        <div className="tw-fixed tw-inset-0 tw-z-40 tw-flex tw-items-center tw-justify-center tw-bg-black/30 tw-p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Delete conversations confirmation"
            className="tw-w-full tw-max-w-[340px] tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--panel)] tw-p-4 tw-shadow-[var(--shadow)]"
          >
            <div className="tw-text-sm tw-font-extrabold tw-text-[var(--text)]">Delete selected conversations?</div>
            <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
              This cannot be undone.
            </div>
            <div className="tw-mt-3 tw-flex tw-justify-end tw-gap-2">
              <button
                type="button"
                className={actionButton}
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={dangerButton}
                onClick={() => {
                  void onConfirmDelete();
                }}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
