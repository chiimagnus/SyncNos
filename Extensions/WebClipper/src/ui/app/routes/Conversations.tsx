import { useEffect, useMemo, useState } from 'react';
import type { Conversation, ConversationDetail } from '../../../conversations/domain/models';
import { createZipBlob } from '../../../sync/backup/zip-utils';
import { buildConversationBasename } from '../../../conversations/domain/file-naming';
import { formatConversationMarkdown } from '../../../conversations/domain/markdown';
import { deleteConversations, getConversationDetail, listConversations } from '../../../conversations/client/repo';
import { syncNotionConversations, syncObsidianConversations } from '../../../sync/repo';

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function Conversations() {
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<Conversation[]>([]);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [exporting, setExporting] = useState(false);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [syncingObsidian, setSyncingObsidian] = useState(false);

  const selected = useMemo(
    () => items.find((x) => Number(x.id) === Number(activeId)) ?? null,
    [items, activeId],
  );

  const refresh = async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const list = await listConversations();
      setItems(list);
      const ids = new Set(list.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0));
      setSelectedIds((prev) => prev.filter((id) => ids.has(Number(id))));
      if (list.length && activeId == null) setActiveId(Number(list[0].id));
    } catch (e) {
      setListError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = activeId;
    if (!id || id <= 0) {
      setDetail(null);
      return;
    }

    setLoadingDetail(true);
    setDetailError(null);
    setDetail(null);

    getConversationDetail(id)
      .then((d) => setDetail(d))
      .catch((e) => setDetailError((e as any)?.message ?? String(e ?? 'failed')))
      .finally(() => setLoadingDetail(false));
  }, [activeId]);

  const selectedIdSet = useMemo(() => new Set(selectedIds.map((x) => Number(x))), [selectedIds]);
  const allIds = useMemo(() => items.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0), [items]);
  const allSelected = !!allIds.length && selectedIds.length === allIds.length;

  const toggleAll = () => {
    if (allSelected) setSelectedIds([]);
    else setSelectedIds(allIds);
  };

  const toggleSelected = (id: number) => {
    const safeId = Number(id);
    if (!Number.isFinite(safeId) || safeId <= 0) return;
    setSelectedIds((prev) => (prev.includes(safeId) ? prev.filter((x) => x !== safeId) : [...prev, safeId]));
  };

  const onDeleteSelected = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    const ok = confirm(`Delete ${ids.length} conversation(s)? This cannot be undone.`);
    if (!ok) return;

    setLoadingList(true);
    setListError(null);
    try {
      await deleteConversations(ids);
      setSelectedIds([]);
      if (activeId != null && ids.includes(Number(activeId))) setActiveId(null);
      await refresh();
    } catch (e) {
      setListError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setLoadingList(false);
    }
  };

  const exportSelectedMarkdown = async ({ mergeSingle }: { mergeSingle: boolean }) => {
    const ids = selectedIds.slice();
    if (!ids.length) return;

    setExporting(true);
    setListError(null);
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
      setListError((e as any)?.message ?? String(e ?? 'export failed'));
    } finally {
      setExporting(false);
    }
  };

  const onSyncNotion = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    setSyncingNotion(true);
    setListError(null);
    try {
      await syncNotionConversations(ids);
    } catch (e) {
      setListError((e as any)?.message ?? String(e ?? 'notion sync failed'));
    } finally {
      setSyncingNotion(false);
    }
  };

  const onSyncObsidian = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    setSyncingObsidian(true);
    setListError(null);
    try {
      await syncObsidianConversations(ids);
    } catch (e) {
      setListError((e as any)?.message ?? String(e ?? 'obsidian sync failed'));
    } finally {
      setSyncingObsidian(false);
    }
  };

  const baseButtonClass =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-px-3 tw-text-xs tw-font-bold tw-transition-colors tw-duration-200 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';
  const neutralButtonClass = `${baseButtonClass} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)] hover:tw-bg-[var(--btn-bg-hover)]`;
  const primaryButtonClass = `${baseButtonClass} tw-border-[var(--text)] tw-bg-[var(--text)] tw-text-white hover:tw-bg-[#c94f20]`;
  const dangerButtonClass = `${baseButtonClass} tw-border-[var(--danger)] tw-bg-[var(--danger-bg)] tw-text-[var(--danger)] hover:tw-bg-[#ffd7d3]`;

  return (
    <section className="tw-grid tw-min-h-0 tw-gap-3 lg:tw-h-full lg:tw-grid-cols-[340px_minmax(0,1fr)]">
      <aside className="tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3 lg:tw-flex lg:tw-min-h-0 lg:tw-flex-col" aria-label="Conversation list">
        <div className="tw-flex tw-items-end tw-justify-between tw-gap-2">
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Captured List</h2>
          <span className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
            {selectedIds.length}/{items.length} selected
          </span>
        </div>

        <div className="tw-mt-2 tw-flex tw-items-center tw-justify-between tw-gap-3">
          <label className="tw-inline-flex tw-items-center tw-gap-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]"
            />
            Select all
          </label>
          <span className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
            {loadingList ? 'Refreshing list...' : 'Ready'}
          </span>
        </div>

        <div className="route-scroll tw-mt-3 tw-grid tw-max-h-[44vh] tw-gap-2 tw-overflow-auto tw-pr-1 lg:tw-min-h-0 lg:tw-flex-1 lg:tw-max-h-none">
          {items.length ? null : <div className="tw-rounded-xl tw-border tw-border-dashed tw-border-[var(--border)] tw-bg-[var(--panel)]/70 tw-p-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">No conversations yet.</div>}

          {items.map((c) => {
            const id = Number(c.id);
            const active = Number(c.id) === Number(activeId);
            const title = c.title && String(c.title).trim() ? String(c.title).trim() : '(Untitled)';
            return (
              <button
                key={String(c.id)}
                onClick={() => setActiveId(id)}
                type="button"
                className={`tw-w-full tw-rounded-xl tw-border tw-p-2.5 tw-text-left tw-transition-colors tw-duration-200 ${
                  active
                    ? 'tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)]'
                    : 'tw-border-[var(--border)] tw-bg-white hover:tw-border-[var(--border-strong)] hover:tw-bg-[var(--panel)]'
                }`}
              >
                <div className="tw-flex tw-items-center tw-gap-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIdSet.has(id)}
                    onChange={() => toggleSelected(id)}
                    onClick={(e) => e.stopPropagation()}
                    className="tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]"
                  />
                  <div className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-bold tw-text-[var(--text)]">{title}</div>
                </div>
                <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
                  {c.source} · {formatTime(c.lastCapturedAt)}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3 lg:tw-flex lg:tw-min-h-0 lg:tw-flex-col" aria-label="Conversation detail">
        <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-border-b tw-border-[var(--border)] tw-pb-2">
          <div className="tw-min-w-0">
            <h2 className="tw-m-0 tw-max-w-[85%] tw-truncate tw-text-[20px] tw-font-extrabold tw-tracking-[-0.01em] tw-text-[var(--text)]">
              {selected ? selected.title || '(Untitled)' : 'Detail'}
            </h2>
            <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
              {selected ? `${selected.source} · ${selected.conversationKey}` : 'Select one conversation from sidebar'}
            </div>
          </div>

          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
            <button onClick={refresh} disabled={loadingList} type="button" className={primaryButtonClass}>
              {loadingList ? 'Loading…' : 'Refresh'}
            </button>
            <button
              onClick={() => onSyncObsidian().catch(() => {})}
              disabled={!selectedIds.length || syncingObsidian}
              type="button"
              className={neutralButtonClass}
            >
              {syncingObsidian ? 'Syncing…' : 'Obsidian'}
            </button>
            <button
              onClick={() => onSyncNotion().catch(() => {})}
              disabled={!selectedIds.length || syncingNotion}
              type="button"
              className={neutralButtonClass}
            >
              {syncingNotion ? 'Syncing…' : 'Notion'}
            </button>
            <button
              onClick={() => exportSelectedMarkdown({ mergeSingle: true }).catch(() => {})}
              disabled={!selectedIds.length || exporting}
              type="button"
              className={neutralButtonClass}
            >
              Export 1 file
            </button>
            <button
              onClick={() => exportSelectedMarkdown({ mergeSingle: false }).catch(() => {})}
              disabled={!selectedIds.length || exporting}
              type="button"
              className={neutralButtonClass}
            >
              Export multi
            </button>
            <button
              onClick={() => onDeleteSelected().catch(() => {})}
              disabled={!selectedIds.length || loadingList}
              type="button"
              className={dangerButtonClass}
            >
              Delete
            </button>
          </div>
        </header>

        {listError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{listError}</p> : null}
        {loadingDetail ? <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Loading…</p> : null}
        {detailError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{detailError}</p> : null}

        {detail?.messages?.length ? (
          <div className="route-scroll tw-mt-3 tw-grid tw-gap-2.5 lg:tw-min-h-0 lg:tw-flex-1 lg:tw-overflow-auto lg:tw-pr-1">
            {detail.messages.map((m) => (
              <article key={String(m.id)} className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--panel)]/55 tw-p-3">
                <header className="tw-flex tw-items-center tw-justify-between tw-gap-2">
                  <div className="tw-font-mono tw-text-[11px] tw-font-black tw-uppercase tw-tracking-[0.08em] tw-text-[var(--text)]">{m.role}</div>
                  <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{formatTime(m.updatedAt)}</div>
                </header>
                <pre className="tw-m-0 tw-mt-2 tw-whitespace-pre-wrap tw-font-mono tw-text-[12px] tw-leading-5 tw-text-[var(--muted)]">
                  {m.contentMarkdown || m.contentText || ''}
                </pre>
              </article>
            ))}
          </div>
        ) : activeId ? (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">No messages.</p>
        ) : (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Select a conversation.</p>
        )}
      </section>
    </section>
  );
}
