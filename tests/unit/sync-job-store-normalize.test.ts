import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState: Record<string, unknown> = {};

vi.mock('@platform/storage/local', () => {
  return {
    storageGet: async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys || []) out[key] = storageState[key];
      return out;
    },
    storageSet: async (patch: Record<string, unknown>) => {
      Object.assign(storageState, patch || {});
    },
  };
});

describe('normalizeSyncJobSnapshot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(storageState)) delete storageState[key];
  });

  it('normalizes current feishu done job snapshots and rejects removed legacy statuses', async () => {
    const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');

    const snapshot = normalizeSyncJobSnapshot('feishu', {
      id: 'job_1',
      status: 'done',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
      conversations: [
        { source: 'web', conversationKey: 'article-1', conversationId: 1 },
        { source: 'chatgpt', conversationKey: 'thread-2', conversationId: 2 },
      ],
      conversationIds: [99],
      perConversation: [
        {
          conversationId: 1,
          reference: { source: 'web', conversationKey: 'article-1', conversationId: 1 },
          ok: true,
          appended: 1,
          at: 10,
        },
        {
          conversationId: 2,
          reference: { source: 'chatgpt', conversationKey: 'thread-2', conversationId: 2 },
          ok: false,
          error: 'no permission',
          at: 11,
        },
      ],
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot!.provider).toBe('feishu');
    expect(snapshot!.id).toBe('job_1');
    expect(snapshot!.status).toBe('done');
    expect(snapshot!.conversationIds).toEqual([1, 2]);
    expect(snapshot!.okCount).toBe(1);
    expect(snapshot!.failCount).toBe(1);
    expect(snapshot!.updatedAt).toBe(2);
    expect(
      normalizeSyncJobSnapshot('feishu', {
        ...snapshot,
        status: 'finished',
      }),
    ).toBeNull();
  });

  it('aborts a foreign running job immediately when forced', async () => {
    const { abortRunningSyncJobIfFromOtherInstance, SYNC_JOB_STORAGE_KEYS } =
      await import('@services/sync/sync-job-store');
    const now = Date.now();
    storageState[SYNC_JOB_STORAGE_KEYS.notion] = {
      id: 'job_2',
      provider: 'notion',
      instanceId: 'background-old',
      status: 'running',
      startedAt: now - 3_000,
      updatedAt: now - 2_000,
      finishedAt: null,
      conversationIds: [1],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };

    const reconciled = await abortRunningSyncJobIfFromOtherInstance('notion', 'background-new', { forceAbort: true });
    expect(reconciled?.status).toBe('aborted');
    expect(reconciled?.abortedReason).toBe('extension reloaded');
    expect((storageState[SYNC_JOB_STORAGE_KEYS.notion] as any)?.status).toBe('aborted');
  });

  it('keeps a fresh foreign running job until the 5 minute stale window expires when not forced', async () => {
    const { abortRunningSyncJobIfFromOtherInstance, isRunningSyncJob, SYNC_JOB_STORAGE_KEYS } =
      await import('@services/sync/sync-job-store');
    const now = Date.now();
    storageState[SYNC_JOB_STORAGE_KEYS.feishu] = {
      id: 'job_3',
      provider: 'feishu',
      instanceId: 'background-old',
      status: 'running',
      startedAt: now - 3_000,
      updatedAt: now - 2_000,
      finishedAt: null,
      conversationIds: [2],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };

    const fresh = await abortRunningSyncJobIfFromOtherInstance('feishu', 'background-new');
    expect(fresh?.status).toBe('running');
    expect(isRunningSyncJob(fresh)).toBe(true);

    storageState[SYNC_JOB_STORAGE_KEYS.feishu] = {
      ...(storageState[SYNC_JOB_STORAGE_KEYS.feishu] as any),
      updatedAt: now - 5 * 60 * 1000 - 1_000,
    };
    const stale = await abortRunningSyncJobIfFromOtherInstance('feishu', 'background-new');
    expect(stale?.status).toBe('aborted');
    expect(stale?.abortedReason).toBe('extension reloaded');
  });
});
