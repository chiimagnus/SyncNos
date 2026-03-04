import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { exportBackupZipV2 } from '../../../sync/backup/export';
import { LAST_BACKUP_EXPORT_AT_STORAGE_KEY } from '../../../sync/backup/backup-utils';
import {
  importBackupLegacyJsonMerge,
  importBackupZipV2Merge,
  type ImportProgress,
  type ImportStats,
} from '../../../sync/backup/import';
import { extractZipEntries } from '../../../sync/backup/zip-utils';
import { disconnectNotion } from '../../../sync/notion/auth/settings-client';
import { getNotionOAuthDefaults } from '../../../sync/notion/auth/oauth';
import {
  ARTICLE_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
  UI_MESSAGE_TYPES,
} from '../../../platform/messaging/message-contracts';
import { send } from '../../../platform/runtime/runtime';
import { storageGet, storageSet } from '../../../platform/storage/local';
import { getNotionSyncJobStatus, getObsidianSyncStatus } from '../../../sync/repo';

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
    <ul style={{ margin: 0, paddingLeft: 18 }}>
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

export default function Settings() {
  const routerLocation = useLocation();
  const navigate = useNavigate();

  const notionRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLDivElement | null>(null);
  const obsidianRef = useRef<HTMLDivElement | null>(null);
  const backupRef = useRef<HTMLDivElement | null>(null);
  const backupImportRef = useRef<HTMLDivElement | null>(null);
  const notionAiRef = useRef<HTMLDivElement | null>(null);
  const inpageRef = useRef<HTMLDivElement | null>(null);

  type SettingsSectionKey = 'notion' | 'article' | 'obsidian' | 'backup' | 'notion-ai' | 'inpage';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSection = useMemo<SettingsSectionKey>(() => {
    const params = new URLSearchParams(routerLocation.search || '');
    const raw = String(params.get('section') || '').trim().toLowerCase();
    if (raw === 'article' || raw === 'obsidian' || raw === 'backup' || raw === 'notion-ai' || raw === 'inpage') return raw;
    return 'notion';
  }, [routerLocation.search]);

  const focusKey = useMemo(() => {
    const params = new URLSearchParams(routerLocation.search || '');
    return String(params.get('focus') || '').trim().toLowerCase();
  }, [routerLocation.search]);

  const setActiveSection = (key: SettingsSectionKey) => {
    const params = new URLSearchParams(routerLocation.search || '');
    params.set('section', key);
    params.delete('focus');
    navigate({ pathname: routerLocation.pathname, search: `?${params.toString()}` }, { replace: true, state: routerLocation.state });
  };

  // Notion
  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);
  const [notionWorkspaceName, setNotionWorkspaceName] = useState<string>('');
  const [notionPendingState, setNotionPendingState] = useState<string>('');
  const [notionLastError, setNotionLastError] = useState<string>('');
  const [notionClientId, setNotionClientId] = useState<string>('');
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
  const [obsidianChatFolder, setObsidianChatFolder] = useState<string>('');
  const [obsidianArticleFolder, setObsidianArticleFolder] = useState<string>('');
  const [obsidianTestResult, setObsidianTestResult] = useState<string>('');
  const [obsidianJob, setObsidianJob] = useState<any>(null);

  // Article fetch
  const [articleFetchStatus, setArticleFetchStatus] = useState<string>('Idle');

  // Backup
  const [exportStatus, setExportStatus] = useState<string>('Idle');
  const [importStatus, setImportStatus] = useState<string>('Ready');
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [lastBackupExportAt, setLastBackupExportAt] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Notion AI
  const [notionAiModelIndex, setNotionAiModelIndex] = useState<string>('');

  // Inpage
  const [inpageSupportedOnly, setInpageSupportedOnly] = useState<boolean | null>(null);

  const cardClassName = 'tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3';
  const buttonClassName =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-px-3 tw-text-xs tw-font-bold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)] disabled:tw-cursor-not-allowed disabled:tw-opacity-60';
  const primaryButtonClassName =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--text)] tw-bg-[var(--text)] tw-px-3 tw-text-xs tw-font-bold tw-text-white tw-transition-colors tw-duration-200 hover:tw-bg-[#c94f20] disabled:tw-cursor-not-allowed disabled:tw-opacity-60';

  const buttonStyle = useMemo(
    () => ({
      padding: '8px 12px',
      borderRadius: 10,
      border: '1px solid var(--border-strong)',
      background: 'var(--btn-bg)',
      color: 'var(--text)',
      fontWeight: 700,
      cursor: 'pointer',
    }),
    [],
  );

  const cardStyle = useMemo(
    () => ({
      border: '1px solid var(--border)',
      borderRadius: 16,
      background: 'rgba(255, 255, 255, 0.8)',
      padding: 12,
    }),
    [],
  );

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
          LAST_BACKUP_EXPORT_AT_STORAGE_KEY,
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
      setLastBackupExportAt(Number((local as any)?.[LAST_BACKUP_EXPORT_AT_STORAGE_KEY]) || 0);

      const obsidian = unwrap(obsidianRes);
      setObsidianApiBaseUrl(String(obsidian?.apiBaseUrl || ''));
      setObsidianAuthHeaderName(String(obsidian?.authHeaderName || ''));
      setObsidianApiKeyPresent(!!obsidian?.apiKeyPresent);
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

  const onSaveObsidianSettings = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: any = {
        apiBaseUrl: obsidianApiBaseUrl,
        authHeaderName: obsidianAuthHeaderName,
        chatFolder: obsidianChatFolder,
        articleFolder: obsidianArticleFolder,
      };
      if (obsidianApiKeyChanged) payload.apiKey = obsidianApiKeyDraft;
      const res = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS, payload);
      const data = unwrap(res);
      setObsidianApiBaseUrl(String(data?.apiBaseUrl || ''));
      setObsidianAuthHeaderName(String(data?.authHeaderName || ''));
      setObsidianApiKeyPresent(!!data?.apiKeyPresent);
      setObsidianChatFolder(String(data?.chatFolder || ''));
      setObsidianArticleFolder(String(data?.articleFolder || ''));
      setObsidianApiKeyDraft('');
      setObsidianApiKeyChanged(false);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  const onClearObsidianKey = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS, { apiKey: '' });
      const data = unwrap(res);
      setObsidianApiKeyPresent(!!data?.apiKeyPresent);
      setObsidianApiKeyDraft('');
      setObsidianApiKeyChanged(false);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  const onTestObsidianConnection = async () => {
    setBusy(true);
    setError(null);
    setObsidianTestResult('Testing…');
    try {
      const res = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.TEST_CONNECTION, {});
      const data = unwrap(res);
      const ok = data && data.ok === true;
      const message = data && data.message ? String(data.message) : '';
      setObsidianTestResult(ok ? `OK ✓ ${message}`.trim() : `Error: ${message || 'failed'}`);
    } catch (e) {
      const msg = (e as any)?.message ?? String(e ?? 'failed');
      setObsidianTestResult(`Error: ${msg}`);
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
      setLastBackupExportAt(Date.parse(res.exportedAt) || Date.now());
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

  const notionStatusText = useMemo(() => {
    if (notionConnected == null) return 'unknown';
    if (notionConnected) {
      const w = String(notionWorkspaceName || '').trim();
      return w ? `Connected ✓ (${w})` : 'Connected ✓';
    }
    if (notionLastError) return `Error: ${notionLastError}`;
    if (notionPendingState) return 'Waiting…';
    return 'Not connected';
  }, [notionConnected, notionLastError, notionPendingState, notionWorkspaceName]);

  useEffect(() => {
    const refByKey: Record<SettingsSectionKey, React.RefObject<HTMLDivElement | null>> = {
      notion: notionRef,
      article: articleRef,
      obsidian: obsidianRef,
      backup: backupRef,
      'notion-ai': notionAiRef,
      inpage: inpageRef,
    };

    const target = refByKey[activeSection]?.current || null;
    if (target) target.scrollIntoView({ block: 'start' });

    if (focusKey === 'import') {
      backupImportRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [activeSection, focusKey]);

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0">
      <aside className="tw-w-[220px] tw-shrink-0 tw-border-r tw-border-[var(--border)] tw-bg-[var(--panel)]/40">
        <div className="tw-p-4">
          <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">Settings</div>
          <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">Integrations, backup, and app behavior.</div>
        </div>

        <nav className="tw-px-2 tw-pb-4" aria-label="Settings sections">
          {([
            { key: 'notion', label: 'Notion' },
            { key: 'article', label: 'Article' },
            { key: 'obsidian', label: 'Obsidian' },
            { key: 'backup', label: 'Backup' },
            { key: 'notion-ai', label: 'Notion AI' },
            { key: 'inpage', label: 'Inpage' },
          ] as Array<{ key: SettingsSectionKey; label: string }>).map((s) => {
            const active = activeSection === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setActiveSection(s.key)}
                className={[
                  'tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-xl tw-border tw-px-3 tw-py-2 tw-text-left tw-text-xs tw-font-extrabold tw-transition-colors tw-duration-200',
                  active
                    ? 'tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)]'
                    : 'tw-border-transparent tw-bg-transparent tw-text-[var(--muted)] hover:tw-border-[var(--border)] hover:tw-bg-white/40 hover:tw-text-[var(--text)]',
                ].join(' ')}
                aria-current={active ? 'page' : undefined}
              >
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-overflow-x-hidden tw-p-4">
        <section className="route-scroll tw-mx-auto tw-grid tw-w-full tw-max-w-[980px] tw-gap-4 tw-pr-1">
      <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--panel)]/85 tw-p-4">
        <div>
          <h1 className="tw-m-0 tw-text-[26px] tw-font-black tw-leading-none tw-tracking-[-0.01em] tw-text-[var(--text)]">Settings</h1>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Sync integrations, backup, and app behavior controls.</p>
        </div>
        <button onClick={() => refresh().catch(() => {})} disabled={busy} type="button" className={primaryButtonClassName}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="tw-m-0 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{error}</p> : null}

      <div ref={notionRef} id="settings-notion">
      <section style={cardStyle as any} className={cardClassName} aria-label="Notion OAuth">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Notion OAuth</h2>
        <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>status: {notionStatusText}</div>
        <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
          clientId: {notionClientId ? notionClientId : '(missing)'}
        </div>
        <button onClick={() => onNotionConnectOrDisconnect().catch(() => {})} disabled={busy} style={{ marginTop: 10 }} type="button" className={buttonClassName}>
          {notionConnected ? 'Disconnect' : pollingNotion ? 'Connecting…' : 'Connect'}
        </button>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Parent Page</div>
            <select
              value={notionParentPageId}
              disabled={busy || !notionConnected}
              onChange={(e) => onSaveNotionParentPage(e.target.value).catch(() => {})}
              style={{ width: '100%' }}
              className="tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]"
            >
              {notionPageOptions.length ? null : <option value="">{notionConnected ? 'Click refresh →' : 'Connect Notion first'}</option>}
              {notionPageOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => onLoadNotionPages().catch(() => {})} disabled={busy || !notionConnected || loadingNotionPages} type="button" className={buttonClassName}>
            {loadingNotionPages ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div style={{ marginTop: 12, opacity: 0.85, fontSize: 12 }}>
          sync status: {String(notionJob?.status ?? 'idle')} · updated: {formatTime(notionJob?.updatedAt)}
        </div>
        {notionJob?.error ? (
          <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', color: 'crimson' }}>
            {String(notionJob.error)}
          </pre>
        ) : null}
      </section>
      </div>

      <div ref={articleRef} id="settings-article">
      <section style={cardStyle as any} className={cardClassName} aria-label="Article Fetch">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Article Fetch</h2>
        <button onClick={() => onFetchCurrentPage().catch(() => {})} disabled={busy} style={{ marginTop: 10 }} type="button" className={buttonClassName}>
          Fetch Current Page
        </button>
        <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>status: {articleFetchStatus}</div>
      </section>
      </div>

      <div ref={obsidianRef} id="settings-obsidian">
      <section style={cardStyle as any} className={cardClassName} aria-label="Obsidian Settings">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Obsidian</h2>

        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>API Base URL</div>
              <input
                value={obsidianApiBaseUrl}
                onChange={(e) => setObsidianApiBaseUrl(e.target.value)}
                disabled={busy}
                spellCheck={false}
                className="tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)]"
              />
            </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>API Key</div>
              <input
                value={obsidianApiKeyDraft}
                onChange={(e) => {
                  setObsidianApiKeyDraft(e.target.value);
                  setObsidianApiKeyChanged(true);
                }}
                disabled={busy}
                placeholder={obsidianApiKeyPresent ? '(configured)' : ''}
                className="tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)]"
              />
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              status: {obsidianApiKeyPresent ? 'configured' : 'not configured'} (value not displayed)
            </div>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Auth Header</div>
              <input
                value={obsidianAuthHeaderName}
                onChange={(e) => setObsidianAuthHeaderName(e.target.value)}
                disabled={busy}
                spellCheck={false}
                className="tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)]"
              />
            </label>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>AI Chats Folder</div>
              <input
                value={obsidianChatFolder}
                onChange={(e) => setObsidianChatFolder(e.target.value)}
                disabled={busy}
                spellCheck={false}
                className="tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)]"
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>Web Articles Folder</div>
              <input
                value={obsidianArticleFolder}
                onChange={(e) => setObsidianArticleFolder(e.target.value)}
                disabled={busy}
                spellCheck={false}
                className="tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)]"
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className={buttonClassName} style={buttonStyle as any} onClick={() => onSaveObsidianSettings().catch(() => {})} disabled={busy}>
              Save
            </button>
            <button className={buttonClassName} style={buttonStyle as any} onClick={() => onTestObsidianConnection().catch(() => {})} disabled={busy}>
              Test Connection
            </button>
            <button className={buttonClassName} style={buttonStyle as any} onClick={() => onClearObsidianKey().catch(() => {})} disabled={busy}>
              Clear API key
            </button>
          </div>

          {obsidianTestResult ? <div style={{ opacity: 0.85, fontSize: 12 }}>test: {obsidianTestResult}</div> : null}

          <div style={{ opacity: 0.85, fontSize: 12 }}>
            sync status: {String(obsidianJob?.status ?? 'idle')} · started: {formatTime(obsidianJob?.startedAt)}
          </div>
        </div>
      </section>
      </div>

      <div ref={backupRef} id="settings-backup">
      <section style={cardStyle as any} className={cardClassName} aria-label="Database Backup">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Database Backup</h2>

        <div ref={backupImportRef} id="settings-backup-import" style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={buttonClassName} style={buttonStyle as any} onClick={() => handleBackupExport().catch(() => {})} disabled={busy}>
            Export (Zip v2)
          </button>
          <button
            className={buttonClassName}
            style={buttonStyle as any}
            disabled={busy}
            onClick={() => {
              if (busy) return;
              fileInputRef.current?.click();
            }}
          >
            Import…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip,application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFromFile(file).catch(() => {});
            }}
          />
        </div>
        <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>export: {exportStatus}</div>
        <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>last export: {lastBackupExportAt ? formatTime(lastBackupExportAt) : '—'}</div>
        <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>import: {importStatus}</div>
        <div style={{ marginTop: 10 }}>{renderStats(importStats)}</div>
      </section>
      </div>

      <div ref={notionAiRef} id="settings-notion-ai">
      <section style={cardStyle as any} className={cardClassName} aria-label="Notion AI">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Notion AI</h2>
        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={notionAiModelIndex}
            onChange={(e) => setNotionAiModelIndex(e.target.value)}
            disabled={busy}
            inputMode="numeric"
            placeholder="3"
            style={{ width: 120 }}
            className="tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)]"
          />
          <button className={buttonClassName} style={buttonStyle as any} onClick={() => onSaveNotionAiModelIndex().catch(() => {})} disabled={busy}>
            Save
          </button>
          <button className={buttonClassName} style={buttonStyle as any} onClick={() => onResetNotionAiModelIndex().catch(() => {})} disabled={busy}>
            Reset
          </button>
        </div>
        <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>
          Applies only when Notion AI model is set to Auto. Menu order may change in Notion.
        </div>
      </section>
      </div>

      <div ref={inpageRef} id="settings-inpage">
      <section style={cardStyle as any} className={cardClassName} aria-label="Inpage Button">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Inpage Button</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }} className="tw-text-sm tw-font-semibold tw-text-[var(--muted)]">
          <input
            type="checkbox"
            checked={!!inpageSupportedOnly}
            disabled={busy || inpageSupportedOnly == null}
            onChange={(e) => onToggleInpageSupportedOnly(!!e.target.checked).catch(() => {})}
            className="tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]"
          />
          仅在支持站点显示 Inpage 按钮
        </label>
        <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>Applies immediately to existing tabs.</div>
      </section>
      </div>
        </section>
      </div>
    </div>
  );
}
