import { useEffect, useState } from 'react';
import {
  clearObsidianApiKey,
  disconnectNotion,
  getNotionConnectionStatus,
  getObsidianSettingsStatus,
} from '../../../domains/settings/sensitive';

export default function Settings() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);
  const [obsidian, setObsidian] = useState<{
    apiBaseUrl: string;
    authHeaderName: string;
    apiKeyPresent: boolean;
    chatFolder: string;
    articleFolder: string;
  } | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [n, o] = await Promise.all([getNotionConnectionStatus(), getObsidianSettingsStatus()]);
      setNotionConnected(n.connected);
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

  const onDisconnectNotion = async () => {
    setLoading(true);
    setError(null);
    try {
      await disconnectNotion();
      await refresh();
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
      setLoading(false);
    }
  };

  const onClearObsidianKey = async () => {
    setLoading(true);
    setError(null);
    try {
      await clearObsidianApiKey();
      await refresh();
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
      setLoading(false);
    }
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Settings</h1>
        <button onClick={refresh} disabled={loading} type="button">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <p style={{ marginTop: 8, opacity: 0.75 }}>
        Sensitive fields (tokens / API keys) are never displayed here. Only status + clear actions.
      </p>

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
          <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>
            status: {notionConnected == null ? 'unknown' : notionConnected ? 'connected' : 'not connected'}
          </div>
          <button
            onClick={onDisconnectNotion}
            disabled={loading || notionConnected === false}
            style={{ marginTop: 10 }}
            type="button"
          >
            Disconnect (Clear token)
          </button>
        </section>

        <section
          style={{
            border: '1px solid color-mix(in oklab, CanvasText 12%, transparent)',
            borderRadius: 12,
            padding: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>Obsidian</h2>
          <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>
            apiBaseUrl: {obsidian?.apiBaseUrl ?? 'unknown'}
          </div>
          <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
            authHeaderName: {obsidian?.authHeaderName ?? 'unknown'}
          </div>
          <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
            apiKey: {obsidian?.apiKeyPresent ? 'configured' : 'not configured'}
          </div>
          <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
            chatFolder: {obsidian?.chatFolder ?? 'unknown'}
          </div>
          <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
            articleFolder: {obsidian?.articleFolder ?? 'unknown'}
          </div>
          <button
            onClick={onClearObsidianKey}
            disabled={loading || obsidian?.apiKeyPresent !== true}
            style={{ marginTop: 10 }}
            type="button"
          >
            Clear API key
          </button>
        </section>
      </div>
    </section>
  );
}

