import { useEffect, useMemo, useState } from 'react';
import type { Conversation, ConversationDetail } from '../../../domains/conversations/models';
import { getConversationDetail, listConversations } from '../../../domains/conversations/repo';

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

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  const selected = useMemo(
    () => items.find((x) => Number(x.id) === Number(selectedId)) ?? null,
    [items, selectedId],
  );

  const refresh = async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const list = await listConversations();
      setItems(list);
      if (list.length && selectedId == null) setSelectedId(Number(list[0].id));
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
    const id = selectedId;
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
  }, [selectedId]);

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

        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {items.length ? null : (
            <div style={{ opacity: 0.7 }}>No conversations yet.</div>
          )}

          {items.map((c) => {
            const active = Number(c.id) === Number(selectedId);
            const title = (c.title && String(c.title).trim()) ? String(c.title).trim() : '(Untitled)';
            return (
              <button
                key={String(c.id)}
                onClick={() => setSelectedId(Number(c.id))}
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
                <div style={{ fontWeight: 650 }}>{title}</div>
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
        ) : selectedId ? (
          <p style={{ opacity: 0.7, marginTop: 12 }}>No messages.</p>
        ) : (
          <p style={{ opacity: 0.7, marginTop: 12 }}>Select a conversation.</p>
        )}
      </div>
    </section>
  );
}
