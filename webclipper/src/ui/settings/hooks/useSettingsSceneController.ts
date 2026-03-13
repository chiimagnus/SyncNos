import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { exportBackupZipV2 } from '../../../sync/backup/export';
import { LAST_BACKUP_EXPORT_AT_STORAGE_KEY } from '../../../sync/backup/backup-utils';
import { importBackupLegacyJsonMerge, importBackupZipV2Merge, type ImportProgress, type ImportStats } from '../../../sync/backup/import';
import { extractZipEntries } from '../../../sync/backup/zip-utils';
import { disconnectNotion } from '../../../sync/notion/auth/settings-client';
import { getNotionOAuthDefaults } from '../../../sync/notion/auth/oauth';
import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../../../platform/messaging/message-contracts';
import { send } from '../../../platform/runtime/runtime';
import { storageGet, storageOnChanged, storageSet } from '../../../platform/storage/local';
import { openOrFocusExtensionAppTab } from '../../../platform/webext/extension-app';
import { setSyncProviderEnabled, syncProviderEnabledStorageKey } from '../../../sync/sync-provider-gate';
import {
  DEFAULT_CHAT_WITH_MAX_CHARS,
  DEFAULT_CHAT_WITH_PLATFORMS,
  DEFAULT_CHAT_WITH_PROMPT_TEMPLATE,
  loadChatWithSettings,
  resetChatWithSettings,
  saveChatWithSettings,
} from '../../../integrations/chatwith/chatwith-settings';
import {
  buildInsightStats,
  getInsightStatsSourceData,
  getInsightTimeRangeWindow,
  type InsightStats,
  type InsightStatsSourceData,
  type InsightTimeRange,
} from '../sections/insight-stats';

import {
  formatProgress,
  isZipFile,
  openHttpUrl,
  retrieveNotionParentPage,
  searchNotionParentPages,
  unwrap,
  type ApiResponse,
  type NotionPageOption,
} from '../utils';
import type { SettingsSectionKey } from '../types';
import { t } from '../../../i18n';

const NOTION_SYNC_PROVIDER_ENABLED_KEY = syncProviderEnabledStorageKey('notion');
const OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY = syncProviderEnabledStorageKey('obsidian');

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

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error || '').trim();
  return text || fallback;
}

type RunTaskOptions = {
  useBusy?: boolean;
  clearError?: boolean;
  fallbackMessage?: string;
  onError?: (message: string) => void;
};

export type UseSettingsSceneControllerArgs = {
  activeSection: SettingsSectionKey;
  focusKey?: string;
};

type InpageDisplayMode = 'supported' | 'all' | 'off';

function normalizeInpageDisplayMode(value: unknown): InpageDisplayMode | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'supported' || raw === 'all' || raw === 'off') return raw as InpageDisplayMode;
  return null;
}

function inpageDisplayModeFromLegacySupportedOnly(value: unknown): InpageDisplayMode {
  return value === true ? 'supported' : 'all';
}

