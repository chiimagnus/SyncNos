import { GITHUB_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  cancelDeviceFlow,
  pollDeviceFlowOnce,
  startDeviceFlow,
} from '@services/sync/github/auth/device-flow';
import {
  clearGithubAuthState,
  getGithubSafeAuthSummary,
  type GithubSafeAuthSummary,
} from '@services/sync/github/auth/auth-store';
import { GITHUB_APP_CONFIG } from '@services/sync/github/github-app-config';
import {
  discoverGithubRepositories,
  preflightGithubRepository,
  type GithubRepositoryDiscovery,
  type GithubRepositoryPreflight,
} from '@services/sync/github/github-repository-service';
import {
  getGithubSettings,
  saveGithubSettings,
  type GithubSettings,
  type GithubSettingsField,
} from '@services/sync/github/settings-store';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

export type GithubSettingsHandlersDeps = {
  getSettings: typeof getGithubSettings;
  saveSettings: typeof saveGithubSettings;
  getSafeAuthSummary: typeof getGithubSafeAuthSummary;
  startDeviceFlow: typeof startDeviceFlow;
  pollDeviceFlowOnce: typeof pollDeviceFlowOnce;
  cancelDeviceFlow: typeof cancelDeviceFlow;
  clearAuthState: typeof clearGithubAuthState;
  discoverRepositories: typeof discoverGithubRepositories;
  preflightRepository: typeof preflightGithubRepository;
};

const DEFAULT_DEPS: GithubSettingsHandlersDeps = {
  getSettings: getGithubSettings,
  saveSettings: saveGithubSettings,
  getSafeAuthSummary: getGithubSafeAuthSummary,
  startDeviceFlow,
  pollDeviceFlowOnce,
  cancelDeviceFlow,
  clearAuthState: clearGithubAuthState,
  discoverRepositories: discoverGithubRepositories,
  preflightRepository: preflightGithubRepository,
};

const SETTINGS_FIELDS = new Set<GithubSettingsField>([
  'repository',
  'branch',
  'chatFolder',
  'articleFolder',
  'videoFolder',
]);

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeAuthDto(value: GithubSafeAuthSummary | unknown) {
  const state = safeString((value as any)?.state);
  if (state === 'disconnected' || state === 'connected') return { state } as const;
  if (state !== 'pending') throw Object.assign(new Error('github_auth_summary_invalid'), { code: 'github_auth_summary_invalid' });

  const userCode = safeString((value as any)?.userCode);
  const verificationUri = safeString((value as any)?.verificationUri);
  const expiresAt = safeTimestamp((value as any)?.expiresAt);
  const nextPollAt = safeTimestamp((value as any)?.nextPollAt);
  if (
    !userCode ||
    verificationUri !== GITHUB_APP_CONFIG.deviceVerificationUrl ||
    expiresAt == null ||
    nextPollAt == null
  ) {
    throw Object.assign(new Error('github_auth_summary_invalid'), { code: 'github_auth_summary_invalid' });
  }
  return { state: 'pending' as const, userCode, verificationUri, expiresAt, nextPollAt };
}

function safeSettingsDto(value: GithubSettings | any) {
  const defaults = value?.defaults || {};
  return {
    repository: safeString(value?.repository),
    branch: safeString(value?.branch),
    chatFolder: safeString(value?.chatFolder),
    articleFolder: safeString(value?.articleFolder),
    videoFolder: safeString(value?.videoFolder),
    defaults: {
      repository: safeString(defaults.repository),
      branch: safeString(defaults.branch),
      chatFolder: safeString(defaults.chatFolder),
      articleFolder: safeString(defaults.articleFolder),
      videoFolder: safeString(defaults.videoFolder),
    },
  };
}

function safeDiscoveryDto(value: GithubRepositoryDiscovery | any) {
  const status =
    value?.status === 'ready' ||
    value?.status === 'github_app_not_installed' ||
    value?.status === 'github_no_accessible_repositories'
      ? value.status
      : 'github_no_accessible_repositories';
  const account = value?.account
    ? {
        login: safeString(value.account.login),
        avatarUrl: safeString(value.account.avatarUrl),
        url: safeString(value.account.url),
      }
    : null;
  const repositories = (Array.isArray(value?.repositories) ? value.repositories : []).map((repository: any) => ({
    owner: safeString(repository?.owner),
    repo: safeString(repository?.repo),
    fullName: safeString(repository?.fullName),
    private: repository?.private === true,
    installationId:
      typeof repository?.installationId === 'number' && Number.isSafeInteger(repository.installationId) && repository.installationId > 0
        ? repository.installationId
        : 0,
    userPermissions: {
      admin: repository?.userPermissions?.admin === true,
      maintain: repository?.userPermissions?.maintain === true,
      push: repository?.userPermissions?.push === true,
      pull: repository?.userPermissions?.pull === true,
      triage: repository?.userPermissions?.triage === true,
    },
    installationContentsPermission:
      repository?.installationContentsPermission === 'write' || repository?.installationContentsPermission === 'read'
        ? repository.installationContentsPermission
        : 'unknown',
    contentWriteCapable: repository?.contentWriteCapable === true,
  }));
  return {
    status,
    account,
    repositories,
    installUrl: GITHUB_APP_CONFIG.installUrl,
    appUrl: GITHUB_APP_CONFIG.appUrl,
  };
}

