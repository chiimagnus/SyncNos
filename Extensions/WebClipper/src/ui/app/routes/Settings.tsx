import { useEffect, useState } from 'react';
import {
  clearObsidianApiKey,
  disconnectNotion,
  getNotionConnectionStatus,
  getObsidianSettingsStatus,
} from '../../../domains/settings/sensitive';
import { ARTICLE_MESSAGE_TYPES, UI_MESSAGE_TYPES } from '../../../platform/messaging/message-contracts';
import { send } from '../../../platform/runtime/runtime';
import { storageGet, storageSet } from '../../../platform/storage/local';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

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
  const [articleFetchStatus, setArticleFetchStatus] = useState<string>('Idle');
  const [inpageSupportedOnly, setInpageSupportedOnly] = useState<boolean | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [n, o, s] = await Promise.all([
        getNotionConnectionStatus(),
        getObsidianSettingsStatus(),
        storageGet(['inpage_supported_only']),
      ]);
      setNotionConnected(n.connected);
      setObsidian(o);
      setInpageSupportedOnly(!!s?.inpage_supported_only);
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

  const onFetchCurrentPage = async () => {
    setLoading(true);
    setError(null);
    setArticleFetchStatus('Fetching…');
    try {
      const res = await send<ApiResponse<any>>(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB, {});
      const data = unwrap(res);
      const conversationId = Number(data?.conversationId) || 0;
      setArticleFetchStatus(conversationId ? `Saved ✓ (conversationId=${conversationId})` : 'Done ✓');
      await refresh();
    } catch (e) {
      const msg = (e as any)?.message ?? String(e ?? 'fetch failed');
      setArticleFetchStatus(`Error: ${msg}`);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const onToggleInpageSupportedOnly = async (next: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await storageSet({ inpage_supported_only: !!next });
      setInpageSupportedOnly(!!next);
      const res = await send<ApiResponse<any>>(UI_MESSAGE_TYPES.APPLY_INPAGE_VISIBILITY, {});
      unwrap(res);
    } catch (e) {
      const msg = (e as any)?.message ?? String(e ?? 'failed');
      setError(msg);
    } finally {
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

        <section
          style={{
            border: '1px solid color-mix(in oklab, CanvasText 12%, transparent)',
            borderRadius: 12,
            padding: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>Article Fetch</h2>
          <button onClick={() => onFetchCurrentPage().catch(() => {})} disabled={loading} style={{ marginTop: 10 }} type="button">
            Fetch Current Page
          </button>
          <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>status: {articleFetchStatus}</div>
        </section>

        <section
          style={{
            border: '1px solid color-mix(in oklab, CanvasText 12%, transparent)',
            borderRadius: 12,
            padding: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>Inpage Button</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={!!inpageSupportedOnly}
              disabled={loading || inpageSupportedOnly == null}
              onChange={(e) => onToggleInpageSupportedOnly(!!e.target.checked).catch(() => {})}
            />
            Only show on supported sites
          </label>
          <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>
            Applies immediately to existing tabs.
          </div>
        </section>
      </div>
    </section>
  );
}
