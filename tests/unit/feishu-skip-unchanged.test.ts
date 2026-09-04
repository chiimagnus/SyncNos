import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@services/sync/shared/content-hash';

const backgroundStorageMocks = vi.hoisted(() => ({
  getSyncMappingByConversation: vi.fn(),
  getMessagesByConversationId: vi.fn(),
  patchSyncMapping: vi.fn(),
}));

vi.mock('@services/conversations/background/storage', () => ({
  backgroundStorage: {
    getSyncMappingByConversation: backgroundStorageMocks.getSyncMappingByConversation,
    getMessagesByConversationId: backgroundStorageMocks.getMessagesByConversationId,
    patchSyncMapping: backgroundStorageMocks.patchSyncMapping,
  },
}));

const authMocks = vi.hoisted(() => ({
  resolveFeishuAccessToken: vi.fn(),
}));

vi.mock('@services/sync/feishu/auth/oauth', () => ({
  resolveFeishuAccessToken: authMocks.resolveFeishuAccessToken,
}));

const jobStoreMocks = vi.hoisted(() => ({
  setJob: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock('@services/sync/sync-job-store', () => ({
  createSyncJobStore: () => ({
    setJob: jobStoreMocks.setJob,
    getJob: jobStoreMocks.getJob,
  }),
}));

vi.mock('@services/sync/feishu/docx/feishu-docx-markdown', () => ({
  formatConversationMarkdownForFeishuDocxSync: vi.fn(async () => '# same content'),
}));

const fetchFeishuJsonMock = vi.hoisted(() => vi.fn());
vi.mock('@services/sync/feishu/feishu-api', () => ({
  fetchFeishuJson: fetchFeishuJsonMock,
}));

function setupChromeStorage() {
  const store: Record<string, unknown> = {};
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: any, cb: (res: Record<string, unknown>) => void) {
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
          const out: Record<string, unknown> = {};
          for (const k of list) out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb && cb();
        },
        remove(_keys: any, cb: () => void) {
          cb && cb();
        },
      },
    },
  };
  return store;
}

async function loadModule(rel: string) {
  const mod = await import(/* @vite-ignore */ rel);
  return (mod as any).default || mod;
}

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error cleanup
  delete globalThis.chrome;
});

describe('feishu skip unchanged', () => {
  it('ignores fractional conversation ids without creating a running job', async () => {
    setupChromeStorage();
    jobStoreMocks.setJob.mockResolvedValue(true);

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const result = await orch.syncConversations({ conversationIds: [1.5], instanceId: 'fractional' });

    expect(result).toMatchObject({ okCount: 0, failCount: 0, results: [] });
    expect(jobStoreMocks.setJob).not.toHaveBeenCalled();
    expect(backgroundStorageMocks.getSyncMappingByConversation).not.toHaveBeenCalled();
    expect(fetchFeishuJsonMock).not.toHaveBeenCalled();
  });

  it('keeps best-effort compact persistence before remote work and synchronously rejects a second direct run', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');
    jobStoreMocks.setJob.mockResolvedValue(false);
    jobStoreMocks.getJob.mockResolvedValue(null);

    const hash = await sha256Hex('# same content');
    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: 'doc1', feishuLastContentHash: hash },
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);

    let releaseRemote!: () => void;
    const remoteGate = new Promise<void>((resolve) => {
      releaseRemote = resolve;
    });
    fetchFeishuJsonMock.mockImplementationOnce(async () => {
      await remoteGate;
      return { document: { document_id: 'doc1', revision_id: 1, title: 't' } };
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const firstRun = orch.syncConversations({ conversationIds: [1], instanceId: 'first' });
    await vi.waitFor(() => expect(fetchFeishuJsonMock).toHaveBeenCalledTimes(1));

    expect(orch.isRunActive()).toBe(true);
    expect(jobStoreMocks.setJob.mock.calls[0]?.[0]).toMatchObject({
      provider: 'feishu',
      status: 'running',
      totalCount: 1,
      conversationIds: [],
      perConversation: [],
    });
    expect(jobStoreMocks.setJob.mock.invocationCallOrder[0]).toBeLessThan(
      fetchFeishuJsonMock.mock.invocationCallOrder[0],
    );

    let conflict: unknown = null;
    try {
      orch.syncConversations({ conversationIds: [2], instanceId: 'second' });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({ code: 'sync_already_running' });
    expect(fetchFeishuJsonMock).toHaveBeenCalledTimes(1);

    releaseRemote();
    const result = await firstRun;
    expect(result.okCount).toBe(1);
    const attemptedJobs = jobStoreMocks.setJob.mock.calls.map(([job]) => job).filter(Boolean);
    const runningJobs = attemptedJobs.filter((job: any) => job.status === 'running');
    expect(
      runningJobs.every(
        (job: any) =>
          job.totalCount === 1 &&
          Array.isArray(job.conversationIds) &&
          job.conversationIds.length === 0 &&
          Array.isArray(job.perConversation) &&
          job.perConversation.length === 0,
      ),
    ).toBe(true);
    expect(
      runningJobs.filter((job: any) => job.currentConversationId === 1 && job.currentStage === 'preparing_sync'),
    ).toHaveLength(1);
    expect(runningJobs.filter((job: any) => Number(job.okCount || 0) + Number(job.failCount || 0) === 1)).toEqual([
      expect.objectContaining({ okCount: 1, failCount: 0, currentConversationId: undefined }),
    ]);
    expect(attemptedJobs.at(-1)).toMatchObject({
      status: 'done',
      conversationIds: [1],
      okCount: 1,
      failCount: 0,
      perConversation: [expect.objectContaining({ conversationId: 1, ok: true })],
    });
    expect(orch.isRunActive()).toBe(false);
    expect(await orch.getSyncStatus()).toMatchObject({ provider: 'feishu', job: null });
  });

  it('skips syncing when content hash unchanged and docId exists', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');
    fetchFeishuJsonMock.mockResolvedValue({ document: { document_id: 'doc1', revision_id: 1, title: 't' } });

    const hash = await sha256Hex('# same content');
    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: 'doc1', feishuLastContentHash: hash },
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });

    expect(res.okCount).toBe(1);
    expect(res.results?.[0]?.mode).toBe('skipped_unchanged');
    expect(fetchFeishuJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchFeishuJsonMock).toHaveBeenCalledWith(
      '/docx/v1/documents/doc1',
      { method: 'GET' },
      { accessToken: 't' },
    );
    expect(backgroundStorageMocks.patchSyncMapping).toHaveBeenCalledWith(1, {
      feishuDocId: 'doc1',
      feishuLastContentHash: hash,
      feishuLastSyncedAt: res.results?.[0]?.at,
    });
    expect(Number(res.results?.[0]?.at)).toBeGreaterThanOrEqual(0);
  });
});
