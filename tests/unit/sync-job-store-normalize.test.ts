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

  it('normalizes ids, totalCount, rows, and counts through the provider-owned key', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
    storageState[SYNC_JOB_STORAGE_KEYS.feishu] = {
      id: 'job_1',
      provider: 'wrong-provider',
      status: 'done',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
      totalCount: 4,
      conversationIds: [1, '2', -1, 0, 2, 3.5, Number.POSITIVE_INFINITY],
      currentConversationId: 4.5,
      okCount: -1,
      failCount: 1.5,
      perConversation: [
        { conversationId: '1', ok: true, appended: 1, at: 10 },
        { conversationId: 2, ok: false, error: 'no permission', at: 11 },
        { conversationId: 2.5, ok: true, at: 12 },
        { conversationId: 0, ok: false, at: 13 },
      ],
    };
    const snapshot = await createSyncJobStore('feishu').getJob();

    expect(snapshot).toMatchObject({
      provider: 'feishu',
      id: 'job_1',
      status: 'done',
      totalCount: 4,
      conversationIds: [1, 2],
      okCount: 1,
      failCount: 1,
      updatedAt: 2,
    });
    expect(snapshot?.currentConversationId).toBeUndefined();
    expect(snapshot?.perConversation.map((row) => row.conversationId)).toEqual([1, 2]);
  });

  it('accepts only known phases instead of manufacturing a terminal job', async () => {
    const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');

    expect(normalizeSyncJobSnapshot('notion', { status: 'future', conversationIds: [], perConversation: [] })).toBeNull();
    expect(normalizeSyncJobSnapshot('notion', { conversationIds: [], perConversation: [] })).toBeNull();
    expect(normalizeSyncJobSnapshot('notion', null)).toBeNull();
  });

  it('keeps normalization deterministic when persisted timestamps are absent or invalid', async () => {
    const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');
    const raw = {
      status: 'done',
      startedAt: 20,
      updatedAt: Number.NaN,
      finishedAt: 30,
      conversationIds: [1],
      perConversation: [{ conversationId: 1, ok: true, at: undefined }],
    };

    const first = normalizeSyncJobSnapshot('notion', raw);
    const second = normalizeSyncJobSnapshot('notion', raw);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ startedAt: 20, updatedAt: 30, finishedAt: 30 });
    expect(first?.perConversation[0]?.at).toBe(0);
  });

  it.each([[-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'treats invalid totalCount %p as absent',
    async (totalCount) => {
      const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');
      const snapshot = normalizeSyncJobSnapshot('github', {
        status: 'running',
        startedAt: 1,
        updatedAt: 2,
        finishedAt: null,
        totalCount,
        conversationIds: [],
        okCount: 0,
        failCount: 0,
        perConversation: [],
      });

      expect(snapshot).toBeTruthy();
      expect(snapshot?.totalCount).toBeUndefined();
    },
  );

  it('normalizes GitHub snapshots under the dedicated generic job key', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');

    expect(SYNC_JOB_STORAGE_KEYS.github).toBe('github_sync_job_v1');
    storageState[SYNC_JOB_STORAGE_KEYS.github] = {
      id: 'github_job_1',
      provider: 'github',
      status: 'running',
      instanceId: 'background-github',
      startedAt: 10,
      updatedAt: 11,
      conversationIds: [3, '4', 3, 0],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };
    const snapshot = await createSyncJobStore('github').getJob();

    expect(snapshot).toMatchObject({
      id: 'github_job_1',
      provider: 'github',
      status: 'running',
      instanceId: 'background-github',
      conversationIds: [3, 4],
    });
  });

  it('aborts a foreign running job immediately when forced', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
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

    const reconciled = await createSyncJobStore('notion').abortRunningJobIfFromOtherInstance('background-new', {
      forceAbort: true,
    });
    expect(reconciled?.status).toBe('aborted');
    expect(reconciled?.abortedReason).toBe('extension reloaded');
    expect((storageState[SYNC_JOB_STORAGE_KEYS.notion] as any)?.status).toBe('aborted');
  });

  it('keeps the pre-T2 stale-window behavior until ownership replaces it', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
    const jobStore = createSyncJobStore('feishu');
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

    const fresh = await jobStore.abortRunningJobIfFromOtherInstance('background-new');
    expect(fresh?.status).toBe('running');
    expect(jobStore.isRunningJob(fresh)).toBe(true);

    storageState[SYNC_JOB_STORAGE_KEYS.feishu] = {
      ...(storageState[SYNC_JOB_STORAGE_KEYS.feishu] as any),
      updatedAt: now - 5 * 60 * 1000 - 1_000,
    };
    const stale = await jobStore.abortRunningJobIfFromOtherInstance('background-new');
    expect(stale?.status).toBe('aborted');
    expect(stale?.abortedReason).toBe('extension reloaded');
  });
});
