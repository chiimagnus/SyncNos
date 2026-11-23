import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { closeDbForTests, openDb } from '@platform/idb/schema';
import { getConversationStorageDetails } from '@services/conversations/data/conversation-storage';

function request<T>(item: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    item.onsuccess = () => resolve(item.result);
    item.onerror = () => reject(item.error);
  });
}

async function write(storeName: 'conversations' | 'image_cache', value: Record<string, unknown>): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  const id = Number(await request(tx.objectStore(storeName).add(value)));
  await completed;
  return id;
}

const pngChunk = (name: string, data: number[] = []) => [
  0,
  0,
  0,
  data.length,
  ...Array.from(name, (ch) => ch.charCodeAt(0)),
  ...data,
  0,
  0,
  0,
  0,
];
const png = (extra: number[] = []) =>
  new Blob(
    [
      Uint8Array.from([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        ...pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
        ...extra,
        ...pngChunk('IDAT'),
      ]),
    ],
    { type: 'image/png' },
  );

beforeEach(async () => {
  closeDbForTests();
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  await request(indexedDB.deleteDatabase('webclipper'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  closeDbForTests();
});

describe('storage details for one saved item', () => {
  it('counts logical text and unique readable local blobs, not other items or remote references', async () => {
    const owner = await write('conversations', { source: 'web', conversationKey: 'a', lastActivityAt: 1 });
    const unrelated = await write('conversations', { source: 'chatgpt', conversationKey: 'b', lastActivityAt: 1 });
    const original = png();
    const id = await write('image_cache', {
      conversationId: owner,
      url: 'https://example.com/photo.png',
      blob: original,
      byteSize: 1,
      contentType: 'image/png',
    });
    const foreignId = await write('image_cache', {
      conversationId: unrelated,
      url: 'https://example.com/foreign.png',
      blob: original,
      byteSize: original.size,
      contentType: 'image/png',
    });
    const markdown = `图像 ![文章配图](syncnos-asset://${id}) 和 ![再次引用](syncnos-asset://${id})。\n![远程](https://example.com/remote.png)\n![失效](syncnos-asset://9999)\n![不属于这篇文章](syncnos-asset://${foreignId})`;
    const result = await getConversationStorageDetails({
      conversationId: owner,
      messages: [{ id: 1, conversationId: owner, role: 'article', messageKey: 'body', contentMarkdown: markdown }],
    });
    expect(result.localReferences).toBe(4);
    expect(result.otherReferences).toBe(1);
    expect(result.missingReferences).toBe(2);
    expect(result.images).toHaveLength(3);
    expect(result.images[0]).toMatchObject({
      id,
      label: '文章配图',
      format: 'PNG',
      bytes: original.size,
      state: 'ready',
      optimizable: true,
    });
    expect(result.images[1]).toMatchObject({ id: 9999, state: 'missing', bytes: 0, optimizable: false });
    expect(result.images[2]).toMatchObject({ id: foreignId, state: 'missing', bytes: 0, optimizable: false });
    expect(result.imageBytes).toBe(original.size);
    expect(result.textBytes).toBe(new TextEncoder().encode(markdown).length);
    expect(result.totalBytes).toBe(result.textBytes + original.size);
  });

  it('shows subtitles, unsupported animation and a pure-text item without a phantom optimization action', async () => {
    const owner = await write('conversations', { source: 'bilibili', conversationKey: 'video', lastActivityAt: 1 });
    const video = await getConversationStorageDetails({
      conversationId: owner,
      messages: [
        {
          id: 2,
          conversationId: owner,
          messageKey: 'video_transcript',
          role: 'video',
          transcriptCues: [{ text: '字幕内容', startSeconds: 0, endSeconds: 5 }],
          videoChapters: [{ title: '章节一', startSeconds: 0, endSeconds: null }],
        },
      ],
    });
    expect(video.textBytes).toBe(new TextEncoder().encode('字幕内容章节一').byteLength);
    expect(video.images).toEqual([]);
    expect(video.totalBytes).toBe(video.textBytes);

    const animated = png(pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 1]));
    const id = await write('image_cache', {
      conversationId: owner,
      url: 'https://example.com/animation.png',
      blob: animated,
      byteSize: animated.size,
      contentType: 'image/png',
    });
    const withAnimation = await getConversationStorageDetails({
      conversationId: owner,
      messages: [
        {
          id: 3,
          conversationId: owner,
          role: 'video',
          messageKey: 'content',
          contentMarkdown: `![动图](syncnos-asset://${id})`,
        },
      ],
    });
    expect(withAnimation.images[0]).toMatchObject({ format: 'APNG', optimizable: false });
  });

  it('does not resolve an invalid owner or a cancelled request', async () => {
    await expect(getConversationStorageDetails({ conversationId: 0, messages: [] })).rejects.toThrow(
      'invalid_conversation_id',
    );
    const abort = new AbortController();
    abort.abort();
    await expect(
      getConversationStorageDetails({
        conversationId: 1,
        messages: [],
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
