import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState: Record<string, unknown> = {};
const storageMocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock('@platform/storage/local', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
}));

function runningJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    provider: 'notion',
    instanceId: 'background-current',
    status: 'running',
    startedAt: 1,
    updatedAt: 2,
    finishedAt: null,
    totalCount: 2,
    conversationIds: [],
    currentConversationId: 2,
    currentConversationTitle: 'Current',
    currentStage: 'preparing_sync',
    okCount: 1,
    failCount: 0,
    perConversation: [],
    ...overrides,
  };
}

function terminalJob(overrides: Record<string, unknown> = {}) {
  return runningJob({
    status: 'done',
    finishedAt: 3,
    totalCount: 2,
    conversationIds: [1, 2],
    currentConversationId: undefined,
    currentConversationTitle: undefined,
    currentStage: undefined,
    okCount: 1,
    failCount: 1,
    perConversation: [
      {
        conversationId: 1,
        conversationTitle: 'One',
        ok: true,
        mode: 'synced',
        appended: 1,
        error: '',
        at: 2,
      },
      {
        conversationId: 2,
        conversationTitle: 'Two',
        ok: false,
        mode: 'failed',
        appended: 0,
        error: 'no permission',
        warnings: [{ code: 'warning', message: 'warning message' }],
        at: 3,
      },
    ],
    ...overrides,
  });
}

describe('normalizeSyncJobSnapshot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(storageState)) delete storageState[key];
    storageMocks.get.mockImplementation(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys || []) out[key] = storageState[key];
      return out;
    });
    storageMocks.set.mockImplementation(async (patch: Record<string, unknown>) => {
      Object.assign(storageState, patch || {});
    });
  });

  it('reads only the current v2 provider-owned SyncJob contract', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
    expect(SYNC_JOB_STORAGE_KEYS).toEqual({
      notion: 'notion_sync_job_v2',
      obsidian: 'obsidian_sync_job_v2',
      feishu: 'feishu_sync_job_v2',
      github: 'github_sync_job_v2',
    });

    storageState[SYNC_JOB_STORAGE_KEYS.notion] = runningJob();
    await expect(createSyncJobStore('notion').getJob()).resolves.toEqual(runningJob());
  });

  it('does not read or migrate a legacy v1 SyncJob key', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
    storageState.notion_sync_job_v1 = runningJob();

    await expect(createSyncJobStore('notion').getJob()).resolves.toBeNull();
    expect(storageMocks.get).toHaveBeenCalledWith([SYNC_JOB_STORAGE_KEYS.notion]);
    expect(storageMocks.set).not.toHaveBeenCalled();
  });

  it('accepts a complete canonical terminal snapshot without repairing it', async () => {
    const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');
    expect(normalizeSyncJobSnapshot('notion', terminalJob())).toEqual(terminalJob());
  });

  it.each([
    ['provider mismatch', { provider: 'github' }],
    ['missing totalCount', { totalCount: undefined }],
    ['fractional totalCount', { totalCount: 1.5 }],
    ['coerced timestamp', { startedAt: '1' }],
    ['coerced count', { okCount: '1' }],
    ['coerced conversation id', { currentConversationId: '2' }],
    ['durable running queue', { conversationIds: [1, 2] }],
    [
      'durable running result rows',
      {
        perConversation: [{ conversationId: 1, ok: true, mode: 'synced', appended: 1, error: '', at: 2 }],
      },
    ],
  ])('rejects %s instead of hydrating an old shape', async (_label, patch) => {
    const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');
    expect(normalizeSyncJobSnapshot('notion', runningJob(patch))).toBeNull();
  });

  it('rejects malformed terminal rows instead of dropping or repairing them', async () => {
    const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');
    expect(
      normalizeSyncJobSnapshot(
        'notion',
        terminalJob({
          perConversation: [{ conversationId: '1', ok: true, mode: 'synced', appended: 1, error: '', at: 2 }],
        }),
      ),
    ).toBeNull();
  });

  it('rejects terminal counters that disagree with the parsed row truth', async () => {
    const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');
    expect(normalizeSyncJobSnapshot('notion', terminalJob({ okCount: 2, failCount: 0 }))).toBeNull();
    expect(normalizeSyncJobSnapshot('notion', terminalJob({ okCount: 0, failCount: 2 }))).toBeNull();
  });

  it('accepts only known phases and exact finishedAt semantics', async () => {
    const { normalizeSyncJobSnapshot } = await import('@services/sync/sync-job-store');
    expect(normalizeSyncJobSnapshot('notion', runningJob({ status: 'future' }))).toBeNull();
    expect(normalizeSyncJobSnapshot('notion', runningJob({ finishedAt: 3 }))).toBeNull();
    expect(normalizeSyncJobSnapshot('notion', terminalJob({ finishedAt: null }))).toBeNull();
    expect(normalizeSyncJobSnapshot('notion', null)).toBeNull();
  });

  it('propagates storage read failure instead of manufacturing an empty job', async () => {
    const { createSyncJobStore } = await import('@services/sync/sync-job-store');
    storageMocks.get.mockRejectedValueOnce(new Error('storage read failed'));

    await expect(createSyncJobStore('notion').getJob()).rejects.toThrow('storage read failed');
  });

  it('returns null when the current key is absent', async () => {
    const { createSyncJobStore } = await import('@services/sync/sync-job-store');
    await expect(createSyncJobStore('notion').getJob()).resolves.toBeNull();
  });

  it('materializes a current orphan running job as aborted without instance or age heuristics', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
    storageState[SYNC_JOB_STORAGE_KEYS.notion] = runningJob({ currentConversationId: undefined });

    const reconciled = await createSyncJobStore('notion').abortRunningJob();
    expect(reconciled).toMatchObject({ status: 'aborted', abortedReason: 'extension reloaded' });
    expect((storageState[SYNC_JOB_STORAGE_KEYS.notion] as any)?.status).toBe('aborted');
  });

  it('does not report recovery when the aborted snapshot cannot be persisted', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
    storageState[SYNC_JOB_STORAGE_KEYS.feishu] = runningJob({
      provider: 'feishu',
      currentConversationId: undefined,
    });
    storageMocks.set.mockRejectedValueOnce(new Error('storage write failed'));

    const reconciled = await createSyncJobStore('feishu').abortRunningJob();
    expect(reconciled?.status).toBe('running');
    expect((storageState[SYNC_JOB_STORAGE_KEYS.feishu] as any)?.status).toBe('running');
  });

  it('leaves terminal and missing current jobs unchanged during startup reconciliation', async () => {
    const { createSyncJobStore, SYNC_JOB_STORAGE_KEYS } = await import('@services/sync/sync-job-store');
    const store = createSyncJobStore('github');
    await expect(store.abortRunningJob()).resolves.toBeNull();
    storageState[SYNC_JOB_STORAGE_KEYS.github] = terminalJob({ provider: 'github' });
    await expect(store.abortRunningJob()).resolves.toMatchObject({ status: 'done' });
    expect(storageMocks.set).not.toHaveBeenCalled();
  });
});
