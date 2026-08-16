import { afterEach, describe, expect, it, vi } from 'vitest';

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

const fetchFeishuJsonMock = vi.hoisted(() => vi.fn());
vi.mock('@services/sync/feishu/feishu-api', () => ({
  fetchFeishuJson: fetchFeishuJsonMock,
}));

const bindMocks = vi.hoisted(() => ({
  bindFeishuDocxImagesByOrder: vi.fn(async () => {
    throw new Error('bind failed: https://example.com/a.png?sig=SECRET&x=1');
  }),
}));

vi.mock('@services/sync/feishu/docx/image-block-binder', () => ({
  bindFeishuDocxImagesByOrder: bindMocks.bindFeishuDocxImagesByOrder,
}));

function setupChromeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
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
        remove(keys: any, cb: () => void) {
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : [];
          for (const k of list) delete store[k];
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

function mockDefaultFeishuFolderLayout(path: string, init?: RequestInit) {
  if (path === '/drive/explorer/v2/root_folder/meta') return { token: 'root' };
  if (path.startsWith('/drive/v1/files?')) return { files: [], has_more: false };
  if (path === '/drive/v1/files/create_folder') {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const parent = String(body.folder_token || '');
    const name = String(body.name || '');
    if (parent === 'root' && name === 'SyncNos-AIChats') return { folder: { folder_token: 'fld_ai_chats' } };
    if (parent === 'root' && name === 'SyncNos-WebArticles') return { folder: { folder_token: 'fld_web_articles' } };
    if (parent === 'root' && name === 'SyncNos-Videos') return { folder: { folder_token: 'fld_videos' } };
    return { folder: { folder_token: `fld_${parent}_${name}` } };
  }
  return null;
}

describe('feishu orchestrator warnings sanitization', () => {
  it('does not force-abort running jobs when status is read without instanceId', async () => {
    setupChromeStorage();
    jobStoreMocks.getJob.mockResolvedValue({
      id: 'job_running',
      provider: 'feishu',
      instanceId: 'background-old',
      status: 'running',
      startedAt: Date.now() - 3_000,
      updatedAt: Date.now() - 1_000,
      finishedAt: null,
      conversationIds: [1],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const status = await orch.getSyncStatus();

    expect(jobStoreMocks.abortRunningJobIfFromOtherInstance).not.toHaveBeenCalled();
    expect(jobStoreMocks.getJob).toHaveBeenCalledTimes(1);
    expect(status.job?.status).toBe('running');
  });

  it('sanitizes query values even when binder throws', async () => {
    setupChromeStorage();
    tokenMocks.getFeishuOAuthToken.mockResolvedValue({ accessToken: 't', expiresAt: Date.now() + 60_000 });
    jobStoreMocks.abortRunningJobIfFromOtherInstance.mockResolvedValue(null);
    jobStoreMocks.isRunningJob.mockReturnValue(false);

    storageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: '' },
    });
    storageMocks.getMessagesByConversation.mockResolvedValue([]);

    fetchFeishuJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const drive = mockDefaultFeishuFolderLayout(path, init);
      if (drive) return drive;
      if (path === '/docx/v1/documents') return { document: { document_id: 'doc1' } };
      if (path.includes('/children?page_size=')) return { items: [] };
      if (path === '/docx/v1/documents/blocks/convert')
        return {
          blocks: [{ block_type: 2, text: { elements: [{ text_run: { content: 'hi' } }] } }],
          first_level_block_ids: [],
        };
      if (path.endsWith('/children') && !path.includes('batch_delete')) return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({
      conversations: [resolved],
      instanceId: 'x',
      storage: providerStorage(),
    });
    expect(res.okCount).toBe(1);

    const warnings = String(res.results?.[0]?.warnings?.join('\n') || '');
    expect(warnings).toContain('https://example.com/a.png?keys=sig,x');
    expect(warnings).not.toContain('SECRET');
  });
});