function safePreflightDto(value: GithubRepositoryPreflight | any) {
  return {
    repository: safeString(value?.repository),
    branch: safeString(value?.branch),
    remoteKey: safeString(value?.remoteKey),
    installationId:
      typeof value?.installationId === 'number' && Number.isSafeInteger(value.installationId) && value.installationId > 0
        ? value.installationId
        : null,
  };
}

function hasOnlySettingsPayloadFields(message: any): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  return Object.keys(message).every((key) => key === 'type' || SETTINGS_FIELDS.has(key as GithubSettingsField));
}

function safeErrorResponse(router: AnyRouter, error: unknown, fallbackCode: string) {
  const rawCode = safeString((error as any)?.code);
  const code = /^github_[a-z0-9_]+$/.test(rawCode) ? rawCode : fallbackCode;
  const statusValue = Number((error as any)?.status);
  const requestIdValue = safeString((error as any)?.requestId);
  const fieldValue = safeString((error as any)?.field);
  const requestId = /^[A-Za-z0-9_.:-]{1,128}$/.test(requestIdValue) ? requestIdValue : '';
  const field = SETTINGS_FIELDS.has(fieldValue as GithubSettingsField) ? fieldValue : '';
  return router.err(code, {
    code,
    ...(Number.isSafeInteger(statusValue) && statusValue >= 0 ? { status: statusValue } : {}),
    ...(requestId ? { requestId } : {}),
    ...(field ? { field } : {}),
  });
}

export function registerGithubSettingsHandlers(
  router: AnyRouter,
  deps: GithubSettingsHandlersDeps = DEFAULT_DEPS,
) {
  router.register(GITHUB_MESSAGE_TYPES.GET_SETTINGS, async () => {
    try {
      const [settings, auth] = await Promise.all([deps.getSettings(), deps.getSafeAuthSummary()]);
      return router.ok({
        provider: 'github',
        settings: safeSettingsDto(settings),
        auth: safeAuthDto(auth),
        app: {
          verificationUrl: GITHUB_APP_CONFIG.deviceVerificationUrl,
          appUrl: GITHUB_APP_CONFIG.appUrl,
          installUrl: GITHUB_APP_CONFIG.installUrl,
        },
      });
    } catch (error) {
      return safeErrorResponse(router, error, 'github_settings_load_failed');
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.START_DEVICE_FLOW, async () => {
    try {
      return router.ok({ auth: safeAuthDto(await deps.startDeviceFlow()) });
    } catch (error) {
      return safeErrorResponse(router, error, 'github_device_start_failed');
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW, async () => {
    try {
      return router.ok({ auth: safeAuthDto(await deps.pollDeviceFlowOnce()) });
    } catch (error) {
      return safeErrorResponse(router, error, 'github_device_poll_failed');
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.CANCEL_DEVICE_FLOW, async () => {
    try {
      return router.ok({ auth: safeAuthDto(await deps.cancelDeviceFlow()) });
    } catch (error) {
      return safeErrorResponse(router, error, 'github_device_cancel_failed');
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.DISCONNECT, async () => {
    try {
      await deps.clearAuthState();
      return router.ok({
        provider: 'github',
        auth: { state: 'disconnected' },
        disconnectedLocal: true,
      });
    } catch (error) {
      return safeErrorResponse(router, error, 'github_disconnect_failed');
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES, async () => {
    try {
      return router.ok(safeDiscoveryDto(await deps.discoverRepositories()));
    } catch (error) {
      return safeErrorResponse(router, error, 'github_repository_list_failed');
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.SAVE_SETTINGS, async (message) => {
    if (!hasOnlySettingsPayloadFields(message)) {
      return router.err('github_settings_payload_invalid', { code: 'github_settings_payload_invalid' });
    }
    try {
      const settings = await deps.saveSettings({
        ...(message.repository == null ? {} : { repository: message.repository }),
        ...(message.branch == null ? {} : { branch: message.branch }),
        ...(message.chatFolder == null ? {} : { chatFolder: message.chatFolder }),
        ...(message.articleFolder == null ? {} : { articleFolder: message.articleFolder }),
        ...(message.videoFolder == null ? {} : { videoFolder: message.videoFolder }),
      });
      return router.ok({ settings: safeSettingsDto(settings) });
    } catch (error) {
      return safeErrorResponse(router, error, 'github_settings_save_failed');
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.TEST_CONNECTION, async () => {
    try {
      const settings = await deps.getSettings();
      const preflight = await deps.preflightRepository({
        repository: settings.repository,
        branch: settings.branch,
      });
      return router.ok({ ok: true, target: safePreflightDto(preflight) });
    } catch (error) {
      return safeErrorResponse(router, error, 'github_connection_test_failed');
    }
  });
}
