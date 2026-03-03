import { useEffect, useMemo, useState } from 'react';
import type { Conversation, ConversationDetail } from '../../../conversations/models';
import { createZipBlob } from '../../../domains/backup/zip-utils';
import { buildConversationBasename } from '../../../conversations/file-naming';
import { formatConversationMarkdown } from '../../../conversations/markdown';
import { deleteConversations, getConversationDetail, listConversations } from '../../../conversations/repo';
import { syncNotionConversations, syncObsidianConversations } from '../../../domains/sync/repo';

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

  return (
    <section style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ margin: 0 }}>Conversations</h1>
          <button onClick={refresh} disabled={loadingList} type="button">
            {loadingList ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {listError ? (
          <p style={{ color: 'crimson' }}>{listError}</p>
        ) : null}

        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.9 }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Select all
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onSyncObsidian().catch(() => {})}
              disabled={!selectedIds.length || syncingObsidian}
              type="button"
            >
              {syncingObsidian ? 'Syncing…' : 'Obsidian'}
            </button>
            <button
              onClick={() => onSyncNotion().catch(() => {})}
              disabled={!selectedIds.length || syncingNotion}
              type="button"
            >
              {syncingNotion ? 'Syncing…' : 'Notion'}
            </button>
            <button
              onClick={() => exportSelectedMarkdown({ mergeSingle: true }).catch(() => {})}
              disabled={!selectedIds.length || exporting}
              type="button"
            >
              Export (single)
            </button>
            <button
              onClick={() => exportSelectedMarkdown({ mergeSingle: false }).catch(() => {})}
              disabled={!selectedIds.length || exporting}
              type="button"
            >
              Export (multi)
            </button>
            <button onClick={() => onDeleteSelected().catch(() => {})} disabled={!selectedIds.length || loadingList} type="button">
              Delete
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {items.length ? null : (
            <div style={{ opacity: 0.7 }}>No conversations yet.</div>
          )}

          {items.map((c) => {
            const id = Number(c.id);
            const active = Number(c.id) === Number(activeId);
            const title = (c.title && String(c.title).trim()) ? String(c.title).trim() : '(Untitled)';
            return (
              <button
                key={String(c.id)}
                onClick={() => setActiveId(id)}
                type="button"
                style={{
                  textAlign: 'left',
                  padding: '10px 10px',
                  borderRadius: 10,
                  border: '1px solid color-mix(in oklab, CanvasText 15%, transparent)',
                  background: active
                    ? 'color-mix(in oklab, CanvasText 10%, Canvas)'
                    : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedIdSet.has(id)}
                    onChange={() => toggleSelected(id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div style={{ fontWeight: 650, flex: 1 }}>{title}</div>
                </div>
                <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
                  {c.source} · {formatTime(c.lastCapturedAt)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0 }}>{selected ? (selected.title || '(Untitled)') : 'Detail'}</h2>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            {selected ? `${selected.source} · ${selected.conversationKey}` : null}
          </div>
        </div>

        {loadingDetail ? <p style={{ opacity: 0.7 }}>Loading…</p> : null}
        {detailError ? <p style={{ color: 'crimson' }}>{detailError}</p> : null}

        {detail?.messages?.length ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            {detail.messages.map((m) => (
              <article
                key={String(m.id)}
                style={{
                  border: '1px solid color-mix(in oklab, CanvasText 12%, transparent)',
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontWeight: 700 }}>{m.role}</div>
                  <div style={{ opacity: 0.6, fontSize: 12 }}>{formatTime(m.updatedAt)}</div>
                </header>
                <pre style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>
                  {m.contentMarkdown || m.contentText || ''}
                </pre>
              </article>
            ))}
          </div>
        ) : activeId ? (
          <p style={{ opacity: 0.7, marginTop: 12 }}>No messages.</p>
        ) : (
          <p style={{ opacity: 0.7, marginTop: 12 }}>Select a conversation.</p>
        )}
      </div>
    </section>
  );
}
