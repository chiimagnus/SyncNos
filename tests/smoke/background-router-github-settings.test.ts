import { createBackgroundRouter } from '@platform/messaging/background-router';
import { GITHUB_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  registerGithubSettingsHandlers,
  type GithubSettingsHandlersDeps,
} from '@services/sync/github/settings-background-handlers';
import { describe, expect, it, vi } from 'vitest';

const ACCESS_TOKEN = 'sentinel_access_token';
const REFRESH_TOKEN = 'sentinel_refresh_token';
const DEVICE_CODE = 'sentinel_device_code';

const settings = {
  repository: 'owner/repo',
  branch: 'main',
  chatFolder: 'SyncNos-AIChats',
  articleFolder: 'SyncNos-WebArticles',
  videoFolder: 'SyncNos-Videos',
  defaults: {
    repository: '',
    branch: '',
    chatFolder: 'SyncNos-AIChats',
    articleFolder: 'SyncNos-WebArticles',
    videoFolder: 'SyncNos-Videos',
  },
};

function createHarness(overrides: Partial<GithubSettingsHandlersDeps> = {}) {
  const deps = {
    getSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async () => settings),
    getSafeAuthSummary: vi.fn(async () => ({ state: 'disconnected' as const })),
    startDeviceFlow: vi.fn(async () => ({ state: 'disconnected' as const })),
    pollDeviceFlowOnce: vi.fn(async () => ({ state: 'disconnected' as const })),
    cancelDeviceFlow: vi.fn(async () => ({ state: 'disconnected' as const })),
    clearAuthState: vi.fn(async () => ({ version: 1 as const, state: 'disconnected' as const })),
    discoverRepositories: vi.fn(async () => ({
      status: 'github_app_not_installed' as const,
      account: null,
      repositories: [],
      installUrl: 'https://github.com/apps/syncnos/installations/new',
      appUrl: 'https://github.com/apps/syncnos',
    })),
    preflightRepository: vi.fn(async () => ({
      repository: 'owner/repo',
      branch: 'main',
      remoteKey: 'github.com/owner/repo@main',
      installationId: 7,
      headSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
    })),
    ...overrides,
  } as GithubSettingsHandlersDeps;
  const router = createBackgroundRouter({
    fallback: (message) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${message?.type}`, extra: null },
    }),
  });
  registerGithubSettingsHandlers(router, deps);
  return { router, deps };
}

function expectSecretFree(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(ACCESS_TOKEN);
  expect(serialized).not.toContain(REFRESH_TOKEN);
  expect(serialized).not.toContain(DEVICE_CODE);
}

describe('background-router GitHub settings routes', () => {
  it('restores local settings and a pending Device Flow without networking or leaking deviceCode', async () => {
    const discoverRepositories = vi.fn();
    const { router } = createHarness({
      getSafeAuthSummary: vi.fn(async () => ({
        state: 'pending',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: 20_000,
        nextPollAt: 11_000,
        deviceCode: DEVICE_CODE,
      })) as any,
      discoverRepositories,
    });

    const response = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.GET_SETTINGS });

    expect(response).toMatchObject({
      ok: true,
      data: {
        provider: 'github',
        settings: { repository: 'owner/repo', branch: 'main' },
        auth: {
          state: 'pending',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresAt: 20_000,
          nextPollAt: 11_000,
        },
      },
    });
    expect(discoverRepositories).not.toHaveBeenCalled();
    expectSecretFree(response);
  });

  it('keeps Device Flow start, poll, cancel and local disconnect responses secret-free', async () => {
    const clearAuthState = vi.fn(async () => ({
      version: 1,
      state: 'connected',
      token: { accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN, createdAt: 1 },
    })) as any;
    const { router } = createHarness({
      startDeviceFlow: vi.fn(async () => ({
        state: 'pending',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: 20_000,
        nextPollAt: 11_000,
        deviceCode: DEVICE_CODE,
      })) as any,
      pollDeviceFlowOnce: vi.fn(async () => ({
        state: 'connected',
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
        deviceCode: DEVICE_CODE,
      })) as any,
      cancelDeviceFlow: vi.fn(async () => ({ state: 'disconnected', deviceCode: DEVICE_CODE })) as any,
      clearAuthState,
    });

    for (const type of [
      GITHUB_MESSAGE_TYPES.START_DEVICE_FLOW,
      GITHUB_MESSAGE_TYPES.POLL_DEVICE_FLOW,
      GITHUB_MESSAGE_TYPES.CANCEL_DEVICE_FLOW,
      GITHUB_MESSAGE_TYPES.DISCONNECT,
    ]) {
      const response = await router.__handleMessageForTests({ type });
      expect(response.ok).toBe(true);
      expectSecretFree(response);
    }
    expect(clearAuthState).toHaveBeenCalledTimes(1);
    const disconnected = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.DISCONNECT });
    expect(disconnected.data).toMatchObject({ auth: { state: 'disconnected' }, disconnectedLocal: true });
  });

  it('whitelists repository/settings/preflight DTOs and rejects secret-bearing save payloads', async () => {
    const saveSettings = vi.fn(async () => ({ ...settings, accessToken: ACCESS_TOKEN })) as any;
    const preflightRepository = vi.fn(async () => ({
      repository: 'owner/repo',
      branch: 'main',
      remoteKey: 'github.com/owner/repo@main',
      installationId: 7,
      headSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      accessToken: ACCESS_TOKEN,
    })) as any;
    const { router } = createHarness({
      saveSettings,
      preflightRepository,
      discoverRepositories: vi.fn(async () => ({
        status: 'ready',
        account: {
          login: 'octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1',
          url: 'https://github.com/octocat',
          accessToken: ACCESS_TOKEN,
        },
        repositories: [
          {
            owner: 'owner',
            repo: 'repo',
            fullName: 'owner/repo',
            private: true,
            installationId: 7,
            userPermissions: { admin: false, maintain: false, push: true, pull: true, triage: false },
            installationContentsPermission: 'write',
            contentWriteCapable: true,
            refreshToken: REFRESH_TOKEN,
          },
        ],
        installUrl: 'https://attacker.invalid/should-not-be-forwarded',
        appUrl: `https://attacker.invalid/${DEVICE_CODE}`,
      })) as any,
    });

    const repositories = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES });
    expect(repositories).toMatchObject({
      ok: true,
      data: {
        status: 'ready',
        account: { login: 'octocat' },
        repositories: [{ fullName: 'owner/repo', contentWriteCapable: true }],
        installUrl: 'https://github.com/apps/syncnos/installations/new',
        appUrl: 'https://github.com/apps/syncnos',
      },
    });
    expectSecretFree(repositories);

    const saved = await router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SAVE_SETTINGS,
      repository: 'owner/repo',
      branch: 'main',
      chatFolder: 'Chats',
    });
    expect(saved.ok).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith({ repository: 'owner/repo', branch: 'main', chatFolder: 'Chats' });
    expectSecretFree(saved);

    const rejected = await router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SAVE_SETTINGS,
      repository: 'owner/repo',
      accessToken: ACCESS_TOKEN,
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { extra: { code: 'github_settings_payload_invalid' } },
    });
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expectSecretFree(rejected);

    const tested = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.TEST_CONNECTION });
    expect(preflightRepository).toHaveBeenCalledWith({ repository: 'owner/repo', branch: 'main' });
    expect(tested).toMatchObject({
      ok: true,
      data: {
        ok: true,
        target: {
          repository: 'owner/repo',
          branch: 'main',
          remoteKey: 'github.com/owner/repo@main',
          installationId: 7,
        },
      },
    });
    expectSecretFree(tested);
  });

  it('returns stable safe error metadata without reflecting secret-bearing error messages', async () => {
    const authRequired = Object.assign(new Error(`failed with ${ACCESS_TOKEN} ${REFRESH_TOKEN} ${DEVICE_CODE}`), {
      code: 'github_auth_required',
      status: 401,
      requestId: 'REQ-123',
    });
    const startFailure = new Error(`network body ${ACCESS_TOKEN} ${REFRESH_TOKEN} ${DEVICE_CODE}`);
    const { router } = createHarness({
      discoverRepositories: vi.fn(async () => {
        throw authRequired;
      }),
      startDeviceFlow: vi.fn(async () => {
        throw startFailure;
      }),
    });

    const listResponse = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.LIST_REPOSITORIES });
    expect(listResponse).toMatchObject({
      ok: false,
      error: {
        message: 'github_auth_required',
        extra: { code: 'github_auth_required', status: 401, requestId: 'REQ-123' },
      },
    });
    expectSecretFree(listResponse);

    const startResponse = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.START_DEVICE_FLOW });
    expect(startResponse).toMatchObject({
      ok: false,
      error: { message: 'github_device_start_failed', extra: { code: 'github_device_start_failed' } },
    });
    expectSecretFree(startResponse);
  });
});
