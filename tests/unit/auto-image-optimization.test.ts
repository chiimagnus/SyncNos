import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

const settings = vi.hoisted(() => ({
  enabled: undefined as boolean | undefined,
  read: vi.fn(),
}));
const candidate = vi.hoisted(() => ({ make: vi.fn() }));

vi.mock('@platform/storage/local', () => ({
  storageGet: (keys: string[]) => settings.read(keys),
  storageSet: async () => {},
}));
vi.mock('@services/conversations/data/image-optimization', () => ({
  createImageOptimizationPreview: (input: unknown) => candidate.make(input),
}));

import { closeDbForTests, openDb } from '@platform/idb/schema';
import { readDataRevision } from '@services/data-revisions/storage-idb';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IDB failed'));
  });
}
async function assetRows(): Promise<any[]> {
  const db = await openDb();
  return await done(db.transaction('image_cache', 'readonly').objectStore('image_cache').getAll());
}

const original = new Blob([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5)], { type: 'image/png' });
const optimized = new Blob([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)], { type: 'image/png' });
const dataUrl = `data:image/png;base64,${Buffer.from(new Uint8Array(await original.arrayBuffer())).toString('base64')}`;

async function cacheData(conversationId: number, url = dataUrl) {
  const message = { messageKey: 'm1', contentMarkdown: `![image](${url})` };
  const result = await inlineChatImagesInMessages({ conversationId, messages: [message], enableHttpImages: true });
  return { message, result, rows: await assetRows() };
}

beforeEach(async () => {
  closeDbForTests();
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  await done(indexedDB.deleteDatabase('webclipper'));
  settings.enabled = undefined;
  settings.read.mockReset().mockImplementation(async () => ({
    auto_optimize_new_images_enabled: settings.enabled,
  }));
  candidate.make.mockReset().mockImplementation(async ({ blob }: { blob: Blob }) => ({
    ok: true,
    mode: 'pixel-exact',
    originalBlob: blob,
    optimizedBlob: optimized,
    originalBytes: blob.size,
    optimizedBytes: optimized.size,
    savedBytes: blob.size - optimized.size,
    width: 1,
    height: 1,
    contentType: 'image/png',
    pixelsEqual: true,
  }));
});
afterEach(() => {
  closeDbForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opt-in optimization on new image cache writes', () => {
  it('defaults off, storing original data without probing the browser image codec', async () => {
    const output = await cacheData(19);
    expect(output.result.inlinedCount).toBe(1);
    expect(output.rows).toHaveLength(1);
    expect(output.rows[0].blob.size).toBe(original.size);
    expect(candidate.make).not.toHaveBeenCalled();
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('opt-in saves the strictly smaller pixel-exact result in one transaction and leaves asset identity stable', async () => {
    settings.enabled = true;
    const first = await cacheData(20);
    expect(candidate.make).toHaveBeenCalledWith(
      expect.objectContaining({
        blob: expect.any(Blob),
        mode: 'pixel-exact',
        contentType: 'image/png',
      }),
    );
    expect(first.rows[0].blob.size).toBe(optimized.size);
    expect(first.rows[0].byteSize).toBe(optimized.size);
    expect(first.rows[0].contentType).toBe('image/png');
    expect(first.rows[0].url).toMatch(/^data:image\/png;fnv1a64=/);
    expect(first.message.contentMarkdown).toMatch(/syncnos-asset:\/\/\d+/);
    expect(await readDataRevision('image_cache')).toBe(1);

    candidate.make.mockClear();
    const second = await cacheData(20);
    expect(second.rows).toHaveLength(1);
    expect(second.result.fromCacheCount).toBe(1);
    expect(candidate.make).not.toHaveBeenCalled();
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('keeps the original on no savings, codec error or browser lacking codec APIs', async () => {
    settings.enabled = true;
    candidate.make.mockResolvedValueOnce({ ok: false, reason: 'no-savings' });
    expect((await cacheData(21)).rows[0].blob.size).toBe(original.size);
    candidate.make.mockRejectedValueOnce(new Error('browser codec unavailable'));
    expect((await cacheData(22)).rows.find((row) => row.conversationId === 22).blob.size).toBe(original.size);
    expect(await readDataRevision('image_cache')).toBe(2);
  });

  it('does not optimize a not-yet-started asset when the setting is switched off', async () => {
    settings.enabled = true;
    const first = await cacheData(23);
    expect(first.rows[0].blob.size).toBe(optimized.size);
    settings.enabled = false;
    candidate.make.mockClear();
    expect((await cacheData(24)).rows.find((row) => row.conversationId === 24).blob.size).toBe(original.size);
    expect(candidate.make).not.toHaveBeenCalled();
  });

  it('optimizes a new ChatGPT upload once without rewriting its stable file identity', async () => {
    settings.enabled = true;
    const downloader = vi.fn(async (fileIds: string[]) => {
      expect(fileIds).toEqual(['file_image_1']);
      return [
        {
          cacheKey: 'chatgpt-file://file_image_1',
          ok: true as const,
          blob: original,
          byteSize: original.size,
          contentType: 'image/png',
        },
      ];
    });
    const messages = [{ messageKey: 'm1', contentMarkdown: '![uploaded](chatgpt-file://file_image_1)' }];
    const first = await inlineChatImagesInMessages({
      conversationId: 27,
      messages,
      enableChatgptImages: true,
      downloadChatgptImages: downloader,
    });
    expect(first.inlinedCount).toBe(1);
    expect(first.downloadedCount).toBe(1);
    expect(messages[0].contentMarkdown).toMatch(/syncnos-asset:\/\/\d+/);
    const saved = (await assetRows()).find((row) => row.conversationId === 27);
    expect(saved.url).toBe('chatgpt-file://file_image_1');
    expect(saved.blob.size).toBe(optimized.size);
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('keeps animated or metadata-sensitive images unchanged when pixel-exact preview refuses them', async () => {
    settings.enabled = true;
    candidate.make.mockResolvedValueOnce({ ok: false, reason: 'unsupported-format' });
    expect((await cacheData(28)).rows[0].blob.size).toBe(original.size);
    candidate.make.mockResolvedValueOnce({ ok: false, reason: 'metadata-unsafe' });
    expect((await cacheData(29)).rows.find((row) => row.conversationId === 29).blob.size).toBe(original.size);
    expect(await readDataRevision('image_cache')).toBe(2);
  });

  it('applies the same optional optimization to fetched HTTP images, but never downloads disabled HTTP image caches', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(await original.arrayBuffer(), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    settings.enabled = true;
    const output = await cacheData(25, 'https://images.example.com/a.png');
    expect(output.rows.find((row) => row.conversationId === 25).blob.size).toBe(optimized.size);

    const skippedMessage = { messageKey: 'm2', contentMarkdown: '![x](https://images.example.com/b.png)' };
    await inlineChatImagesInMessages({ conversationId: 26, messages: [skippedMessage], enableHttpImages: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await assetRows()).filter((row) => row.conversationId === 26)).toHaveLength(0);
    expect(candidate.make).toHaveBeenCalledTimes(1);
  });
});
