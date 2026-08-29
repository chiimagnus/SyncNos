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

const tokenMocks = vi.hoisted(() => ({
  getFeishuOAuthToken: vi.fn(),
  setFeishuOAuthToken: vi.fn(),
}));

vi.mock('@services/sync/feishu/auth/token-store', () => ({
  getFeishuOAuthToken: tokenMocks.getFeishuOAuthToken,
  setFeishuOAuthToken: tokenMocks.setFeishuOAuthToken,
}));

const jobStoreMocks = vi.hoisted(() => ({
  abortRunningJobIfFromOtherInstance: vi.fn(),
  isRunningJob: vi.fn(),
  setJob: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock('@services/sync/feishu/feishu-sync-job-store.ts', () => ({
  default: {
    abortRunningJobIfFromOtherInstance: jobStoreMocks.abortRunningJobIfFromOtherInstance,
    isRunningJob: jobStoreMocks.isRunningJob,
    setJob: jobStoreMocks.setJob,
    getJob: jobStoreMocks.getJob,
  },
}));

vi.mock('@services/sync/feishu/docx/feishu-docx-markdown', () => ({
  formatConversationMarkdownForFeishuDocxSync: vi.fn(async () => '![img](https://example.com/a.png)'),
}));

vi.mock('@services/sync/feishu/settings-store', () => ({
  getFeishuPathConfig: vi.fn(async () => ({
    chatFolder: '',
    articleFolder: '',
    videoFolder: '',
    defaults: { chatFolder: '', articleFolder: '', videoFolder: '' },
  })),
  pickFeishuFolderPathForConversation: vi.fn(() => ''),
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

describe('feishu skip unchanged missing doc', () => {
  it('creates a new doc when content unchanged but existing doc is gone', async () => {
    setupChromeStorage();
    tokenMocks.getFeishuOAuthToken.mockResolvedValue({ accessToken: 't', expiresAt: Date.now() + 60_000 });
    jobStoreMocks.abortRunningJobIfFromOtherInstance.mockResolvedValue(null);
    jobStoreMocks.isRunningJob.mockReturnValue(false);

    const hash = await sha256Hex('![img](https://example.com/a.png)');
    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: 'doc1', feishuLastContentHash: hash },
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);

    fetchFeishuJsonMock.mockImplementation(async (path: string, init: any) => {
      if (path === '/docx/v1/documents/doc1' && String(init?.method || 'GET').toUpperCase() === 'GET') {
        const err: any = new Error('resource deleted');
        err.extra = { status: 400, code: 1770003 };
        throw err;
      }
      if (path === '/docx/v1/documents' && String(init?.method || 'GET').toUpperCase() === 'POST') {
        return { document: { document_id: 'doc_new' } };
      }
      return {};
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });

    expect(res.okCount).toBe(1);
    expect(res.results?.[0]?.mode).toBe('create');
    expect(backgroundStorageMocks.patchSyncMapping).toHaveBeenCalledWith(1, {
      feishuDocId: 'doc_new',
      feishuLastContentHash: hash,
      feishuLastSyncedAt: res.results?.[0]?.at,
    });
    expect(Number(res.results?.[0]?.at)).toBeGreaterThanOrEqual(0);
  });

  it('does not record provider freshness when remote content upload fails', async () => {
    setupChromeStorage();
    tokenMocks.getFeishuOAuthToken.mockResolvedValue({ accessToken: 't', expiresAt: Date.now() + 60_000 });
    jobStoreMocks.abortRunningJobIfFromOtherInstance.mockResolvedValue(null);
    jobStoreMocks.isRunningJob.mockReturnValue(false);
    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 2, title: 'fail upload' },
      mapping: null,
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);

    fetchFeishuJsonMock.mockImplementation(async (path: string, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (path === '/docx/v1/documents' && method === 'POST') {
        return { document: { document_id: 'doc_fail' } };
      }
      if (method === 'POST') throw new Error('forced remote upload failure');
      return {};
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [2], instanceId: 'x' });

    expect(res.failCount).toBe(1);
    expect(res.results?.[0]?.mode).toBe('failed');
    expect(backgroundStorageMocks.patchSyncMapping).not.toHaveBeenCalled();
  });
});
