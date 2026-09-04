import { afterEach, describe, expect, it, vi } from 'vitest';

const backgroundStorageMocks = vi.hoisted(() => ({
  getSyncMappingByConversation: vi.fn(),
  getMessagesByConversationId: vi.fn(),
  patchSyncMapping: vi.fn(),
}));
const imageCacheMocks = vi.hoisted(() => ({
  getImageCacheAssetsByIds: vi.fn(),
}));

vi.mock('@services/conversations/background/storage', () => ({
  backgroundStorage: {
    getSyncMappingByConversation: backgroundStorageMocks.getSyncMappingByConversation,
    getMessagesByConversationId: backgroundStorageMocks.getMessagesByConversationId,
    patchSyncMapping: backgroundStorageMocks.patchSyncMapping,
  },
}));
vi.mock('@services/conversations/data/image-cache-read', () => ({
  getImageCacheAssetsByIds: (...args: any[]) => imageCacheMocks.getImageCacheAssetsByIds(...args),
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

vi.mock('@services/sync/feishu/settings-store', () => ({
  getFeishuPathConfig: vi.fn(async () => ({
    chatFolder: '',
    articleFolder: '',
    videoFolder: '',
    defaults: { chatFolder: '', articleFolder: '', videoFolder: '' },
  })),
  pickFeishuFolderPathForConversation: vi.fn(() => ''),
}));

const markdownMocks = vi.hoisted(() => ({
  formatConversationMarkdownForFeishuDocxSync: vi.fn(
    async () => '![a](https://example.com/a.png)\n\n![b](data:image/png;base64,AAAA)',
  ),
}));
vi.mock('@services/sync/feishu/docx/feishu-docx-markdown', () => ({
  formatConversationMarkdownForFeishuDocxSync: markdownMocks.formatConversationMarkdownForFeishuDocxSync,
}));

const fetchFeishuJsonMock = vi.hoisted(() => vi.fn());
vi.mock('@services/sync/feishu/feishu-api', () => ({
  fetchFeishuJson: fetchFeishuJsonMock,
}));

const downloadImageSmartMock = vi.hoisted(() => vi.fn());
vi.mock('@platform/webext/image-download-proxy', () => ({
  downloadImageSmart: downloadImageSmartMock,
}));

const imageBindMocks = vi.hoisted(() => ({
  uploadImageToFeishu: vi.fn(async () => 'file_tok'),
  bindImageBlockWithFileToken: vi.fn(async () => undefined),
  guessFileNameFromUrl: vi.fn((_url: string, fallbackExt: string) => `image.${fallbackExt}`),
}));

vi.mock('@services/sync/feishu/docx/image-materializer', () => ({
  FEISHU_DOCX_IMAGE_MAX_BYTES: 20 * 1024 * 1024,
  uploadImageToFeishu: imageBindMocks.uploadImageToFeishu,
  bindImageBlockWithFileToken: imageBindMocks.bindImageBlockWithFileToken,
  guessFileNameFromUrl: imageBindMocks.guessFileNameFromUrl,
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

describe('feishu docx image bind flow', () => {
  it('converts markdown then binds images by order (best-effort)', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');

    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: '' },
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);

    downloadImageSmartMock.mockResolvedValue({
      ok: true,
      reason: '',
      blob: new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
      contentType: 'image/png',
    });

    fetchFeishuJsonMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/docx/v1/documents') return { document: { document_id: 'doc1' } };
      if (path === '/docx/v1/documents/blocks/convert') {
        return {
          blocks: [
            { block_id: 'tmp1', block_type: 27, image: {}, children: [] },
            { block_id: 'tmp2', block_type: 27, image: {}, children: [] },
          ],
          first_level_block_ids: ['tmp1', 'tmp2'],
        };
      }
      if (path.endsWith('/descendant')) return { ok: true };
      if (path.startsWith('/docx/v1/documents/doc1/blocks?')) {
        return {
          items: [
            { block_id: 'img1', block_type: 27 },
            { block_id: 'img2', block_type: 27 },
          ],
          has_more: false,
        };
      }
      if (path.includes('/children?page_size=')) return { items: [] };
      throw new Error(`unexpected path: ${path} ${(init as any)?.method || ''}`);
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);

    expect(fetchFeishuJsonMock.mock.calls.map((c) => String(c[0] || ''))).toContain(
      '/docx/v1/documents/blocks/convert',
    );
    expect(imageBindMocks.uploadImageToFeishu).toHaveBeenCalledTimes(2);
    expect(imageBindMocks.bindImageBlockWithFileToken).toHaveBeenCalledTimes(2);
  });

  it('passes conversation ownership into preprocess and skips unavailable local images before downloader/upload/bind', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');
    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: '' },
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);
    markdownMocks.formatConversationMarkdownForFeishuDocxSync.mockResolvedValueOnce(
      [
        '![cross](syncnos-asset://7)',
        '![bad](syncnos-asset://nope)',
        '![zero](syncnos-asset://0)',
        '![unsafe](syncnos-asset://9007199254740992)',
      ].join('\n\n'),
    );
    imageCacheMocks.getImageCacheAssetsByIds.mockResolvedValue(new Map());

    fetchFeishuJsonMock.mockImplementation(async (path: string) => {
      if (path === '/docx/v1/documents') return { document: { document_id: 'doc1' } };
      if (path === '/docx/v1/documents/blocks/convert') {
        return {
          blocks: Array.from({ length: 4 }, (_, index) => ({
            block_id: `tmp${index + 1}`,
            block_type: 27,
            image: {},
            children: [],
          })),
          first_level_block_ids: ['tmp1', 'tmp2', 'tmp3', 'tmp4'],
        };
      }
      if (path.endsWith('/descendant')) return { ok: true };
      if (path.startsWith('/docx/v1/documents/doc1/blocks?')) {
        return {
          items: Array.from({ length: 4 }, (_, index) => ({ block_id: `img${index + 1}`, block_type: 27 })),
          has_more: false,
        };
      }
      if (path.includes('/children?page_size=')) return { items: [] };
      return {};
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });

    expect(res.okCount).toBe(1);
    expect(imageCacheMocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);
    expect(imageCacheMocks.getImageCacheAssetsByIds).toHaveBeenCalledWith({ ids: [7], conversationId: 1 });
    expect(downloadImageSmartMock).not.toHaveBeenCalled();
    expect(imageBindMocks.uploadImageToFeishu).not.toHaveBeenCalled();
    expect(imageBindMocks.bindImageBlockWithFileToken).not.toHaveBeenCalled();
    expect(String(res.results?.[0]?.warnings?.join('\n') || '')).toContain('local image unavailable');
  });

  it('records warnings when image blocks are fewer than markdown images', async () => {
    setupChromeStorage();
    authMocks.resolveFeishuAccessToken.mockResolvedValue('t');

    backgroundStorageMocks.getSyncMappingByConversation.mockResolvedValue({
      conversation: { id: 1, title: 't' },
      mapping: { feishuDocId: '' },
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([]);

    downloadImageSmartMock.mockResolvedValue({
      ok: true,
      reason: '',
      blob: new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
      contentType: 'image/png',
    });

    fetchFeishuJsonMock.mockImplementation(async (path: string) => {
      if (path === '/docx/v1/documents') return { document: { document_id: 'doc1' } };
      if (path === '/docx/v1/documents/blocks/convert') {
        return {
          blocks: [{ block_id: 'tmp1', block_type: 27, image: {}, children: [] }],
          first_level_block_ids: ['tmp1'],
        };
      }
      if (path.endsWith('/descendant')) return { ok: true };
      if (path.startsWith('/docx/v1/documents/doc1/blocks?')) {
        return { items: [{ block_id: 'img1', block_type: 27 }], has_more: false };
      }
      if (path.includes('/children?page_size=')) return { items: [] };
      return {};
    });

    const orch = await loadModule('@services/sync/feishu/feishu-sync-orchestrator.ts');
    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);
    expect(String(res.results?.[0]?.warnings?.join('\n') || '')).toContain('missing docx image blocks');
  });
});
