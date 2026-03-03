import { useEffect, useMemo, useRef, useState } from 'react';

import { exportBackupZipV2 } from '../../../src/backup/export';
import {
  importBackupLegacyJsonMerge,
  importBackupZipV2Merge,
  type ImportProgress,
  type ImportStats,
} from '../../../src/backup/import';
import { extractZipEntries } from '../../../src/backup/zip-utils';
import { disconnectNotion } from '../../../src/settings/sensitive';
import { getNotionOAuthDefaults } from '../../../src/integrations/notion/oauth';
import {
  ARTICLE_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
  UI_MESSAGE_TYPES,
} from '../../../src/platform/messaging/message-contracts';
import { send } from '../../../src/platform/runtime/runtime';
import { storageGet, storageSet } from '../../../src/platform/storage/local';
import { getNotionSyncJobStatus, getObsidianSyncStatus } from '../../../src/sync/repo';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function formatProgress(p: ImportProgress) {
  const safeTotal = Math.max(0, Number(p.total) || 0);
  const safeDone = Math.min(safeTotal || 0, Math.max(0, Number(p.done) || 0));
  const pct = safeTotal ? Math.floor((safeDone / safeTotal) * 100) : 0;
  const labelStage = p.stage ? ` ${p.stage}` : '';
  return { pct, text: `Importing… ${pct}% (${safeDone}/${safeTotal})${labelStage}`.trim() };
}

async function isZipFile(file: File) {
  if (!file) return false;
  const name = file.name ? String(file.name).toLowerCase() : '';
  const type = file.type ? String(file.type).toLowerCase() : '';
  if (name.endsWith('.zip') || type.includes('zip')) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head.length < 4) return false;
    return (
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      ((head[2] === 0x03 && head[3] === 0x04) ||
        (head[2] === 0x05 && head[3] === 0x06) ||
        (head[2] === 0x07 && head[3] === 0x08))
    );
  } catch (_e) {
    return false;
  }
}

function getPageTitle(page: any) {
  try {
    const props = page && page.properties ? page.properties : {};
    for (const key of Object.keys(props)) {
      const p = props[key];
      if (p && p.type === 'title' && Array.isArray(p.title)) {
        const t = p.title.map((x: any) => x.plain_text || '').join('').trim();
        if (t) return t;
      }
    }
  } catch (_e) {
    // ignore
  }
  return page && page.url ? String(page.url) : 'Untitled';
}

type NotionPageOption = { id: string; title: string };

async function searchNotionParentPages(accessToken: string): Promise<NotionPageOption[]> {
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: 50 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`notion api failed: HTTP ${res.status} ${text}`);
  const json = text ? JSON.parse(text) : {};
  const results = Array.isArray(json?.results) ? json.results : [];
  const pages = results.filter((item: any) => {
    if (!item || item.object !== 'page') return false;
    if (item.archived === true || item.in_trash === true) return false;
    const parent = item.parent || null;
    if (!parent) return true;
    if (parent.database_id) return false;
    if (parent.type === 'database_id') return false;
    return true;
  });
  return pages
    .map((p: any) => ({ id: String(p.id || ''), title: getPageTitle(p) }))
    .filter((p: NotionPageOption) => !!p.id);
}

async function retrieveNotionParentPage(accessToken: string, pageId: string): Promise<NotionPageOption | null> {
  const safeId = String(pageId || '').trim();
  if (!safeId) return null;
  const res = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(safeId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': '2022-06-28',
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) return null;
  const json = text ? JSON.parse(text) : {};
  if (!json || json.object !== 'page') return null;
  if (json.archived === true || json.in_trash === true) return null;
  const id = String(json.id || safeId).trim();
  if (!id) return null;
  return { id, title: getPageTitle(json) };
}

function openHttpUrl(url: string) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const anyGlobal: any = globalThis as any;
    const tabs = anyGlobal.browser?.tabs ?? anyGlobal.chrome?.tabs;
    if (tabs?.create) {
      tabs.create({ url: u });
      return true;
    }
  } catch (_e) {
    // ignore
  }
  try {
    window.open(u, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_e) {
    return false;
  }
}

