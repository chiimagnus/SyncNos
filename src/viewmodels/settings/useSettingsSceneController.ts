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
import {
  FEISHU_DEFAULTS,
  FEISHU_STORAGE_KEYS,
  getFeishuPathConfig,
  normalizeFeishuFolderPath,
  saveFeishuPathConfig,
} from '@services/sync/feishu/settings-store';
import { normalizeNotionDatabaseIdInput } from '@services/sync/notion/notion-id-utils';
import {
  FEISHU_MESSAGE_TYPES,
  GITHUB_MESSAGE_TYPES,
  INPAGE_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
} from '@services/protocols/message-contracts';
import { conversationKinds } from '@services/protocols/conversation-kinds';
import type { ConversationKindDbSpec } from '@services/protocols/conversation-kind-contract';
import { MARKDOWN_READING_PROFILE_STORAGE_KEY } from '@services/protocols/markdown-reading-profile-storage';
import { send } from '@services/shared/runtime';
import { storageGet, storageOnChanged, storageRemove, storageSet } from '@services/shared/storage';
import { downloadBlobFile, openOrFocusExtensionAppTab } from '@services/shared/webext';
import { setSyncProviderEnabled, syncProviderEnabledStorageKey } from '@services/sync/sync-provider-gate';
import { GITHUB_AUTH_STATE_KEY } from '@services/sync/github/auth/auth-store';
import {
  NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
  FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
  GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  ANTI_HOTLINK_RULES_SETTINGS_STORAGE_KEY,
  getDefaultAntiHotlinkRulesForSettings,
  loadAntiHotlinkRulesForSettings,
  resetAntiHotlinkRulesForSettings,
  saveAntiHotlinkRulesForSettings,
  type AntiHotlinkRuleDraft,
} from '@services/integrations/anti-hotlink/anti-hotlink-settings';
import type { AntiHotlinkRuleValidationIssue } from '@services/integrations/anti-hotlink/anti-hotlink-settings';
import { getInsightStatsSourceData, type InsightStatsSourceData } from '@services/insight/insight-stats-source';
import {
  requestDataRevisionRetry,
  subscribeDataRevisionChanges,
  whenDataRevisionObserverReady,
} from '@services/data-revisions/observer';
import {
  buildInsightStats,
  getInsightTimeRangeWindow,
  type InsightStats,
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
import { getCurrentLocale, getLocalePreference, saveLocalePreference, type LocalePreference, t } from '@i18n';
import { ABOUT_YOU_USER_NAME_STORAGE_KEY, normalizeUserName } from '@services/shared/user-profile';
import {
  INPAGE_DISPLAY_MODE_STORAGE_KEY,
  normalizeInpageDisplayMode,
  readEffectiveInpageDisplayMode,
  type InpageDisplayMode,
} from '@services/shared/inpage-display-mode';

const NOTION_SYNC_PROVIDER_ENABLED_KEY = syncProviderEnabledStorageKey('notion');
const OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY = syncProviderEnabledStorageKey('obsidian');
const FEISHU_SYNC_PROVIDER_ENABLED_KEY = syncProviderEnabledStorageKey('feishu');
const GITHUB_SYNC_PROVIDER_ENABLED_KEY = syncProviderEnabledStorageKey('github');
const FALLBACK_NOTION_DB_STORAGE_KEYS = [
  'notion_db_id_syncnos_ai_chats',
  'notion_db_id_syncnos_web_articles',
  'notion_db_id_syncnos_videos',
];
const FALLBACK_CHAT_DB_SPEC = {
  title: 'SyncNos-AI Chats',
  storageKey: 'notion_db_id_syncnos_ai_chats',
} as const;
const FALLBACK_ARTICLE_DB_SPEC = {
  title: 'SyncNos-Web Articles',
  storageKey: 'notion_db_id_syncnos_web_articles',
} as const;
const FALLBACK_VIDEO_DB_SPEC = {
  title: 'SyncNos-Videos',
  storageKey: 'notion_db_id_syncnos_videos',
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

type AntiHotlinkRuleRowError = {
  domain?: string;
  referer?: string;
};

function mapAntiHotlinkValidationIssuesToRowErrors(
  issues: ReadonlyArray<AntiHotlinkRuleValidationIssue>,
): AntiHotlinkRuleRowError[] {
  const rows: AntiHotlinkRuleRowError[] = [];
  for (const issue of issues || []) {
    const index = Number(issue?.index);
    if (!Number.isFinite(index) || index < 0) continue;
    const row = rows[index] || {};
    if (issue.field === 'domain') row.domain = issue.message;
    if (issue.field === 'referer') row.referer = issue.message;
    rows[index] = row;
  }
  return rows;
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

export type InsightLoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type InsightRevisionScope = 'conversations' | 'messages' | 'article_comments';
const INSIGHT_REVISION_SCOPES: readonly InsightRevisionScope[] = ['conversations', 'messages', 'article_comments'];

type GithubAuthSummary =
  | { state: 'disconnected' }
  | { state: 'connected' }
  | { state: 'pending'; userCode: string; verificationUri: string; expiresAt: number; nextPollAt: number };

type GithubRepositoryStatus = 'ready' | 'github_app_not_installed' | 'github_no_accessible_repositories' | null;

type GithubRepositoryOption = {
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  installationId: number;
  contentWriteCapable: boolean;
};

type GithubSafeAccount = { login: string; avatarUrl: string; url: string };

type GithubConnectionTarget = {
  repository: string;
  branch: string;
  remoteKey: string;
  installationId: number | null;
};

type GithubConnectionTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'uninitialized' }
  | { status: 'initializing' }
  | { status: 'success'; target: GithubConnectionTarget }
  | { status: 'error'; error: string };

function normalizeGithubConnectionTarget(value: any): GithubConnectionTarget {
  return {
    repository: String(value?.repository || ''),
    branch: String(value?.branch || ''),
    remoteKey: String(value?.remoteKey || ''),
    installationId:
      Number.isSafeInteger(value?.installationId) && value.installationId > 0 ? value.installationId : null,
  };
}

function normalizeGithubAuthSummary(value: unknown): GithubAuthSummary {
  const raw = value as any;
  if (raw?.state === 'connected') return { state: 'connected' };
  if (raw?.state === 'pending') {
    return {
      state: 'pending',
      userCode: String(raw.userCode || ''),
      verificationUri: String(raw.verificationUri || ''),
      expiresAt: Number(raw.expiresAt) || 0,
      nextPollAt: Number(raw.nextPollAt) || 0,
    };
  }
  return { state: 'disconnected' };
}

function normalizeGithubRepositoryOptions(value: unknown): GithubRepositoryOption[] {
  return (Array.isArray(value) ? value : []).flatMap((row: any) => {
    const fullName = String(row?.fullName || '').trim();
    if (!fullName) return [];
    return [
      {
        owner: String(row?.owner || '').trim(),
        repo: String(row?.repo || '').trim(),
        fullName,
        private: row?.private === true,
        installationId: Number.isSafeInteger(row?.installationId) && row.installationId > 0 ? row.installationId : 0,
        contentWriteCapable: row?.contentWriteCapable === true,
      },
    ];
  });
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
  const [notionParentPageId, setNotionParentPageId] = useState<string>('');
  const [notionParentPageTitle, setNotionParentPageTitle] = useState<string>('');
  const [notionPages, setNotionPages] = useState<NotionPageOption[]>([]);
  const [loadingNotionPages, setLoadingNotionPages] = useState(false);
  const [pollingNotion, setPollingNotion] = useState(false);
  const notionConnectedRef = useRef<boolean | null>(null);
  const notionPendingStateRef = useRef('');
  const notionLastErrorRef = useRef('');
  const notionPollingRef = useRef(false);
  const notionAuthRequestSeqRef = useRef(0);
  const notionAuthAppliedSeqRef = useRef(0);
  const notionStartGenerationRef = useRef(0);
  const notionAuthObservationRevisionRef = useRef(0);
  const notionPendingObservationRevisionRef = useRef(0);
  const notionPagesAutoLoadRef = useRef(false);
  const [notionSyncEnabled, setNotionSyncEnabled] = useState(true);
  const [notionAutoSyncEnabled, setNotionAutoSyncEnabled] = useState(false);

  // Feishu
  const [feishuConnected, setFeishuConnected] = useState<boolean | null>(null);
  const [feishuPendingState, setFeishuPendingState] = useState<string>('');
  const [feishuLastError, setFeishuLastError] = useState<string>('');
  const [feishuClientId, setFeishuClientId] = useState<string>('');
  const [feishuClientSecret, setFeishuClientSecret] = useState<string>('');
  const [feishuTokenExchangeProxyUrl, setFeishuTokenExchangeProxyUrl] = useState<string>('');
  const [pollingFeishu, setPollingFeishu] = useState(false);
  const feishuConnectedRef = useRef<boolean | null>(null);
  const feishuPendingStateRef = useRef('');
  const feishuLastErrorRef = useRef('');
  const feishuPollingRef = useRef(false);
  const feishuAuthRequestSeqRef = useRef(0);
  const feishuAuthAppliedSeqRef = useRef(0);
  const feishuStartGenerationRef = useRef(0);
  const feishuAuthObservationRevisionRef = useRef(0);
  const feishuPendingObservationRevisionRef = useRef(0);
  const [feishuSyncEnabled, setFeishuSyncEnabled] = useState(true);
  const [feishuAutoSyncEnabled, setFeishuAutoSyncEnabled] = useState(false);
  const [feishuChatFolder, setFeishuChatFolder] = useState<string>('');
  const [feishuArticleFolder, setFeishuArticleFolder] = useState<string>('');
  const [feishuVideoFolder, setFeishuVideoFolder] = useState<string>('');

  // Obsidian
  const [obsidianApiBaseUrl, setObsidianApiBaseUrl] = useState<string>('');
  const [obsidianAuthHeaderName, setObsidianAuthHeaderName] = useState<string>('');
  const [obsidianApiKeyDraft, setObsidianApiKeyDraft] = useState<string>('');
  const [obsidianApiKeyPresent, setObsidianApiKeyPresent] = useState<boolean>(false);
  const [obsidianApiKeyMasked, setObsidianApiKeyMasked] = useState<string>('');
  const [obsidianChatFolder, setObsidianChatFolder] = useState<string>('');
  const [obsidianArticleFolder, setObsidianArticleFolder] = useState<string>('');
  const [obsidianVideoFolder, setObsidianVideoFolder] = useState<string>('');
  const [obsidianStatus, setObsidianStatus] = useState<string>(t('statusIdle'));
  const [obsidianSyncEnabled, setObsidianSyncEnabled] = useState(true);
  const [obsidianAutoSyncEnabled, setObsidianAutoSyncEnabled] = useState(false);

  // GitHub
  const [githubAuth, setGithubAuth] = useState<GithubAuthSummary>({ state: 'disconnected' });
  const [githubAccount, setGithubAccount] = useState<GithubSafeAccount | null>(null);
  const [githubRepositoryStatus, setGithubRepositoryStatus] = useState<GithubRepositoryStatus>(null);
  const [githubRepositories, setGithubRepositories] = useState<GithubRepositoryOption[]>([]);
  const [githubRepositoriesLoading, setGithubRepositoriesLoading] = useState(false);
  const [githubRepositoryDiscoveryError, setGithubRepositoryDiscoveryError] = useState('');
  const githubRepositoryDiscoveryGenerationRef = useRef(0);
  // GET_SETTINGS auth reads can overlap: reject responses older than the latest successful/direct auth update,
  // but let an older successful read become last-good when a newer read failed.
  const githubAuthRequestSeqRef = useRef(0);
  const githubAuthAppliedSeqRef = useRef(0);
  // ponytail: 这里只合并同一时刻的 Device Flow poll；poll interval 与跨调用并发仍由 service 层持久化状态最终门禁。
  const githubDevicePollInFlightRef = useRef<Promise<void> | null>(null);
  const [githubRepository, setGithubRepository] = useState('');
  const [githubBranch, setGithubBranch] = useState('');
  const githubPersistedBranchRef = useRef('');
  const [githubVerificationUrl, setGithubVerificationUrl] = useState('');
  const [githubAppUrl, setGithubAppUrl] = useState('');
  const [githubInstallUrl, setGithubInstallUrl] = useState('');
  const [githubSyncEnabled, setGithubSyncEnabled] = useState(true);
  const [githubAutoSyncEnabled, setGithubAutoSyncEnabled] = useState(false);
  const [githubConnectionTest, setGithubConnectionTest] = useState<GithubConnectionTestState>({ status: 'idle' });

  // Backup
  const [exportStatus, setExportStatus] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string>('');
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [lastBackupExportAt, setLastBackupExportAt] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupImportRef = useRef<HTMLDivElement | null>(null);
  const chatDbSpec = useMemo(() => getKindDbSpec('chat', FALLBACK_CHAT_DB_SPEC), []);
  const articleDbSpec = useMemo(() => getKindDbSpec('article', FALLBACK_ARTICLE_DB_SPEC), []);
  const videoDbSpec = useMemo(() => getKindDbSpec('video', FALLBACK_VIDEO_DB_SPEC), []);
  const [notionAdvancedOpen, setNotionAdvancedOpen] = useState(false);
  const [notionChatDatabaseId, setNotionChatDatabaseId] = useState<string>('');
  const [notionArticleDatabaseId, setNotionArticleDatabaseId] = useState<string>('');
  const [notionVideoDatabaseId, setNotionVideoDatabaseId] = useState<string>('');

  // Inpage
  const [inpageDisplayMode, setInpageDisplayMode] = useState<InpageDisplayMode>('all');
  const inpageDisplayObservationRevisionRef = useRef(0);
  const [aiChatAutoSaveEnabled, setAiChatAutoSaveEnabled] = useState<boolean>(true);
  const aiChatAutoSaveObservationRevisionRef = useRef(0);
  const [aiChatCacheImagesEnabled, setAiChatCacheImagesEnabled] = useState<boolean>(false);
  const [webArticleCacheImagesEnabled, setWebArticleCacheImagesEnabled] = useState<boolean>(false);
  const [xiaohongshuCommentsCaptureEnabled, setXiaohongshuCommentsCaptureEnabled] = useState<boolean>(false);
  const [antiHotlinkAdvancedOpen, setAntiHotlinkAdvancedOpen] = useState<boolean>(false);
  const [antiHotlinkRules, setAntiHotlinkRules] = useState<AntiHotlinkRuleDraft[]>(() =>
    getDefaultAntiHotlinkRulesForSettings(),
  );
  const [antiHotlinkRuleErrors, setAntiHotlinkRuleErrors] = useState<AntiHotlinkRuleRowError[]>([]);
  const [aiChatDollarMentionEnabled, setAiChatDollarMentionEnabled] = useState<boolean>(true);
  const aiChatDollarMentionObservationRevisionRef = useRef(0);
  const [localePreference, setLocalePreference] = useState<LocalePreference>(() => getLocalePreference());

  // Insight
  const [insightStats, setInsightStats] = useState<InsightStats | null>(null);
  const [insightLoadStatus, setInsightLoadStatus] = useState<InsightLoadStatus>('idle');
  const [insightError, setInsightError] = useState('');
  const [insightRange, setInsightRange] = useState<InsightTimeRange>('7d');
  const insightSourceDataRef = useRef<InsightStatsSourceData | null>(null);
  const insightSourceRevisionGenerationRef = useRef(0);
  const insightActivationGenerationRef = useRef(0);
  const insightObservedSectionRef = useRef(activeSection);
  const insightReadinessSettledRef = useRef(false);
  const insightSourceStaleRef = useRef(true);
  const insightStaleScopesRef = useRef(new Set<InsightRevisionScope>(INSIGHT_REVISION_SCOPES));
  const insightSourceReadInFlightRef = useRef(false);
  const insightDisposedRef = useRef(false);
  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  const insightRangeRef = useRef(insightRange);
  insightRangeRef.current = insightRange;
  const startInsightSourceReadRef = useRef<() => void>(() => {});
  const [aboutYouUserName, setAboutYouUserName] = useState<string>('');

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

  const setNotionPollingState = useCallback((next: boolean) => {
    notionPollingRef.current = next;
    setPollingNotion(next);
  }, []);

  const setFeishuPollingState = useCallback((next: boolean) => {
    feishuPollingRef.current = next;
    setPollingFeishu(next);
  }, []);

  const applyNotionAuthStatus = useCallback(
    (value: unknown, snapshotRequestSeq?: number): boolean => {
      if (snapshotRequestSeq == null) {
        const directSeq = notionAuthRequestSeqRef.current + 1;
        notionAuthRequestSeqRef.current = directSeq;
        notionAuthAppliedSeqRef.current = directSeq;
      } else {
        if (snapshotRequestSeq <= notionAuthAppliedSeqRef.current) return false;
        notionAuthAppliedSeqRef.current = snapshotRequestSeq;
      }

      const raw = value as any;
      const connected = raw?.connected === true;
      notionConnectedRef.current = connected;
      setNotionConnected(connected);
      setNotionWorkspaceName(String(raw?.workspaceName || ''));
      if (connected) {
        notionStartGenerationRef.current += 1;
        setNotionPollingState(false);
      } else {
        setLoadingNotionPages(false);
        setNotionPages([]);
      }
      return true;
    },
    [setNotionPollingState],
  );

  const applyFeishuAuthStatus = useCallback(
    (value: unknown, snapshotRequestSeq?: number): boolean => {
      if (snapshotRequestSeq == null) {
        const directSeq = feishuAuthRequestSeqRef.current + 1;
        feishuAuthRequestSeqRef.current = directSeq;
        feishuAuthAppliedSeqRef.current = directSeq;
      } else {
        if (snapshotRequestSeq <= feishuAuthAppliedSeqRef.current) return false;
        feishuAuthAppliedSeqRef.current = snapshotRequestSeq;
      }

      const connected = (value as any)?.connected === true;
      feishuConnectedRef.current = connected;
      setFeishuConnected(connected);
      if (connected) {
        feishuStartGenerationRef.current += 1;
        setFeishuPollingState(false);
      }
      return true;
    },
    [setFeishuPollingState],
  );

  const readNotionAuthStatus = useCallback(async () => {
    const requestSeq = notionAuthRequestSeqRef.current + 1;
    notionAuthRequestSeqRef.current = requestSeq;
    const status = unwrap(await send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS, {}));
    return applyNotionAuthStatus(status, requestSeq) ? status : null;
  }, [applyNotionAuthStatus]);

  const readFeishuAuthStatus = useCallback(async () => {
    const requestSeq = feishuAuthRequestSeqRef.current + 1;
    feishuAuthRequestSeqRef.current = requestSeq;
    const status = unwrap(await send<ApiResponse<any>>(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS, {}));
    return applyFeishuAuthStatus(status, requestSeq) ? status : null;
  }, [applyFeishuAuthStatus]);

  const applyNotionPendingStorageObservation = useCallback(
    (value: unknown) => {
      const next = String(value || '');
      notionAuthObservationRevisionRef.current += 1;
      notionPendingObservationRevisionRef.current += 1;
      notionPendingStateRef.current = next;
      setNotionPendingState(next);
      if (!next) {
        notionStartGenerationRef.current += 1;
        setNotionPollingState(false);
      }
    },
    [setNotionPollingState],
  );

  const applyNotionErrorStorageObservation = useCallback(
    (value: unknown) => {
      const next = String(value || '');
      notionAuthObservationRevisionRef.current += 1;
      notionLastErrorRef.current = next;
      setNotionLastError(next);
      if (next) {
        notionStartGenerationRef.current += 1;
        setNotionPollingState(false);
      }
    },
    [setNotionPollingState],
  );

  const applyFeishuPendingStorageObservation = useCallback(
    (value: unknown) => {
      const next = String(value || '');
      feishuAuthObservationRevisionRef.current += 1;
      feishuPendingObservationRevisionRef.current += 1;
      feishuPendingStateRef.current = next;
      setFeishuPendingState(next);
      if (!next) {
        feishuStartGenerationRef.current += 1;
        setFeishuPollingState(false);
      }
    },
    [setFeishuPollingState],
  );

  const applyFeishuErrorStorageObservation = useCallback(
    (value: unknown) => {
      const next = String(value || '');
      feishuAuthObservationRevisionRef.current += 1;
      feishuLastErrorRef.current = next;
      setFeishuLastError(next);
      if (next) {
        feishuStartGenerationRef.current += 1;
        setFeishuPollingState(false);
      }
    },
    [setFeishuPollingState],
  );

  const refreshNotionAuthFromStorageSignal = useCallback(async () => {
    try {
      await readNotionAuthStatus();
    } catch (_error) {
      // A token storage change is only a wake signal. Preserve the last-good safe status on read failure.
    }
  }, [readNotionAuthStatus]);

  const refreshFeishuAuthFromStorageSignal = useCallback(async () => {
    try {
      await readFeishuAuthStatus();
    } catch (_error) {
      // A token storage change is only a wake signal. Preserve the last-good safe status on read failure.
    }
  }, [readFeishuAuthStatus]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearGithubRepositoryDiscovery = useCallback(() => {
    githubRepositoryDiscoveryGenerationRef.current += 1;
    setGithubAccount(null);
    setGithubRepositoryStatus(null);
    setGithubRepositories([]);
    setGithubRepositoriesLoading(false);
    setGithubRepositoryDiscoveryError('');
  }, []);

  const applyGithubAuth = useCallback(
    (value: unknown, snapshotRequestSeq?: number) => {
      if (snapshotRequestSeq == null) {
        const directSeq = githubAuthRequestSeqRef.current + 1;
        githubAuthRequestSeqRef.current = directSeq;
        githubAuthAppliedSeqRef.current = directSeq;
      } else {
        if (snapshotRequestSeq <= githubAuthAppliedSeqRef.current) return;
        githubAuthAppliedSeqRef.current = snapshotRequestSeq;
      }

      const next = normalizeGithubAuthSummary(value);
      setGithubAuth(next);
      if (next.state !== 'connected') {
        setGithubConnectionTest({ status: 'idle' });
        clearGithubRepositoryDiscovery();
      }
    },
    [clearGithubRepositoryDiscovery],
  );

  const applyGithubTargetSettings = useCallback((value: any) => {
    const repository = String(value?.repository || '');
    const branch = String(value?.branch || '');
    setGithubRepository(repository);
    githubPersistedBranchRef.current = branch;
    setGithubBranch(branch);
  }, []);

  const applyGithubSettingsResponse = useCallback(
    (value: any, authSnapshotRequestSeq?: number) => {
      const settings = value?.settings || {};
      const app = value?.app || {};
      applyGithubTargetSettings(settings);
      setGithubVerificationUrl(String(app.verificationUrl || ''));
      setGithubAppUrl(String(app.appUrl || ''));
      setGithubInstallUrl(String(app.installUrl || ''));
      setGithubConnectionTest({ status: 'idle' });
      applyGithubAuth(value?.auth, authSnapshotRequestSeq);
    },
    [applyGithubAuth, applyGithubTargetSettings],
  );

  const runGithubRepositoryDiscovery = useCallback(async () => {
    const requestGeneration = githubRepositoryDiscoveryGenerationRef.current + 1;
    githubRepositoryDiscoveryGenerationRef.current = requestGeneration;
    setGithubConnectionTest({ status: 'idle' });
    setGithubRepositoryDiscoveryError('');
    setGithubRepositoriesLoading(true);

    try {
      const data = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES, {}));
      if (githubRepositoryDiscoveryGenerationRef.current !== requestGeneration) return;

      const status: GithubRepositoryStatus =
        data?.status === 'ready' ||
        data?.status === 'github_app_not_installed' ||
        data?.status === 'github_no_accessible_repositories'
          ? data.status
          : null;
      if (status == null) throw new Error('github_repository_response_invalid');

      const login = String(data?.account?.login || '').trim();
      setGithubAccount(
        login
          ? {
              login,
              avatarUrl: String(data?.account?.avatarUrl || ''),
              url: String(data?.account?.url || ''),
            }
          : null,
      );
      setGithubRepositoryStatus(status);
      setGithubRepositories(normalizeGithubRepositoryOptions(data?.repositories));
      if (data?.appUrl) setGithubAppUrl(String(data.appUrl));
      if (data?.installUrl) setGithubInstallUrl(String(data.installUrl));
    } catch (error) {
      if (githubRepositoryDiscoveryGenerationRef.current !== requestGeneration) return;
      const message = toErrorMessage(error, 'github_repository_list_failed');
      if (message === 'github_auth_required') {
        applyGithubAuth({ state: 'disconnected' });
        return;
      }
      setGithubRepositoryDiscoveryError(message);
    } finally {
      if (githubRepositoryDiscoveryGenerationRef.current === requestGeneration) {
        setGithubRepositoriesLoading(false);
      }
    }
  }, [applyGithubAuth]);

  useEffect(() => {
    return () => {
      githubRepositoryDiscoveryGenerationRef.current += 1;
    };
  }, []);

  const refreshGithubAuthFromStorageSignal = useCallback(async () => {
    const requestSeq = githubAuthRequestSeqRef.current + 1;
    githubAuthRequestSeqRef.current = requestSeq;
    try {
      const snapshot = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.GET_SETTINGS, {}));
      applyGithubAuth(snapshot?.auth, requestSeq);
    } catch (_error) {
      // Storage changes are only a wake signal. Keep the current safe UI snapshot if rehydration fails.
    }
  }, [applyGithubAuth]);

  const refreshInternal = useCallback(async () => {
    const githubAuthRequestSeq = githubAuthRequestSeqRef.current + 1;
    githubAuthRequestSeqRef.current = githubAuthRequestSeq;
    const notionAuthObservationAtStart = notionAuthObservationRevisionRef.current;
    const feishuAuthObservationAtStart = feishuAuthObservationRevisionRef.current;
    const inpageDisplayObservationAtStart = inpageDisplayObservationRevisionRef.current;
    const aiChatAutoSaveObservationAtStart = aiChatAutoSaveObservationRevisionRef.current;
    const aiChatDollarMentionObservationAtStart = aiChatDollarMentionObservationRevisionRef.current;
    const [, , local, obsidianRes, githubRes, antiHotlinkRulesDraft, effectiveInpageDisplayMode] = await Promise.all([
      readNotionAuthStatus(),
      readFeishuAuthStatus(),
      storageGet([
        'notion_oauth_pending_state',
        'notion_oauth_last_error',
        'notion_parent_page_id',
        'notion_parent_page_title',
        'feishu_oauth_client_id',
        'feishu_oauth_client_secret',
        'feishu_oauth_pending_state',
        'feishu_oauth_last_error',
        'feishu_oauth_token_exchange_proxy_url',
        chatDbSpec.storageKey,
        articleDbSpec.storageKey,
        videoDbSpec.storageKey,
        NOTION_SYNC_PROVIDER_ENABLED_KEY,
        FEISHU_SYNC_PROVIDER_ENABLED_KEY,
        OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY,
        GITHUB_SYNC_PROVIDER_ENABLED_KEY,
        NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
        OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
        FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
        GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
        'ai_chat_auto_save_enabled',
        'ai_chat_cache_images_enabled',
        'web_article_cache_images_enabled',
        'xiaohongshu_comments_capture_enabled',
        'ai_chat_dollar_mention_enabled',
        MARKDOWN_READING_PROFILE_STORAGE_KEY,
        LAST_BACKUP_EXPORT_AT_STORAGE_KEY,
        ABOUT_YOU_USER_NAME_STORAGE_KEY,
      ]),
      send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS, {}),
      send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.GET_SETTINGS, {}),
      loadAntiHotlinkRulesForSettings({ forceRefresh: true }),
      readEffectiveInpageDisplayMode(),
    ]);

    if (notionAuthObservationRevisionRef.current === notionAuthObservationAtStart) {
      const pending = String(local?.notion_oauth_pending_state || '');
      const lastError = String(local?.notion_oauth_last_error || '');
      notionPendingStateRef.current = pending;
      notionLastErrorRef.current = lastError;
      setNotionPendingState(pending);
      setNotionLastError(lastError);
      if (notionConnectedRef.current === true || lastError || !pending) setNotionPollingState(false);
    }
    setNotionParentPageId(String(local?.notion_parent_page_id || ''));
    setNotionParentPageTitle(String(local?.notion_parent_page_title || ''));
    setNotionChatDatabaseId(String(local?.[chatDbSpec.storageKey] || ''));
    setNotionArticleDatabaseId(String(local?.[articleDbSpec.storageKey] || ''));
    setNotionVideoDatabaseId(String(local?.[videoDbSpec.storageKey] || ''));
    setNotionSyncEnabled(local?.[NOTION_SYNC_PROVIDER_ENABLED_KEY] !== false);
    setNotionAutoSyncEnabled(local?.[NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY] === true);
    setFeishuSyncEnabled(local?.[FEISHU_SYNC_PROVIDER_ENABLED_KEY] !== false);
    setFeishuAutoSyncEnabled(local?.[FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY] === true);
    setObsidianSyncEnabled(local?.[OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY] !== false);
    setObsidianAutoSyncEnabled(local?.[OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY] === true);
    setGithubSyncEnabled(local?.[GITHUB_SYNC_PROVIDER_ENABLED_KEY] !== false);
    setGithubAutoSyncEnabled(local?.[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] === true);

    setFeishuClientId(String(local?.feishu_oauth_client_id || ''));
    setFeishuClientSecret(String(local?.feishu_oauth_client_secret || ''));
    if (feishuAuthObservationRevisionRef.current === feishuAuthObservationAtStart) {
      const pending = String(local?.feishu_oauth_pending_state || '');
      const lastError = String(local?.feishu_oauth_last_error || '');
      feishuPendingStateRef.current = pending;
      feishuLastErrorRef.current = lastError;
      setFeishuPendingState(pending);
      setFeishuLastError(lastError);
      if (feishuConnectedRef.current === true || lastError || !pending) setFeishuPollingState(false);
    }
    setFeishuTokenExchangeProxyUrl(String(local?.feishu_oauth_token_exchange_proxy_url || ''));
    const feishuPathConfig = await getFeishuPathConfig().catch(() => null);
    setFeishuChatFolder(String(feishuPathConfig?.chatFolder || FEISHU_DEFAULTS.chatFolder));
    setFeishuArticleFolder(String(feishuPathConfig?.articleFolder || FEISHU_DEFAULTS.articleFolder));
    setFeishuVideoFolder(String(feishuPathConfig?.videoFolder || FEISHU_DEFAULTS.videoFolder));

    if (inpageDisplayObservationRevisionRef.current === inpageDisplayObservationAtStart) {
      setInpageDisplayMode(effectiveInpageDisplayMode);
    }
    if (aiChatAutoSaveObservationRevisionRef.current === aiChatAutoSaveObservationAtStart) {
      setAiChatAutoSaveEnabled(local?.ai_chat_auto_save_enabled !== false);
    }
    setAiChatCacheImagesEnabled(local?.ai_chat_cache_images_enabled === true);
    setWebArticleCacheImagesEnabled(local?.web_article_cache_images_enabled === true);
    setXiaohongshuCommentsCaptureEnabled(local?.xiaohongshu_comments_capture_enabled === true);
    setAntiHotlinkRules(Array.isArray(antiHotlinkRulesDraft) ? antiHotlinkRulesDraft : []);
    setAntiHotlinkRuleErrors([]);
    if (aiChatDollarMentionObservationRevisionRef.current === aiChatDollarMentionObservationAtStart) {
      setAiChatDollarMentionEnabled(local?.ai_chat_dollar_mention_enabled !== false);
    }
    setLastBackupExportAt(Number(local?.[LAST_BACKUP_EXPORT_AT_STORAGE_KEY] || 0) || 0);
    setAboutYouUserName(normalizeUserName(local?.[ABOUT_YOU_USER_NAME_STORAGE_KEY]));

    const obsidianSettings = unwrap(obsidianRes);
    setObsidianApiBaseUrl(String(obsidianSettings?.apiBaseUrl || ''));
    setObsidianAuthHeaderName(String(obsidianSettings?.authHeaderName || ''));
    setObsidianApiKeyPresent(!!obsidianSettings?.apiKeyPresent);
    setObsidianApiKeyMasked(String(obsidianSettings?.apiKeyMasked || ''));
    setObsidianChatFolder(String(obsidianSettings?.chatFolder || ''));
    setObsidianArticleFolder(String(obsidianSettings?.articleFolder || ''));
    setObsidianVideoFolder(String(obsidianSettings?.videoFolder || ''));
    setObsidianApiKeyDraft('');
    setObsidianStatus(t('statusIdle'));

    const githubSettings = unwrap(githubRes);
    applyGithubSettingsResponse(githubSettings, githubAuthRequestSeq);
  }, [
    applyGithubSettingsResponse,
    articleDbSpec.storageKey,
    chatDbSpec.storageKey,
    readFeishuAuthStatus,
    readNotionAuthStatus,
    setFeishuPollingState,
    setNotionPollingState,
    videoDbSpec.storageKey,
  ]);

  useEffect(() => {
    if (activeSection !== 'github') return;
    if (githubAuth.state !== 'connected') return;
    if (githubRepositoryStatus != null) return;
    if (githubRepositoriesLoading) return;
    if (githubRepositoryDiscoveryError) return;
    void runGithubRepositoryDiscovery();
  }, [
    activeSection,
    githubAuth.state,
    githubRepositoriesLoading,
    githubRepositoryDiscoveryError,
    githubRepositoryStatus,
    runGithubRepositoryDiscovery,
  ]);

  useEffect(() => {
    return storageOnChanged((changes: any, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes || typeof changes !== 'object') return;

      if (Object.prototype.hasOwnProperty.call(changes, NOTION_SYNC_PROVIDER_ENABLED_KEY)) {
        const nextValue = changes[NOTION_SYNC_PROVIDER_ENABLED_KEY]?.newValue;
        setNotionSyncEnabled(nextValue !== false);
      }
      if (Object.prototype.hasOwnProperty.call(changes, NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY)) {
        const nextValue = changes[NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY]?.newValue;
        setNotionAutoSyncEnabled(nextValue === true);
      }
      if (Object.prototype.hasOwnProperty.call(changes, OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY)) {
        const nextValue = changes[OBSIDIAN_SYNC_PROVIDER_ENABLED_KEY]?.newValue;
        setObsidianSyncEnabled(nextValue !== false);
      }
      if (Object.prototype.hasOwnProperty.call(changes, OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY)) {
        const nextValue = changes[OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY]?.newValue;
        setObsidianAutoSyncEnabled(nextValue === true);
      }
      if (Object.prototype.hasOwnProperty.call(changes, FEISHU_SYNC_PROVIDER_ENABLED_KEY)) {
        const nextValue = changes[FEISHU_SYNC_PROVIDER_ENABLED_KEY]?.newValue;
        setFeishuSyncEnabled(nextValue !== false);
      }
      if (Object.prototype.hasOwnProperty.call(changes, FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY)) {
        const nextValue = changes[FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY]?.newValue;
        setFeishuAutoSyncEnabled(nextValue === true);
      }
      if (Object.prototype.hasOwnProperty.call(changes, GITHUB_SYNC_PROVIDER_ENABLED_KEY)) {
        const nextValue = changes[GITHUB_SYNC_PROVIDER_ENABLED_KEY]?.newValue;
        setGithubSyncEnabled(nextValue !== false);
      }
      if (Object.prototype.hasOwnProperty.call(changes, GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY)) {
        const nextValue = changes[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY]?.newValue;
        setGithubAutoSyncEnabled(nextValue === true);
      }
      if (Object.prototype.hasOwnProperty.call(changes, GITHUB_AUTH_STATE_KEY)) {
        void refreshGithubAuthFromStorageSignal();
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'ai_chat_auto_save_enabled')) {
        aiChatAutoSaveObservationRevisionRef.current += 1;
        setAiChatAutoSaveEnabled(changes.ai_chat_auto_save_enabled?.newValue !== false);
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'ai_chat_dollar_mention_enabled')) {
        aiChatDollarMentionObservationRevisionRef.current += 1;
        setAiChatDollarMentionEnabled(changes.ai_chat_dollar_mention_enabled?.newValue !== false);
      }
      if (Object.prototype.hasOwnProperty.call(changes, INPAGE_DISPLAY_MODE_STORAGE_KEY)) {
        const revision = ++inpageDisplayObservationRevisionRef.current;
        const normalized = normalizeInpageDisplayMode(changes[INPAGE_DISPLAY_MODE_STORAGE_KEY]?.newValue);
        if (normalized) {
          setInpageDisplayMode(normalized);
        } else {
          void readEffectiveInpageDisplayMode()
            .then((mode) => {
              if (inpageDisplayObservationRevisionRef.current === revision) setInpageDisplayMode(mode);
            })
            .catch(() => {
              if (inpageDisplayObservationRevisionRef.current === revision) setInpageDisplayMode('all');
            });
        }
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'xiaohongshu_comments_capture_enabled')) {
        setXiaohongshuCommentsCaptureEnabled(changes.xiaohongshu_comments_capture_enabled?.newValue === true);
      }
      if (Object.prototype.hasOwnProperty.call(changes, ANTI_HOTLINK_RULES_SETTINGS_STORAGE_KEY)) {
        void loadAntiHotlinkRulesForSettings({ forceRefresh: true })
          .then((rules) => {
            setAntiHotlinkRules(Array.isArray(rules) ? rules : []);
            setAntiHotlinkRuleErrors([]);
          })
          .catch(() => {});
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'notion_oauth_pending_state')) {
        applyNotionPendingStorageObservation(changes.notion_oauth_pending_state?.newValue);
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'notion_oauth_last_error')) {
        applyNotionErrorStorageObservation(changes.notion_oauth_last_error?.newValue);
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'notion_oauth_token_v1')) {
        void refreshNotionAuthFromStorageSignal();
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'feishu_oauth_pending_state')) {
        applyFeishuPendingStorageObservation(changes.feishu_oauth_pending_state?.newValue);
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'feishu_oauth_last_error')) {
        applyFeishuErrorStorageObservation(changes.feishu_oauth_last_error?.newValue);
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'feishu_oauth_token_v1')) {
        void refreshFeishuAuthFromStorageSignal();
      }

      if (Object.prototype.hasOwnProperty.call(changes, FEISHU_STORAGE_KEYS.chatFolder)) {
        const nextValue = changes[FEISHU_STORAGE_KEYS.chatFolder]?.newValue;
        setFeishuChatFolder(normalizeFeishuFolderPath(nextValue, FEISHU_DEFAULTS.chatFolder));
      }
      if (Object.prototype.hasOwnProperty.call(changes, FEISHU_STORAGE_KEYS.articleFolder)) {
        const nextValue = changes[FEISHU_STORAGE_KEYS.articleFolder]?.newValue;
        setFeishuArticleFolder(normalizeFeishuFolderPath(nextValue, FEISHU_DEFAULTS.articleFolder));
      }
      if (Object.prototype.hasOwnProperty.call(changes, FEISHU_STORAGE_KEYS.videoFolder)) {
        const nextValue = changes[FEISHU_STORAGE_KEYS.videoFolder]?.newValue;
        setFeishuVideoFolder(normalizeFeishuFolderPath(nextValue, FEISHU_DEFAULTS.videoFolder));
      }
    });
  }, [
    applyFeishuErrorStorageObservation,
    applyFeishuPendingStorageObservation,
    applyNotionErrorStorageObservation,
    applyNotionPendingStorageObservation,
    refreshFeishuAuthFromStorageSignal,
    refreshGithubAuthFromStorageSignal,
    refreshNotionAuthFromStorageSignal,
  ]);

  useEffect(() => {
    void runTask(refreshInternal);
  }, [refreshInternal, runTask]);

  const onSaveFeishuPaths = useCallback(async () => {
    if (busy) return;

    await runTask(
      async () => {
        const next = await saveFeishuPathConfig({
          chatFolder: feishuChatFolder,
          articleFolder: feishuArticleFolder,
          videoFolder: feishuVideoFolder,
        });
        setFeishuChatFolder(String(next.chatFolder || FEISHU_DEFAULTS.chatFolder));
        setFeishuArticleFolder(String(next.articleFolder || FEISHU_DEFAULTS.articleFolder));
        setFeishuVideoFolder(String(next.videoFolder || FEISHU_DEFAULTS.videoFolder));
      },
      { fallbackMessage: 'save feishu paths failed' },
    );
  }, [busy, feishuArticleFolder, feishuChatFolder, feishuVideoFolder, runTask]);

  useEffect(() => {
    if (!pollingNotion) return;
    if (notionConnected || notionLastError || !notionPendingState) {
      setNotionPollingState(false);
      return;
    }
    const timer = setTimeout(() => setNotionPollingState(false), 60_000);
    return () => clearTimeout(timer);
  }, [notionConnected, notionLastError, notionPendingState, pollingNotion, setNotionPollingState]);

  useEffect(() => {
    if (!pollingFeishu) return;
    if (feishuConnected || feishuLastError || !feishuPendingState) {
      setFeishuPollingState(false);
      return;
    }
    const timer = setTimeout(() => setFeishuPollingState(false), 60_000);
    return () => clearTimeout(timer);
  }, [feishuConnected, feishuLastError, feishuPendingState, pollingFeishu, setFeishuPollingState]);

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
    if (notionConnectedRef.current !== true && notionPollingRef.current) return;

    await runTask(async () => {
      if (notionConnectedRef.current !== true && notionPollingRef.current) return;
      const status = await readNotionAuthStatus();
      if (!status) return;

      if (status.connected === true) {
        unwrap(await send<ApiResponse<{ disconnected: boolean }>>(NOTION_MESSAGE_TYPES.DISCONNECT, {}));
        notionAuthObservationRevisionRef.current += 1;
        notionStartGenerationRef.current += 1;
        applyNotionAuthStatus({ connected: false, workspaceName: '' });
        notionPendingStateRef.current = '';
        notionLastErrorRef.current = '';
        setNotionPendingState('');
        setNotionLastError('');
        setNotionPages([]);
        setNotionParentPageId('');
        setNotionParentPageTitle('');
        setNotionPollingState(false);
        setLoadingNotionPages(false);
        return;
      }
      if (notionPollingRef.current) return;

      const requestGeneration = notionStartGenerationRef.current + 1;
      notionStartGenerationRef.current = requestGeneration;
      const pendingObservationRevisionAtStart = notionPendingObservationRevisionRef.current;
      const started = unwrap(await send<ApiResponse<{ state: string }>>(NOTION_MESSAGE_TYPES.START_AUTH, {}));
      const state = String(started?.state || '').trim();
      if (!state) throw new Error('notion oauth start returned invalid state');
      if (notionStartGenerationRef.current !== requestGeneration) return;
      if (
        notionPendingObservationRevisionRef.current !== pendingObservationRevisionAtStart &&
        notionPendingStateRef.current !== state
      ) {
        return;
      }

      notionAuthObservationRevisionRef.current += 1;
      notionPendingStateRef.current = state;
      notionLastErrorRef.current = '';
      setNotionPendingState(state);
      setNotionLastError('');
      setNotionPollingState(true);
    });
  }, [applyNotionAuthStatus, readNotionAuthStatus, runTask, setNotionPollingState]);

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

  const onToggleNotionAutoSyncEnabled = useCallback(
    async (enabled: boolean) => {
      await runTask(
        async () => {
          await storageSet({ [NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY]: enabled });
          setNotionAutoSyncEnabled(enabled);
        },
        { fallbackMessage: 'save notion auto sync enabled failed' },
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

  const onToggleObsidianAutoSyncEnabled = useCallback(
    async (enabled: boolean) => {
      await runTask(
        async () => {
          await storageSet({ [OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY]: enabled });
          setObsidianAutoSyncEnabled(enabled);
        },
        { fallbackMessage: 'save obsidian auto sync enabled failed' },
      );
    },
    [runTask],
  );

  const onToggleFeishuSyncEnabled = useCallback(
    async (enabled: boolean) => {
      await runTask(
        async () => {
          await setSyncProviderEnabled('feishu', enabled);
          setFeishuSyncEnabled(enabled);
        },
        { fallbackMessage: 'save feishu sync enabled failed' },
      );
    },
    [runTask],
  );

  const onToggleFeishuAutoSyncEnabled = useCallback(
    async (enabled: boolean) => {
      await runTask(
        async () => {
          await storageSet({ [FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY]: enabled });
          setFeishuAutoSyncEnabled(enabled);
        },
        { fallbackMessage: 'save feishu auto sync enabled failed' },
      );
    },
    [runTask],
  );

  const onToggleGithubSyncEnabled = useCallback(
    async (enabled: boolean) => {
      await runTask(
        async () => {
          await setSyncProviderEnabled('github', enabled);
          setGithubSyncEnabled(enabled);
        },
        { fallbackMessage: 'save github sync enabled failed' },
      );
    },
    [runTask],
  );

  const onToggleGithubAutoSyncEnabled = useCallback(
    async (enabled: boolean) => {
      await runTask(
        async () => {
          await storageSet({ [GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY]: enabled });
          setGithubAutoSyncEnabled(enabled);
        },
        { fallbackMessage: 'save github auto sync enabled failed' },
      );
    },
    [runTask],
  );

  const onGithubConnect = useCallback(async () => {
    await runTask(
      async () => {
        const data = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.START_DEVICE_FLOW, {}));
        applyGithubAuth(data?.auth);
      },
      { fallbackMessage: 'github_device_start_failed' },
    );
  }, [applyGithubAuth, runTask]);

  const pollGithubDeviceFlow = useCallback(() => {
    if (githubDevicePollInFlightRef.current) return githubDevicePollInFlightRef.current;

    const poll = (async () => {
      try {
        const data = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW, {}));
        applyGithubAuth(data?.auth);
      } catch (error) {
        // A failed poll may still advance nextPollAt or clear a terminal flow. Rehydrate the safe durable state
        // before surfacing the original error so every later timer/lifecycle reconcile follows canonical timing.
        try {
          const requestSeq = githubAuthRequestSeqRef.current + 1;
          githubAuthRequestSeqRef.current = requestSeq;
          const snapshot = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.GET_SETTINGS, {}));
          applyGithubAuth(snapshot?.auth, requestSeq);
        } catch (_refreshError) {
          // GET_SETTINGS is recovery only; do not replace the original poll failure.
        }
        setError(toErrorMessage(error, 'github_device_poll_failed'));
      }
    })().finally(() => {
      if (githubDevicePollInFlightRef.current === poll) githubDevicePollInFlightRef.current = null;
    });

    githubDevicePollInFlightRef.current = poll;
    return poll;
  }, [applyGithubAuth]);

  useEffect(() => {
    if (githubAuth.state !== 'pending') return;
    const delay = Math.max(0, githubAuth.nextPollAt - Date.now());
    const timer = setTimeout(() => {
      void pollGithubDeviceFlow();
    }, delay);
    return () => clearTimeout(timer);
  }, [githubAuth, pollGithubDeviceFlow]);

  useEffect(() => {
    if (githubAuth.state !== 'pending') return;

    const reconcileIfDue = () => {
      if (globalThis.document?.visibilityState === 'hidden') return;
      if (Date.now() < githubAuth.nextPollAt) return;
      void pollGithubDeviceFlow();
    };
    const onVisibilityChange = () => {
      if (globalThis.document?.visibilityState !== 'hidden') reconcileIfDue();
    };

    const documentLike = globalThis.document;
    const windowLike = globalThis.window;
    documentLike?.addEventListener('visibilitychange', onVisibilityChange);
    windowLike?.addEventListener('focus', reconcileIfDue);
    windowLike?.addEventListener('pageshow', reconcileIfDue);
    return () => {
      documentLike?.removeEventListener('visibilitychange', onVisibilityChange);
      windowLike?.removeEventListener('focus', reconcileIfDue);
      windowLike?.removeEventListener('pageshow', reconcileIfDue);
    };
  }, [githubAuth, pollGithubDeviceFlow]);

  const onCancelGithubDeviceFlow = useCallback(async () => {
    await runTask(
      async () => {
        const data = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.CANCEL_DEVICE_FLOW, {}));
        applyGithubAuth(data?.auth);
      },
      { fallbackMessage: 'github_device_cancel_failed' },
    );
  }, [applyGithubAuth, runTask]);

  const onDisconnectGithub = useCallback(async () => {
    await runTask(
      async () => {
        const data = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.DISCONNECT, {}));
        applyGithubAuth(data?.auth ?? { state: 'disconnected' });
        setGithubConnectionTest({ status: 'idle' });
      },
      { fallbackMessage: 'github_disconnect_failed' },
    );
  }, [applyGithubAuth, runTask]);

  const onRefreshGithubRepositories = useCallback(async () => {
    await runGithubRepositoryDiscovery();
  }, [runGithubRepositoryDiscovery]);

  const onChangeGithubRepository = useCallback(
    async (value: string) => {
      const next = String(value || '').trim();
      const current = String(githubRepository || '').trim();
      const allowed = githubRepositories.some(
        (repository) => repository.fullName === next && repository.contentWriteCapable,
      );
      if (!next || (next !== current && !allowed)) return;

      await runTask(
        async () => {
          const data = unwrap(
            await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.SAVE_SETTINGS, {
              repository: next,
            }),
          );
          const settings = data?.settings || {};
          applyGithubTargetSettings(settings);
          setGithubConnectionTest({ status: 'idle' });
        },
        { fallbackMessage: 'github_settings_save_failed' },
      );
    },
    [applyGithubTargetSettings, githubRepositories, githubRepository, runTask],
  );

  const onChangeGithubBranch = useCallback((value: string) => {
    setGithubBranch(value);
    setGithubConnectionTest({ status: 'idle' });
  }, []);

  const onSaveGithubBranch = useCallback(async () => {
    const saved = await runTask(
      async () => {
        const data = unwrap(
          await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.SAVE_SETTINGS, {
            branch: githubBranch,
          }),
        );
        applyGithubTargetSettings(data?.settings || {});
        setGithubConnectionTest({ status: 'idle' });
      },
      { fallbackMessage: 'github_settings_save_failed' },
    );
    if (saved) return;

    try {
      const snapshot = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.GET_SETTINGS, {}));
      applyGithubTargetSettings(snapshot?.settings || {});
    } catch (_error) {
      setGithubBranch(githubPersistedBranchRef.current);
    }
    setGithubConnectionTest({ status: 'idle' });
  }, [applyGithubTargetSettings, githubBranch, runTask]);

  const onTestGithubConnection = useCallback(async () => {
    setGithubConnectionTest({ status: 'testing' });
    await runTask(
      async () => {
        const data = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.TEST_CONNECTION, {}));
        setGithubConnectionTest({ status: 'success', target: normalizeGithubConnectionTarget(data?.target) });
      },
      {
        fallbackMessage: 'github_connection_test_failed',
        onError: (message) => {
          if (message === 'github_repository_uninitialized') {
            setError(null);
            setGithubConnectionTest({ status: 'uninitialized' });
            return;
          }
          setGithubConnectionTest({ status: 'error', error: message });
        },
      },
    );
  }, [runTask]);

  const onInitializeGithubRepository = useCallback(async () => {
    setGithubConnectionTest({ status: 'initializing' });
    await runTask(
      async () => {
        const data = unwrap(await send<ApiResponse<any>>(GITHUB_MESSAGE_TYPES.INITIALIZE_REPOSITORY, {}));
        setGithubConnectionTest({ status: 'success', target: normalizeGithubConnectionTarget(data?.target) });
      },
      {
        fallbackMessage: 'github_repository_initialize_failed',
        onError: (message) => setGithubConnectionTest({ status: 'error', error: message }),
      },
    );
  }, [runTask]);

  const githubTargetUnavailable = useMemo(() => {
    const selected = String(githubRepository || '')
      .trim()
      .toLowerCase();
    if (!selected || githubAuth.state !== 'connected' || githubRepositoryStatus == null) return false;
    if (githubRepositoryStatus !== 'ready') return true;
    const target = githubRepositories.find((repository) => repository.fullName.toLowerCase() === selected);
    return !target?.contentWriteCapable;
  }, [githubAuth.state, githubRepositories, githubRepository, githubRepositoryStatus]);

  const onSaveFeishuAdvancedSettings = useCallback(async () => {
    await runTask(
      async () => {
        const saved = unwrap(
          await send<ApiResponse<any>>(FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG, {
            clientId: feishuClientId,
            clientSecret: feishuClientSecret,
            tokenExchangeProxyUrl: feishuTokenExchangeProxyUrl,
          }),
        );
        setFeishuTokenExchangeProxyUrl(String(saved?.tokenExchangeProxyUrl || ''));
        setFeishuClientId(String(saved?.clientId || ''));
        setFeishuClientSecret(String(feishuClientSecret || '').trim());
      },
      { fallbackMessage: 'save feishu settings failed' },
    );
  }, [feishuClientId, feishuClientSecret, feishuTokenExchangeProxyUrl, runTask]);

  const onFeishuConnectOrDisconnect = useCallback(async () => {
    if (feishuConnectedRef.current !== true && feishuPollingRef.current) return;

    await runTask(async () => {
      if (feishuConnectedRef.current !== true && feishuPollingRef.current) return;
      const status = await readFeishuAuthStatus();
      if (!status) return;

      if (status.connected === true) {
        unwrap(await send<ApiResponse<{ disconnected: boolean }>>(FEISHU_MESSAGE_TYPES.DISCONNECT, {}));
        feishuAuthObservationRevisionRef.current += 1;
        feishuStartGenerationRef.current += 1;
        applyFeishuAuthStatus({ connected: false });
        feishuPendingStateRef.current = '';
        feishuLastErrorRef.current = '';
        setFeishuPendingState('');
        setFeishuLastError('');
        setFeishuPollingState(false);
        return;
      }
      if (feishuPollingRef.current) return;

      const requestGeneration = feishuStartGenerationRef.current + 1;
      feishuStartGenerationRef.current = requestGeneration;
      const pendingObservationRevisionAtStart = feishuPendingObservationRevisionRef.current;
      const started = unwrap(
        await send<ApiResponse<{ state: string }>>(FEISHU_MESSAGE_TYPES.START_AUTH, {
          clientId: feishuClientId,
          clientSecret: feishuClientSecret,
          tokenExchangeProxyUrl: feishuTokenExchangeProxyUrl,
        }),
      );
      const state = String(started?.state || '').trim();
      if (!state) throw new Error('feishu oauth start returned invalid state');
      if (feishuStartGenerationRef.current !== requestGeneration) return;
      if (
        feishuPendingObservationRevisionRef.current !== pendingObservationRevisionAtStart &&
        feishuPendingStateRef.current !== state
      ) {
        return;
      }

      feishuAuthObservationRevisionRef.current += 1;
      feishuPendingStateRef.current = state;
      feishuLastErrorRef.current = '';
      setFeishuPendingState(state);
      setFeishuLastError('');
      setFeishuPollingState(true);
    });
  }, [
    applyFeishuAuthStatus,
    feishuClientId,
    feishuClientSecret,
    feishuTokenExchangeProxyUrl,
    readFeishuAuthStatus,
    runTask,
    setFeishuPollingState,
  ]);

  const feishuStatusText = useMemo(() => {
    if (feishuConnected == null) return t('statusUnknown');
    if (feishuConnected) return `${t('statusConnected')} ✅`;
    if (feishuLastError) return t('statusError');
    if (feishuPendingState) return t('statusWaiting');
    return t('statusNotConnected');
  }, [feishuConnected, feishuLastError, feishuPendingState]);

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

  const onToggleNotionAdvancedOpen = useCallback(() => {
    setNotionAdvancedOpen((prev) => !prev);
  }, []);

  const onSaveNotionDatabaseId = useCallback(
    async (kind: 'chat' | 'article' | 'video') => {
      const spec = kind === 'chat' ? chatDbSpec : kind === 'article' ? articleDbSpec : videoDbSpec;
      const raw =
        kind === 'chat' ? notionChatDatabaseId : kind === 'article' ? notionArticleDatabaseId : notionVideoDatabaseId;
      const next = normalizeNotionDatabaseIdInput(String(raw || ''));

      await runTask(
        async () => {
          await storageSet({ [spec.storageKey]: next });
          if (kind === 'chat') setNotionChatDatabaseId(next);
          else if (kind === 'article') setNotionArticleDatabaseId(next);
          else setNotionVideoDatabaseId(next);
        },
        { fallbackMessage: 'save notion database id failed' },
      );
    },
    [
      articleDbSpec,
      chatDbSpec,
      notionArticleDatabaseId,
      notionChatDatabaseId,
      notionVideoDatabaseId,
      runTask,
      videoDbSpec,
    ],
  );

  const onResetNotionDatabaseId = useCallback(
    async (kind: 'chat' | 'article' | 'video') => {
      const spec = kind === 'chat' ? chatDbSpec : kind === 'article' ? articleDbSpec : videoDbSpec;

      await runTask(
        async () => {
          await storageRemove([spec.storageKey]);
          if (kind === 'chat') setNotionChatDatabaseId('');
          else if (kind === 'article') setNotionArticleDatabaseId('');
          else setNotionVideoDatabaseId('');
        },
        { fallbackMessage: 'reset notion database id failed' },
      );
    },
    [articleDbSpec, chatDbSpec, runTask, videoDbSpec],
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
            videoFolder: obsidianVideoFolder,
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
          setObsidianVideoFolder(String(data?.videoFolder || ''));
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
      obsidianVideoFolder,
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
        const revision = inpageDisplayObservationRevisionRef.current;
        const response = unwrap(
          await send<ApiResponse<{ mode: InpageDisplayMode }>>(INPAGE_MESSAGE_TYPES.SET_DISPLAY_MODE, { mode: next }),
        );
        const mode = normalizeInpageDisplayMode(response?.mode);
        if (!mode) throw new Error('invalid inpage display mode response');
        if (inpageDisplayObservationRevisionRef.current !== revision) return;
        inpageDisplayObservationRevisionRef.current += 1;
        setInpageDisplayMode(mode);
      });
    },
    [runTask],
  );

  const onChangeLocalePreference = useCallback(
    async (next: LocalePreference) => {
      await runTask(async () => {
        const preference = await saveLocalePreference(next);
        setLocalePreference(preference);
        globalThis.location?.reload();
      });
    },
    [runTask],
  );

  const onToggleAiChatAutoSaveEnabled = useCallback(
    async (next: boolean) => {
      await runTask(async () => {
        const revision = aiChatAutoSaveObservationRevisionRef.current;
        const normalized = next === true;
        await storageSet({ ai_chat_auto_save_enabled: normalized });
        if (aiChatAutoSaveObservationRevisionRef.current !== revision) return;
        aiChatAutoSaveObservationRevisionRef.current += 1;
        setAiChatAutoSaveEnabled(normalized);
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

  const onToggleXiaohongshuCommentsCaptureEnabled = useCallback(
    async (next: boolean) => {
      await runTask(async () => {
        await storageSet({ xiaohongshu_comments_capture_enabled: next === true });
        setXiaohongshuCommentsCaptureEnabled(next === true);
      });
    },
    [runTask],
  );

  const onToggleAntiHotlinkAdvancedOpen = useCallback(() => {
    setAntiHotlinkAdvancedOpen((open) => !open);
  }, []);

  const onChangeAntiHotlinkRule = useCallback((index: number, patch: Partial<AntiHotlinkRuleDraft>) => {
    setAntiHotlinkRules((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (index < 0 || index >= list.length) return list;
      return list.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return {
          domain: patch.domain == null ? String(row.domain || '') : String(patch.domain),
          referer: patch.referer == null ? String(row.referer || '') : String(patch.referer),
        };
      });
    });
    setAntiHotlinkRuleErrors((prev) => {
      const next = Array.isArray(prev) ? prev.slice() : [];
      if (index < 0 || index >= next.length) return next;
      const row = { ...(next[index] || {}) };
      if (Object.prototype.hasOwnProperty.call(patch, 'domain')) delete row.domain;
      if (Object.prototype.hasOwnProperty.call(patch, 'referer')) delete row.referer;
      next[index] = row;
      return next;
    });
  }, []);

  const onAddAntiHotlinkRule = useCallback(() => {
    setAntiHotlinkRules((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.concat([{ domain: '', referer: 'https://' }]);
    });
    setAntiHotlinkRuleErrors((prev) => {
      const list = Array.isArray(prev) ? prev.slice() : [];
      list.push({});
      return list;
    });
  }, []);

  const onRemoveAntiHotlinkRule = useCallback((index: number) => {
    setAntiHotlinkRules((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (index < 0 || index >= list.length) return list;
      return list.filter((_, rowIndex) => rowIndex !== index);
    });
    setAntiHotlinkRuleErrors((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (index < 0 || index >= list.length) return list;
      return list.filter((_, rowIndex) => rowIndex !== index);
    });
  }, []);

  const onApplyAntiHotlinkRules = useCallback(async () => {
    await runTask(
      async () => {
        const result = await saveAntiHotlinkRulesForSettings(antiHotlinkRules);
        if (!result.ok) {
          setAntiHotlinkRuleErrors(mapAntiHotlinkValidationIssuesToRowErrors(result.issues));
          return;
        }
        setAntiHotlinkRules(
          result.rules.map((rule) => ({
            domain: String(rule.domain || ''),
            referer: String(rule.referer || ''),
          })),
        );
        setAntiHotlinkRuleErrors([]);
      },
      {
        useBusy: false,
        clearError: false,
        fallbackMessage: 'save anti-hotlink rules failed',
      },
    );
  }, [antiHotlinkRules, runTask]);

  const onResetAntiHotlinkRules = useCallback(async () => {
    await runTask(
      async () => {
        const resetRules = await resetAntiHotlinkRulesForSettings();
        setAntiHotlinkRules(resetRules);
        setAntiHotlinkRuleErrors([]);
      },
      {
        useBusy: false,
        clearError: false,
        fallbackMessage: 'reset anti-hotlink rules failed',
      },
    );
  }, [runTask]);

  const onToggleAiChatDollarMentionEnabled = useCallback(
    async (next: boolean) => {
      await runTask(async () => {
        const revision = aiChatDollarMentionObservationRevisionRef.current;
        const normalized = next === true;
        await storageSet({ ai_chat_dollar_mention_enabled: normalized });
        if (aiChatDollarMentionObservationRevisionRef.current !== revision) return;
        aiChatDollarMentionObservationRevisionRef.current += 1;
        setAiChatDollarMentionEnabled(normalized);
      });
    },
    [runTask],
  );

  const startInsightSourceRead = useCallback(() => {
    if (
      insightDisposedRef.current ||
      activeSectionRef.current !== 'aboutyou' ||
      !insightReadinessSettledRef.current ||
      !insightSourceStaleRef.current ||
      insightSourceReadInFlightRef.current
    ) {
      return;
    }

    const sourceGeneration = insightSourceRevisionGenerationRef.current;
    const activationGeneration = insightActivationGenerationRef.current;
    const retryScopes = insightStaleScopesRef.current.size
      ? Array.from(insightStaleScopesRef.current)
      : [...INSIGHT_REVISION_SCOPES];
    insightSourceReadInFlightRef.current = true;
    setInsightLoadStatus('loading');
    setInsightError('');

    void getInsightStatsSourceData()
      .then((data) => {
        if (
          insightDisposedRef.current ||
          activeSectionRef.current !== 'aboutyou' ||
          sourceGeneration !== insightSourceRevisionGenerationRef.current ||
          activationGeneration !== insightActivationGenerationRef.current
        ) {
          return;
        }

        const rangeWindow = getInsightTimeRangeWindow(insightRangeRef.current);
        const nextStats = buildInsightStats(data, rangeWindow);
        insightSourceDataRef.current = data;
        insightSourceStaleRef.current = false;
        insightStaleScopesRef.current.clear();
        setInsightStats(nextStats);
        setInsightError('');
        setInsightLoadStatus('ready');
      })
      .catch((error) => {
        if (
          insightDisposedRef.current ||
          activeSectionRef.current !== 'aboutyou' ||
          sourceGeneration !== insightSourceRevisionGenerationRef.current ||
          activationGeneration !== insightActivationGenerationRef.current
        ) {
          return;
        }

        setInsightError(toErrorMessage(error, t('insightLoadFailed')));
        setInsightLoadStatus('error');
        requestDataRevisionRetry(retryScopes);
      })
      .finally(() => {
        insightSourceReadInFlightRef.current = false;
        if (insightDisposedRef.current) return;
        const becameStaleDuringRead = sourceGeneration !== insightSourceRevisionGenerationRef.current;
        const activationChangedDuringRead = activationGeneration !== insightActivationGenerationRef.current;
        if (
          (becameStaleDuringRead || activationChangedDuringRead) &&
          activeSectionRef.current === 'aboutyou' &&
          insightReadinessSettledRef.current &&
          insightSourceStaleRef.current
        ) {
          void Promise.resolve().then(() => startInsightSourceReadRef.current());
        }
      });
  }, []);
  startInsightSourceReadRef.current = startInsightSourceRead;

  useEffect(() => {
    insightDisposedRef.current = false;
    const unsubscribe = subscribeDataRevisionChanges((scopes) => {
      const relevantScopes = INSIGHT_REVISION_SCOPES.filter((scope) => scopes.includes(scope));
      if (!relevantScopes.length || insightDisposedRef.current) return;

      insightSourceRevisionGenerationRef.current += 1;
      insightSourceStaleRef.current = true;
      for (const scope of relevantScopes) insightStaleScopesRef.current.add(scope);
      startInsightSourceReadRef.current();
    });

    void whenDataRevisionObserverReady().then(() => {
      if (insightDisposedRef.current) return;
      insightReadinessSettledRef.current = true;
      startInsightSourceReadRef.current();
    });

    return () => {
      insightDisposedRef.current = true;
      insightActivationGenerationRef.current += 1;
      insightSourceRevisionGenerationRef.current += 1;
      insightReadinessSettledRef.current = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (insightObservedSectionRef.current !== activeSection) {
      insightObservedSectionRef.current = activeSection;
      insightActivationGenerationRef.current += 1;
    }
    if (activeSection !== 'aboutyou') return;
    startInsightSourceReadRef.current();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'aboutyou') return;
    const data = insightSourceDataRef.current;
    if (!data || insightSourceStaleRef.current) return;

    const rangeWindow = getInsightTimeRangeWindow(insightRange);
    setInsightStats(buildInsightStats(data, rangeWindow));
  }, [activeSection, insightRange]);

  const handleBackupExport = useCallback(async () => {
    if (busy) return;

    setExportStatus(t('backupExporting'));
    await runTask(
      async () => {
        // Show coarse-grained progress. Export uses `zipSync()` (CSP-safe on Firefox),
        // so the UI cannot update continuously while the synchronous zip step is running.
        const stageLabel = (stage: string) => {
          switch (stage) {
            case 'open_db':
              return '1/6';
            case 'read_db':
              return '2/6';
            case 'read_storage':
              return '3/6';
            case 'assemble_files':
              return '4/6';
            case 'zip':
              return '5/6';
            case 'finalize':
              return '6/6';
            default:
              return '';
          }
        };

        // Ensure status paint happens before the potentially long synchronous zip step.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const result = await exportBackupZipV2({
          onProgress: ({ stage }) => {
            const label = stageLabel(stage);
            if (label) setExportStatus(`${t('backupExporting')} (${label})`);
          },
        });
        downloadBlobFile(result.blob, result.filename);

        setExportStatus(
          `${t('backupExported')} (${t('statsConversations')} ${result.counts.conversations}, ${t('statsMessages')} ${result.counts.messages}, ${t('statsComments')} ${result.counts.article_comments})`,
        );
        setLastBackupExportAt(Date.parse(result.exportedAt) || Date.now());
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

  const guideLocale = getCurrentLocale();
  const obsidianSetupGuideUrl =
    guideLocale === 'zh'
      ? 'https://github.com/chiimagnus/SyncNos/blob/main/docs/guide/obsidian/LocalRestAPI.zh.md'
      : 'https://github.com/chiimagnus/SyncNos/blob/main/docs/guide/obsidian/LocalRestAPI.en.md';
  const feishuSetupGuideUrl =
    guideLocale === 'zh'
      ? 'https://github.com/chiimagnus/SyncNos/blob/main/docs/guide/feishu/DocxSync.zh.md'
      : 'https://github.com/chiimagnus/SyncNos/blob/main/docs/guide/feishu/DocxSync.en.md';

  const onOpenObsidianSetupGuide = useCallback(() => {
    openHttpUrl(obsidianSetupGuideUrl);
  }, [obsidianSetupGuideUrl]);

  const onOpenFeishuSetupGuide = useCallback(() => {
    openHttpUrl(feishuSetupGuideUrl);
  }, [feishuSetupGuideUrl]);

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

  const onChangeAboutYouUserName = useCallback((next: string) => {
    setAboutYouUserName(normalizeUserName(next));
  }, []);

  const onSaveAboutYouUserName = useCallback(async () => {
    const value = normalizeUserName(aboutYouUserName);
    await runTask(
      async () => {
        await storageSet({ [ABOUT_YOU_USER_NAME_STORAGE_KEY]: value });
        setAboutYouUserName(value);
      },
      { useBusy: false, clearError: false, fallbackMessage: 'save user name failed' },
    );
  }, [aboutYouUserName, runTask]);

  return {
    busy,
    error,
    clearError,

    notionSyncEnabled,
    onToggleNotionSyncEnabled,
    notionAutoSyncEnabled,
    onToggleNotionAutoSyncEnabled,

    notionConnected,
    pollingNotion,
    loadingNotionPages,
    notionAdvancedOpen,
    onToggleNotionAdvancedOpen,
    notionChatDatabaseId,
    setNotionChatDatabaseId,
    notionArticleDatabaseId,
    setNotionArticleDatabaseId,
    notionVideoDatabaseId,
    setNotionVideoDatabaseId,
    notionChatDatabaseLabel: chatDbSpec.title,
    notionArticleDatabaseLabel: articleDbSpec.title,
    notionVideoDatabaseLabel: videoDbSpec.title,
    onSaveNotionDatabaseId,
    onResetNotionDatabaseId,
    notionParentPageId,
    notionPageOptions,
    notionStatusText,
    onNotionConnectOrDisconnect,
    onSaveNotionParentPage,
    onLoadNotionPages,

    feishuSyncEnabled,
    onToggleFeishuSyncEnabled,
    feishuAutoSyncEnabled,
    onToggleFeishuAutoSyncEnabled,

    feishuConnected,
    pollingFeishu,
    feishuPendingState,
    feishuLastError,
    feishuClientId,
    setFeishuClientId,
    feishuClientSecret,
    setFeishuClientSecret,
    feishuTokenExchangeProxyUrl,
    setFeishuTokenExchangeProxyUrl,
    feishuChatFolder,
    setFeishuChatFolder,
    feishuArticleFolder,
    setFeishuArticleFolder,
    feishuVideoFolder,
    setFeishuVideoFolder,
    feishuStatusText,
    onSaveFeishuPaths,
    onSaveFeishuAdvancedSettings,
    onFeishuConnectOrDisconnect,
    onOpenFeishuSetupGuide,
    feishuSetupGuideUrl,

    obsidianSyncEnabled,
    onToggleObsidianSyncEnabled,
    obsidianAutoSyncEnabled,
    onToggleObsidianAutoSyncEnabled,

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
    obsidianVideoFolder,
    setObsidianVideoFolder,
    obsidianStatus,
    onSaveObsidianSettings,
    onTestObsidianConnection,
    onOpenObsidianSetupGuide,
    obsidianSetupGuideUrl,

    githubAuth,
    githubAccount,
    githubRepositoryStatus,
    githubRepositories,
    githubRepositoriesLoading,
    githubRepositoryDiscoveryError,
    githubTargetUnavailable,
    githubRepository,
    onChangeGithubRepository,
    githubBranch,
    onChangeGithubBranch,
    githubVerificationUrl,
    githubAppUrl,
    githubInstallUrl,
    githubSyncEnabled,
    onToggleGithubSyncEnabled,
    githubAutoSyncEnabled,
    onToggleGithubAutoSyncEnabled,
    githubConnectionTest,
    onGithubConnect,
    onCancelGithubDeviceFlow,
    onDisconnectGithub,
    onRefreshGithubRepositories,
    onSaveGithubBranch,
    onTestGithubConnection,
    onInitializeGithubRepository,

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
    localePreference,
    onChangeLocalePreference,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    aiChatCacheImagesEnabled,
    onToggleAiChatCacheImagesEnabled,
    webArticleCacheImagesEnabled,
    onToggleWebArticleCacheImagesEnabled,
    xiaohongshuCommentsCaptureEnabled,
    onToggleXiaohongshuCommentsCaptureEnabled,
    antiHotlinkAdvancedOpen,
    onToggleAntiHotlinkAdvancedOpen,
    antiHotlinkRules,
    antiHotlinkRuleErrors,
    onChangeAntiHotlinkRule,
    onAddAntiHotlinkRule,
    onRemoveAntiHotlinkRule,
    onApplyAntiHotlinkRules,
    onResetAntiHotlinkRules,
    aiChatDollarMentionEnabled,
    onToggleAiChatDollarMentionEnabled,
    insightStats,
    insightLoadStatus,
    insightError,
    insightRange,
    setInsightRange,
    aboutYouUserName,
    onChangeAboutYouUserName,
    onSaveAboutYouUserName,
  };
}
