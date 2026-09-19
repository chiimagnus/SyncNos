import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  jobStoreMocks.setJob.mockResolvedValue(true);
  jobStoreMocks.getJob.mockResolvedValue(null);
});

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

  it('fails before remote work when the initial running snapshot cannot be persisted', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');
    jobStoreMocks.setJob.mockResolvedValue(false);

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');

    await expect(
      orch.syncConversations({
        conversationIds: [1],
        instanceId: 'first',
        jobId: 'feishu-accepted-job',
      }),
    ).rejects.toMatchObject({ code: 'feishu_sync_job_persist_failed' });

    expect(jobStoreMocks.setJob.mock.calls[0]?.[0]).toMatchObject({
      id: 'feishu-accepted-job',
      provider: 'feishu',
      status: 'running',
      totalCount: 1,
      conversationIds: [],
      perConversation: [],
    });
    expect(authMocks.resolveFeishuAccessToken).not.toHaveBeenCalled();
    expect(backgroundStorageMocks.getSyncMappingByConversation).not.toHaveBeenCalled();
    expect(fetchFeishuJsonMock).not.toHaveBeenCalled();
    expect(orch.isRunActive()).toBe(false);
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
