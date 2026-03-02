import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation, ConversationDetail } from '../../../src/domains/conversations/models';
import { createZipBlob } from '../../../src/domains/backup/zip-utils';
import { formatConversationMarkdown, sanitizeFilenamePart } from '../../../src/domains/conversations/markdown';
import { deleteConversations, getConversationDetail, listConversations } from '../../../src/domains/conversations/repo';
import { syncNotionConversations, syncObsidianConversations } from '../../../src/domains/sync/repo';

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function trimText(text: unknown, maxLen: number) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(0, maxLen - 1))}…`;
}

export default function ChatsTab() {
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Conversation[]>([]);

  const [filterSource, setFilterSource] = useState<string>('__all__');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);

  const [exporting, setExporting] = useState(false);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [syncingObsidian, setSyncingObsidian] = useState(false);

  const refresh = async () => {
    setLoadingList(true);
    setError(null);
    try {
      const list = await listConversations();
      setItems(list);
      const ids = new Set(list.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0));
      setSelectedIds((prev) => prev.filter((id) => ids.has(Number(id))));
      if (list.length && activeId == null) setActiveId(Number(list[0].id));
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!exportOpen) return;
      const wrap = exportWrapRef.current;
      const target = e.target as any;
      if (wrap && target && wrap.contains(target)) return;
      setExportOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [exportOpen]);

  const sources = useMemo(() => {
    const unique = new Set<string>();
    for (const it of items) {
      const s = String(it?.source || '').trim();
      if (s) unique.add(s);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filterSource === '__all__') return items;
    return items.filter((x) => String(x?.source || '') === filterSource);
  }, [items, filterSource]);

  const selectedIdSet = useMemo(() => new Set(selectedIds.map((x) => Number(x))), [selectedIds]);
  const filteredIds = useMemo(
    () => filteredItems.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0),
    [filteredItems],
  );
  const allSelected = !!filteredIds.length && filteredIds.every((id) => selectedIdSet.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredIds.includes(Number(id))));
      return;
    }
    setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
  };

  const toggleSelected = (id: number) => {
    const safeId = Number(id);
    if (!Number.isFinite(safeId) || safeId <= 0) return;
    setSelectedIds((prev) => (prev.includes(safeId) ? prev.filter((x) => x !== safeId) : [...prev, safeId]));
  };

  const activeConversation = useMemo(
    () => items.find((x) => Number(x.id) === Number(activeId)) ?? null,
    [items, activeId],
  );

  useEffect(() => {
    const id = Number(activeId);
    if (!id || id <= 0) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    setDetail(null);
    getConversationDetail(id)
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [activeId]);

  const onDeleteSelected = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    const ok = confirm(`Delete ${ids.length} conversation(s)? This cannot be undone.`);
    if (!ok) return;
    setLoadingList(true);
    setError(null);
    try {
      await deleteConversations(ids);
      setSelectedIds([]);
      if (activeId != null && ids.includes(Number(activeId))) setActiveId(null);
      await refresh();
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
      const selectedConversations = items.filter((c) => ids.includes(Number(c.id)));
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
        for (let i = 0; i < selectedConversations.length; i += 1) {
          const c = selectedConversations[i];
          // eslint-disable-next-line no-await-in-loop
          const d = await getConversationDetail(Number(c.id));
          const source = sanitizeFilenamePart(c.source || 'unknown', 'unknown');
          const title = sanitizeFilenamePart(c.title || 'untitled', 'untitled');
          files.push({
            name: `webclipper-${source}-${title}-${i + 1}-${stamp}.md`,
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
      if (failCount) alert(`Notion sync finished.\n\nOK: ${okCount}\nFailed: ${failCount}`);
      else alert(`Notion sync finished.\n\nOK: ${okCount}\nFailed: 0`);
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

  const renderPreview = () => {
    const c = activeConversation;
    const messages = detail?.messages || [];
    if (!c) return null;
    return (
      <div className="tw-rounded-xl tw-border tw-border-[rgba(217,89,38,0.14)] tw-bg-white/50 tw-p-2">
        <div className="tw-flex tw-items-start tw-justify-between tw-gap-2">
          <div className="tw-min-w-0">
            <div className="tw-font-bold tw-text-[13px] tw-truncate">{c.title || 'Untitled'}</div>
            <div className="tw-text-[12px] tw-text-[var(--muted)] tw-truncate">
              {c.source} · {formatTime(c.lastCapturedAt)}
            </div>
          </div>
          <button
            className="tw-h-7 tw-px-2 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
            onClick={() => {
              try {
                const url = browser.runtime.getURL(`/app.html#/conversations?focus=${Number(c.id)}`);
                void browser.tabs.create({ url });
              } catch (_e) {
                // ignore
              }
            }}
            type="button"
          >
            Open
          </button>
        </div>
        <div className="tw-mt-2 tw-max-h-[160px] tw-overflow-auto tw-rounded-lg tw-bg-[rgba(255,255,255,0.55)] tw-p-2 tw-text-[12px]">
          {loadingDetail ? (
            <div className="tw-text-[var(--muted)]">Loading…</div>
          ) : messages.length ? (
            <div className="tw-grid tw-gap-2">
              {messages.slice(-6).map((m) => (
                <div key={m.id} className="tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.10)] tw-bg-white/65 tw-p-2">
                  <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{String(m.role || 'message')}</div>
                  <div className="tw-mt-1 tw-whitespace-pre-wrap tw-break-words">
                    {trimText(m.contentText || m.contentMarkdown || '', 600)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="tw-text-[var(--muted)]">No messages.</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="tw-h-full tw-min-h-0 tw-flex tw-flex-col tw-gap-2">
      {error ? (
        <div className="tw-rounded-xl tw-border tw-border-[rgba(199,55,47,0.25)] tw-bg-[var(--danger-bg)] tw-px-3 tw-py-2 tw-text-[12px] tw-text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <section className="tw-flex-1 tw-min-h-0 tw-rounded-2xl tw-border tw-border-[rgba(217,89,38,0.14)] tw-bg-[var(--panel)] tw-shadow-[var(--shadow)] tw-overflow-hidden tw-flex tw-flex-col">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-p-3 tw-border-b tw-border-[rgba(217,89,38,0.12)]">
          <div className="tw-font-extrabold tw-text-[14px]">Conversations</div>
          <button
            className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
            onClick={() => refresh().catch(() => {})}
            disabled={loadingList}
            type="button"
          >
            {loadingList ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div className="tw-flex-1 tw-min-h-0 tw-overflow-auto">
          {filteredItems.length ? (
            <div className="tw-divide-y tw-divide-[rgba(217,89,38,0.10)]">
              {filteredItems.map((c) => {
                const id = Number(c.id);
                const checked = selectedIdSet.has(id);
                const active = Number(activeId) === id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveId(id)}
                    className={[
                      'tw-w-full tw-text-left tw-flex tw-items-start tw-gap-2 tw-px-3 tw-py-2 tw-transition-colors',
                      active ? 'tw-bg-white/55' : 'hover:tw-bg-white/40',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(id)}
                      onClick={(e) => e.stopPropagation()}
                      className="tw-mt-1"
                      aria-label="Select conversation"
                    />
                    <div className="tw-min-w-0 tw-flex-1">
                      <div className="tw-font-semibold tw-text-[13px] tw-truncate">{c.title || 'Untitled'}</div>
                      <div className="tw-mt-0.5 tw-text-[12px] tw-text-[var(--muted)] tw-truncate">
                        {c.source} · {formatTime(c.lastCapturedAt)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="tw-p-4 tw-text-[12px] tw-text-[var(--muted)]">No conversations yet.</div>
          )}
        </div>

        <div className="tw-border-t tw-border-[rgba(217,89,38,0.12)] tw-p-3 tw-grid tw-gap-2">
          {renderPreview()}

          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
            <label className="tw-flex tw-items-center tw-gap-2 tw-text-[12px] tw-text-[var(--muted)]">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              All
            </label>

            <select
              className="tw-h-8 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.16)] tw-bg-white/55 tw-px-2 tw-text-[12px] tw-text-[var(--muted)]"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              aria-label="Source filter"
            >
              <option value="__all__">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <div className="tw-flex-1" />

            <button
              className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(199,55,47,0.26)] tw-bg-[var(--danger-bg)] hover:tw-bg-[rgba(255,229,225,0.85)] tw-text-[12px] tw-font-semibold tw-text-[var(--danger)]"
              onClick={() => onDeleteSelected().catch(() => {})}
              disabled={!selectedIds.length || loadingList}
              type="button"
              title="Delete selected"
            >
              Delete
            </button>

            <div className="tw-relative" ref={exportWrapRef}>
              <button
                className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
                onClick={() => setExportOpen((v) => !v)}
                disabled={!selectedIds.length || exporting}
                type="button"
                aria-haspopup="menu"
                aria-expanded={exportOpen}
              >
                Export ▾
              </button>
              {exportOpen ? (
                <div className="tw-absolute tw-right-0 tw-mt-1 tw-w-44 tw-rounded-xl tw-border tw-border-[rgba(217,89,38,0.16)] tw-bg-white/95 tw-shadow-[var(--shadow)] tw-overflow-hidden tw-z-10">
                  <button
                    type="button"
                    className="tw-w-full tw-text-left tw-px-3 tw-py-2 tw-text-[12px] hover:tw-bg-[var(--btn-bg)]"
                    onClick={() => {
                      setExportOpen(false);
                      void exportSelectedMarkdown({ mergeSingle: true });
                    }}
                  >
                    Single Markdown
                  </button>
                  <button
                    type="button"
                    className="tw-w-full tw-text-left tw-px-3 tw-py-2 tw-text-[12px] hover:tw-bg-[var(--btn-bg)]"
                    onClick={() => {
                      setExportOpen(false);
                      void exportSelectedMarkdown({ mergeSingle: false });
                    }}
                  >
                    Multi Markdown
                  </button>
                </div>
              ) : null}
            </div>

            <button
              className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
              onClick={() => onSyncObsidian().catch(() => {})}
              disabled={!selectedIds.length || syncingObsidian}
              type="button"
            >
              {syncingObsidian ? 'Obsidian…' : 'Obsidian'}
            </button>

            <button
              className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
              onClick={() => onSyncNotion().catch(() => {})}
              disabled={!selectedIds.length || syncingNotion}
              type="button"
            >
              {syncingNotion ? 'Notion…' : 'Notion'}
            </button>

            <div className="tw-text-[12px] tw-text-[var(--muted)] tw-ml-1">
              {filteredItems.length}/{items.length}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
