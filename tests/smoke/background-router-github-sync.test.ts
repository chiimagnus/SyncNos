import { GITHUB_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerSyncHandlers } from '@services/sync/background-handlers';
import { describe, expect, it, vi } from 'vitest';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function installStorage(store: Record<string, unknown>) {
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: string[] | string, callback: (result: Record<string, unknown>) => void) {
          const list = Array.isArray(keys) ? keys : [keys];
          callback(Object.fromEntries(list.map((key) => [key, store[key] ?? null])));
        },
        set(payload: Record<string, unknown>, callback?: () => void) {
          Object.assign(store, payload);
          callback?.();
        },
        remove(keys: string[] | string, callback?: () => void) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
          callback?.();
        },
      },
    },
  };
}

function createRouter(githubSyncOrchestrator: any, instanceId = 'github-background-instance') {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerSyncHandlers(router as any, {
    getInstanceId: () => instanceId,
    notionSyncOrchestrator: {
      syncConversations: async () => ({}),
      getSyncJobStatus: async () => ({ job: null }),
      clearSyncJobStatus: async () => ({ job: null }),
      isRunActive: () => false,
    },
    obsidianSyncOrchestrator: {
      testConnection: async () => ({ ok: true }),
      syncConversations: async () => ({}),
      getSyncStatus: async () => ({ job: null }),
      clearSyncStatus: async () => ({ job: null }),
      isRunActive: () => false,
    },
    feishuSyncOrchestrator: {
      syncConversations: async () => ({}),
      getSyncStatus: async () => ({ job: null }),
      clearSyncStatus: async () => ({ job: null }),
      isRunActive: () => false,
    },
    githubSyncOrchestrator,
  });
  return router;
}

describe('background-router github sync routes', () => {
  it('uses gate, live-owner fast reject and ignores durable running residue for admission', async () => {
    const store: Record<string, unknown> = { webclipper_sync_provider_github_enabled: false };
    installStorage(store);
    const blocker = deferred<unknown>();
    let job: any = null;
    const githubSyncOrchestrator = {
      getSyncStatus: vi.fn(async () => ({ provider: 'github', job })),
      clearSyncStatus: vi.fn(async () => ({ provider: 'github', job: null })),
      sync: vi.fn(async () => await blocker.promise),
      isRunActive: vi.fn(() => false),
    };
    const router = createRouter(githubSyncOrchestrator);

    const disabled = await router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS,
      conversationIds: [1],
    });
    expect(disabled.ok).toBe(false);
    expect(disabled.error?.extra).toMatchObject({ code: 'sync_provider_disabled', provider: 'github' });
    expect(githubSyncOrchestrator.getSyncStatus).not.toHaveBeenCalled();
    expect(githubSyncOrchestrator.sync).not.toHaveBeenCalled();

    delete store.webclipper_sync_provider_github_enabled;
    const started = await router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS,
      conversationIds: [1, '2', 2, 0],
    });
    expect(started).toMatchObject({ ok: true, data: { started: true, provider: 'github' } });
    expect(githubSyncOrchestrator.getSyncStatus).not.toHaveBeenCalled();
    expect(githubSyncOrchestrator.sync).toHaveBeenCalledWith({
      conversationIds: [1, 2],
      mode: 'reconcile',
      instanceId: 'github-background-instance',
    });

    const concurrent = await router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS,
      conversationIds: [3],
    });
    expect(concurrent.ok).toBe(false);
    expect(concurrent.error?.extra?.code).toBe('sync_already_running');
    expect(githubSyncOrchestrator.sync).toHaveBeenCalledTimes(1);

    blocker.resolve({ summary: { syncedCount: 2, failedCount: 0 } });
    await blocker.promise;
    await Promise.resolve();

    job = { status: 'running', id: 'persisted-running' };
    const residueRun = await router.__handleMessageForTests({
      type: GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS,
      conversationIds: [4],
    });
    expect(residueRun).toMatchObject({ ok: true, data: { started: true, provider: 'github' } });
    expect(githubSyncOrchestrator.getSyncStatus).not.toHaveBeenCalled();
    expect(githubSyncOrchestrator.sync).toHaveBeenCalledTimes(2);
  });

  it('delegates status and clear through the production sync contract', async () => {
    installStorage({});
    const githubSyncOrchestrator = {
      getSyncStatus: vi.fn(async () => ({
        provider: 'github',
        job: { status: 'done' },
      })),
      clearSyncStatus: vi.fn(async () => ({ provider: 'github', job: null })),
      sync: vi.fn(async () => ({})),
      isRunActive: vi.fn(() => false),
    };
    const router = createRouter(githubSyncOrchestrator, 'instance-status');

    const status = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.GET_SYNC_STATUS });
    expect(status).toMatchObject({
      ok: true,
      data: { provider: 'github', active: false, job: { status: 'done' } },
    });

    const cleared = await router.__handleMessageForTests({ type: GITHUB_MESSAGE_TYPES.CLEAR_SYNC_STATUS });
    expect(cleared).toMatchObject({
      ok: true,
      data: { provider: 'github', active: false, job: null },
    });
    expect(githubSyncOrchestrator.clearSyncStatus).toHaveBeenCalledWith();
  });
});
