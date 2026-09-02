import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('reads persisted canonical running status without mutating it', async () => {
    const persisted = {
      id: 'job_running',
      provider: 'feishu',
      instanceId: 'background-old',
      status: 'running',
      startedAt: Date.now() - 3_000,
      updatedAt: Date.now() - 1_000,
      finishedAt: null,
      totalCount: 1,
      conversationIds: [],
      currentConversationId: 1,
      currentConversationTitle: 'Current',
      currentStage: 'preparing_sync',
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };
    const store = setupChromeStorage({ feishu_sync_job_v2: persisted });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const status = await orch.getSyncStatus();

    expect(status.job).toEqual(persisted);
    expect(store.feishu_sync_job_v2).toEqual(persisted);
  });

  it('sanitizes query values even when binder throws', async () => {
    const store = setupChromeStorage();
    tokenMocks.getFeishuOAuthToken.mockResolvedValue({ accessToken: 't', expiresAt: Date.now() + 60_000 });

    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: '' },
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);

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
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);

    const warnings = String(res.results?.[0]?.warnings?.join('\n') || '');
    expect(warnings).toContain('https://example.com/a.png?keys=sig,x');
    expect(warnings).not.toContain('SECRET');

    const persisted = store.feishu_sync_job_v2 as any;
    expect(persisted?.status).toBe('done');
    expect(persisted?.perConversation?.[0]?.warnings).toEqual([
      { code: 'feishu_sync_warning', message: expect.stringContaining('https://example.com/a.png?keys=sig,x') },
    ]);
    const status = await orch.getSyncStatus();
    expect(status.job?.status).toBe('done');
    expect(status.job?.perConversation?.[0]?.warnings).toEqual(persisted.perConversation[0].warnings);
  });
});
