import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GITHUB_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY } from '@services/sync/auto-sync/auto-sync-keys';
import { useSettingsSceneController } from '@viewmodels/settings/useSettingsSceneController';

const runtimeMocks = vi.hoisted(() => ({ send: vi.fn() }));
const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  onChanged: vi.fn(),
}));
const gateMocks = vi.hoisted(() => ({
  setSyncProviderEnabled: vi.fn(),
  syncProviderEnabledStorageKey: vi.fn((id: string) => `webclipper_sync_provider_${id}_enabled`),
}));

vi.mock('@services/shared/runtime', () => ({ send: runtimeMocks.send }));
vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
  storageRemove: storageMocks.remove,
  storageOnChanged: storageMocks.onChanged,
}));
vi.mock('@services/sync/sync-provider-gate', () => ({
  setSyncProviderEnabled: gateMocks.setSyncProviderEnabled,
  syncProviderEnabledStorageKey: gateMocks.syncProviderEnabledStorageKey,
}));
vi.mock('@services/integrations/anti-hotlink/anti-hotlink-settings', () => ({
  ANTI_HOTLINK_RULES_SETTINGS_STORAGE_KEY: 'anti_hotlink_rules_v1',
  getDefaultAntiHotlinkRulesForSettings: () => [],
  loadAntiHotlinkRulesForSettings: async () => [],
  resetAntiHotlinkRulesForSettings: async () => [],
  saveAntiHotlinkRulesForSettings: async () => [],
}));
vi.mock('@services/integrations/chatwith/chatwith-settings', () => ({
  DEFAULT_CHAT_WITH_PLATFORMS: [],
  DEFAULT_CHAT_WITH_PROMPT_TEMPLATE: '',
  loadChatWithSettings: async () => ({ promptTemplate: '', platforms: [] }),
  resetChatWithPlatforms: async () => [],
  saveChatWithSettings: async () => ({ promptTemplate: '', platforms: [] }),
}));
vi.mock('@services/sync/feishu/settings-store', () => ({
  FEISHU_DEFAULTS: { chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' },
  FEISHU_STORAGE_KEYS: {
    chatFolder: 'feishu_chat_folder',
    articleFolder: 'feishu_article_folder',
    videoFolder: 'feishu_video_folder',
  },
  getFeishuPathConfig: async () => ({ chatFolder: 'Chats', articleFolder: 'Articles', videoFolder: 'Videos' }),
  normalizeFeishuFolderPath: (value: unknown, fallback: string) => String(value || fallback),
  saveFeishuPathConfig: async (value: any) => value,
}));
vi.mock('@i18n', () => ({
  getCurrentLocale: () => 'en',
  getLocalePreference: () => 'system',
  saveLocalePreference: async (value: any) => value,
  t: (key: string) => key,
}));

type Snapshot = ReturnType<typeof useSettingsSceneController>;
type ApiResponse = { ok: boolean; data: any; error: any };

const ACCESS_TOKEN = 'sentinel_access_token';
const REFRESH_TOKEN = 'sentinel_refresh_token';
const DEVICE_CODE = 'sentinel_device_code';
const GITHUB_PROVIDER_KEY = 'webclipper_sync_provider_github_enabled';

let latestSnapshot: Snapshot | null = null;
let root: ReactDOM.Root | null = null;
let dom: JSDOM | null = null;
let storageState: Record<string, unknown> = {};
let storageListener: ((changes: any, areaName: string) => void) | null = null;
let githubSettingsData: any;
let githubRepositoryData: any;
let startResponse: ApiResponse;
let cancelResponse: ApiResponse;
let disconnectResponse: ApiResponse;
let testConnectionResponse: ApiResponse;
let initializeRepositoryResponse: ApiResponse;
let saveSettingsResponse: ApiResponse | null;
let pollResponses: Array<ApiResponse | (() => ApiResponse)> = [];

const ok = (data: any): ApiResponse => ({ ok: true, data, error: null });
const fail = (message: string, extra: any = null): ApiResponse => ({
  ok: false,
  data: null,
  error: { message, extra },
});

function githubSettings(auth: any, repository = 'owner/repo') {
  return {
    provider: 'github',
    settings: {
      repository,
      branch: 'main',
      defaults: {
        repository: '',
        branch: '',
      },
    },
    auth,
    app: {
      verificationUrl: 'https://github.com/login/device',
      appUrl: 'https://github.com/apps/syncnos',
      installUrl: 'https://github.com/apps/syncnos/installations/new',
    },
  };
}

function readyRepositories(fullNames: string[] = ['owner/repo']) {
  return {
    status: 'ready',
    account: {
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      url: 'https://github.com/octocat',
    },
    repositories: fullNames.map((fullName, index) => {
      const [owner, repo] = fullName.split('/');
      return {
        owner,
        repo,
        fullName,
        private: index % 2 === 0,
        installationId: index + 1,
        userPermissions: { push: true },
        installationContentsPermission: 'write',
        contentWriteCapable: true,
      };
    }),
    appUrl: 'https://github.com/apps/syncnos',
    installUrl: 'https://github.com/apps/syncnos/installations/new',
  };
}

function ControllerHarness() {
  const snapshot = useSettingsSceneController({ activeSection: 'github' });
  useEffect(() => {
    latestSnapshot = snapshot;
  }, [snapshot]);
  return null;
}

function setupDom() {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/settings',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  root = ReactDOM.createRoot(document.getElementById('root')!);
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).location;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  dom?.window.close();
  dom = null;
}

