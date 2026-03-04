import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { exportBackupZipV2 } from '../../../sync/backup/export';
import { LAST_BACKUP_EXPORT_AT_STORAGE_KEY } from '../../../sync/backup/backup-utils';
import { importBackupLegacyJsonMerge, importBackupZipV2Merge, type ImportProgress, type ImportStats } from '../../../sync/backup/import';
import { extractZipEntries } from '../../../sync/backup/zip-utils';
import { disconnectNotion } from '../../../sync/notion/auth/settings-client';
import { getNotionOAuthDefaults } from '../../../sync/notion/auth/oauth';
import { ARTICLE_MESSAGE_TYPES, NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES, UI_MESSAGE_TYPES } from '../../../platform/messaging/message-contracts';
import { send } from '../../../platform/runtime/runtime';
import { storageGet, storageSet } from '../../../platform/storage/local';
import { getNotionSyncJobStatus, getObsidianSyncStatus } from '../../../sync/repo';

import { SettingsHeader } from './settings/SettingsHeader';
import { SettingsSidebarNav } from './settings/SettingsSidebarNav';
import type { SettingsSectionKey } from './settings/types';
import { ArticleFetchSection } from './settings/sections/ArticleFetchSection';
import { BackupSection } from './settings/sections/BackupSection';
import { InpageSection } from './settings/sections/InpageSection';
import { NotionAISection } from './settings/sections/NotionAISection';
import { NotionOAuthSection } from './settings/sections/NotionOAuthSection';
import { ObsidianSettingsSection } from './settings/sections/ObsidianSettingsSection';
import {
  formatProgress,
  isZipFile,
  openHttpUrl,
  retrieveNotionParentPage,
  searchNotionParentPages,
  unwrap,
  type ApiResponse,
  type NotionPageOption,
} from './settings/utils';

