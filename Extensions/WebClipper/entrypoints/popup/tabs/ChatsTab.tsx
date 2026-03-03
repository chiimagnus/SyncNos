import MarkdownIt from 'markdown-it';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createZipBlob } from '../../../src/domains/backup/zip-utils';
import { buildConversationBasename } from '../../../src/conversations/file-naming';
import { formatConversationMarkdown } from '../../../src/conversations/markdown';
import type { Conversation, ConversationDetail } from '../../../src/conversations/models';
import { deleteConversations, getConversationDetail, listConversations } from '../../../src/conversations/repo';
import { syncNotionConversations, syncObsidianConversations } from '../../../src/domains/sync/repo';
import { storageGet, storageSet } from '../../../src/platform/storage/local';

type SourceMeta = { key: string; label: string };

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
  return Array.isArray(conversation.warningFlags) && conversation.warningFlags.length > 0;
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

type PreviewState = { conversationId: number; left: number; top: number } | null;

function normalizeRole(role: unknown) {
  const r = String(role || 'assistant').toLowerCase();
  if (r === 'user') return 'user';
  if (r === 'assistant')
     return 'assistant';
  return 'other';
}

export default function ChatsTab() {
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Conversation[]>([]);
  const [allItems, setAllItems] = useState<Conversation[]>([]);

  const [filterKey, setFilterKey] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<number[]>([]);

  const [exportOpen, setExportOpen] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);

  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const [exporting, setExporting] = useState(false);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [syncingObsidian, setSyncingObsidian] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const md = useMemo(() => {
    const inst = new MarkdownIt({
      html: false,
      breaks: true,
      linkify: true,
      typographer: false,
    });
    try {
      inst.enable(['table']);
    } catch (_e) {
      // ignore
    }
    return inst;
  }, []);

  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewDetail, setPreviewDetail] = useState<ConversationDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const refresh = async () => {
    setLoadingList(true);
    setError(null);
    try {
      const list = await listConversations();
      setAllItems(list);
      setItems(list);
      const ids = new Set(list.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0));
      setSelectedIds((prev) => prev.filter((id) => ids.has(Number(id))));
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    storageGet(['popup_source_filter_key'])
      .then((res) => {
        const v = String(res?.popup_source_filter_key || 'all').trim().toLowerCase() || 'all';
        setFilterKey(v);
      })
      .catch(() => {});
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const key = String(filterKey || 'all').trim().toLowerCase() || 'all';
    if (key === 'all') return allItems;
    return allItems.filter((c) => getSourceMeta(c.source).key === key);
  }, [allItems, filterKey]);

  useEffect(() => {
    setItems(filteredItems);
    const allowed = new Set(filteredItems.map((c) => Number(c.id)));
    setSelectedIds((prev) => prev.filter((id) => allowed.has(Number(id))));
  }, [filteredItems]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (exportOpen) {
        const wrap = exportWrapRef.current;
        const target = e.target as any;
        if (!wrap || !target || !wrap.contains(target)) setExportOpen(false);
      }
      if (preview) {
        const target = e.target as any;
        if (target && target.closest && target.closest('.chatPreviewPopover, .row')) return;
        setPreview(null);
        setPreviewDetail(null);
      }
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [exportOpen, preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!preview) return;
      if (e.key === 'Escape') {
        // Prevent browser default from closing the whole popup.
        e.preventDefault();
        e.stopPropagation();
        setPreview(null);
        setPreviewDetail(null);
      }
    };
    // Use capture so we intercept Escape before the extension popup closes.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [preview]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    };
  }, []);

  const selectedIdSet = useMemo(() => new Set(selectedIds.map((x) => Number(x))), [selectedIds]);

  const total = items.length;
  const selectedCount = selectedIds.length;

  const allSelected = total > 0 && selectedCount === total;
  const indeterminate = selectedCount > 0 && selectedCount < total;

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = indeterminate;
  }, [indeterminate]);

  const toggleAll = () => {
    if (allSelected) setSelectedIds([]);
    else setSelectedIds(items.map((c) => Number(c.id)).filter((x) => Number.isFinite(x) && x > 0));
  };

  const toggleSelected = (id: number) => {
    const safeId = Number(id);
    if (!Number.isFinite(safeId) || safeId <= 0) return;
    setSelectedIds((prev) => (prev.includes(safeId) ? prev.filter((x) => x !== safeId) : [...prev, safeId]));
  };

  const sourceOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const c of allItems) {
      const meta = getSourceMeta(c.source);
      if (!meta.key) continue;
      map.set(meta.key, { key: meta.key, label: meta.label || meta.key });
    }
    const opts = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    return [{ key: 'all', label: 'All' }, ...opts];
  }, [allItems]);

  const setSourceFilterKey = async (key: string) => {
    const next = String(key || 'all').trim().toLowerCase() || 'all';
    setFilterKey(next);
    setSelectedIds([]);
    try {
      await storageSet({ popup_source_filter_key: next });
    } catch (_e) {
      // ignore
    }
  };

  const openDeleteConfirm = () => {
    const ids = selectedIds.slice();
    if (!ids.length || loadingList) return;
    setConfirmDeleteIds(ids);
    setConfirmDeleteOpen(true);
  };

  const closeDeleteConfirm = () => {
    if (loadingList) return;
    setConfirmDeleteOpen(false);
    setConfirmDeleteIds([]);
  };

  useEffect(() => {
    if (!confirmDeleteOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeDeleteConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmDeleteOpen]);

  const onConfirmDelete = async () => {
    const ids = confirmDeleteIds.slice();
    if (!ids.length) {
      closeDeleteConfirm();
      return;
    }
    setLoadingList(true);
    setError(null);
    try {
      await deleteConversations(ids);
      setSelectedIds([]);
      setPreview(null);
      setPreviewDetail(null);
      await refresh();
      setConfirmDeleteOpen(false);
      setConfirmDeleteIds([]);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setLoadingList(false);
    }
  };

  const exportSelectedMarkdown = async ({ mergeSingle }: { mergeSingle: boolean }) => {
    const ids = selectedIds.slice();
    if (!ids.length) return;

    setExporting(true);
    setError(null);
    try {
      const selectedConversations = allItems.filter((c) => ids.includes(Number(c.id)));
      if (!selectedConversations.length) return;

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const files: Array<{ name: string; data: string }> = [];

      if (mergeSingle) {
        const docs: string[] = [];
        for (const c of selectedConversations) {
          // eslint-disable-next-line no-await-in-loop
          const d = await getConversationDetail(Number(c.id));
          docs.push(formatConversationMarkdown(c, d.messages || []));
        }
        const text = docs.join('\n---\n\n');
        files.push({ name: `webclipper-export-${stamp}.md`, data: text });
      } else {
        for (const c of selectedConversations) {
          // eslint-disable-next-line no-await-in-loop
          const d = await getConversationDetail(Number(c.id));
          files.push({
            name: `${buildConversationBasename(c)}.md`,
            data: formatConversationMarkdown(c, d.messages || []),
          });
        }
      }

      const zipBlob = await createZipBlob(files);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webclipper-export-${stamp}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'export failed'));
    } finally {
      setExporting(false);
    }
  };

  const onSyncNotion = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    setSyncingNotion(true);
    setError(null);
    try {
      const res = await syncNotionConversations(ids);
      const okCount = Number(res?.okCount) || 0;
      const failCount = Number(res?.failCount) || 0;
      if (failCount) alert(`Sync finished.\n\nOK: ${okCount}\nFailed: ${failCount}`);
      else alert(`Sync finished.\n\nOK: ${okCount}\nFailed: 0`);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'notion sync failed'));
    } finally {
      setSyncingNotion(false);
    }
  };

  const onSyncObsidian = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    setSyncingObsidian(true);
    setError(null);
    try {
      const res = await syncObsidianConversations(ids);
      const okCount = Number(res?.okCount) || 0;
      const failCount = Number(res?.failCount) || 0;
      if (failCount) alert(`Obsidian sync finished.\n\nOK: ${okCount}\nFailed: ${failCount}`);
      else alert(`Obsidian sync finished.\n\nOK: ${okCount}\nFailed: 0`);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'obsidian sync failed'));
    } finally {
      setSyncingObsidian(false);
    }
  };

  const todayCount = useMemo(() => {
    const now = new Date();
    return items.filter((c) => {
      const ts = Number(c.lastCapturedAt) || 0;
      if (!ts) return false;
      try {
        return isSameLocalDay(new Date(ts), now);
      } catch {
        return false;
      }
    }).length;
  }, [items]);

  const showPreview = async (conversationId: number, anchorEl: HTMLElement) => {
    const id = Number(conversationId);
    if (!id || id <= 0) return;
    const rect = anchorEl.getBoundingClientRect();

    const margin = 8;
    const popoverWidth = Math.min(280, Math.max(200, window.innerWidth - 20));
    const popoverHeight = Math.min(420, Math.max(220, window.innerHeight - 16));

    const preferredLeft = rect.right + margin;
    const maxLeft = window.innerWidth - margin - popoverWidth;
    const left = Math.max(margin, Math.min(preferredLeft, maxLeft));

    const preferredTop = rect.top;
    const maxTop = window.innerHeight - margin - popoverHeight;
    const top = Math.max(margin, Math.min(preferredTop, maxTop));

    setPreview({ conversationId: id, left, top });
    setPreviewLoading(true);
    setPreviewDetail(null);
    try {
      const d = await getConversationDetail(id);
      setPreviewDetail(d);
    } catch (_e) {
      setPreviewDetail({ conversationId: id, messages: [] });
    } finally {
      setPreviewLoading(false);
    }
  };

  const onRowClick = (e: React.MouseEvent, conversationId: number) => {
    if (!e || e.button !== 0) return;
    const target = e.target as any;
    if (target && target.closest) {
      if (target.closest("input[type='checkbox'], label.checkbox")) return;
      if (target.closest('button')) return;
      if (target.closest('a')) return;
    }
    showPreview(conversationId, e.currentTarget as any).catch(() => {});
  };

  const onCopyConversation = async (conversation: Conversation, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = Number(conversation.id);
    try {
      const d = await getConversationDetail(id);
      const mdText = formatConversationMarkdown(conversation, d.messages || []);
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
      await browser.tabs.create({ url: safe });
    } catch (_e) {
      // ignore
    }
  };

  const previewConversation = useMemo(() => {
    if (!preview) return null;
    return allItems.find((c) => Number(c.id) === Number(preview.conversationId)) ?? null;
  }, [preview, allItems]);

  const previewMessages = previewDetail?.messages || [];

  return (
    <>
      <div className="viewScroll" aria-label="Chats content">
        {error ? (
          <div className="toolbar" style={{ borderColor: 'rgba(199, 55, 47, 0.35)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </div>
        ) : null}

        <main className="chatsMain">
          <div id="list" className="list">
            {items.map((conversation) => {
              const id = Number(conversation.id);
              const checked = selectedIdSet.has(id);
              const { key: sourceKey, label: sourceLabel } = getSourceMeta(conversation.source);
              const safeUrl = sanitizeHttpUrl(conversation.url || '');
              const isAnchor = preview && preview.conversationId === id;
              return (
                <div
                  key={conversation.id}
                  className={['row', isAnchor ? 'is-preview-anchor' : ''].filter(Boolean).join(' ')}
                  data-conversation-id={String(conversation.id)}
                  aria-label={conversation.title || '(untitled)'}
                  onClick={(e) => onRowClick(e, id)}
                  role="button"
                  tabIndex={0}
                >
                  <label className="checkbox">
                    <input type="checkbox" checked={checked} onChange={() => toggleSelected(id)} aria-label="Select" />
                  </label>

                  <div className="meta">
                    <div className="name">
                      {conversation.title || '(untitled)'}
                      {hasWarningFlags(conversation) ? <span className="pill warn">warning</span> : null}
                    </div>

                    <div className="sub">
                      <button
                        className={['sourceCopy', copiedId === id ? 'is-copied' : ''].filter(Boolean).join(' ')}
                        type="button"
                        aria-label="Copy full markdown"
                        title={copiedId === id ? 'Copied' : 'Copy full markdown'}
                        onClick={(e) => void onCopyConversation(conversation, e)}
                      >
                        {copiedId === id ? '✓' : '⧉'}
                      </button>
                      <button
                        className="sourceOpen"
                        type="button"
                        aria-label="Open original chat"
                        title={safeUrl ? 'Open chat' : 'No link available'}
                        disabled={!safeUrl}
                        onClick={(e) => void openConversationUrl(String(conversation.url || ''), e)}
                      >
                        ↗
                      </button>
                      <span className={['sourceTag', `sourceTag--${sourceKey}`].join(' ')}>{sourceLabel}</span>
                      {conversation.lastCapturedAt ? (
                        <>
                          <span className="metaDivider"> · </span>
                          <span className="timeLabel">{formatTime(conversation.lastCapturedAt)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>

      <aside
        id="chatPreviewPopover"
        className="chatPreviewPopover"
        aria-label="Conversation preview"
        hidden={!preview}
        style={preview ? { left: preview.left, top: preview.top } : undefined}
      >
        <div className="chatPreviewBody">
          {previewConversation ? (
            <div className="chatPreviewMsg">
              <div className="chatPreviewMsgRole">{previewConversation.title || '(untitled)'}</div>
              <div className="chatPreviewMsgMarkdown">
                {(() => {
                  const meta = getSourceMeta(previewConversation.source);
                  return <span className={['sourceTag', `sourceTag--${meta.key}`].join(' ')}>{meta.label || previewConversation.source}</span>;
                })()}
              </div>
            </div>
          ) : null}

          {previewLoading ? <div className="chatPreviewPlaceholder">Loading…</div> : null}
          {!previewLoading && preview && !previewMessages.length ? (
            <div className="chatPreviewPlaceholder">No messages.</div>
          ) : null}
          {previewMessages.slice(-8).map((m) => {
            const role = normalizeRole(m.role);
            const text = String(m.contentMarkdown || m.contentText || '');
            const html = md.render(text);
            return (
              <div key={m.id} className={['chatPreviewMsg', role === 'user' ? 'chatPreviewMsg--user' : role === 'assistant' ? 'chatPreviewMsg--assistant' : 'chatPreviewMsg--other'].join(' ')}>
                <div className="chatPreviewMsgRole">{String(m.role || 'Message')}</div>
                <div className="chatPreviewMsgMarkdown" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            );
          })}
        </div>
      </aside>

      <footer className="bottomDock" aria-label="Actions">
        <section id="chatBottomBar" className={['bottomBar', selectedCount ? 'hasSelection' : ''].filter(Boolean).join(' ')} aria-label="Chat actions">
          <label className="checkbox compact">
            <input ref={selectAllRef} id="chkSelectAll" type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} />
            <span className="srOnly">Select all</span>
          </label>

          <select
            id="sourceFilterSelect"
            className="input compact"
            aria-label="Source filter"
            value={filterKey}
            onChange={(e) => void setSourceFilterKey(e.target.value)}
            disabled={!!selectedCount}
          >
            {sourceOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>

          <div id="chatActionButtons" className="chatActionButtons">
            <button id="btnDelete" className="btn danger" type="button" title="Delete selected" onClick={openDeleteConfirm} disabled={!selectedCount || loadingList}>
              Delete
            </button>

            <div className="exportWrap" ref={exportWrapRef}>
              <button
                id="btnExport"
                className="btn export"
                type="button"
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                onClick={() => setExportOpen((v) => !v)}
                disabled={!selectedCount || exporting}
              >
                <span className="label">Export</span>
                <span className="caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              <div id="exportMenu" className="menu" role="menu" aria-label="Export options" hidden={!exportOpen}>
                <button
                  id="menuExportSingleMarkdown"
                  className="menu-item"
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
                  className="menu-item"
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

            <button id="btnSyncObsidian" className="btn" type="button" onClick={() => onSyncObsidian().catch(() => {})} disabled={!selectedCount || syncingObsidian}>
              {syncingObsidian ? 'Obsidian...' : 'Obsidian'}
            </button>
            <button id="btnSyncNotion" className="btn" type="button" onClick={() => onSyncNotion().catch(() => {})} disabled={!selectedCount || syncingNotion}>
              {syncingNotion ? 'Notion...' : 'Notion'}
            </button>
          </div>

          <div id="chatBottomSpacer" className="spacer" />
          <div id="stats" className="stats">
            <span className="statsLabel">Today:</span>
            <span className="todayCount">{String(todayCount)}</span>
            <span className="statsDivider"> · </span>
            <span className="statsLabel">Total:</span>
            <span className="totalCount">{String(items.length)}</span>
          </div>
        </section>
      </footer>

      {confirmDeleteOpen ? (
        <div
          className="modalOverlay"
          role="presentation"
          onMouseDown={(e) => {
            e.preventDefault();
            closeDeleteConfirm();
          }}
        >
          <div
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modalTitle">Delete conversations?</div>
            <div className="modalBody">Delete {confirmDeleteIds.length} conversation(s)? This cannot be undone.</div>
            <div className="modalActions">
              <button className="btn" type="button" onClick={closeDeleteConfirm} disabled={loadingList}>
                Cancel
              </button>
              <button className="btn danger" type="button" onClick={() => onConfirmDelete().catch(() => {})} disabled={loadingList}>
                {loadingList ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
