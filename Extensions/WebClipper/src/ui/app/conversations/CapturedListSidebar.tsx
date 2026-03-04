import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import type { Conversation } from '../../../conversations/domain/models';
import { formatConversationMarkdown } from '../../../conversations/domain/markdown';
import { getConversationDetail } from '../../../conversations/client/repo';
import { tabsCreate } from '../../../platform/webext/tabs';

import { useConversationsApp } from './conversations-context';

type SourceMeta = { key: string; label: string };

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

function settingsClass(isActive: boolean) {
  const base =
    'tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-xl tw-border tw-px-3 tw-py-2 tw-text-xs tw-font-extrabold tw-transition-colors tw-duration-200';
  if (isActive) return `${base} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)]`;
  return `${base} tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]`;
}

export function CapturedListSidebar({ onCollapse }: { onCollapse: () => void }) {
  const {
    loadingList,
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

  const navigate = useNavigate();

  const [filterKey, setFilterKey] = useState<string>('all');
  const selectAllRef = useRef<HTMLInputElement | null>(null);

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
  const pct = total ? Math.floor((selectedCount / total) * 100) : 0;

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    };
  }, []);

  const onSetFilterKey = (key: string) => {
    const next = String(key || 'all').trim().toLowerCase() || 'all';
    setFilterKey(next);
    clearSelected();
    try {
      localStorage.setItem('webclipper_app_source_filter_key', next);
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
    navigate('/');
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

  const actionButtonBase =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-px-3 tw-text-xs tw-font-extrabold tw-transition-colors tw-duration-200 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';
  const actionButton = `${actionButtonBase} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)] hover:tw-bg-[var(--btn-bg-hover)]`;
  const dangerButton = `${actionButtonBase} tw-border-[var(--danger)] tw-bg-[var(--danger-bg)] tw-text-[var(--danger)] hover:tw-bg-[#ffd7d3]`;

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-2">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <span
            className="tw-inline-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[11px] tw-font-black tw-tracking-[0.12em] tw-text-[var(--text)]"
            aria-hidden="true"
          >
            SN
          </span>
          <div className="tw-min-w-0">
            <p className="tw-m-0 tw-truncate tw-text-[13px] tw-font-black tw-leading-none tw-text-[var(--text)]">Captured List</p>
            <p className="tw-mt-1 tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{selectedIds.length}/{items.length} selected</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCollapse}
          className="tw-inline-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]"
          aria-label="Collapse sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6.25 3.25L3 6.5L6.25 9.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.2 6.5H12.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="tw-mt-1 tw-flex tw-items-center tw-justify-between tw-gap-3">
        <span className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{loadingList ? 'Refreshing...' : 'Ready'}</span>
        <select
          value={filterKey}
          onChange={(e) => onSetFilterKey(e.target.value)}
          className="tw-min-h-8 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-px-2 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]"
          aria-label="Source filter"
        >
          {sourceOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="route-scroll tw-mt-2 tw-grid tw-min-h-0 tw-flex-1 tw-gap-2 tw-overflow-auto tw-pr-1">
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
          const isActive = Number(id) === Number(activeId) && location.pathname !== '/settings';

          const rowBase =
            'tw-group tw-flex tw-gap-2.5 tw-rounded-2xl tw-border tw-bg-[#fffaf7] tw-p-3 tw-transition tw-duration-150 focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]';
          const rowClass = isActive
            ? `${rowBase} tw-border-[var(--border-strong)] tw-shadow-[var(--shadow)]`
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

                  <span className={['tw-inline-flex tw-items-center tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-white/70 tw-px-2 tw-py-0.5 tw-text-[10px] tw-font-extrabold tw-text-[var(--muted)]', `sourceTag--${sourceKey}`].join(' ')}>
                    {sourceLabel}
                  </span>

                  {(conversation as any).lastCapturedAt ? (
                    <span className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{formatTime((conversation as any).lastCapturedAt)}</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="tw-mt-2 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/75 tw-p-3">
        {hasSelection ? (
          <div className="tw-grid tw-gap-2">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <div className="tw-text-xs tw-font-extrabold tw-text-[var(--text)]">{selectedIds.length} selected</div>
              <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{busy ? 'Working…' : 'Actions'}</div>
            </div>
            <div className="tw-flex tw-flex-wrap tw-gap-2">
              <button type="button" className={dangerButton} onClick={() => deleteSelected().catch(() => {})} disabled={busy}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" className={actionButton} onClick={() => exportSelectedMarkdown({ mergeSingle: true }).catch(() => {})} disabled={busy}>
                {exporting ? 'Exporting…' : 'Export'}
              </button>
              <button type="button" className={actionButton} onClick={() => syncSelectedObsidian().catch(() => {})} disabled={busy}>
                {syncingObsidian ? 'Syncing…' : 'Obsidian'}
              </button>
              <button type="button" className={actionButton} onClick={() => syncSelectedNotion().catch(() => {})} disabled={busy}>
                {syncingNotion ? 'Syncing…' : 'Notion'}
              </button>
            </div>
          </div>
        ) : (
          <div className="tw-grid tw-gap-2">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <label className="tw-inline-flex tw-items-center tw-gap-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
                <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={() => toggleAll(visibleIds)} className="tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]" />
                Select all
              </label>
              <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{selectedCount}/{total} selected</div>
            </div>
            <div className="tw-h-2 tw-overflow-hidden tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-[var(--panel)]/70">
              <div className="tw-h-full tw-bg-[var(--border-strong)]" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} aria-hidden="true" />
            </div>
          </div>
        )}

        <div className="tw-mt-3">
          <NavLink to="/settings" className={({ isActive }) => settingsClass(isActive)}>
            Settings
          </NavLink>
        </div>
      </div>
    </div>
  );
}