function renderStats(stats: ImportStats | null) {
  if (!stats) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 12 }}>
      <li>
        Conversations: +{stats.conversationsAdded} / ~{stats.conversationsUpdated}
      </li>
      <li>
        Messages: +{stats.messagesAdded} / ~{stats.messagesUpdated} (skipped {stats.messagesSkipped})
      </li>
      <li>
        Mappings: +{stats.mappingsAdded} / ~{stats.mappingsUpdated}
      </li>
      <li>Settings applied: {stats.settingsApplied}</li>
    </ul>
  );
}

function isFirefoxFamilyBrowser() {
  try {
    const ua = String(globalThis.navigator?.userAgent || '').toLowerCase();
    if (!ua) return false;
    return ua.includes('firefox') || ua.includes('librewolf') || ua.includes('zen');
  } catch (_e) {
    return false;
  }
}

async function openExtensionAppSettings() {
  const url = browser.runtime.getURL('/app.html#/settings');
  await browser.tabs.create({ url });
}

export default function SettingsTab() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Notion
  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);
  const [notionWorkspaceName, setNotionWorkspaceName] = useState<string>('');
  const [notionClientId, setNotionClientId] = useState<string>('');
  const [notionPendingState, setNotionPendingState] = useState<string>('');
  const [notionLastError, setNotionLastError] = useState<string>('');
  const [notionParentPageId, setNotionParentPageId] = useState<string>('');
  const [notionParentPageTitle, setNotionParentPageTitle] = useState<string>('');
  const [notionPages, setNotionPages] = useState<Array<{ id: string; title: string }>>([]);
  const [loadingNotionPages, setLoadingNotionPages] = useState(false);
  const [pollingNotion, setPollingNotion] = useState(false);
  const [notionJob, setNotionJob] = useState<any>(null);
  const notionPagesAutoLoadRef = useRef(false);

  // Obsidian
  const [obsidianApiBaseUrl, setObsidianApiBaseUrl] = useState<string>('');
  const [obsidianAuthHeaderName, setObsidianAuthHeaderName] = useState<string>('');
  const [obsidianApiKeyDraft, setObsidianApiKeyDraft] = useState<string>('');
  const [obsidianApiKeyChanged, setObsidianApiKeyChanged] = useState(false);
  const [obsidianApiKeyPresent, setObsidianApiKeyPresent] = useState<boolean>(false);
  const [obsidianApiKeyMasked, setObsidianApiKeyMasked] = useState<string>('');
  const [obsidianChatFolder, setObsidianChatFolder] = useState<string>('');
  const [obsidianArticleFolder, setObsidianArticleFolder] = useState<string>('');
  const [obsidianStatus, setObsidianStatus] = useState<string>('Idle');
  const [obsidianJob, setObsidianJob] = useState<any>(null);

  // Article fetch
  const [articleFetchStatus, setArticleFetchStatus] = useState<string>('Idle');

  // Backup
  const [exportStatus, setExportStatus] = useState<string>('Idle');
  const [importStatus, setImportStatus] = useState<string>('Ready');
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Notion AI
  const [notionAiModelIndex, setNotionAiModelIndex] = useState<string>('');

  // Inpage
  const [inpageSupportedOnly, setInpageSupportedOnly] = useState<boolean | null>(null);
  const useAppImport = useMemo(() => isFirefoxFamilyBrowser(), []);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const [notionRes, local, obsidianRes, nJob, oJob] = await Promise.all([
        send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, {}),
        storageGet([
          'notion_oauth_client_id',
          'notion_oauth_pending_state',
          'notion_oauth_last_error',
          'notion_parent_page_id',
          'notion_parent_page_title',
          'notion_ai_preferred_model_index',
          'inpage_supported_only',
        ]),
        send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS, {}),
        getNotionSyncJobStatus().catch(() => ({ job: null } as any)),
        getObsidianSyncStatus().catch(() => ({ job: null } as any)),
      ]);

      const notion = unwrap(notionRes);
      setNotionConnected(!!notion?.connected);
      setNotionWorkspaceName(String(notion?.token?.workspaceName || ''));

      setNotionClientId(String(local?.notion_oauth_client_id || '').trim());
      setNotionPendingState(String(local?.notion_oauth_pending_state || '').trim());
      setNotionLastError(String(local?.notion_oauth_last_error || '').trim());
      setNotionParentPageId(String(local?.notion_parent_page_id || '').trim());
      setNotionParentPageTitle(String(local?.notion_parent_page_title || '').trim());
      setNotionAiModelIndex(String(local?.notion_ai_preferred_model_index || '').trim());
      setInpageSupportedOnly(local?.inpage_supported_only == null ? null : !!local.inpage_supported_only);

      const obsidian = unwrap(obsidianRes);
      setObsidianApiBaseUrl(String(obsidian?.apiBaseUrl || ''));
      setObsidianAuthHeaderName(String(obsidian?.authHeaderName || ''));
      setObsidianApiKeyPresent(!!obsidian?.apiKeyPresent);
      setObsidianApiKeyMasked(String(obsidian?.apiKeyMasked || ''));
      setObsidianChatFolder(String(obsidian?.chatFolder || ''));
      setObsidianArticleFolder(String(obsidian?.articleFolder || ''));
      setNotionJob(nJob?.job ?? null);
      setObsidianJob(oJob?.job ?? null);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pollingNotion) return;
    const startedAt = Date.now();
    const t = setInterval(() => {
      if (Date.now() - startedAt > 60_000) {
        setPollingNotion(false);
        return;
      }
      refresh().catch(() => {});
    }, 750);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingNotion]);

  const notionPageOptions = useMemo(() => {
    const list = Array.isArray(notionPages) ? notionPages.slice() : [];
    const selectedId = String(notionParentPageId || '').trim();
    if (selectedId && !list.some((p) => String(p?.id || '').trim() === selectedId)) {
      const title = String(notionParentPageTitle || '').trim();
      list.unshift({ id: selectedId, title: title || selectedId });
    }
    const seen = new Set<string>();
    return list.filter((p) => {
      const id = p && p.id ? String(p.id).trim() : '';
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [notionPages, notionParentPageId, notionParentPageTitle]);

  const notionStatusText = useMemo(() => {
    if (notionConnected == null) return 'unknown';
    if (notionConnected) {
      const w = String(notionWorkspaceName || '').trim();
      return w ? `Connected ✅ (${w})` : 'Connected ✅';
    }
    if (notionLastError) return 'Error';
    if (notionPendingState) return 'Waiting…';
    return 'Not connected';
  }, [notionConnected, notionLastError, notionPendingState, notionWorkspaceName]);

  const onNotionConnectOrDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = unwrap(await send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, {}));
      if (status?.connected) {
        await disconnectNotion();
        await refresh();
        return;
      }

      const clientId = String(notionClientId || '').trim();
      if (!clientId) throw new Error('Notion OAuth client id not configured');

      const cfg = getNotionOAuthDefaults();
      const state = `webclipper_${Math.random().toString(16).slice(2)}_${Date.now()}`;
      await storageSet({ notion_oauth_pending_state: state });
      const url = new URL(cfg.authorizationUrl);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('response_type', cfg.responseType);
      url.searchParams.set('owner', cfg.owner);
      url.searchParams.set('redirect_uri', cfg.redirectUri);
      url.searchParams.set('state', state);

      const opened = openHttpUrl(url.toString());
      if (!opened) throw new Error('Failed to open Notion OAuth tab');
      setPollingNotion(true);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  const onLoadNotionPages = async () => {
    setLoadingNotionPages(true);
    setError(null);
    try {
      const status = unwrap(await send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, {}));
      const accessToken = String(status?.token?.accessToken || '');
      if (!accessToken) throw new Error('Notion not connected');
      const savedId = String(notionParentPageId || '').trim();
      const savedTitle = String(notionParentPageTitle || '').trim();

      let pages = await searchNotionParentPages(accessToken);
      let resolvedSaved = savedId ? pages.find((p) => p.id === savedId) ?? null : null;
      if (savedId && !resolvedSaved) {
        const retrieved = await retrieveNotionParentPage(accessToken, savedId);
        if (retrieved) {
          pages = [retrieved, ...pages.filter((p) => p.id !== retrieved.id)];
          resolvedSaved = retrieved;
        }
      }

      setNotionPages(pages);

      const nextId = savedId || (pages[0]?.id || '');
      const nextTitle = (resolvedSaved?.title || (savedId ? savedTitle : pages[0]?.title) || '').trim();
      if (nextId) setNotionParentPageId(nextId);
      if (nextTitle) setNotionParentPageTitle(nextTitle);

      const payload: Record<string, unknown> = {};
      if (nextId && nextId !== savedId) payload.notion_parent_page_id = nextId;
      if (nextTitle && nextTitle !== savedTitle) payload.notion_parent_page_title = nextTitle;
      if (Object.keys(payload).length) await storageSet(payload);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed to load pages'));
    } finally {
      setLoadingNotionPages(false);
    }
  };

  useEffect(() => {
    if (!notionConnected) {
      notionPagesAutoLoadRef.current = false;
      return;
    }
    if (notionPagesAutoLoadRef.current) return;
    if (notionPages.length) {
      notionPagesAutoLoadRef.current = true;
      return;
    }
    notionPagesAutoLoadRef.current = true;
    onLoadNotionPages().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notionConnected]);

  const onSaveNotionParentPage = async (id: string) => {
    const next = String(id || '').trim();
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      setNotionParentPageId(next);
      const match = notionPages.find((p) => p && String(p.id || '').trim() === next) ?? null;
      if (match && match.title) setNotionParentPageTitle(String(match.title || '').trim());
      const payload: Record<string, unknown> = { notion_parent_page_id: next };
      if (match && match.title) payload.notion_parent_page_title = String(match.title || '').trim();
      await storageSet(payload);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  const onFetchCurrentPage = async () => {
    setBusy(true);
    setError(null);
    setArticleFetchStatus('Fetching…');
    try {
      const res = await send<ApiResponse<any>>(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB, {});
      const data = unwrap(res);
      const conversationId = Number(data?.conversationId) || 0;
      setArticleFetchStatus(conversationId ? `Saved ✓ (conversationId=${conversationId})` : 'Done ✓');
    } catch (e) {
      const msg = (e as any)?.message ?? String(e ?? 'fetch failed');
      setArticleFetchStatus(`Error: ${msg}`);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const onSaveObsidianSettings = async ({ includeApiKey }: { includeApiKey?: boolean } = {}) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setObsidianStatus('Saving…');
    try {
      const payload: any = {
        apiBaseUrl: obsidianApiBaseUrl,
        authHeaderName: obsidianAuthHeaderName,
        chatFolder: obsidianChatFolder,
        articleFolder: obsidianArticleFolder,
      };
      if (includeApiKey === true && String(obsidianApiKeyDraft || '').trim()) payload.apiKey = obsidianApiKeyDraft;
      const res = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS, payload);
      const data = unwrap(res);
      setObsidianApiBaseUrl(String(data?.apiBaseUrl || ''));
      setObsidianAuthHeaderName(String(data?.authHeaderName || ''));
      setObsidianApiKeyPresent(!!data?.apiKeyPresent);
      setObsidianApiKeyMasked(String(data?.apiKeyMasked || ''));
      setObsidianChatFolder(String(data?.chatFolder || ''));
      setObsidianArticleFolder(String(data?.articleFolder || ''));
      setObsidianApiKeyDraft('');
      setObsidianApiKeyChanged(false);
      setObsidianStatus('Saved');
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
      setObsidianStatus('Error');
    } finally {
      setBusy(false);
    }
  };

  const onTestObsidianConnection = async () => {
    setBusy(true);
    setError(null);
    setObsidianStatus('Testing…');
    try {
      const res = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.TEST_CONNECTION, {});
      const data = unwrap(res);
      const ok = data && data.ok === true;
      const message = data && data.message ? String(data.message) : '';
      setObsidianStatus(ok ? `OK ✓ ${message}`.trim() : `Error: ${message || 'failed'}`);
    } catch (e) {
      const msg = (e as any)?.message ?? String(e ?? 'failed');
      setObsidianStatus(`Error: ${msg}`);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const onToggleInpageSupportedOnly = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await storageSet({ inpage_supported_only: !!next });
      setInpageSupportedOnly(!!next);
      const res = await send<ApiResponse<any>>(UI_MESSAGE_TYPES.APPLY_INPAGE_VISIBILITY, {});
      unwrap(res);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  const onSaveNotionAiModelIndex = async () => {
    setBusy(true);
    setError(null);
    try {
      const raw = String(notionAiModelIndex || '').trim();
      const n = raw ? Number(raw) : NaN;
      if (!raw) {
        await storageSet({ notion_ai_preferred_model_index: '' });
      } else if (!Number.isFinite(n) || n <= 0) {
        throw new Error('Invalid model index');
      } else {
        await storageSet({ notion_ai_preferred_model_index: Math.floor(n) });
      }
      await refresh();
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  const onResetNotionAiModelIndex = async () => {
    setBusy(true);
    setError(null);
    try {
      await storageSet({ notion_ai_preferred_model_index: '' });
      await refresh();
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleBackupExport = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setExportStatus('Exporting…');
    try {
      const res = await exportBackupZipV2();
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      setExportStatus(`Exported (${res.counts.conversations} convos, ${res.counts.messages} msgs)`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      const msg = (e as any)?.message ? String((e as any).message) : String(e || 'export failed');
      setExportStatus(`Error: ${msg}`);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const importFromFile = async (file: File) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setImportStats(null);
    setImportStatus(`Importing: ${file.name}`);
    try {
      const asZip = await isZipFile(file);
      let stats: ImportStats;
      if (asZip) {
        const entries = await extractZipEntries(file);
        stats = await importBackupZipV2Merge(entries, (p) => {
          const view = formatProgress(p);
          setImportStatus(view.text);
        });
      } else {
        const text = await file.text();
        const doc = JSON.parse(text);
        stats = await importBackupLegacyJsonMerge(doc, (p) => {
          const view = formatProgress(p);
          setImportStatus(view.text);
        });
      }
      setImportStats(stats);
      setImportStatus('Imported ✓');
    } catch (e) {
      const msg = (e as any)?.message ? String((e as any).message) : String(e || 'import failed');
      setImportStatus(`Error: ${msg}`);
      setError(msg);
    } finally {
      setBusy(false);
      try {
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (_e) {
        // ignore
      }
    }
  };

  const handleBackupImportClick = async () => {
    if (busy) return;
    if (!useAppImport) {
      fileInputRef.current?.click();
      return;
    }
    setImportStatus('Firefox kernel detected: import in App Settings');
    await openExtensionAppSettings();
    window.close();
  };

  const openSetupGuide = () => {
    openHttpUrl('https://github.com/chiimagnus/SyncNos/blob/main/.github/guide/obsidian/LocalRestAPI.zh.md');
  };

  const articleFetchStatusClass = useMemo(() => {
    const s = String(articleFetchStatus || '').toLowerCase();
    if (s.includes('fetch')) return 'is-loading';
    if (s.startsWith('error')) return 'is-error';
    if (s.includes('saved') || s.includes('done')) return 'is-ok';
    return '';
  }, [articleFetchStatus]);

  return (
    <div className="viewScroll" aria-label="Settings content">
      {error ? (
        <section className="toolbar" style={{ borderColor: 'rgba(199, 55, 47, 0.35)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          {error}
        </section>
      ) : null}

      <section className="toolbar settingsPanel" id="databaseBackupCard" aria-label="Database backup">
        <div className="settingsRow settingsRow--header" aria-label="Database backup header">
          <div className="notionHeaderText">
            <span className="notionHeaderTitle">Database Backup</span>
          </div>
          <div className="spacer" />
        </div>

        <div className="settingsDivider" role="presentation" />

        <div className="settingsRow settingsRow--compact" aria-label="Database import controls">
          <div className="settingsControl settingsControl--grow">
            <button id="btnDatabaseExport" className="btn" type="button" onClick={() => handleBackupExport().catch(() => {})} disabled={busy}>
              Export
            </button>
            <button
              id="btnDatabaseImport"
              className="btn"
              type="button"
              onClick={() => handleBackupImportClick().catch(() => {})}
              disabled={busy}
            >
              {useAppImport ? 'Import in App' : 'Import'}
            </button>
            <input
              ref={fileInputRef}
              id="databaseImportFile"
              className="fileInputHidden"
              type="file"
              accept=".zip,application/zip,.json,application/json"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                void importFromFile(f);
              }}
            />
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Database backup status">
          <div className="settingsLabel settingsLabel--inline">Status</div>
          <div className="sub">
            export: {exportStatus} · import: {importStatus}
          </div>
        </div>

        {importStats ? (
          <div className="settingsRow settingsRow--compact" aria-label="Database backup import stats">
            <div className="settingsLabel settingsLabel--inline">Stats</div>
            <div className="sub">{renderStats(importStats)}</div>
          </div>
        ) : null}
      </section>

      <section className="toolbar settingsPanel" id="articleFetchCard" aria-label="Article fetch">
        <div className="settingsRow settingsRow--header" aria-label="Article fetch header">
          <div className="notionHeaderText">
            <span className="notionHeaderTitle">Article Fetch</span>
          </div>
          <div className="spacer" />
        </div>

        <div className="settingsDivider" role="presentation" />

        <div className="settingsRow settingsRow--compact" aria-label="Fetch current page article">
          <div className="settingsControl settingsControl--grow">
            <button id="btnFetchCurrentArticle" className="btn" type="button" onClick={() => onFetchCurrentPage().catch(() => {})} disabled={busy}>
              Fetch Current Page
            </button>
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Article fetch status">
          <div className="settingsLabel settingsLabel--inline">Status</div>
          <div id="articleFetchStatus" className={['sub', articleFetchStatusClass].filter(Boolean).join(' ')}>
            {articleFetchStatus}
          </div>
        </div>
      </section>

      <section className="toolbar settingsPanel" id="notionAuthCard" aria-label="Notion settings">
        <div className="settingsRow settingsRow--header" id="notionBar">
          <img className="notionLogo" src={browser.runtime.getURL('icons/notion.svg' as any)} alt="" aria-hidden="true" />
          <div className="notionHeaderText" aria-label="Notion OAuth status">
            <span className="notionHeaderTitle">Notion OAuth</span>
            <span className="notionHeaderSep" aria-hidden="true">
              |
            </span>
            <span id="notionStatusTitle" className="notionHeaderStatus">
              {notionStatusText}
            </span>
          </div>
          <div className="spacer" />
          <button id="btnNotionConnect" className="btn" disabled={busy} onClick={() => onNotionConnectOrDisconnect().catch(() => {})} type="button">
            {notionConnected ? 'Disconnect' : pollingNotion ? 'Connecting…' : 'Connect'}
          </button>
        </div>

        <div className="settingsDivider" role="presentation" />

        <div className="settingsRow settingsRow--compact" aria-label="Parent page selector">
          <div className="settingsLabel settingsLabel--inline">Parent Page</div>
          <div className="settingsControl settingsControl--grow">
            <select
              id="notionPages"
              className="input"
              value={notionParentPageId}
              disabled={busy || !notionConnected}
              onChange={(e) => onSaveNotionParentPage(e.target.value).catch(() => {})}
            >
              {notionPageOptions.length ? null : <option value="">{notionConnected ? 'Click refresh →' : 'Connect Notion first'}</option>}
              {notionPageOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button
              id="btnNotionLoadPages"
              className="btn icon"
              type="button"
              title="Refresh"
              onClick={() => onLoadNotionPages().catch(() => {})}
              disabled={busy || !notionConnected || loadingNotionPages}
            >
              ↻
            </button>
          </div>
        </div>
      </section>

      <section className="toolbar settingsPanel" id="notionAiCard" aria-label="Notion AI settings">
        <div className="settingsRow settingsRow--header" aria-label="Notion AI header">
          <div className="notionHeaderText">
            <span className="notionHeaderTitle">Notion AI</span>
          </div>
          <div className="spacer" />
        </div>

        <div className="settingsDivider" role="presentation" />

        <div className="settingsRow settingsRow--compact" aria-label="Preferred model index">
          <div className="settingsLabel settingsLabel--inline">Model Index</div>
          <div className="settingsControl settingsControl--grow">
            <input
              id="notionAiModelIndex"
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="3"
              aria-label="Notion AI preferred model index"
              value={notionAiModelIndex}
              disabled={busy}
              onChange={(e) => setNotionAiModelIndex(e.target.value)}
            />
            <button id="btnNotionAiModelSave" className="btn" type="button" onClick={() => onSaveNotionAiModelIndex().catch(() => {})} disabled={busy}>
              Save
            </button>
            <button id="btnNotionAiModelReset" className="btn" type="button" title="Reset to default" onClick={() => onResetNotionAiModelIndex().catch(() => {})} disabled={busy}>
              Reset
            </button>
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Notion AI model note">
          <div className="settingsLabel settingsLabel--inline">Note</div>
          <div className="sub">Applies only when Notion AI model is set to Auto. Menu order may change in Notion.</div>
        </div>
      </section>

      <section className="toolbar settingsPanel" id="obsidianSyncCard" aria-label="Obsidian Local REST API">
        <div className="settingsRow settingsRow--header" aria-label="Obsidian sync header">
          <div className="notionHeaderText">
            <span className="notionHeaderTitle">Obsidian Local REST API</span>
          </div>
          <div className="spacer" />
        </div>

        <div className="settingsDivider" role="presentation" />

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian API Base URL">
          <div className="settingsLabel settingsLabel--inline">Base URL</div>
          <div className="settingsControl settingsControl--grow">
            <input
              id="obsidianApiBaseUrl"
              className="input"
              type="text"
              spellCheck={false}
              placeholder="http://127.0.0.1:27123"
              aria-label="Obsidian API base url"
              value={obsidianApiBaseUrl}
              disabled={busy}
              onChange={(e) => setObsidianApiBaseUrl(e.target.value)}
              onBlur={() => onSaveObsidianSettings().catch(() => {})}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void onSaveObsidianSettings();
              }}
            />
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian API key">
          <div className="settingsLabel settingsLabel--inline">API Key</div>
          <div className="settingsControl settingsControl--grow">
            <input
              id="obsidianApiKey"
              className="input"
              type="text"
              placeholder={obsidianApiKeyPresent ? obsidianApiKeyMasked : ''}
              aria-label="Obsidian API key"
              value={obsidianApiKeyDraft}
              disabled={busy}
              onChange={(e) => {
                setObsidianApiKeyDraft(e.target.value);
                setObsidianApiKeyChanged(true);
              }}
              onBlur={() => {
                if (!String(obsidianApiKeyDraft || '').trim()) return;
                void onSaveObsidianSettings({ includeApiKey: true });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!String(obsidianApiKeyDraft || '').trim()) return;
                void onSaveObsidianSettings({ includeApiKey: true });
              }}
            />
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian auth header name">
          <div className="settingsLabel settingsLabel--inline">Auth Header</div>
          <div className="settingsControl settingsControl--grow">
            <input
              id="obsidianAuthHeaderName"
              className="input"
              type="text"
              spellCheck={false}
              placeholder="Authorization"
              aria-label="Obsidian auth header name"
              value={obsidianAuthHeaderName}
              disabled={busy}
              onChange={(e) => setObsidianAuthHeaderName(e.target.value)}
              onBlur={() => onSaveObsidianSettings().catch(() => {})}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void onSaveObsidianSettings();
              }}
            />
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian sync controls">
          <div className="settingsControl settingsControl--grow">
            <button id="btnObsidianTestConnection" className="btn" type="button" onClick={() => onTestObsidianConnection().catch(() => {})} disabled={busy}>
              Test
            </button>
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian sync status">
          <div className="settingsLabel settingsLabel--inline">Status</div>
          <div id="obsidianSyncStatus" className="sub">
            {obsidianStatus}
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian sync note">
          <div className="settingsLabel settingsLabel--inline">Note</div>
          <div className="sub">
            Install and configure Obsidian Local REST API first.{' '}
            <a
              id="obsidianSetupGuideLink"
              className="textLink"
              href="https://github.com/chiimagnus/SyncNos/blob/main/.github/guide/obsidian/LocalRestAPI.zh.md"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                openSetupGuide();
              }}
            >
              Open Setup Guide
            </a>
          </div>
        </div>
      </section>

      <section className="toolbar settingsPanel" id="obsidianPathsCard" aria-label="Obsidian Paths">
        <div className="settingsRow settingsRow--header" aria-label="Obsidian paths header">
          <div className="notionHeaderText">
            <span className="notionHeaderTitle">Obsidian Paths</span>
          </div>
          <div className="spacer" />
        </div>

        <div className="settingsDivider" role="presentation" />

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian AI chats folder">
          <div className="settingsLabel settingsLabel--inline">AI Chats Folder</div>
          <div className="settingsControl settingsControl--grow">
            <input
              id="obsidianChatFolder"
              className="input"
              type="text"
              spellCheck={false}
              placeholder="SyncNos-AIChats"
              aria-label="Obsidian AI chats folder"
              value={obsidianChatFolder}
              disabled={busy}
              onChange={(e) => setObsidianChatFolder(e.target.value)}
              onBlur={() => onSaveObsidianSettings().catch(() => {})}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void onSaveObsidianSettings();
              }}
            />
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian web clipper folder">
          <div className="settingsLabel settingsLabel--inline">Web Clipper Folder</div>
          <div className="settingsControl settingsControl--grow">
            <input
              id="obsidianArticleFolder"
              className="input"
              type="text"
              spellCheck={false}
              placeholder="SyncNos-WebArticles"
              aria-label="Obsidian web clipper folder"
              value={obsidianArticleFolder}
              disabled={busy}
              onChange={(e) => setObsidianArticleFolder(e.target.value)}
              onBlur={() => onSaveObsidianSettings().catch(() => {})}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void onSaveObsidianSettings();
              }}
            />
          </div>
        </div>

        <div className="settingsRow settingsRow--compact" aria-label="Obsidian paths note">
          <div className="settingsLabel settingsLabel--inline">Note</div>
          <div className="sub">Vault-relative folder paths. Nested folders supported. Empty uses defaults.</div>
        </div>
      </section>

      <section className="toolbar settingsPanel" id="inpageVisibilityCard" aria-label="Inpage button visibility settings">
        <div className="settingsRow settingsRow--header" aria-label="Inpage button visibility header">
          <div className="notionHeaderText">
            <span className="notionHeaderTitle">Inpage Button</span>
          </div>
          <div className="spacer" />
        </div>

        <div className="settingsDivider" role="presentation" />

        <div className="settingsRow settingsRow--compact" aria-label="Inpage button supported sites toggle">
          <div className="settingsControl settingsControl--grow">
            <label className="checkbox" htmlFor="inpageSupportedOnlyToggle">
              <input
                id="inpageSupportedOnlyToggle"
                type="checkbox"
                checked={!!inpageSupportedOnly}
                disabled={busy || inpageSupportedOnly == null}
                onChange={(e) => onToggleInpageSupportedOnly(e.target.checked).catch(() => {})}
              />
              <span>仅在支持站点显示 Inpage 按钮</span>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
