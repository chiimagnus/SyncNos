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

vi.mock('@services/conversations/external-markdown', () => ({
  formatConversationMarkdownForExternalOutput: vi.fn(async () => '# Title\n\nhello'),
}));

const fetchFeishuJsonMock = vi.hoisted(() => vi.fn());

vi.mock('@services/sync/feishu/feishu-api', () => ({
  fetchFeishuJson: fetchFeishuJsonMock,
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

describe('feishu convert fallback', () => {
  it('uses descendant insertion when convert succeeds', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');

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
      if (path.endsWith('/descendant')) return { ok: true };
      if (path === '/docx/v1/documents/blocks/convert')
        return {
          blocks: [{ block_type: 2, text: { elements: [{ text_run: { content: 'hi' } }] } }],
          first_level_block_ids: ['tmp1'],
        };
      throw new Error(`unexpected path: ${path}`);
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);

    const paths = fetchFeishuJsonMock.mock.calls.map((c) => String(c[0] || ''));
    expect(paths).toContain('/docx/v1/documents/blocks/convert');
    expect(paths.some((p) => p.endsWith('/descendant'))).toBe(true);
  });

  it('falls back to text blocks when convert is permission denied', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');

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
      if (path.endsWith('/children') && !path.includes('batch_delete')) return { ok: true };
      if (path === '/docx/v1/documents/blocks/convert') {
        const err: any = new Error('forbidden');
        err.extra = { status: 403 };
        throw err;
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);

    const calls = fetchFeishuJsonMock.mock.calls.map((c) => ({ path: String(c[0] || ''), init: c[1] as any }));
    const paths = calls.map((c) => c.path);
    expect(paths).toContain('/docx/v1/documents/blocks/convert');
    expect(paths.some((p) => p.endsWith('/descendant'))).toBe(false);
    expect(
      calls.some((c) => c.path.endsWith('/children') && String(c.init?.method || 'GET').toUpperCase() === 'POST'),
    ).toBe(true);
  });

  it('falls back to text blocks when descendant insertion fails', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');

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
          first_level_block_ids: ['tmp1'],
        };
      if (path.endsWith('/descendant')) throw new Error('schema mismatch');
      if (path.endsWith('/children') && !path.includes('batch_delete')) return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);

    const calls = fetchFeishuJsonMock.mock.calls.map((c) => ({ path: String(c[0] || ''), init: c[1] as any }));
    expect(calls.some((c) => c.path.endsWith('/descendant'))).toBe(true);
    expect(
      calls.some((c) => c.path.endsWith('/children') && String(c.init?.method || 'GET').toUpperCase() === 'POST'),
    ).toBe(true);
  });

  it('falls back to text blocks when convert returns empty blocks', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');

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
      if (path === '/docx/v1/documents/blocks/convert') return { blocks: [], first_level_block_ids: [] };
      if (path.endsWith('/children') && !path.includes('batch_delete')) return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);

    const calls = fetchFeishuJsonMock.mock.calls.map((c) => ({ path: String(c[0] || ''), init: c[1] as any }));
    expect(calls.some((c) => c.path === '/docx/v1/documents/blocks/convert')).toBe(true);
    expect(
      calls.some((c) => c.path.endsWith('/children') && String(c.init?.method || 'GET').toUpperCase() === 'POST'),
    ).toBe(true);
  });

  it('batches descendant insertion when convert yields more than 1000 blocks', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');

    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: '' },
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);

    const blocks = Array.from({ length: 1001 }).map((_, i) => ({
      block_id: `b${i + 1}`,
      block_type: 2,
      text: { elements: [{ text_run: { content: `line${i + 1}` } }] },
      children: [],
    }));
    const firstLevel = blocks.map((b) => b.block_id);

    fetchFeishuJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const drive = mockDefaultFeishuFolderLayout(path, init);
      if (drive) return drive;
      if (path === '/docx/v1/documents') return { document: { document_id: 'doc1' } };
      if (path.includes('/children?page_size=')) return { items: [] };
      if (path === '/docx/v1/documents/blocks/convert')
        return {
          blocks,
          first_level_block_ids: firstLevel,
        };
      if (path.endsWith('/descendant')) return { ok: true };
      if (path.endsWith('/children') && !path.includes('batch_delete')) return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);

    const calls = fetchFeishuJsonMock.mock.calls.map((c) => String(c[0] || ''));
    const descendantCalls = calls.filter((p) => p.endsWith('/descendant'));
    expect(descendantCalls.length).toBe(2);
  });
});
