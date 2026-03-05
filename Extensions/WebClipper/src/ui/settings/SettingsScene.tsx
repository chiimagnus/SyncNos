import { useEffect, useMemo, useRef, useState } from 'react';

import { exportBackupZipV2 } from '../../sync/backup/export';
import { LAST_BACKUP_EXPORT_AT_STORAGE_KEY } from '../../sync/backup/backup-utils';
import { importBackupLegacyJsonMerge, importBackupZipV2Merge, type ImportProgress, type ImportStats } from '../../sync/backup/import';
import { extractZipEntries } from '../../sync/backup/zip-utils';
import { disconnectNotion } from '../../sync/notion/auth/settings-client';
import { getNotionOAuthDefaults } from '../../sync/notion/auth/oauth';
import {
  ARTICLE_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
} from '../../platform/messaging/message-contracts';
import { getURL, send } from '../../platform/runtime/runtime';
import { storageGet, storageSet } from '../../platform/storage/local';
import { tabsCreate } from '../../platform/webext/tabs';

import { useIsNarrowScreen } from '../shared/hooks/useIsNarrowScreen';

import { SettingsSidebarNav } from '../app/routes/settings/SettingsSidebarNav';
import { SETTINGS_SECTIONS, type SettingsSectionKey } from '../app/routes/settings/types';
import { ArticleFetchSection } from '../app/routes/settings/sections/ArticleFetchSection';
import { BackupSection } from '../app/routes/settings/sections/BackupSection';
import { InpageSection } from '../app/routes/settings/sections/InpageSection';
import { NotionAISection } from '../app/routes/settings/sections/NotionAISection';
import { NotionOAuthSection } from '../app/routes/settings/sections/NotionOAuthSection';
import { ObsidianSettingsSection } from '../app/routes/settings/sections/ObsidianSettingsSection';
import {
  formatProgress,
  isZipFile,
  openHttpUrl,
  retrieveNotionParentPage,
  searchNotionParentPages,
  unwrap,
  type ApiResponse,
  type NotionPageOption,
} from '../app/routes/settings/utils';

type NarrowRoute = 'list' | 'detail';

function isFirefoxFamilyBrowser() {
  try {
    const ua = String(globalThis.navigator?.userAgent || '').toLowerCase();
    if (!ua) return false;
    return ua.includes('firefox') || ua.includes('librewolf') || ua.includes('zen');
  } catch (_e) {
    return false;
  }
}

function isPopupUi() {
  try {
    const p = String(globalThis.location?.pathname || '').toLowerCase();
    return p.includes('popup.html');
  } catch (_e) {
    return false;
  }
}

export type SettingsSceneProps = {
  activeSection: SettingsSectionKey;
  focusKey?: string;
  onSelectSection: (key: SettingsSectionKey) => void;
  defaultNarrowRoute?: NarrowRoute;
};

