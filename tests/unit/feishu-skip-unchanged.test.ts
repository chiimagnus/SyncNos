import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@services/sync/shared/content-hash';

const storageMocks = vi.hoisted(() => ({
  getSyncMappingByConversation: vi.fn(),
  getMessagesByConversation: vi.fn(),
  patchSyncMapping: vi.fn(),
}));

const resolved = { source: 'test', conversationKey: 'conversation-1', conversationId: 1 } as const;
function providerStorage() {
  return {
    resolveConversation: vi.fn(async () => resolved),
    getConversationByReference: vi.fn(async () => null),
    getMessagesByConversation: storageMocks.getMessagesByConversation,
    getSyncMappingByConversation: storageMocks.getSyncMappingByConversation,
    patchSyncMapping: storageMocks.patchSyncMapping,
    setConversationNotionPageId: vi.fn(async () => true),
    setSyncCursor: vi.fn(async () => true),
    clearSyncCursor: vi.fn(async () => true),
    getArticleCommentsByConversation: vi.fn(async () => []),
    attachOrphanArticleCommentsToConversation: vi.fn(async () => 0),
    getImageAsset: vi.fn(async () => null),
  };
}

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
  it('skips syncing when content hash unchanged and docId exists', async () => {
    setupChromeStorage();
    tokenMocks.getFeishuOAuthToken.mockResolvedValue({ accessToken: 't', expiresAt: Date.now() + 60_000 });
    jobStoreMocks.abortRunningJobIfFromOtherInstance.mockResolvedValue(null);
    jobStoreMocks.isRunningJob.mockReturnValue(false);
    fetchFeishuJsonMock.mockResolvedValue({ document: { document_id: 'doc1', revision_id: 1, title: 't' } });

    const hash = await sha256Hex('# same content');
    storageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: 'doc1', feishuLastContentHash: hash },
    });
    storageMocks.getMessagesByConversation.mockResolvedValue([]);

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({
      conversations: [resolved],
      instanceId: 'x',
      storage: providerStorage(),
    });

    expect(res.okCount).toBe(1);
    expect(res.results?.[0]?.mode).toBe('skipped_unchanged');
    expect(fetchFeishuJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchFeishuJsonMock).toHaveBeenCalledWith(
      '/docx/v1/documents/doc1',
      { method: 'GET' },
      { accessToken: 't' },
    );
    expect(storageMocks.patchSyncMapping).toHaveBeenCalledWith(
      resolved,
      expect.objectContaining({ feishuDocId: 'doc1' }),
    );
  });
});
