import { useEffect, useState } from 'react';
import { getNotionSyncJobStatus, getObsidianSyncStatus } from '../../../domains/sync/repo';

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function SyncJobs() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notion, setNotion] = useState<any>(null);
  const [obsidian, setObsidian] = useState<any>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [n, o] = await Promise.all([getNotionSyncJobStatus(), getObsidianSyncStatus()]);
      setNotion(n);
      setObsidian(o);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notionJob = notion?.job ?? null;
  const obsidianJob = obsidian?.job ?? null;

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Sync</h1>
        <button onClick={refresh} disabled={loading} type="button">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section
          style={{
            border: '1px solid color-mix(in oklab, CanvasText 12%, transparent)',
            borderRadius: 12,
            padding: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>Notion</h2>
          <div style={{ marginTop: 8, opacity: 0.8, fontSize: 12 }}>
            status: {String(notionJob?.status ?? 'idle')}
          </div>
          <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12 }}>
            updated: {formatTime(notionJob?.updatedAt)}
          </div>
          <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12 }}>
            conversations: {Array.isArray(notionJob?.conversationIds) ? notionJob.conversationIds.length : 0}
          </div>
          {notionJob?.error ? (
            <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', color: 'crimson' }}>
              {String(notionJob.error)}
            </pre>
          ) : null}
        </section>

        <section
          style={{
            border: '1px solid color-mix(in oklab, CanvasText 12%, transparent)',
            borderRadius: 12,
            padding: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>Obsidian</h2>
          <div style={{ marginTop: 8, opacity: 0.8, fontSize: 12 }}>
            status: {String(obsidianJob?.status ?? 'idle')}
          </div>
          <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12 }}>
            started: {formatTime(obsidianJob?.startedAt)}
          </div>
          <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12 }}>
            conversations: {Array.isArray(obsidianJob?.conversationIds) ? obsidianJob.conversationIds.length : 0}
          </div>
        </section>
      </div>
    </section>
  );
}