export default function Settings() {
  const routerLocation = useLocation();
  const navigate = useNavigate();

  type SearchParams = { section: SettingsSectionKey; focus: string };

  const params = useMemo<SearchParams>(() => {
    const s = new URLSearchParams(routerLocation.search || '');
    const rawSection = String(s.get('section') || '').trim().toLowerCase();
    const rawFocus = String(s.get('focus') || '').trim().toLowerCase();

    // Backward compat: older deep links may use `section=notion-ai`.
    if (rawSection === 'notion-ai') {
      return { section: 'notion', focus: rawFocus || 'notion-ai' };
    }

    const section: SettingsSectionKey =
      rawSection === 'article' || rawSection === 'obsidian' || rawSection === 'backup' || rawSection === 'inpage'
        ? (rawSection as SettingsSectionKey)
        : 'notion';
    const focus = rawFocus;
    return { section, focus };
  }, [routerLocation.search]);

  const activeSection = params.section;
  const focusKey = params.focus;

  const setActiveSection = (key: SettingsSectionKey) => {
    const next = new URLSearchParams(routerLocation.search || '');
    next.set('section', key);
    next.delete('focus');
    navigate({ pathname: routerLocation.pathname, search: `?${next.toString()}` }, { replace: true, state: routerLocation.state });
  };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Notion
  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);
  const [notionWorkspaceName, setNotionWorkspaceName] = useState<string>('');
  const [notionPendingState, setNotionPendingState] = useState<string>('');
  const [notionLastError, setNotionLastError] = useState<string>('');
  const [notionClientId, setNotionClientId] = useState<string>('');
  const [notionParentPageId, setNotionParentPageId] = useState<string>('');
  const [notionParentPageTitle, setNotionParentPageTitle] = useState<string>('');
  const [notionPages, setNotionPages] = useState<NotionPageOption[]>([]);
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
  const backupImportRef = useRef<HTMLDivElement | null>(null);
  const notionAiRef = useRef<HTMLDivElement | null>(null);

  // Notion AI
  const [notionAiModelIndex, setNotionAiModelIndex] = useState<string>('');

  // Inpage
  const [inpageSupportedOnly, setInpageSupportedOnly] = useState<boolean | null>(null);

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
    if (notionPageOptions.length) {
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
        stats = await importBackupZipV2Merge(entries, (p: ImportProgress) => {
          const view = formatProgress(p);
          setImportStatus(view.text);
        });
      } else {
        const text = await file.text();
        const doc = JSON.parse(text);
        stats = await importBackupLegacyJsonMerge(doc, (p: ImportProgress) => {
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
    if (activeSection !== 'backup') return;
    if (focusKey !== 'import') return;
    backupImportRef.current?.scrollIntoView({ block: 'start' });
  }, [activeSection, focusKey]);

  useEffect(() => {
    if (activeSection !== 'notion') return;
    if (focusKey !== 'notion-ai') return;
    notionAiRef.current?.scrollIntoView({ block: 'start' });
  }, [activeSection, focusKey]);

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0">
      <SettingsSidebarNav activeSection={activeSection} onSelectSection={setActiveSection} />

      <div className="tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-overflow-x-hidden tw-p-4">
        <section className="route-scroll tw-mx-auto tw-grid tw-w-full tw-max-w-[980px] tw-gap-4 tw-pr-1">
          <SettingsHeader busy={busy} error={error} onRefresh={() => refresh().catch(() => {})} />

          {activeSection === 'notion' ? (
            <>
              <NotionOAuthSection
                busy={busy}
                notionStatusText={notionStatusText}
                notionClientId={notionClientId}
                notionConnected={!!notionConnected}
                pollingNotion={pollingNotion}
                loadingNotionPages={loadingNotionPages}
                notionParentPageId={notionParentPageId}
                notionPageOptions={notionPageOptions}
                notionJob={notionJob}
                onConnectOrDisconnect={() => onNotionConnectOrDisconnect().catch(() => {})}
                onSaveNotionParentPage={(id) => onSaveNotionParentPage(id).catch(() => {})}
                onLoadNotionPages={() => onLoadNotionPages().catch(() => {})}
              />

              <div ref={notionAiRef} id="settings-notion-ai">
                <NotionAISection
                  busy={busy}
                  modelIndex={notionAiModelIndex}
                  onChangeModelIndex={setNotionAiModelIndex}
                  onSave={() => onSaveNotionAiModelIndex().catch(() => {})}
                  onReset={() => onResetNotionAiModelIndex().catch(() => {})}
                />
              </div>
            </>
          ) : null}

          {activeSection === 'article' ? <ArticleFetchSection busy={busy} statusText={articleFetchStatus} onFetchCurrentPage={() => onFetchCurrentPage().catch(() => {})} /> : null}

          {activeSection === 'obsidian' ? (
            <ObsidianSettingsSection
              busy={busy}
              apiBaseUrl={obsidianApiBaseUrl}
              authHeaderName={obsidianAuthHeaderName}
              apiKeyDraft={obsidianApiKeyDraft}
              apiKeyPresent={obsidianApiKeyPresent}
              chatFolder={obsidianChatFolder}
              articleFolder={obsidianArticleFolder}
              testResult={obsidianTestResult}
              job={obsidianJob}
              onChangeApiBaseUrl={setObsidianApiBaseUrl}
              onChangeAuthHeaderName={setObsidianAuthHeaderName}
              onChangeApiKeyDraft={(v) => {
                setObsidianApiKeyDraft(v);
                setObsidianApiKeyChanged(true);
              }}
              onChangeChatFolder={setObsidianChatFolder}
              onChangeArticleFolder={setObsidianArticleFolder}
              onSave={() => onSaveObsidianSettings().catch(() => {})}
              onTest={() => onTestObsidianConnection().catch(() => {})}
              onClearKey={() => onClearObsidianKey().catch(() => {})}
            />
          ) : null}

          {activeSection === 'backup' ? (
            <BackupSection
              busy={busy}
              exportStatus={exportStatus}
              importStatus={importStatus}
              importStats={importStats}
              lastBackupExportAt={lastBackupExportAt}
              backupImportRef={backupImportRef}
              fileInputRef={fileInputRef}
              onExport={() => handleBackupExport().catch(() => {})}
              onImportFile={(file) => importFromFile(file).catch(() => {})}
            />
          ) : null}

          {activeSection === 'inpage' ? (
            <InpageSection busy={busy} supportedOnly={inpageSupportedOnly} onToggleSupportedOnly={(next) => onToggleInpageSupportedOnly(next).catch(() => {})} />
          ) : null}
        </section>
      </div>
    </div>
  );
}
