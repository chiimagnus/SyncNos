import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FEISHU_MESSAGE_TYPES,
  GITHUB_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
} from '@platform/messaging/message-contracts';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerSyncHandlers } from '@services/sync/background-handlers';
import { registerFeishuSettingsHandlers } from '@services/sync/feishu/settings-background-handlers';
import { createSyncAlreadyRunningError, createSyncRunOwnership } from '@services/sync/sync-run-ownership';

const mocks = vi.hoisted(() => ({
  ensureSyncProviderEnabled: vi.fn(),
  getNotionOAuthToken: vi.fn(),
  getFeishuOAuthToken: vi.fn(),
  startFeishuOAuthAttempt: vi.fn(),
  saveFeishuOAuthConfig: vi.fn(),
  clearFeishuOAuthAttemptAndToken: vi.fn(),
  storageGet: vi.fn(),
  storageRemove: vi.fn(),
}));

vi.mock('@services/sync/sync-provider-gate', () => ({
  ensureSyncProviderEnabled: mocks.ensureSyncProviderEnabled,
}));
vi.mock('@services/sync/notion/auth/token-store', () => ({
  getNotionOAuthToken: mocks.getNotionOAuthToken,
}));
vi.mock('@services/sync/feishu/auth/token-store', () => ({
  getFeishuOAuthToken: mocks.getFeishuOAuthToken,
}));
vi.mock('@services/sync/feishu/auth/oauth', () => ({
  startFeishuOAuthAttempt: mocks.startFeishuOAuthAttempt,
  saveFeishuOAuthConfig: mocks.saveFeishuOAuthConfig,
  clearFeishuOAuthAttemptAndToken: mocks.clearFeishuOAuthAttemptAndToken,
}));
vi.mock('@platform/storage/local', () => ({
  storageGet: mocks.storageGet,
  storageRemove: mocks.storageRemove,
}));

type Provider = 'notion' | 'obsidian' | 'feishu' | 'github';

