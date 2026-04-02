import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { exportBackupZipV2 } from '@services/sync/backup/export';
import { LAST_BACKUP_EXPORT_AT_STORAGE_KEY } from '@services/sync/backup/backup-utils';
import {
  importBackupLegacyJsonMerge,
  importBackupZipV2Merge,
  type ImportProgress,
  type ImportStats,
} from '@services/sync/backup/import';
import { extractZipEntries } from '@services/sync/backup/zip-utils';
import { disconnectNotion } from '@services/sync/notion/auth/settings-client';
import { getNotionOAuthDefaults } from '@services/sync/notion/auth/oauth';
import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { conversationKinds } from '@services/protocols/conversation-kinds';
import type { ConversationKindDbSpec } from '@services/protocols/conversation-kind-contract';
import {
  MARKDOWN_READING_PROFILE_STORAGE_KEY,
  buildMarkdownReadingProfileStoragePatch,
  normalizeStoredMarkdownReadingProfile,
} from '@services/protocols/markdown-reading-profile-storage';
import { send } from '@services/shared/runtime';
import { storageGet, storageOnChanged, storageRemove, storageSet } from '@services/shared/storage';
import { openOrFocusExtensionAppTab } from '@services/shared/webext';
import { setSyncProviderEnabled, syncProviderEnabledStorageKey } from '@services/sync/sync-provider-gate';
import {
  DEFAULT_CHAT_WITH_MAX_CHARS,
  DEFAULT_CHAT_WITH_PLATFORMS,
  DEFAULT_CHAT_WITH_PROMPT_TEMPLATE,
  loadChatWithSettings,
  resetChatWithPlatforms,
  saveChatWithSettings,
} from '@services/integrations/chatwith/chatwith-settings';
import {
  buildInsightStats,
  getInsightStatsSourceData,
  getInsightTimeRangeWindow,
  type InsightStats,
  type InsightStatsSourceData,
  type InsightTimeRange,
} from '@viewmodels/settings/insight-stats';

import {
  formatProgress,
  isZipFile,
  openHttpUrl,
  unwrap,
  type ApiResponse,
  type NotionPageOption,
} from '@viewmodels/settings/utils';
import type { SettingsSectionKey } from '@viewmodels/settings/types';
import { t } from '@i18n';
import { ABOUT_YOU_USER_NAME_STORAGE_KEY, normalizeUserName } from '@services/shared/user-profile';

const NOTION_SYNC_PROVIDER_ENABLED_KEY = syncProviderEnabledStorageKey('notion');
const OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY = syncProviderEnabledStorageKey('obsidian');
const FALLBACK_NOTION_DB_STORAGE_KEYS = ['notion_db_id_syncnos_ai_chats', 'notion_db_id_syncnos_web_articles'];
const FALLBACK_CHAT_DB_SPEC = {
  title: 'SyncNos-AI Chats',
  storageKey: 'notion_db_id_syncnos_ai_chats',
} as const;
const FALLBACK_ARTICLE_DB_SPEC = {
  title: 'SyncNos-Web Articles',
  storageKey: 'notion_db_id_syncnos_web_articles',
} as const;

function getKindDbSpec(kindId: string, fallback: { title: string; storageKey: string }) {
  try {
    const spec = (conversationKinds as any)?.getNotionDbSpecByKindId?.(kindId) as ConversationKindDbSpec | null;
    const storageKey = String(spec?.storageKey || '').trim();
    const title = String(spec?.title || '').trim();
    if (storageKey && title) return { storageKey, title };
  } catch (_e) {
    // ignore and fallback
  }
  return { ...fallback };
}