async function flushReact() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

async function renderController() {
  act(() => {
    root!.render(createElement(ControllerHarness));
  });
  await flushReact();
}

async function invoke(action: () => void | Promise<void>) {
  await act(async () => {
    await action();
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

function callCount(type: string) {
  return runtimeMocks.send.mock.calls.filter(([messageType]) => messageType === type).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  latestSnapshot = null;
  storageState = {};
  storageListener = null;
  githubSettingsData = githubSettings({ state: 'disconnected' });
  githubRepositoryData = readyRepositories();
  startResponse = ok({
    auth: {
      state: 'pending',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 60_000,
      nextPollAt: 15_000,
    },
  });
  cancelResponse = ok({ auth: { state: 'disconnected' } });
  disconnectResponse = ok({ provider: 'github', auth: { state: 'disconnected' }, disconnectedLocal: true });
  testConnectionResponse = ok({
    ok: true,
    target: { repository: 'owner/repo', branch: 'main', remoteKey: 'github.com/owner/repo@main', installationId: 1 },
  });
  initializeRepositoryResponse = ok({
    ok: true,
    initialized: true,
    target: { repository: 'owner/repo', branch: 'main', remoteKey: 'github.com/owner/repo@main', installationId: 1 },
  });
  saveSettingsResponse = null;
  pollResponses = [];

  storageMocks.get.mockImplementation(async (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, storageState[key]])),
  );
  storageMocks.set.mockImplementation(async (patch: Record<string, unknown>) => {
    Object.assign(storageState, patch);
  });
  storageMocks.remove.mockImplementation(async (keys: string[]) => {
    for (const key of keys) delete storageState[key];
  });
  storageMocks.onChanged.mockImplementation((listener: any) => {
    storageListener = listener;
    return () => {
      if (storageListener === listener) storageListener = null;
    };
  });
  gateMocks.setSyncProviderEnabled.mockResolvedValue(undefined);

  runtimeMocks.send.mockImplementation(async (type: string, payload: Record<string, unknown> = {}) => {
    if (type === 'getNotionAuthStatus') return ok({ connected: false });
    if (type === 'getFeishuAuthStatus') return ok({ connected: false });
    if (type === 'obsidianGetSettings') {
      return ok({
        apiBaseUrl: '',
        authHeaderName: '',
        apiKeyPresent: false,
        apiKeyMasked: '',
        chatFolder: '',
        articleFolder: '',
        videoFolder: '',
      });
    }
    if (type === GITHUB_MESSAGE_TYPES.GET_SETTINGS) return ok(githubSettingsData);
    if (type === GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES) return ok(githubRepositoryData);
    if (type === GITHUB_MESSAGE_TYPES.START_DEVICE_FLOW) return startResponse;
    if (type === GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW) {
      const next = pollResponses.shift();
      return typeof next === 'function' ? next() : (next ?? ok({ auth: { state: 'disconnected' } }));
    }
    if (type === GITHUB_MESSAGE_TYPES.CANCEL_DEVICE_FLOW) return cancelResponse;
    if (type === GITHUB_MESSAGE_TYPES.DISCONNECT) return disconnectResponse;
    if (type === GITHUB_MESSAGE_TYPES.SAVE_SETTINGS) {
      if (saveSettingsResponse) return saveSettingsResponse;
      const nextSettings = {
        ...githubSettingsData.settings,
        repository:
          payload.repository == null
            ? String(githubSettingsData.settings.repository || '')
            : String(payload.repository),
        branch: payload.branch == null ? String(githubSettingsData.settings.branch || '') : String(payload.branch),
      };
      githubSettingsData = { ...githubSettingsData, settings: nextSettings };
      return ok({ settings: nextSettings });
    }
    if (type === GITHUB_MESSAGE_TYPES.TEST_CONNECTION) return testConnectionResponse;
    if (type === GITHUB_MESSAGE_TYPES.INITIALIZE_REPOSITORY) return initializeRepositoryResponse;
    return fail(`unexpected message: ${type}`);
  });

  setupDom();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
  }
  root = null;
  vi.useRealTimers();
  cleanupDom();
});