function createHarness(
  activeProvider: Provider | null,
  throwOnSyncProvider: Provider | null,
  jobs: Partial<Record<Provider, unknown>> = {},
) {
  const notionSync = vi.fn(() => {
    if (throwOnSyncProvider === 'notion') throw createSyncAlreadyRunningError();
    return Promise.resolve({});
  });
  const obsidianSync = vi.fn(() => {
    if (throwOnSyncProvider === 'obsidian') throw createSyncAlreadyRunningError();
    return Promise.resolve({});
  });
  const feishuSync = vi.fn(() => {
    if (throwOnSyncProvider === 'feishu') throw createSyncAlreadyRunningError();
    return Promise.resolve({});
  });
  const githubSync = vi.fn(() => {
    if (throwOnSyncProvider === 'github') throw createSyncAlreadyRunningError();
    return Promise.resolve({});
  });

  const notionClear = vi.fn(async () => ({ provider: 'notion', job: null }));
  const obsidianClear = vi.fn(async () => ({ provider: 'obsidian', job: null }));
  const feishuClear = vi.fn(async () => ({ provider: 'feishu', job: null }));
  const githubClear = vi.fn(async () => ({ provider: 'github', job: null }));
  const obsidianPreflight = vi.fn(async () => ({ ok: true }));

  const router = createBackgroundRouter({
    fallback: (message) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${message?.type}`, extra: null },
    }),
  });
  registerSyncHandlers(router as any, {
    getInstanceId: () => 'ownership-test-instance',
    notionSyncOrchestrator: {
      syncConversations: notionSync,
      getSyncJobStatus: async () => ({ provider: 'notion', job: jobs.notion ?? null }),
      clearSyncJobStatus: notionClear,
      isRunActive: () => activeProvider === 'notion',
    },
    obsidianSyncOrchestrator: {
      testConnection: obsidianPreflight,
      syncConversations: obsidianSync,
      getSyncStatus: async () => ({ provider: 'obsidian', job: jobs.obsidian ?? null }),
      clearSyncStatus: obsidianClear,
      isRunActive: () => activeProvider === 'obsidian',
    },
    feishuSyncOrchestrator: {
      syncConversations: feishuSync,
      getSyncStatus: async () => ({ provider: 'feishu', job: jobs.feishu ?? null }),
      clearSyncStatus: feishuClear,
      isRunActive: () => activeProvider === 'feishu',
    },
    githubSyncOrchestrator: {
      sync: githubSync,
      getSyncStatus: async () => ({ provider: 'github', job: jobs.github ?? null }),
      clearSyncStatus: githubClear,
      isRunActive: () => activeProvider === 'github',
    },
  });

  return {
    router,
    sync: { notion: notionSync, obsidian: obsidianSync, feishu: feishuSync, github: githubSync },
    clear: { notion: notionClear, obsidian: obsidianClear, feishu: feishuClear, github: githubClear },
    obsidianPreflight,
  };
}

const syncCases = [
  { provider: 'notion' as const, type: NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS },
  { provider: 'obsidian' as const, type: OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS },
  { provider: 'feishu' as const, type: FEISHU_MESSAGE_TYPES.SYNC_CONVERSATIONS },
  { provider: 'github' as const, type: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS },
];

const clearCases = [
  { provider: 'notion' as const, type: NOTION_MESSAGE_TYPES.CLEAR_SYNC_JOB_STATUS },
  { provider: 'obsidian' as const, type: OBSIDIAN_MESSAGE_TYPES.CLEAR_SYNC_STATUS },
  { provider: 'feishu' as const, type: FEISHU_MESSAGE_TYPES.CLEAR_SYNC_STATUS },
  { provider: 'github' as const, type: GITHUB_MESSAGE_TYPES.CLEAR_SYNC_STATUS },
];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureSyncProviderEnabled.mockResolvedValue(null);
  mocks.getNotionOAuthToken.mockResolvedValue({ accessToken: 'notion-token' });
  mocks.getFeishuOAuthToken.mockResolvedValue({ accessToken: 'feishu-token' });
  mocks.startFeishuOAuthAttempt.mockResolvedValue({ state: 'feishu-state' });
  mocks.saveFeishuOAuthConfig.mockResolvedValue({
    clientId: 'app-id',
    clientSecretPresent: true,
    tokenExchangeProxyUrl: '',
  });
  mocks.clearFeishuOAuthAttemptAndToken.mockResolvedValue([
    'feishu_oauth_token_v1',
    'feishu_oauth_pending_state',
    'feishu_oauth_last_error',
  ]);
  mocks.storageGet.mockResolvedValue({ notion_parent_page_id: 'parent-page' });
  mocks.storageRemove.mockResolvedValue(undefined);
});

describe('background sync ownership admission', () => {
  it.each(syncCases)('$provider rejects an existing run before provider preflight', async ({ provider, type }) => {
    const harness = createHarness(provider, null);

    const response = await harness.router.__handleMessageForTests({ type, conversationIds: [1] });

    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'sync_already_running' } } });
    expect(harness.sync[provider]).not.toHaveBeenCalled();
    if (provider === 'notion') {
      expect(mocks.getNotionOAuthToken).not.toHaveBeenCalled();
      expect(mocks.storageGet).not.toHaveBeenCalled();
    }
    if (provider === 'obsidian') expect(harness.obsidianPreflight).not.toHaveBeenCalled();
    if (provider === 'feishu') expect(mocks.getFeishuOAuthToken).not.toHaveBeenCalled();
  });

  it('reports a detached Obsidian preflight as active even with no durable job and clears it after preflight failure', async () => {
    const harness = createHarness(null, null);
    const preflight = deferred<any>();
    harness.obsidianPreflight.mockImplementationOnce(() => preflight.promise);

    const startResponse = harness.router.__handleMessageForTests({
      type: OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS,
      conversationIds: [1],
    });
    await Promise.resolve();

    const duringPreflight = await harness.router.__handleMessageForTests({
      type: OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS,
    });
    expect(duringPreflight).toMatchObject({
      ok: true,
      data: { provider: 'obsidian', active: true, job: null },
    });
    expect(harness.sync.obsidian).not.toHaveBeenCalled();

    preflight.resolve({ ok: false, error: { code: 'network_error', message: 'offline' } });
    const failed = await startResponse;
    expect(failed).toMatchObject({ ok: false, error: { extra: { code: 'network_error', stage: 'preflight' } } });

    const afterFailure = await harness.router.__handleMessageForTests({ type: OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS });
    expect(afterFailure).toMatchObject({ ok: true, data: { provider: 'obsidian', active: false, job: null } });
  });

  it('keeps liveness independent from a durable running snapshot age', async () => {
    const oldRunning = {
      id: 'old-visible-run',
      provider: 'github',
      status: 'running',
      startedAt: 1,
      updatedAt: Date.now() - 10 * 60_000,
      finishedAt: null,
      conversationIds: [],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };
    const harness = createHarness('github', null, { github: oldRunning });

    const status = await harness.router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.GET_SYNC_STATUS });
    expect(status).toMatchObject({
      ok: true,
      data: { active: true, job: { id: 'old-visible-run', status: 'running' } },
    });

    const conflict = await harness.router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS,
      conversationIds: [1],
    });
    expect(conflict).toMatchObject({ ok: false, error: { extra: { code: 'sync_already_running' } } });
    expect(harness.sync.github).not.toHaveBeenCalled();
  });

  it('treats a durable running snapshot with no live owner as residue instead of admission evidence', async () => {
    const residue = {
      id: 'residue',
      provider: 'github',
      status: 'running',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: null,
      conversationIds: [9],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };
    const harness = createHarness(null, null, { github: residue });

    const status = await harness.router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.GET_SYNC_STATUS });
    expect(status).toMatchObject({ ok: true, data: { active: false, job: { id: 'residue', status: 'running' } } });

    const started = await harness.router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS,
      conversationIds: [1],
    });
    expect(started).toMatchObject({ ok: true, data: { started: true, provider: 'github' } });
    expect(harness.sync.github).toHaveBeenCalledTimes(1);
  });

  it.each(syncCases)(
    '$provider catches the final synchronous ownership guard before ACK',
    async ({ provider, type }) => {
      const harness = createHarness(null, provider);

      const response = await harness.router.__handleMessageForTests({ type, conversationIds: [1] });

      expect(response).toMatchObject({ ok: false, error: { extra: { code: 'sync_already_running' } } });
      expect(harness.sync[provider]).toHaveBeenCalledTimes(1);
      if (provider === 'notion') {
        expect(mocks.getNotionOAuthToken).toHaveBeenCalledTimes(1);
        expect(mocks.storageGet).toHaveBeenCalledTimes(1);
      }
      if (provider === 'obsidian') expect(harness.obsidianPreflight).toHaveBeenCalledTimes(1);
      if (provider === 'feishu') expect(mocks.getFeishuOAuthToken).toHaveBeenCalledTimes(1);
    },
  );
});

describe('Feishu destructive settings ownership', () => {
  function createFeishuSettingsHarness({
    active = false,
    initialJob = null as any,
    clearSucceeds = true,
  }: { active?: boolean; initialJob?: any; clearSucceeds?: boolean } = {}) {
    const ownership = createSyncRunOwnership();
    let job = initialJob;
    const router = createBackgroundRouter({
      fallback: (message) => ({
        ok: false,
        data: null,
        error: { message: `unknown message type: ${message?.type}`, extra: null },
      }),
    });
    registerFeishuSettingsHandlers(router as any, {
      runExclusiveMaintenance: <T>(mutation: () => Promise<T>, options: { clearStatusAfter?: boolean } = {}) =>
        ownership.runExclusiveMutation(async () => {
          const result = await mutation();
          if (options.clearStatusAfter === true) {
            if (!clearSucceeds) {
              throw Object.assign(new Error('feishu sync job persistence failed'), {
                code: 'feishu_sync_job_persist_failed',
              });
            }
            job = null;
          }
          return result;
        }),
    });

    const activeBlocker = deferred<void>();
    let activeRun: Promise<void> | null = null;
    if (active) activeRun = ownership.startRun(() => activeBlocker.promise);
    return {
      router,
      getJob: () => job,
      release: async () => {
        if (!activeRun) return;
        activeBlocker.resolve();
        await activeRun;
      },
    };
  }

  it('registers safe auth status plus owner START/SAVE routes without exposing token secrets', async () => {
    const harness = createFeishuSettingsHarness();
    mocks.getFeishuOAuthToken.mockResolvedValueOnce({
      accessToken: 'ACCESS_SECRET',
      refreshToken: 'REFRESH_SECRET',
      expiresAt: 100,
      createdAt: 1,
    });

    const status = await harness.router.__handleMessageForTests({ type: FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS });
    expect(status).toEqual({ ok: true, data: { connected: true }, error: null });
    expect(JSON.stringify(status)).not.toMatch(/ACCESS_SECRET|REFRESH_SECRET/);

    const start = await harness.router.__handleMessageForTests({
      type: FEISHU_MESSAGE_TYPES.START_AUTH,
      clientId: 'app-id',
      clientSecret: 'secret',
      tokenExchangeProxyUrl: '',
    });
    expect(start).toMatchObject({ ok: true, data: { state: 'feishu-state' } });
    expect(mocks.startFeishuOAuthAttempt).toHaveBeenCalledWith({
      clientId: 'app-id',
      clientSecret: 'secret',
      tokenExchangeProxyUrl: '',
    });

    const saved = await harness.router.__handleMessageForTests({
      type: FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG,
      clientId: 'app-id',
      clientSecret: 'secret',
      tokenExchangeProxyUrl: '',
    });
    expect(saved).toMatchObject({ ok: true, data: { clientId: 'app-id', clientSecretPresent: true } });
    expect(mocks.saveFeishuOAuthConfig).toHaveBeenCalledTimes(1);
  });

  it('rejects active disconnect before deleting Feishu credentials or config', async () => {
    const harness = createFeishuSettingsHarness({ active: true, initialJob: { status: 'running' } });

    const response = await harness.router.__handleMessageForTests({ type: FEISHU_MESSAGE_TYPES.DISCONNECT });

    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'sync_already_running' } } });
    expect(mocks.clearFeishuOAuthAttemptAndToken).not.toHaveBeenCalled();
    expect(mocks.storageRemove).not.toHaveBeenCalled();
    expect(harness.getJob()).toMatchObject({ status: 'running' });
    await harness.release();
  });

  it.each([
    ['idle', null],
    ['residual-running', { id: 'residue', provider: 'feishu', status: 'running' }],
  ])('clears Feishu %s state without directly removing the SyncJob key', async (_label, initialJob) => {
    const harness = createFeishuSettingsHarness({ initialJob });

    const response = await harness.router.__handleMessageForTests({ type: FEISHU_MESSAGE_TYPES.DISCONNECT });

    expect(response.ok).toBe(true);
    expect(harness.getJob()).toBeNull();
    expect(mocks.clearFeishuOAuthAttemptAndToken).toHaveBeenCalledTimes(1);
    expect(mocks.storageRemove).not.toHaveBeenCalled();
    expect(response.data?.clearedKeys).toEqual([
      'feishu_oauth_token_v1',
      'feishu_oauth_pending_state',
      'feishu_oauth_last_error',
    ]);
    expect(response.data?.clearedKeys).not.toContain('feishu_sync_job_v2');
  });

  it('reports final Feishu job-clear failure after credential cleanup instead of fake disconnect success', async () => {
    const harness = createFeishuSettingsHarness({
      initialJob: { id: 'residue', provider: 'feishu', status: 'running' },
      clearSucceeds: false,
    });

    const response = await harness.router.__handleMessageForTests({ type: FEISHU_MESSAGE_TYPES.DISCONNECT });

    expect(response).toMatchObject({
      ok: false,
      error: { extra: { code: 'feishu_sync_job_persist_failed' } },
    });
    expect(mocks.clearFeishuOAuthAttemptAndToken).toHaveBeenCalledTimes(1);
    expect(mocks.storageRemove).not.toHaveBeenCalled();
    expect(harness.getJob()).toMatchObject({ id: 'residue', status: 'running' });
  });
});

describe('background clear ownership errors', () => {
  it('preserves a provider persistence error when clear fails instead of returning fake null', async () => {
    const harness = createHarness(null, null);
    harness.clear.github.mockRejectedValueOnce(
      Object.assign(new Error('github sync job persistence failed'), { code: 'github_sync_job_persist_failed' }),
    );

    const response = await harness.router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.CLEAR_SYNC_STATUS });

    expect(response).toMatchObject({
      ok: false,
      error: { extra: { code: 'github_sync_job_persist_failed' } },
    });
  });

  it.each(clearCases)('$provider preserves sync_already_running from clear', async ({ provider, type }) => {
    const harness = createHarness(null, null);
    harness.clear[provider].mockImplementationOnce(() => {
      throw createSyncAlreadyRunningError();
    });

    const response = await harness.router.__handleMessageForTests({ type });

    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'sync_already_running' } } });
  });
});
