import { beforeEach, describe, expect, it, vi } from 'vitest';

const idbMocks = vi.hoisted(() => ({
  openDb: vi.fn(async () => {
    throw new Error('provider image path must not open IndexedDB');
  }),
}));

vi.mock('@platform/idb/schema', () => ({ openDb: idbMocks.openDb }));

import notionFilesApi from '@services/sync/notion/notion-files-api';
import { upgradeImageBlocksToFileUploads } from '@services/sync/notion/notion-image-upload-upgrader';
import { preprocessFeishuDocxMarkdownImages } from '@services/sync/feishu/docx/feishu-docx-image-preprocess';
import { syncConversations as syncObsidianConversations } from '@services/sync/obsidian/obsidian-sync-orchestrator';
import { saveObsidianSettings } from '@services/sync/obsidian/settings-store';
import type { BackgroundStorage } from '@services/conversations/background/storage';
import type { ImageAsset } from '@services/conversations/data/image-storage';

const reference = { source: 'chatgpt', conversationKey: 'provider-image-thread', conversationId: 41 } as const;

function asset(id = 42): ImageAsset {
  return {
    id,
    conversationId: reference.conversationId,
    url: 'https://example.com/cached.webp',
    blob: new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/webp' }),
    byteSize: 3,
    contentType: 'image/webp',
  };
}

function externalImageBlock(url: string) {
  return {
    object: 'block',
    type: 'image',
    image: { type: 'external', external: { url } },
  };
}

function setupChromeStorage() {
  const store: Record<string, unknown> = {};
  // @ts-expect-error test runtime
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: any, cb: (result: Record<string, unknown>) => void) {
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
          cb(Object.fromEntries(list.map((key) => [key, store[key] ?? null])));
        },
        set(patch: Record<string, unknown>, cb: () => void) {
          Object.assign(store, patch);
          cb?.();
        },
      },
    },
  };
}

function obsidianStorage(resolveImageAsset: (assetId: number) => Promise<ImageAsset | null>): BackgroundStorage {
  return {
    resolveConversation: vi.fn(async () => reference),
    getConversationByReference: vi.fn(async () => ({
      id: reference.conversationId,
      source: reference.source,
      conversationKey: reference.conversationKey,
      sourceType: 'chat',
      title: 'Provider image routing',
    })),
    getMessagesByConversation: vi.fn(async () => [
      {
        messageKey: 'm1',
        sequence: 1,
        role: 'assistant',
        contentMarkdown: '![cached](syncnos-asset://42)',
        updatedAt: 1,
      },
    ]),
    getSyncMappingByConversation: vi.fn(async () => null),
    patchSyncMapping: vi.fn(async () => true),
    setConversationNotionPageId: vi.fn(async () => true),
    setSyncCursor: vi.fn(async () => true),
    clearSyncCursor: vi.fn(async () => true),
    getArticleCommentsByConversation: vi.fn(async () => []),
    attachOrphanArticleCommentsToConversation: vi.fn(async () => 0),
    getImageAsset: vi.fn(async (_conversation, assetId) => await resolveImageAsset(assetId)),
  };
}

async function runObsidian(resolveImageAsset: (assetId: number) => Promise<ImageAsset | null>) {
  setupChromeStorage();
  await saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'test-key' });

  const putBodies: unknown[] = [];
  // @ts-expect-error test runtime
  globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = String(init?.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify({ errorCode: 40400, message: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'PUT') {
      putBodies.push(init?.body);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  });

  const storage = obsidianStorage(resolveImageAsset);
  const result = await syncObsidianConversations({
    conversations: [reference],
    instanceId: `provider-image-${Math.random()}`,
    storage,
  });
  return { putBodies, result, storage };
}

describe('provider image routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Notion resolves syncnos assets through the injected provider capability and preserves missing-image degradation', async () => {
    vi.spyOn(notionFilesApi, 'createFileUpload').mockResolvedValue({ id: 'upload-42' } as any);
    vi.spyOn(notionFilesApi, 'sendFileUpload').mockResolvedValue({} as any);
    vi.spyOn(notionFilesApi, 'waitUntilUploaded').mockResolvedValue({ id: 'upload-42' } as any);
    vi.spyOn(notionFilesApi, 'createExternalURLUpload').mockResolvedValue({ id: 'unused' } as any);

    const resolveImageAsset = vi.fn(async () => asset());
    const uploaded = await upgradeImageBlocksToFileUploads(
      'token',
      [externalImageBlock('syncnos-asset://42')],
      resolveImageAsset,
    );
    expect(resolveImageAsset).toHaveBeenCalledWith(42);
    expect(uploaded[0]?.image?.type).toBe('file_upload');

    const missing = await upgradeImageBlocksToFileUploads(
      'token',
      [externalImageBlock('syncnos-asset://404')],
      async () => null,
    );
    expect(missing[0]?.type).toBe('paragraph');
    expect(String(missing[0]?.paragraph?.rich_text?.[0]?.text?.content || '')).toContain('local image upload failed');
    expect(idbMocks.openDb).not.toHaveBeenCalled();
  });

  it('Feishu preprocess resolves local assets through the injected capability and keeps placeholder degradation when missing', async () => {
    const resolveImageAsset = vi.fn(async () => asset());
    const success = await preprocessFeishuDocxMarkdownImages('![cached](syncnos-asset://42)', resolveImageAsset);
    expect(resolveImageAsset).toHaveBeenCalledWith(42);
    expect(success.imageSourcesInOrder[0]).toMatchObject({
      kind: 'syncnos_asset',
      contentType: 'image/webp',
    });
    expect(success.imageSourcesInOrder[0]?.blob).toBeInstanceOf(Blob);
    expect(success.markdownForConvert).toContain('https://example.com/cached.webp');

    const missing = await preprocessFeishuDocxMarkdownImages('![missing](syncnos-asset://404)', async () => null);
    expect(missing.imageSourcesInOrder[0]).toMatchObject({ kind: 'syncnos_asset' });
    expect(missing.imageSourcesInOrder[0]?.blob).toBeUndefined();
    expect(missing.markdownForConvert).toContain('https://syncnos.invalid/asset/');
    expect(idbMocks.openDb).not.toHaveBeenCalled();
  });

  it('Obsidian resolves attachment bytes through the current conversation storage capability and fails safely when missing', async () => {
    const resolveImageAsset = vi.fn(async () => asset());
    const success = await runObsidian(resolveImageAsset);
    expect(resolveImageAsset).toHaveBeenCalledWith(42);
    expect(success.storage.getImageAsset).toHaveBeenCalledWith(reference, 42);
    expect(success.result.results[0]).toMatchObject({ ok: true, mode: 'full_rebuild' });
    expect(success.putBodies.length).toBeGreaterThanOrEqual(2);

    const missing = await runObsidian(async () => null);
    expect(missing.result.results[0]).toMatchObject({ ok: false, mode: 'failed' });
    expect(String(missing.result.results[0]?.error || '')).toContain('missing local asset blob: 42');
    expect(idbMocks.openDb).not.toHaveBeenCalled();
  });
});