describe('Settings controller GitHub Device Flow', () => {
  it('resumes a pending flow after reload, never polls early, and replans from returned nextPollAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    githubSettingsData = githubSettings({
      state: 'pending',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 60_000,
      nextPollAt: 15_000,
    });
    pollResponses = [
      ok({
        auth: {
          state: 'pending',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresAt: 60_000,
          nextPollAt: 25_000,
        },
      }),
      ok({ auth: { state: 'connected' } }),
    ];

    await renderController();

    expect(latestSnapshot?.githubAuth).toMatchObject({ state: 'pending', nextPollAt: 15_000 });
    expect(callCount(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW)).toBe(0);
    expect(callCount(GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES)).toBe(0);

    await advance(4_999);
    expect(callCount(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW)).toBe(0);
    await advance(1);
    expect(callCount(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW)).toBe(1);
    expect(latestSnapshot?.githubAuth).toMatchObject({ state: 'pending', nextPollAt: 25_000 });

    await advance(9_999);
    expect(callCount(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW)).toBe(1);
    await advance(1);
    expect(callCount(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW)).toBe(2);
    expect(latestSnapshot?.githubAuth).toEqual({ state: 'connected' });
    expect(latestSnapshot?.githubAccount?.login).toBe('octocat');
    expect(latestSnapshot?.githubRepositories.map((item) => item.fullName)).toEqual(['owner/repo']);
    expect(callCount(GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES)).toBe(1);
  });

  it('rehydrates persisted pending state after a poll error instead of retrying from stale timing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    githubSettingsData = githubSettings({
      state: 'pending',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 60_000,
      nextPollAt: 15_000,
    });
    pollResponses = [
      () => {
        githubSettingsData = githubSettings({
          state: 'pending',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresAt: 60_000,
          nextPollAt: 30_000,
        });
        return fail('github_device_poll_failed', { code: 'github_device_poll_failed' });
      },
      ok({
        auth: {
          state: 'pending',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresAt: 60_000,
          nextPollAt: 40_000,
        },
      }),
    ];

    await renderController();
    expect(callCount(GITHUB_MESSAGE_TYPES.GET_SETTINGS)).toBe(1);

    await advance(5_000);
    expect(callCount(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW)).toBe(1);
    expect(callCount(GITHUB_MESSAGE_TYPES.GET_SETTINGS)).toBe(2);
    expect(latestSnapshot?.githubAuth).toMatchObject({ state: 'pending', nextPollAt: 30_000 });

    await advance(14_999);
    expect(callCount(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW)).toBe(1);
    await advance(1);
    expect(callCount(GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW)).toBe(2);
    expect(latestSnapshot?.githubAuth).toMatchObject({ state: 'pending', nextPollAt: 40_000 });
  });

  it('connects, cancels, and disconnects locally while preserving target settings', async () => {
    await renderController();
    expect(latestSnapshot?.githubAuth).toEqual({ state: 'disconnected' });

    await invoke(() => latestSnapshot!.onGithubConnect());
    expect(latestSnapshot?.githubAuth).toMatchObject({ state: 'pending', userCode: 'ABCD-EFGH' });
    expect(callCount(GITHUB_MESSAGE_TYPES.START_DEVICE_FLOW)).toBe(1);

    await invoke(() => latestSnapshot!.onCancelGithubDeviceFlow());
    expect(latestSnapshot?.githubAuth).toEqual({ state: 'disconnected' });
    expect(callCount(GITHUB_MESSAGE_TYPES.CANCEL_DEVICE_FLOW)).toBe(1);

    githubSettingsData = githubSettings({ state: 'connected' });
    await invoke(() => latestSnapshot!.onGithubConnect());
    // START remains a Device Flow operation; emulate a completed connection through the safe poll action.
    pollResponses = [ok({ auth: { state: 'connected' } })];
    await invoke(() => latestSnapshot!.onPollGithubDeviceFlow());
    expect(latestSnapshot?.githubAuth).toEqual({ state: 'connected' });

    const repositoryBeforeDisconnect = latestSnapshot?.githubRepository;
    await invoke(() => latestSnapshot!.onDisconnectGithub());
    expect(latestSnapshot?.githubAuth).toEqual({ state: 'disconnected' });
    expect(latestSnapshot?.githubRepository).toBe(repositoryBeforeDisconnect);
    expect(latestSnapshot?.githubAccount).toBeNull();
    expect(latestSnapshot?.githubRepositories).toEqual([]);
    expect(callCount(GITHUB_MESSAGE_TYPES.DISCONNECT)).toBe(1);
  });

  it('keeps a lost stored repository visible and never silently selects or accepts an unauthorized replacement', async () => {
    githubSettingsData = githubSettings({ state: 'connected' }, 'owner/lost');
    githubRepositoryData = readyRepositories(['owner/other']);

    await renderController();

    expect(latestSnapshot?.githubRepository).toBe('owner/lost');
    expect(latestSnapshot?.githubTargetUnavailable).toBe(true);
    expect(latestSnapshot?.githubRepositories.map((item) => item.fullName)).toEqual(['owner/other']);

    await invoke(() => latestSnapshot!.onChangeGithubRepository('owner/not-authorized'));
    expect(latestSnapshot?.githubRepository).toBe('owner/lost');

    githubRepositoryData = readyRepositories(['owner/other', 'owner/read-only']);
    githubRepositoryData.repositories[1].contentWriteCapable = false;
    await invoke(() => latestSnapshot!.onRefreshGithubRepositories());
    await invoke(() => latestSnapshot!.onChangeGithubRepository('owner/read-only'));
    expect(latestSnapshot?.githubRepository).toBe('owner/lost');

    await invoke(() => latestSnapshot!.onChangeGithubRepository('owner/other'));
    expect(latestSnapshot?.githubRepository).toBe('owner/other');
    expect(latestSnapshot?.githubTargetUnavailable).toBe(false);

    githubRepositoryData = {
      status: 'github_app_not_installed',
      account: { login: 'octocat', avatarUrl: '', url: 'https://github.com/octocat' },
      repositories: [],
      appUrl: 'https://github.com/apps/syncnos',
      installUrl: 'https://github.com/apps/syncnos/installations/new',
    };
    await invoke(() => latestSnapshot!.onRefreshGithubRepositories());
    expect(latestSnapshot?.githubRepositoryStatus).toBe('github_app_not_installed');
    expect(latestSnapshot?.githubRepository).toBe('owner/other');
    expect(latestSnapshot?.githubTargetUnavailable).toBe(true);
  });

  it('treats a stored read-only repository as unavailable instead of a valid sync target', async () => {
    githubSettingsData = githubSettings({ state: 'connected' }, 'owner/read-only');
    githubRepositoryData = readyRepositories(['owner/read-only']);
    githubRepositoryData.repositories[0].contentWriteCapable = false;

    await renderController();

    expect(latestSnapshot?.githubRepository).toBe('owner/read-only');
    expect(latestSnapshot?.githubRepositories).toEqual([
      expect.objectContaining({ fullName: 'owner/read-only', contentWriteCapable: false }),
    ]);
    expect(latestSnapshot?.githubTargetUnavailable).toBe(true);
  });

  it('auto-saves repository and branch, tests the target, and emits provider/auto-sync storage changes', async () => {
    storageState[GITHUB_PROVIDER_KEY] = false;
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = false;
    githubSettingsData = githubSettings({ state: 'connected' });
    githubRepositoryData = readyRepositories(['owner/repo', 'owner/other']);
    await renderController();

    expect(latestSnapshot?.githubSyncEnabled).toBe(false);
    expect(latestSnapshot?.githubAutoSyncEnabled).toBe(false);

    await invoke(() => latestSnapshot!.onToggleGithubSyncEnabled(true));
    expect(gateMocks.setSyncProviderEnabled).toHaveBeenCalledWith('github', true);
    expect(latestSnapshot?.githubSyncEnabled).toBe(true);

    await invoke(() => latestSnapshot!.onToggleGithubAutoSyncEnabled(true));
    expect(storageMocks.set).toHaveBeenCalledWith({ [GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY]: true });
    expect(latestSnapshot?.githubAutoSyncEnabled).toBe(true);

    await invoke(() => latestSnapshot!.onChangeGithubRepository('owner/other'));
    expect(
      runtimeMocks.send.mock.calls.filter(([type]) => type === GITHUB_MESSAGE_TYPES.SAVE_SETTINGS).at(-1)?.[1],
    ).toEqual({
      repository: 'owner/other',
    });
    expect(latestSnapshot?.githubRepository).toBe('owner/other');

    act(() => latestSnapshot?.onChangeGithubBranch('release/v1'));
    await flushReact();
    await invoke(() => latestSnapshot!.onSaveGithubBranch());
    expect(
      runtimeMocks.send.mock.calls.filter(([type]) => type === GITHUB_MESSAGE_TYPES.SAVE_SETTINGS).at(-1)?.[1],
    ).toEqual({
      branch: 'release/v1',
    });
    expect(latestSnapshot?.githubBranch).toBe('release/v1');
    expect(latestSnapshot?.githubAuth).toEqual({ state: 'connected' });

    testConnectionResponse = ok({
      ok: true,
      target: {
        repository: 'owner/other',
        branch: 'release/v1',
        remoteKey: 'github.com/owner/other@release/v1',
        installationId: 2,
        accessToken: ACCESS_TOKEN,
      },
    });
    await invoke(() => latestSnapshot!.onTestGithubConnection());
    expect(latestSnapshot?.githubConnectionTest).toEqual({
      status: 'success',
      target: {
        repository: 'owner/other',
        branch: 'release/v1',
        remoteKey: 'github.com/owner/other@release/v1',
        installationId: 2,
      },
    });

    act(() => {
      storageListener?.({ [GITHUB_PROVIDER_KEY]: { oldValue: false, newValue: false } }, 'local');
      storageListener?.({ [GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY]: { oldValue: true, newValue: false } }, 'local');
    });
    expect(latestSnapshot?.githubSyncEnabled).toBe(false);
    expect(latestSnapshot?.githubAutoSyncEnabled).toBe(false);
  });

  it('turns an empty-repository preflight into an explicit initialize action and clears the expected error banner', async () => {
    githubSettingsData = githubSettings({ state: 'connected' });
    githubRepositoryData = readyRepositories();
    testConnectionResponse = fail('github_repository_uninitialized', { code: 'github_repository_uninitialized' });
    await renderController();

    await invoke(() => latestSnapshot!.onTestGithubConnection());
    expect(latestSnapshot?.githubConnectionTest).toEqual({ status: 'uninitialized' });
    expect(latestSnapshot?.error).toBeNull();

    await invoke(() => latestSnapshot!.onInitializeGithubRepository());
    expect(callCount(GITHUB_MESSAGE_TYPES.INITIALIZE_REPOSITORY)).toBe(1);
    expect(latestSnapshot?.githubConnectionTest).toEqual({
      status: 'success',
      target: {
        repository: 'owner/repo',
        branch: 'main',
        remoteKey: 'github.com/owner/repo@main',
        installationId: 1,
      },
    });
    expect(latestSnapshot?.error).toBeNull();
  });

  it('reverts a rejected branch draft to the persisted target before later target actions can run', async () => {
    githubSettingsData = githubSettings({ state: 'connected' });
    githubRepositoryData = readyRepositories();
    await renderController();

    await invoke(() => latestSnapshot!.onTestGithubConnection());
    expect(latestSnapshot?.githubConnectionTest.status).toBe('success');

    act(() => latestSnapshot?.onChangeGithubBranch('../main'));
    await flushReact();
    expect(latestSnapshot?.githubConnectionTest).toEqual({ status: 'idle' });
    saveSettingsResponse = fail('github_settings_invalid:branch', { code: 'github_settings_invalid' });

    await invoke(() => latestSnapshot!.onSaveGithubBranch());

    const saveCalls = runtimeMocks.send.mock.calls.filter(([type]) => type === GITHUB_MESSAGE_TYPES.SAVE_SETTINGS);
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]?.[1]).toEqual({ branch: '../main' });
    expect(latestSnapshot?.error).toBe('github_settings_invalid:branch');
    expect(latestSnapshot?.githubBranch).toBe('main');
    expect(latestSnapshot?.githubConnectionTest).toEqual({ status: 'idle' });
    expect(latestSnapshot?.githubAuth).toEqual({ state: 'connected' });
    expect(githubSettingsData.settings.branch).toBe('main');

    await invoke(() => latestSnapshot!.onTestGithubConnection());
    expect(latestSnapshot?.githubConnectionTest).toEqual({
      status: 'success',
      target: {
        repository: 'owner/repo',
        branch: 'main',
        remoteKey: 'github.com/owner/repo@main',
        installationId: 1,
      },
    });
  });

  it('invalidates a successful connection test when repository access is refreshed', async () => {
    githubSettingsData = githubSettings({ state: 'connected' });
    githubRepositoryData = readyRepositories();
    await renderController();

    await invoke(() => latestSnapshot!.onTestGithubConnection());
    expect(latestSnapshot?.githubConnectionTest.status).toBe('success');

    githubRepositoryData = {
      status: 'github_no_accessible_repositories',
      account: { login: 'octocat', avatarUrl: '', url: 'https://github.com/octocat' },
      repositories: [],
      appUrl: 'https://github.com/apps/syncnos',
      installUrl: 'https://github.com/apps/syncnos/installations/new',
    };
    await invoke(() => latestSnapshot!.onRefreshGithubRepositories());

    expect(latestSnapshot?.githubConnectionTest).toEqual({ status: 'idle' });
    expect(latestSnapshot?.githubTargetUnavailable).toBe(true);
  });

  it('never hydrates access, refresh, or device secrets into controller state', async () => {
    githubSettingsData = {
      ...githubSettings(
        {
          state: 'connected',
          accessToken: ACCESS_TOKEN,
          refreshToken: REFRESH_TOKEN,
          deviceCode: DEVICE_CODE,
        },
        'owner/repo',
      ),
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      deviceCode: DEVICE_CODE,
    };
    githubSettingsData.settings = { ...githubSettingsData.settings, accessToken: ACCESS_TOKEN };
    githubRepositoryData = {
      ...readyRepositories(),
      account: { ...readyRepositories().account, refreshToken: REFRESH_TOKEN },
      repositories: readyRepositories().repositories.map((repository) => ({
        ...repository,
        deviceCode: DEVICE_CODE,
        accessToken: ACCESS_TOKEN,
      })),
    };

    await renderController();

    const serialized = JSON.stringify(latestSnapshot);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(REFRESH_TOKEN);
    expect(serialized).not.toContain(DEVICE_CODE);
    expect(latestSnapshot?.githubAuth).toEqual({ state: 'connected' });
    expect(latestSnapshot?.githubAccount).toEqual({
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      url: 'https://github.com/octocat',
    });
  });
});
