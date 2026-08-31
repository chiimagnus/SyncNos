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

  it('normalizes feishu job snapshots (ids, counts)', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
    storageState[SYNC_JOB_STORAGE_KEYS.feishu] = {
      id: 'job_1',
      status: 'done',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
      conversationIds: [1, '2', -1, 0, 2],
      perConversation: [
        { conversationId: '1', ok: true, appended: 1, at: 10 },
        { conversationId: 2, ok: false, error: 'no permission', at: 11 },
      ],
    };
    const snapshot = await createSyncJobStore('feishu').getJob();

    expect(snapshot).toBeTruthy();
    expect(snapshot!.provider).toBe('feishu');
    expect(snapshot!.id).toBe('job_1');
    expect(snapshot!.status).toBe('done');
    expect(snapshot!.conversationIds).toEqual([1, 2]);
    expect(snapshot!.okCount).toBe(1);
    expect(snapshot!.failCount).toBe(1);
    expect(snapshot!.updatedAt).toBe(2);
  });

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

  it('keeps a fresh foreign running job until the 5 minute stale window expires when not forced', async () => {
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