function getNotionDbStorageKeys() {
  try {
    const keys = conversationKinds?.getNotionStorageKeys?.();
    if (Array.isArray(keys) && keys.length) {
      return Array.from(new Set(keys.map((key) => String(key || '').trim()).filter(Boolean)));
    }
  } catch (_e) {
    // ignore and fallback
  }
  return FALLBACK_NOTION_DB_STORAGE_KEYS.slice();
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
  const raw = String(value || '')
    .trim()
    .toLowerCase();
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
  const taskQueueRef = useRef<Promise<void>>(Promise.resolve());

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
  const chatDbSpec = useMemo(() => getKindDbSpec('chat', FALLBACK_CHAT_DB_SPEC), []);
  const articleDbSpec = useMemo(() => getKindDbSpec('article', FALLBACK_ARTICLE_DB_SPEC), []);
  const [notionAdvancedOpen, setNotionAdvancedOpen] = useState(false);
  const [notionChatDatabaseId, setNotionChatDatabaseId] = useState<string>('');
  const [notionArticleDatabaseId, setNotionArticleDatabaseId] = useState<string>('');

  // Inpage
  const [inpageDisplayMode, setInpageDisplayMode] = useState<InpageDisplayMode>('all');
  const [aiChatAutoSaveEnabled, setAiChatAutoSaveEnabled] = useState<boolean>(true);
  const [aiChatCacheImagesEnabled, setAiChatCacheImagesEnabled] = useState<boolean>(false);
  const [webArticleCacheImagesEnabled, setWebArticleCacheImagesEnabled] = useState<boolean>(false);
  const [aiChatDollarMentionEnabled, setAiChatDollarMentionEnabled] = useState<boolean>(true);
  const [markdownReadingProfile, setMarkdownReadingProfile] = useState(() => normalizeStoredMarkdownReadingProfile(''));

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
  const [aboutYouUserName, setAboutYouUserName] = useState<string>('');
  const aboutYouUserNameSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPopup = useMemo(() => isPopupUi(), []);
  const useAppImport = useMemo(() => isPopup && isFirefoxFamilyBrowser(), [isPopup]);

  const runTask = useCallback(async (task: () => Promise<void>, options: RunTaskOptions = {}) => {
    const run = taskQueueRef.current.then(async () => {
      const { useBusy = true, clearError = true, fallbackMessage = 'failed', onError } = options;

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
    });

    taskQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const refreshInternal = useCallback(async () => {
    const [notionRes, local, obsidianRes] = await Promise.all([
      send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, {}),
      storageGet([
        'notion_oauth_client_id',
        'notion_oauth_pending_state',
        'notion_oauth_last_error',
        'notion_parent_page_id',
        'notion_parent_page_title',
        'notion_ai_preferred_model_index',
        chatDbSpec.storageKey,
        articleDbSpec.storageKey,
        NOTION_SYNC_PROVIDER_ENABLED_KEY,
        OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY,
        'inpage_display_mode',
        'inpage_supported_only',
        'ai_chat_auto_save_enabled',
        'ai_chat_cache_images_enabled',
        'web_article_cache_images_enabled',
        'ai_chat_dollar_mention_enabled',
        MARKDOWN_READING_PROFILE_STORAGE_KEY,
        LAST_BACKUP_EXPORT_AT_STORAGE_KEY,
        ABOUT_YOU_USER_NAME_STORAGE_KEY,
      ]),
      send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS, {}),
    ]);

    const notionStatus = unwrap(notionRes);
    const connected = !!notionStatus?.connected;
    setNotionConnected(connected);
    setNotionWorkspaceName(String(notionStatus?.workspaceName || notionStatus?.token?.workspaceName || ''));
    if (!connected) {
      setPollingNotion(false);
      setLoadingNotionPages(false);
      setNotionPages([]);
    }

    setNotionClientId(String(local?.notion_oauth_client_id || ''));
    setNotionPendingState(String(local?.notion_oauth_pending_state || ''));
    setNotionLastError(String(local?.notion_oauth_last_error || ''));
    setNotionParentPageId(String(local?.notion_parent_page_id || ''));
    setNotionParentPageTitle(String(local?.notion_parent_page_title || ''));
    setNotionAiModelIndex(String(local?.notion_ai_preferred_model_index || ''));
    setNotionChatDatabaseId(String(local?.[chatDbSpec.storageKey] || ''));
    setNotionArticleDatabaseId(String(local?.[articleDbSpec.storageKey] || ''));
    setNotionSyncEnabled(local?.[NOTION_SYNC_PROVIDER_ENABLED_KEY] !== false);
    setObsidianSyncEnabled(local?.[OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY] !== false);

    const normalizedInpageMode = normalizeInpageDisplayMode(local?.inpage_display_mode);
    setInpageDisplayMode(
      normalizedInpageMode || inpageDisplayModeFromLegacySupportedOnly(local?.inpage_supported_only),
    );
    setAiChatAutoSaveEnabled(local?.ai_chat_auto_save_enabled !== false);
    setAiChatCacheImagesEnabled(local?.ai_chat_cache_images_enabled === true);
    setWebArticleCacheImagesEnabled(local?.web_article_cache_images_enabled === true);
    setAiChatDollarMentionEnabled(local?.ai_chat_dollar_mention_enabled !== false);
    setMarkdownReadingProfile(normalizeStoredMarkdownReadingProfile(local?.[MARKDOWN_READING_PROFILE_STORAGE_KEY]));
    setLastBackupExportAt(Number(local?.[LAST_BACKUP_EXPORT_AT_STORAGE_KEY] || 0) || 0);
    setAboutYouUserName(normalizeUserName(local?.[ABOUT_YOU_USER_NAME_STORAGE_KEY]));

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
    setChatWithPlatforms(
      Array.isArray(chatWith.platforms) ? (chatWith.platforms as any) : DEFAULT_CHAT_WITH_PLATFORMS.slice(),
    );
    chatWithHydratedRef.current = true;
  }, [articleDbSpec.storageKey, chatDbSpec.storageKey]);

  const refresh = useCallback(async () => {
    await runTask(refreshInternal);
  }, [refreshInternal, runTask]);

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
      if (Object.prototype.hasOwnProperty.call(changes, MARKDOWN_READING_PROFILE_STORAGE_KEY)) {
        const nextValue = changes[MARKDOWN_READING_PROFILE_STORAGE_KEY]?.newValue;
        setMarkdownReadingProfile(normalizeStoredMarkdownReadingProfile(nextValue));
      }

      if (
        Object.prototype.hasOwnProperty.call(changes, 'notion_oauth_token_v1') ||
        Object.prototype.hasOwnProperty.call(changes, 'notion_oauth_pending_state') ||
        Object.prototype.hasOwnProperty.call(changes, 'notion_oauth_last_error')
      ) {
        void refresh();
      }
    });
  }, [refresh]);

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

  useEffect(() => {
    if (!pollingNotion) return;
    if (notionConnected) {
      setPollingNotion(false);
      return;
    }
    if (notionLastError) {
      setPollingNotion(false);
      return;
    }
    if (!notionPendingState) {
      setPollingNotion(false);
    }
  }, [notionConnected, notionLastError, notionPendingState, pollingNotion]);

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
        setNotionConnected(false);
        setNotionWorkspaceName('');
        setNotionPendingState('');
        setNotionLastError('');
        setNotionPages([]);
        setNotionParentPageId('');
        setNotionParentPageTitle('');
        setPollingNotion(false);
        setLoadingNotionPages(false);
        await refreshInternal();
        return;
      }

      const clientId = String(notionClientId || '').trim();
      if (!clientId) throw new Error('Notion OAuth client id not configured');

      const cfg = getNotionOAuthDefaults();
      const state = `webclipper_${Math.random().toString(16).slice(2)}_${Date.now()}`;
      await storageSet({ notion_oauth_pending_state: state, notion_oauth_last_error: '' });
      setNotionPendingState(state);
      setNotionLastError('');

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
  }, [notionClientId, refreshInternal, runTask]);

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
        const savedId = String(notionParentPageId || '').trim();
        const savedTitle = String(notionParentPageTitle || '').trim();

        const res = unwrap(await send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.LIST_PARENT_PAGES, {}));
        const pages = Array.isArray(res?.pages) ? (res.pages as NotionPageOption[]) : [];
        const resolvedSaved = res?.resolvedSaved ? (res.resolvedSaved as NotionPageOption) : null;

        setNotionPages(pages);

        const nextId = savedId || pages[0]?.id || '';
        const nextTitle = (resolvedSaved?.title || (savedId ? savedTitle : pages[0]?.title) || '').trim();

        if (nextId) setNotionParentPageId(nextId);
        if (nextTitle) setNotionParentPageTitle(nextTitle);

        if (savedId && nextId && nextId !== savedId) {
          await storageRemove(getNotionDbStorageKeys());
        }

        const payload: Record<string, unknown> = {};
        if (nextId && nextId !== savedId) payload.notion_parent_page_id = nextId;
        if (nextTitle && nextTitle !== savedTitle) payload.notion_parent_page_title = nextTitle;
        if (Object.keys(payload).length) await storageSet(payload);
      },
      { useBusy: false, fallbackMessage: 'failed to load pages' },
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
      const savedId = String(notionParentPageId || '').trim();

      await runTask(async () => {
        if (savedId && next !== savedId) {
          await storageRemove(getNotionDbStorageKeys());
        }

        setNotionParentPageId(next);
        const match = notionPages.find((page) => page && String(page.id || '').trim() === next) ?? null;
        if (match && match.title) setNotionParentPageTitle(String(match.title || '').trim());

        const payload: Record<string, unknown> = { notion_parent_page_id: next };
        if (match && match.title) payload.notion_parent_page_title = String(match.title || '').trim();
        await storageSet(payload);
      });
    },
    [notionPages, notionParentPageId, runTask],
  );

  const onSaveNotionAiModelIndex = useCallback(async () => {
    const ok = await runTask(async () => {
      const raw = String(notionAiModelIndex || '').trim();
      const value = raw ? Number(raw) : NaN;

      if (!raw) {
        await storageSet({ notion_ai_preferred_model_index: '' });
      } else if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid model index');
      } else {
        await storageSet({ notion_ai_preferred_model_index: Math.floor(value) });
      }
    });

    if (ok) await refresh();
  }, [notionAiModelIndex, refresh, runTask]);

  const onResetNotionAiModelIndex = useCallback(async () => {
    const ok = await runTask(async () => {
      await storageSet({ notion_ai_preferred_model_index: '' });
    });

    if (ok) await refresh();
  }, [refresh, runTask]);

  const onToggleNotionAdvancedOpen = useCallback(() => {
    setNotionAdvancedOpen((prev) => !prev);
  }, []);

  const onSaveNotionDatabaseId = useCallback(
    async (kind: 'chat' | 'article') => {
      const spec = kind === 'chat' ? chatDbSpec : articleDbSpec;
      const raw = kind === 'chat' ? notionChatDatabaseId : notionArticleDatabaseId;
      const next = String(raw || '').trim();

      await runTask(
        async () => {
          await storageSet({ [spec.storageKey]: next });
          if (kind === 'chat') setNotionChatDatabaseId(next);
          else setNotionArticleDatabaseId(next);
        },
        { fallbackMessage: 'save notion database id failed' },
      );
    },
    [articleDbSpec, chatDbSpec, notionArticleDatabaseId, notionChatDatabaseId, runTask],
  );

  const onResetNotionDatabaseId = useCallback(
    async (kind: 'chat' | 'article') => {
      const spec = kind === 'chat' ? chatDbSpec : articleDbSpec;

      await runTask(
        async () => {
          await storageRemove([spec.storageKey]);
          if (kind === 'chat') setNotionChatDatabaseId('');
          else setNotionArticleDatabaseId('');
        },
        { fallbackMessage: 'reset notion database id failed' },
      );
    },
    [articleDbSpec, chatDbSpec, runTask],
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
        },
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
    ],
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
          ok ? `${t('statusOk')} ✓ ${message}`.trim() : `${t('statusError')}: ${message || t('phaseFailed')}`,
        );
      },
      {
        fallbackMessage: 'failed',
        onError: (message) => {
          setObsidianStatus(`${t('statusError')}: ${message}`);
        },
      },
    );
  }, [runTask]);

  const onChangeInpageDisplayMode = useCallback(
    async (next: InpageDisplayMode) => {
      await runTask(async () => {
        await storageSet({ inpage_display_mode: next });
        setInpageDisplayMode(next);
      });
    },
    [runTask],
  );

  const onToggleAiChatAutoSaveEnabled = useCallback(
    async (next: boolean) => {
      await runTask(async () => {
        await storageSet({ ai_chat_auto_save_enabled: next === true });
        setAiChatAutoSaveEnabled(next === true);
      });
    },
    [runTask],
  );

  const onToggleAiChatCacheImagesEnabled = useCallback(
    async (next: boolean) => {
      await runTask(async () => {
        await storageSet({ ai_chat_cache_images_enabled: next === true });
        setAiChatCacheImagesEnabled(next === true);
      });
    },
    [runTask],
  );

  const onToggleWebArticleCacheImagesEnabled = useCallback(
    async (next: boolean) => {
      await runTask(async () => {
        await storageSet({ web_article_cache_images_enabled: next === true });
        setWebArticleCacheImagesEnabled(next === true);
      });
    },
    [runTask],
  );

  const onToggleAiChatDollarMentionEnabled = useCallback(
    async (next: boolean) => {
      await runTask(async () => {
        await storageSet({ ai_chat_dollar_mention_enabled: next === true });
        setAiChatDollarMentionEnabled(next === true);
      });
    },
    [runTask],
  );

  const onChangeMarkdownReadingProfile = useCallback(
    async (next: unknown) => {
      const normalized = normalizeStoredMarkdownReadingProfile(next);
      await runTask(
        async () => {
          await storageSet(buildMarkdownReadingProfileStoragePatch(normalized));
          setMarkdownReadingProfile(normalized);
        },
        { fallbackMessage: 'save markdown reading profile failed' },
      );
    },
    [runTask],
  );

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
    if (activeSection !== 'aboutyou') return;
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
    if (activeSection !== 'aboutyou') return;
    const data = insightSourceDataRef.current;
    if (!data) return;

    const window = getInsightTimeRangeWindow(insightRange);
    setInsightStats(buildInsightStats(data, window));
  }, [activeSection, insightRange]);

  const onResetChatWithPlatforms = useCallback(async () => {
    await runTask(async () => {
      await resetChatWithPlatforms();
      setChatWithPlatforms(DEFAULT_CHAT_WITH_PLATFORMS.slice());
    });
  }, [runTask]);

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
          `${t('backupExported')} (${t('statsConversations')} ${result.counts.conversations}, ${t('statsMessages')} ${result.counts.messages}, ${t('statsComments')} ${result.counts.article_comments})`,
        );
        setLastBackupExportAt(Date.parse(result.exportedAt) || Date.now());
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      {
        fallbackMessage: 'export failed',
        onError: (message) => {
          setExportStatus(`${t('statusError')}: ${message}`);
        },
      },
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
        },
      );

      try {
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (_e) {
        // ignore
      }
    },
    [busy, runTask],
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

  const onChangeAboutYouUserName = useCallback((next: string) => {
    const value = normalizeUserName(next);
    setAboutYouUserName(value);
    if (aboutYouUserNameSaveTimerRef.current) clearTimeout(aboutYouUserNameSaveTimerRef.current);
    aboutYouUserNameSaveTimerRef.current = setTimeout(() => {
      aboutYouUserNameSaveTimerRef.current = null;
      void storageSet({ [ABOUT_YOU_USER_NAME_STORAGE_KEY]: value });
    }, 200);
  }, []);

  return {
    busy,
    error,

    notionSyncEnabled,
    onToggleNotionSyncEnabled,

    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionAiModelIndex,
    setNotionAiModelIndex,
    onSaveNotionAiModelIndex,
    onResetNotionAiModelIndex,
    notionAdvancedOpen,
    onToggleNotionAdvancedOpen,
    notionChatDatabaseId,
    setNotionChatDatabaseId,
    notionArticleDatabaseId,
    setNotionArticleDatabaseId,
    notionChatDatabaseLabel: chatDbSpec.title,
    notionArticleDatabaseLabel: articleDbSpec.title,
    onSaveNotionDatabaseId,
    onResetNotionDatabaseId,
    notionAiRef,
    notionParentPageId,
    notionPageOptions,
    notionStatusText,
    onNotionConnectOrDisconnect,
    onSaveNotionParentPage,
    onLoadNotionPages,

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
    aiChatCacheImagesEnabled,
    onToggleAiChatCacheImagesEnabled,
    webArticleCacheImagesEnabled,
    onToggleWebArticleCacheImagesEnabled,
    aiChatDollarMentionEnabled,
    onToggleAiChatDollarMentionEnabled,
    markdownReadingProfile,
    onChangeMarkdownReadingProfile,

    insightStats,
    insightLoading,
    insightError,
    hasLoadedInsight,
    insightRange,
    setInsightRange,
    aboutYouUserName,
    onChangeAboutYouUserName,

    chatWithPromptTemplate,
    setChatWithPromptTemplate,
    chatWithMaxChars,
    setChatWithMaxChars,
    chatWithPlatforms,
    setChatWithPlatforms,
    onResetChatWithPlatforms,
  };
}