export function useSettingsSceneController(args: UseSettingsSceneControllerArgs) {
  const { activeSection, focusKey = '' } = args;

  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
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
  const [notionSyncEnabled, setNotionSyncEnabled] = useState(true);

  // Obsidian
  const [obsidianApiBaseUrl, setObsidianApiBaseUrl] = useState<string>('');
  const [obsidianAuthHeaderName, setObsidianAuthHeaderName] = useState<string>('');
  const [obsidianApiKeyDraft, setObsidianApiKeyDraft] = useState<string>('');
  const [obsidianApiKeyPresent, setObsidianApiKeyPresent] = useState<boolean>(false);
  const [obsidianApiKeyMasked, setObsidianApiKeyMasked] = useState<string>('');
  const [obsidianChatFolder, setObsidianChatFolder] = useState<string>('');
  const [obsidianArticleFolder, setObsidianArticleFolder] = useState<string>('');
  const [obsidianStatus, setObsidianStatus] = useState<string>(t('statusIdle'));
  const [obsidianSyncEnabled, setObsidianSyncEnabled] = useState(true);

  // Backup
  const [exportStatus, setExportStatus] = useState<string>(t('statusIdle'));
  const [importStatus, setImportStatus] = useState<string>(t('statusReady'));
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [lastBackupExportAt, setLastBackupExportAt] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupImportRef = useRef<HTMLDivElement | null>(null);
  const notionAiRef = useRef<HTMLDivElement | null>(null);

  // Notion AI
  const [notionAiModelIndex, setNotionAiModelIndex] = useState<string>('');

  // Inpage
  const [inpageDisplayMode, setInpageDisplayMode] = useState<InpageDisplayMode>('all');
  const [aiChatAutoSaveEnabled, setAiChatAutoSaveEnabled] = useState<boolean>(true);

  // Appearance
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');

  // Chat with AI
  const [chatWithPromptTemplate, setChatWithPromptTemplate] = useState<string>(DEFAULT_CHAT_WITH_PROMPT_TEMPLATE);
  const [chatWithMaxChars, setChatWithMaxChars] = useState<string>(String(DEFAULT_CHAT_WITH_MAX_CHARS));
  const [chatWithPlatforms, setChatWithPlatforms] = useState<any[]>(DEFAULT_CHAT_WITH_PLATFORMS.slice());
  const chatWithHydratedRef = useRef(false);
  const chatWithSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Insight
  const [insightStats, setInsightStats] = useState<InsightStats | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState('');
  const [hasLoadedInsight, setHasLoadedInsight] = useState(false);
  const [insightRange, setInsightRange] = useState<InsightTimeRange>('7d');
  const insightSourceDataRef = useRef<InsightStatsSourceData | null>(null);

  const isPopup = useMemo(() => isPopupUi(), []);
  const useAppImport = useMemo(() => isPopup && isFirefoxFamilyBrowser(), [isPopup]);

  const runTask = useCallback(async (task: () => Promise<void>, options: RunTaskOptions = {}) => {
    const {
      useBusy = true,
      clearError = true,
      fallbackMessage = 'failed',
      onError,
    } = options;

    if (clearError) setError(null);
    if (useBusy) setBusyCount((count) => count + 1);

    try {
      await task();
      return true;
    } catch (e) {
      const message = toErrorMessage(e, fallbackMessage);
      setError(message);
      if (onError) onError(message);
      return false;
    } finally {
      if (useBusy) {
        setBusyCount((count) => (count <= 0 ? 0 : count - 1));
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    await runTask(async () => {
      const [notionRes, local, obsidianRes] = await Promise.all([
        send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, {}),
        storageGet([
          'notion_oauth_client_id',
          'notion_oauth_pending_state',
          'notion_oauth_last_error',
          'notion_parent_page_id',
          'notion_parent_page_title',
          'notion_ai_preferred_model_index',
          NOTION_SYNC_PROVIDER_ENABLED_KEY,
          OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY,
          'inpage_display_mode',
          'inpage_supported_only',
          'ai_chat_auto_save_enabled',
          'ui_theme_mode',
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
      setNotionSyncEnabled(local?.[NOTION_SYNC_PROVIDER_ENABLED_KEY] !== false);
      setObsidianSyncEnabled(local?.[OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY] !== false);

      const normalizedInpageMode = normalizeInpageDisplayMode(local?.inpage_display_mode);
      setInpageDisplayMode(
        normalizedInpageMode || inpageDisplayModeFromLegacySupportedOnly(local?.inpage_supported_only)
      );
      setAiChatAutoSaveEnabled(local?.ai_chat_auto_save_enabled !== false);
      const rawThemeMode = String(local?.ui_theme_mode || '').trim().toLowerCase();
      setThemeMode(
        rawThemeMode === 'light' || rawThemeMode === 'dark' || rawThemeMode === 'system'
          ? (rawThemeMode as any)
          : 'system'
      );
      setLastBackupExportAt(Number(local?.[LAST_BACKUP_EXPORT_AT_STORAGE_KEY] || 0) || 0);

      const obsidianSettings = unwrap(obsidianRes);
      setObsidianApiBaseUrl(String(obsidianSettings?.apiBaseUrl || ''));
      setObsidianAuthHeaderName(String(obsidianSettings?.authHeaderName || ''));
      setObsidianApiKeyPresent(!!obsidianSettings?.apiKeyPresent);
      setObsidianApiKeyMasked(String(obsidianSettings?.apiKeyMasked || ''));
      setObsidianChatFolder(String(obsidianSettings?.chatFolder || ''));
      setObsidianArticleFolder(String(obsidianSettings?.articleFolder || ''));
      setObsidianApiKeyDraft('');
      setObsidianStatus(t('statusIdle'));

      const chatWith = await loadChatWithSettings();
      setChatWithPromptTemplate(String(chatWith.promptTemplate || DEFAULT_CHAT_WITH_PROMPT_TEMPLATE));
      setChatWithMaxChars(String(chatWith.maxChars || DEFAULT_CHAT_WITH_MAX_CHARS));
      setChatWithPlatforms(Array.isArray(chatWith.platforms) ? (chatWith.platforms as any) : DEFAULT_CHAT_WITH_PLATFORMS.slice());
      chatWithHydratedRef.current = true;
    });
  }, [runTask]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return storageOnChanged((changes: any, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes || typeof changes !== 'object') return;

      if (Object.prototype.hasOwnProperty.call(changes, NOTION_SYNC_PROVIDER_ENABLED_KEY)) {
        const nextValue = changes[NOTION_SYNC_PROVIDER_ENABLED_KEY]?.newValue;
        setNotionSyncEnabled(nextValue !== false);
      }
      if (Object.prototype.hasOwnProperty.call(changes, OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY)) {
        const nextValue = changes[OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY]?.newValue;
        setObsidianSyncEnabled(nextValue !== false);
      }
    });
  }, []);

  useEffect(() => {
    if (!pollingNotion) return;

    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > 60_000) {
        setPollingNotion(false);
        return;
      }
      void refresh();
    }, 750);

    return () => clearInterval(timer);
  }, [pollingNotion, refresh]);

  const notionPageOptions = useMemo(() => {
    const list = Array.isArray(notionPages) ? notionPages.slice() : [];
    const selectedId = String(notionParentPageId || '').trim();

    if (selectedId && !list.some((page) => String(page?.id || '').trim() === selectedId)) {
      const title = String(notionParentPageTitle || '').trim();
      list.unshift({ id: selectedId, title: title || selectedId });
    }

    const seen = new Set<string>();
    return list.filter((page) => {
      const id = page && page.id ? String(page.id).trim() : '';
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [notionPages, notionParentPageId, notionParentPageTitle]);

  const onNotionConnectOrDisconnect = useCallback(async () => {
    await runTask(async () => {
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
    });
  }, [notionClientId, refresh, runTask]);

  const onToggleNotionSyncEnabled = useCallback(
    async (enabled: boolean) => {
      await runTask(
        async () => {
          await setSyncProviderEnabled('notion', enabled);
          setNotionSyncEnabled(enabled);
        },
        { fallbackMessage: 'save notion sync enabled failed' },
      );
    },
    [runTask],
  );

  const onToggleObsidianSyncEnabled = useCallback(
    async (enabled: boolean) => {
      await runTask(
        async () => {
          await setSyncProviderEnabled('obsidian', enabled);
          setObsidianSyncEnabled(enabled);
        },
        { fallbackMessage: 'save obsidian sync enabled failed' },
      );
    },
    [runTask],
  );

  const onLoadNotionPages = useCallback(async () => {
    setLoadingNotionPages(true);
    await runTask(
      async () => {
        const status = unwrap(await send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, {}));
        const accessToken = String(status?.token?.accessToken || '');
        if (!accessToken) throw new Error('Notion not connected');

        const savedId = String(notionParentPageId || '').trim();
        const savedTitle = String(notionParentPageTitle || '').trim();

        let pages = await searchNotionParentPages(accessToken);
        let resolvedSaved = savedId ? pages.find((page) => page.id === savedId) ?? null : null;

        if (savedId && !resolvedSaved) {
          const retrieved = await retrieveNotionParentPage(accessToken, savedId);
          if (retrieved) {
            pages = [retrieved, ...pages.filter((page) => page.id !== retrieved.id)];
            resolvedSaved = retrieved;
          }
        }

        setNotionPages(pages);

        const nextId = savedId || pages[0]?.id || '';
        const nextTitle = (resolvedSaved?.title || (savedId ? savedTitle : pages[0]?.title) || '').trim();

        if (nextId) setNotionParentPageId(nextId);
        if (nextTitle) setNotionParentPageTitle(nextTitle);

        const payload: Record<string, unknown> = {};
        if (nextId && nextId !== savedId) payload.notion_parent_page_id = nextId;
        if (nextTitle && nextTitle !== savedTitle) payload.notion_parent_page_title = nextTitle;
        if (Object.keys(payload).length) await storageSet(payload);
      },
      { useBusy: false, fallbackMessage: 'failed to load pages' }
    );
    setLoadingNotionPages(false);
  }, [notionParentPageId, notionParentPageTitle, runTask]);

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
    void onLoadNotionPages();
  }, [notionConnected, notionPageOptions.length, onLoadNotionPages]);

  const onSaveNotionParentPage = useCallback(
    async (id: string) => {
      const next = String(id || '').trim();
      if (!next) return;

      await runTask(async () => {
        setNotionParentPageId(next);
        const match = notionPages.find((page) => page && String(page.id || '').trim() === next) ?? null;
        if (match && match.title) setNotionParentPageTitle(String(match.title || '').trim());

        const payload: Record<string, unknown> = { notion_parent_page_id: next };
        if (match && match.title) payload.notion_parent_page_title = String(match.title || '').trim();
        await storageSet(payload);
      });
    },
    [notionPages, runTask]
  );

  const onSaveObsidianSettings = useCallback(
    async ({ includeApiKey }: { includeApiKey?: boolean } = {}) => {
      if (busy) return;

      setObsidianStatus(t('statusSaving'));
      const ok = await runTask(
        async () => {
          const payload: any = {
            apiBaseUrl: obsidianApiBaseUrl,
            authHeaderName: obsidianAuthHeaderName,
            chatFolder: obsidianChatFolder,
            articleFolder: obsidianArticleFolder,
          };

          if (includeApiKey === true && String(obsidianApiKeyDraft || '').trim()) {
            payload.apiKey = obsidianApiKeyDraft;
          }

          const response = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS, payload);
          const data = unwrap(response);

          setObsidianApiBaseUrl(String(data?.apiBaseUrl || ''));
          setObsidianAuthHeaderName(String(data?.authHeaderName || ''));
          setObsidianApiKeyPresent(!!data?.apiKeyPresent);
          setObsidianApiKeyMasked(String(data?.apiKeyMasked || ''));
          setObsidianChatFolder(String(data?.chatFolder || ''));
          setObsidianArticleFolder(String(data?.articleFolder || ''));
          setObsidianApiKeyDraft('');
        },
        {
          fallbackMessage: 'failed',
          onError: () => {
            setObsidianStatus(t('statusError'));
          },
        }
      );

      if (ok) setObsidianStatus(t('statusSaved'));
    },
    [
      busy,
      obsidianApiBaseUrl,
      obsidianApiKeyDraft,
      obsidianArticleFolder,
      obsidianAuthHeaderName,
      obsidianChatFolder,
      runTask,
    ]
  );

  const onTestObsidianConnection = useCallback(async () => {
    setObsidianStatus(t('statusTesting'));

    await runTask(
      async () => {
        const response = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.TEST_CONNECTION, {});
        const data = unwrap(response);
        const ok = data && data.ok === true;
        const message = data && data.message ? String(data.message) : '';
        setObsidianStatus(
          ok
            ? `${t('statusOk')} ✓ ${message}`.trim()
            : `${t('statusError')}: ${message || t('phaseFailed')}`
        );
      },
      {
        fallbackMessage: 'failed',
        onError: (message) => {
          setObsidianStatus(`${t('statusError')}: ${message}`);
        },
      }
    );
  }, [runTask]);

  const onChangeInpageDisplayMode = useCallback(
    async (next: InpageDisplayMode) => {
      await runTask(async () => {
        await storageSet({ inpage_display_mode: next });
        setInpageDisplayMode(next);
      });
    },
    [runTask]
  );

  const onToggleAiChatAutoSaveEnabled = useCallback(
    async (next: boolean) => {
      await runTask(async () => {
        await storageSet({ ai_chat_auto_save_enabled: next === true });
        setAiChatAutoSaveEnabled(next === true);
      });
    },
    [runTask]
  );

  const onChangeThemeMode = useCallback(
    async (next: 'system' | 'light' | 'dark') => {
      await runTask(async () => {
        const normalized = next === 'light' || next === 'dark' || next === 'system' ? next : 'system';
        await storageSet({ ui_theme_mode: normalized });
        setThemeMode(normalized);
      });
    },
    [runTask]
  );

  const onSaveNotionAiModelIndex = useCallback(async () => {
    await runTask(async () => {
      const raw = String(notionAiModelIndex || '').trim();
      const value = raw ? Number(raw) : NaN;

      if (!raw) {
        await storageSet({ notion_ai_preferred_model_index: '' });
      } else if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid model index');
      } else {
        await storageSet({ notion_ai_preferred_model_index: Math.floor(value) });
      }

      await refresh();
    });
  }, [notionAiModelIndex, refresh, runTask]);

  const onResetNotionAiModelIndex = useCallback(async () => {
    await runTask(async () => {
      await storageSet({ notion_ai_preferred_model_index: '' });
      await refresh();
    });
  }, [refresh, runTask]);

  useEffect(() => {
    if (!chatWithHydratedRef.current) return;

    // Write-through (debounced) to avoid requiring an explicit Save click.
    if (chatWithSaveTimerRef.current != null) clearTimeout(chatWithSaveTimerRef.current);
    chatWithSaveTimerRef.current = setTimeout(() => {
      const max = Number(String(chatWithMaxChars || '').trim());
      void saveChatWithSettings({
        promptTemplate: String(chatWithPromptTemplate || ''),
        maxChars: Number.isFinite(max) ? Math.floor(max) : DEFAULT_CHAT_WITH_MAX_CHARS,
        platforms: Array.isArray(chatWithPlatforms) ? (chatWithPlatforms as any) : [],
      } as any).catch(() => {
        // Don't block the UI on transient storage errors.
      });
    }, 450);

    return () => {
      if (chatWithSaveTimerRef.current != null) clearTimeout(chatWithSaveTimerRef.current);
      chatWithSaveTimerRef.current = null;
    };
  }, [chatWithMaxChars, chatWithPlatforms, chatWithPromptTemplate]);

  useEffect(() => {
    if (activeSection !== 'insight') return;
    if (hasLoadedInsight || insightLoading) return;

    setInsightLoading(true);
    setInsightError('');

    void getInsightStatsSourceData()
      .then((data) => {
        insightSourceDataRef.current = data;
        const window = getInsightTimeRangeWindow(insightRange);
        setInsightStats(buildInsightStats(data, window));
      })
      .catch((error) => {
        setInsightError(toErrorMessage(error, t('insightLoadFailed')));
      })
      .finally(() => {
        setInsightLoading(false);
        setHasLoadedInsight(true);
      });
  }, [activeSection, hasLoadedInsight, insightLoading, insightRange]);

  useEffect(() => {
    if (activeSection !== 'insight') return;
    const data = insightSourceDataRef.current;
    if (!data) return;

    const window = getInsightTimeRangeWindow(insightRange);
    setInsightStats(buildInsightStats(data, window));
  }, [activeSection, insightRange]);

  const onResetChatWithSettings = useCallback(async () => {
    await runTask(async () => {
      await resetChatWithSettings();
      await refresh();
    });
  }, [refresh, runTask]);

  const handleBackupExport = useCallback(async () => {
    if (busy) return;

    setExportStatus(t('backupExporting'));
    await runTask(
      async () => {
        const result = await exportBackupZipV2();
        const url = URL.createObjectURL(result.blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.filename;
        anchor.click();

        setExportStatus(
          `${t('backupExported')} (${t('statsConversations')} ${result.counts.conversations}, ${t('statsMessages')} ${result.counts.messages})`
        );
        setLastBackupExportAt(Date.parse(result.exportedAt) || Date.now());
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      {
        fallbackMessage: 'export failed',
        onError: (message) => {
          setExportStatus(`${t('statusError')}: ${message}`);
        },
      }
    );
  }, [busy, runTask]);

  const importFromFile = useCallback(
    async (file: File) => {
      if (busy) return;

      setImportStats(null);
      setImportStatus(`${t('backupImportingFile')}: ${file.name}`);

      await runTask(
        async () => {
          const asZip = await isZipFile(file);
          let stats: ImportStats;

          if (asZip) {
            const entries = await extractZipEntries(file);
            stats = await importBackupZipV2Merge(entries, (progress: ImportProgress) => {
              const view = formatProgress(progress);
              setImportStatus(view.text);
            });
          } else {
            const text = await file.text();
            const doc = JSON.parse(text);
            stats = await importBackupLegacyJsonMerge(doc, (progress: ImportProgress) => {
              const view = formatProgress(progress);
              setImportStatus(view.text);
            });
          }

          setImportStats(stats);
          setImportStatus(t('backupImported'));
        },
        {
          fallbackMessage: 'import failed',
          onError: (message) => {
            setImportStatus(`${t('statusError')}: ${message}`);
          },
        }
      );

      try {
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (_e) {
        // ignore
      }
    },
    [busy, runTask]
  );

  const openExtensionAppSettings = useCallback(async () => {
    await openOrFocusExtensionAppTab({ route: '/settings' });
  }, []);

  const handleBackupImportClick = useCallback(async () => {
    if (busy) return;

    if (!useAppImport) {
      fileInputRef.current?.click();
      return;
    }

    setImportStatus(t('backupImportInAppFirefox'));
    await openExtensionAppSettings();

    try {
      window.close();
    } catch (_e) {
      // ignore
    }
  }, [busy, openExtensionAppSettings, useAppImport]);

  const onOpenObsidianSetupGuide = useCallback(() => {
    openHttpUrl('https://github.com/chiimagnus/SyncNos/blob/main/.github/guide/obsidian/LocalRestAPI.zh.md');
  }, []);

  const notionStatusText = useMemo(() => {
    if (notionConnected == null) return t('statusUnknown');
    if (notionConnected) {
      const workspace = String(notionWorkspaceName || '').trim();
      return workspace ? `${t('statusConnected')} ✅ (${workspace})` : `${t('statusConnected')} ✅`;
    }
    if (notionLastError) return t('statusError');
    if (notionPendingState) return t('statusWaiting');
    return t('statusNotConnected');
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

  return {
    busy,
    error,

    notionSyncEnabled,
    onToggleNotionSyncEnabled,

    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionParentPageId,
    notionPageOptions,
    notionStatusText,
    notionAiModelIndex,
    setNotionAiModelIndex,
    onNotionConnectOrDisconnect,
    onSaveNotionParentPage,
    onLoadNotionPages,
    onSaveNotionAiModelIndex,
    onResetNotionAiModelIndex,
    notionAiRef,

    obsidianSyncEnabled,
    onToggleObsidianSyncEnabled,

    obsidianApiBaseUrl,
    setObsidianApiBaseUrl,
    obsidianAuthHeaderName,
    setObsidianAuthHeaderName,
    obsidianApiKeyDraft,
    setObsidianApiKeyDraft,
    obsidianApiKeyPresent,
    obsidianApiKeyMasked,
    obsidianChatFolder,
    setObsidianChatFolder,
    obsidianArticleFolder,
    setObsidianArticleFolder,
    obsidianStatus,
    onSaveObsidianSettings,
    onTestObsidianConnection,
    onOpenObsidianSetupGuide,

    exportStatus,
    importStatus,
    importStats,
    lastBackupExportAt,
    backupImportRef,
    fileInputRef,
    useAppImport,
    handleBackupExport,
    importFromFile,
    handleBackupImportClick,

    inpageDisplayMode,
    onChangeInpageDisplayMode,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    themeMode,
    onChangeThemeMode,

    insightStats,
    insightLoading,
    insightError,
    hasLoadedInsight,
    insightRange,
    setInsightRange,

    chatWithPromptTemplate,
    setChatWithPromptTemplate,
    chatWithMaxChars,
    setChatWithMaxChars,
    chatWithPlatforms,
    setChatWithPlatforms,
    onResetChatWithSettings,
  };
}