export function SettingsScene(props: SettingsSceneProps) {
  const { activeSection, focusKey = '', onSelectSection, defaultNarrowRoute = 'list' } = props;

  const isNarrow = useIsNarrowScreen();
  const [narrowRoute, setNarrowRoute] = useState<NarrowRoute>(defaultNarrowRoute);

  useEffect(() => {
    if (!isNarrow) return;
    setNarrowRoute(defaultNarrowRoute);
  }, [defaultNarrowRoute, isNarrow]);

  const setActiveSection = (key: SettingsSectionKey) => {
    onSelectSection(key);
    if (isNarrow) setNarrowRoute('detail');
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
  const notionPagesAutoLoadRef = useRef(false);

  // Obsidian
  const [obsidianApiBaseUrl, setObsidianApiBaseUrl] = useState<string>('');
  const [obsidianAuthHeaderName, setObsidianAuthHeaderName] = useState<string>('');
  const [obsidianApiKeyDraft, setObsidianApiKeyDraft] = useState<string>('');
  const [obsidianApiKeyPresent, setObsidianApiKeyPresent] = useState<boolean>(false);
  const [obsidianApiKeyMasked, setObsidianApiKeyMasked] = useState<string>('');
  const [obsidianChatFolder, setObsidianChatFolder] = useState<string>('');
  const [obsidianArticleFolder, setObsidianArticleFolder] = useState<string>('');
  const [obsidianStatus, setObsidianStatus] = useState<string>('Idle');

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
  const [inpageSupportedOnly, setInpageSupportedOnly] = useState<boolean>(false);

  const isPopup = useMemo(() => isPopupUi(), []);
  const useAppImport = useMemo(() => isPopup && isFirefoxFamilyBrowser(), [isPopup]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const [notionRes, local, obsidianRes] = await Promise.all([
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
      ]);

      const notionStatus = unwrap(notionRes);
      setNotionConnected(!!notionStatus?.connected);
      setNotionWorkspaceName(String(notionStatus?.workspaceName || ''));

      setNotionClientId(String(local?.notion_oauth_client_id || ''));
      setNotionPendingState(String(local?.notion_oauth_pending_state || ''));
      setNotionLastError(String(local?.notion_oauth_last_error || ''));
      setNotionParentPageId(String(local?.notion_parent_page_id || ''));
      setNotionParentPageTitle(String(local?.notion_parent_page_title || ''));
      setNotionAiModelIndex(String(local?.notion_ai_preferred_model_index || ''));

      setInpageSupportedOnly(!!local?.inpage_supported_only);
      setLastBackupExportAt(Number(local?.[LAST_BACKUP_EXPORT_AT_STORAGE_KEY] || 0) || 0);

      const obsidianSettings = unwrap(obsidianRes);
      setObsidianApiBaseUrl(String(obsidianSettings?.apiBaseUrl || ''));
      setObsidianAuthHeaderName(String(obsidianSettings?.authHeaderName || ''));
      setObsidianApiKeyPresent(!!obsidianSettings?.apiKeyPresent);
      setObsidianApiKeyMasked(String(obsidianSettings?.apiKeyMasked || ''));
      setObsidianChatFolder(String(obsidianSettings?.chatFolder || ''));
      setObsidianArticleFolder(String(obsidianSettings?.articleFolder || ''));
      setObsidianApiKeyDraft('');
      setObsidianStatus('Idle');
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

  const openExtensionAppSettings = async () => {
    const url = getURL('/app.html#/settings');
    await tabsCreate({ url });
  };

  const handleBackupImportClick = async () => {
    if (busy) return;
    if (!useAppImport) {
      fileInputRef.current?.click();
      return;
    }
    setImportStatus('Firefox kernel detected: import in App Settings');
    await openExtensionAppSettings();
    try {
      window.close();
    } catch (_e) {
      // ignore
    }
  };

  const onFetchCurrentPage = async () => {
    setBusy(true);
    setError(null);
    setArticleFetchStatus('Fetching…');
    try {
      const res = await send<ApiResponse<any>>(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB, {});
      const data = unwrap(res);
      const conversationId = Number((data as any)?.conversationId) || 0;
      setArticleFetchStatus(conversationId ? `Saved ✓ (conversationId=${conversationId})` : 'Done ✓');
    } catch (e) {
      const msg = (e as any)?.message ?? String(e ?? 'fetch failed');
      setArticleFetchStatus(`Error: ${msg}`);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

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

  const renderDetailContent = () => (
    <section className="route-scroll tw-mx-auto tw-grid tw-w-full tw-max-w-[980px] tw-gap-4 tw-pr-1">
      {error ? <p className="tw-m-0 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{error}</p> : null}

      {activeSection === 'notion' ? (
        <>
          <NotionOAuthSection
            busy={busy}
            notionStatusText={notionStatusText}
            notionConnected={!!notionConnected}
            pollingNotion={pollingNotion}
            loadingNotionPages={loadingNotionPages}
            notionParentPageId={notionParentPageId}
            notionPageOptions={notionPageOptions}
            notionLogoUrl={getURL('icons/notion.svg' as any)}
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

      {activeSection === 'obsidian' ? (
        <ObsidianSettingsSection
          busy={busy}
          apiBaseUrl={obsidianApiBaseUrl}
          authHeaderName={obsidianAuthHeaderName}
          apiKeyDraft={obsidianApiKeyDraft}
          apiKeyPresent={obsidianApiKeyPresent}
          apiKeyMasked={obsidianApiKeyMasked}
          chatFolder={obsidianChatFolder}
          articleFolder={obsidianArticleFolder}
          statusText={obsidianStatus}
          obsidianLogoUrl={getURL('icons/obsidian.svg' as any)}
          onChangeApiBaseUrl={setObsidianApiBaseUrl}
          onChangeAuthHeaderName={setObsidianAuthHeaderName}
          onChangeApiKeyDraft={(v) => {
            setObsidianApiKeyDraft(v);
          }}
          onChangeChatFolder={setObsidianChatFolder}
          onChangeArticleFolder={setObsidianArticleFolder}
          onSave={() => onSaveObsidianSettings().catch(() => {})}
          onSaveApiKey={() => onSaveObsidianSettings({ includeApiKey: true }).catch(() => {})}
          onTest={() => onTestObsidianConnection().catch(() => {})}
          onOpenSetupGuide={() =>
            openHttpUrl('https://github.com/chiimagnus/SyncNos/blob/main/.github/guide/obsidian/LocalRestAPI.zh.md')
          }
        />
      ) : null}

      {activeSection === 'article' ? (
        <ArticleFetchSection busy={busy} status={articleFetchStatus} onFetch={() => onFetchCurrentPage().catch(() => {})} />
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
          importLabel={useAppImport ? 'Import in App' : undefined}
          onImportClick={useAppImport ? () => void handleBackupImportClick() : undefined}
          onExport={() => handleBackupExport().catch(() => {})}
          onImportFile={(file) => importFromFile(file).catch(() => {})}
        />
      ) : null}

      {activeSection === 'inpage' ? (
        <InpageSection busy={busy} supportedOnly={inpageSupportedOnly} onToggleSupportedOnly={(v) => onToggleInpageSupportedOnly(v).catch(() => {})} />
      ) : null}
    </section>
  );

  const activeSectionMeta = useMemo(() => SETTINGS_SECTIONS.find((s) => s.key === activeSection) ?? null, [activeSection]);

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col">
          <div className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--panel)]/60 tw-px-3 tw-py-2 tw-backdrop-blur-sm">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <button
                type="button"
                className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/75 tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)]"
                onClick={() => setNarrowRoute('list')}
                aria-label="Back"
              >
                Back
              </button>
              <div className="tw-min-w-0 tw-flex-1 tw-text-center tw-text-xs tw-font-extrabold tw-text-[var(--muted)]">
                {activeSectionMeta?.label || 'Settings'}
              </div>
              <div className="tw-w-[74px]" aria-hidden="true" />
            </div>
          </div>

          <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-3">
            {renderDetailContent()}
          </div>
        </div>
      );
    }

    return (
      <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col">
        <div className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--panel)]/60 tw-px-3 tw-py-3 tw-backdrop-blur-sm">
          <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">Settings</div>
          <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">Integrations, backup, and app behavior.</div>
        </div>

        <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-p-2">
          <nav className="tw-grid tw-gap-2" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setActiveSection(s.key)}
                className="tw-flex tw-w-full tw-flex-col tw-items-start tw-justify-center tw-gap-0.5 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-px-3 tw-py-3 tw-text-left tw-transition tw-duration-150 hover:tw-border-[var(--border-strong)] hover:tw-shadow-[var(--shadow)]"
              >
                <div className="tw-text-sm tw-font-extrabold tw-text-[var(--text)]">{s.label}</div>
                <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{s.description}</div>
              </button>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0">
      <SettingsSidebarNav activeSection={activeSection} onSelectSection={setActiveSection} />
      <div className="tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-overflow-x-hidden tw-p-4">{renderDetailContent()}</div>
    </div>
  );
}
