import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore, IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { openDb, closeDbForTests } from '@platform/idb/schema';
import { getStorageOverview, scanStorageAssets } from '@services/insight/storage-insight-source';
import { runTrackedTransaction } from '@services/data-revisions/transaction';

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IDB failed'));
  });
}

beforeEach(async () => {
  closeDbForTests();
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  await requestDone(indexedDB.deleteDatabase('webclipper'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  closeDbForTests();
});

describe('storage overview', () => {
  it('counts records without materializing image payloads or message bodies', async () => {
    const db = await openDb();
    const transaction = db.transaction('image_cache', 'readwrite');
    const store = transaction.objectStore('image_cache');
    await requestDone(store.add({ conversationId: 1, url: 'a', blob: new Blob(['123456']) }));
    await requestDone(store.add({ conversationId: 1, url: 'b', blob: new Blob([]) }));
    vi.stubGlobal('navigator', { storage: { estimate: vi.fn().mockResolvedValue({ usage: 1234, quota: 6789 }) } });
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const openCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');

    expect(await getStorageOverview()).toEqual({
      imageCacheRecords: 2,
      originUsageBytes: 1234,
      originQuotaBytes: 6789,
    });
    expect(getAll).not.toHaveBeenCalled();
    expect(openCursor).not.toHaveBeenCalled();
  });

  it('does not turn unsupported, failed or malformed origin estimates into a fake zero', async () => {
    vi.stubGlobal('navigator', {});
    expect(await getStorageOverview()).toMatchObject({
      imageCacheRecords: 0,
      originUsageBytes: null,
      originQuotaBytes: null,
    });

    vi.stubGlobal('navigator', { storage: { estimate: vi.fn().mockRejectedValue(new Error('denied')) } });
    expect(await getStorageOverview()).toMatchObject({ originUsageBytes: null, originQuotaBytes: null });

    vi.stubGlobal('navigator', { storage: { estimate: vi.fn().mockResolvedValue({ usage: -1, quota: Infinity }) } });
    expect(await getStorageOverview()).toMatchObject({ originUsageBytes: null, originQuotaBytes: null });
  });
});

const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 68, 65, 84, 0, 0, 0, 0]);

async function addAsset(row: Record<string, unknown>) {
  const db = await openDb();
  return await requestDone(db.transaction('image_cache', 'readwrite').objectStore('image_cache').add(row));
}

async function addRecord(storeName: 'messages' | 'article_comments' | 'conversations', row: Record<string, unknown>) {
  const db = await openDb();
  return await requestDone(db.transaction(storeName, 'readwrite').objectStore(storeName).add(row));
}

describe('storage content and reference audit', () => {
  it('distinguishes repeated occurrences, unique targets, valid ownership, broken local refs and logical UTF-8 bytes', async () => {
    await addRecord('conversations', {
      source: 'chatgpt',
      sourceType: 'chat',
      conversationKey: 'c1',
      title: '第一条',
      lastActivityAt: 1,
    });
    await addRecord('conversations', {
      source: 'web',
      sourceType: 'article',
      conversationKey: 'a2',
      title: 'Article 2',
      lastActivityAt: 2,
    });
    await addRecord('conversations', {
      source: 'video',
      sourceType: 'video',
      conversationKey: 'v3',
      title: 'Video 3',
      lastActivityAt: 3,
    });
    await addAsset({
      conversationId: 1,
      url: 'https://ex.org/same.png',
      blob: new Blob([pngHeader], { type: 'image/png' }),
      contentType: 'image/png',
    });
    await addAsset({
      conversationId: 2,
      url: 'https://ex.org/same.png',
      blob: new Blob([pngHeader], { type: 'image/png' }),
      contentType: 'image/png',
    });
    await addAsset({
      conversationId: 99,
      url: 'orphan.png',
      blob: new Blob([pngHeader], { type: 'image/png' }),
      contentType: 'image/png',
    });

    const chat =
      '你好🙂 ![1](syncnos-asset://1) ![again](syncnos-asset://1) ![missing](syncnos-asset://999) ![remote](https://ex.org/remote.png)\n\x60\x60\x60md\n![code](syncnos-asset://1)\n\x60\x60\x60';
    const article = '![wrong owner](syncnos-asset://1) ![correct](syncnos-asset://2)';
    await addRecord('messages', {
      conversationId: 1,
      messageKey: 'm1',
      role: 'user',
      sequence: 1,
      contentMarkdown: chat,
    });
    await addRecord('messages', {
      conversationId: 2,
      messageKey: 'article_body',
      role: 'article',
      sequence: 1,
      contentMarkdown: article,
    });
    await addRecord('messages', {
      conversationId: 3,
      messageKey: 'video_transcript',
      role: 'video',
      sequence: 1,
      contentMarkdown: '',
      transcriptCues: [{ startSeconds: 0, text: 'abc' }],
      videoChapters: [{ title: 'C1' }],
    });
    await addRecord('article_comments', { conversationId: 2, commentText: 'X', quoteText: '评论' });
    await addRecord('article_comments', { conversationId: null, commentText: 'abc', quoteText: '你好' });

    const scan = await scanStorageAssets();
    const content = scan.content;
    expect(content.imageOccurrences).toBe(6);
    expect(content.uniqueImageTargets).toBe(4);
    expect(content.uniqueLocalAssetIds).toBe(3);
    expect(content.availableLocalOccurrences).toBe(3);
    expect(content.brokenLocalOccurrences).toBe(2);
    expect(content.otherImageOccurrences).toBe(1);
    expect(content.unreferencedCacheRecords).toBe(1);
    expect(content.commentBytes).toBe(16);
    expect(content.orphanCommentBytes).toBe(9);
    expect(content.logicalTextBytes).toBe(
      new TextEncoder().encode(chat + article + 'abc' + 'C1' + 'X评论' + 'abc你好').byteLength,
    );
    expect(content.byKind.map(({ kind }) => kind).sort()).toEqual(['article', 'chat', 'video']);
    expect(content.topConversations.map(({ conversationId }) => conversationId)).toEqual([1, 2]);
    expect(content.topConversations[0]?.loc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(content.topSources.map(({ source, bytes }) => [source, bytes])).toEqual([
      ['chatgpt', pngHeader.length],
      ['web', pngHeader.length],
    ]);
    expect(scan.topImages[0]?.title).toBe('第一条');
    expect(scan.assetsById.get(3)?.orphan).toBe(true);
  });

  it('invalidates the entire audit on concurrent message changes', async () => {
    await addRecord('conversations', { source: 'web', sourceType: 'article', conversationKey: 'x', lastActivityAt: 1 });
    const db = await openDb();
    await addRecord('messages', {
      conversationId: 1,
      messageKey: 'initial',
      role: 'article',
      contentMarkdown: 'first',
    });
    let mutated = false;
    await expect(
      scanStorageAssets({
        onProgress: async ({ phase }) => {
          if (phase !== 'messages' || mutated) return;
          mutated = true;
          await runTrackedTransaction(
            { db, stores: ['messages'], revisionScopes: ['messages'] },
            async ({ stores, markChanged }) => {
              await requestDone(
                stores.messages.add({
                  conversationId: 1,
                  messageKey: 'late',
                  role: 'article',
                  contentMarkdown: 'late',
                }),
              );
              markChanged('messages');
            },
          );
        },
      }),
    ).rejects.toThrow('storage_insight_stale');
    expect(mutated).toBe(true);

    // A concurrent edit must also invalidate scans that contain image records.
    await addAsset({ conversationId: 1, url: 'p', blob: new Blob([pngHeader]) });
    mutated = false;
    await expect(
      scanStorageAssets({
        onProgress: async ({ phase }) => {
          if (phase !== 'images' || mutated) return;
          mutated = true;
          await runTrackedTransaction(
            { db, stores: ['messages'], revisionScopes: ['messages'] },
            async ({ stores, markChanged }) => {
              await requestDone(
                stores.messages.add({
                  conversationId: 1,
                  messageKey: 'later',
                  role: 'article',
                  contentMarkdown: 'later',
                }),
              );
              markChanged('messages');
            },
          );
        },
      }),
    ).rejects.toThrow('storage_insight_stale');
  });
});

describe('on-demand asset scan', () => {
  it('separates readable, old, orphaned and invalid assets and reads only bounded batches', async () => {
    const db = await openDb();
    await requestDone(
      db.transaction('conversations', 'readwrite').objectStore('conversations').add({
        source: 'chatgpt',
        conversationKey: 'one',
        lastActivityAt: 1,
      }),
    );
    await addAsset({
      conversationId: 1,
      url: 'a.png',
      blob: new Blob([pngHeader], { type: 'image/png' }),
      byteSize: 999,
      contentType: 'image/jpeg',
    });
    await addAsset({
      conversationId: 1,
      url: 'old',
      dataUrl: 'data:image/jpeg;base64,/9j/',
      contentType: 'image/jpeg',
      byteSize: 3,
    });
    await addAsset({ conversationId: 1, url: 'empty', blob: new Blob([], { type: 'image/png' }), byteSize: 0 });
    await addAsset({
      conversationId: 99,
      url: 'orphan',
      blob: new Blob([pngHeader], { type: 'image/png' }),
      byteSize: pngHeader.length,
    });
    for (let i = 0; i < 25; i++) {
      await addAsset({ conversationId: 1, url: `more-${i}`, blob: new Blob([pngHeader], { type: 'image/png' }) });
    }
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const progress: Array<{ processed: number; total: number }> = [];
    const scan = await scanStorageAssets({
      onProgress: (value) => {
        progress.push(value);
      },
    });

    expect(scan.records).toBe(29);
    expect(scan.readableCount).toBe(28);
    expect(scan.unreadableCount).toBe(1);
    expect(scan.orphanCount).toBe(1);
    expect(scan.legacyCount).toBe(1);
    expect(scan.metadataMismatchCount).toBe(1);
    expect(scan.formatMismatchCount).toBe(1);
    expect(scan.bytes).toBe(pngHeader.length * 27 + 3);
    expect(scan.topImages).toHaveLength(12);
    expect(scan.assetsById.get(1)?.format).toBe('png');
    expect(scan.assetsById.get(2)?.format).toBe('jpeg');
    expect(scan.assetsById.get(3)?.readable).toBe(false);
    expect(progress).toContainEqual({ phase: 'images', processed: 29, total: 29 });
    const batches = getAll.mock.calls.filter(
      (_, index) => (getAll.mock.contexts[index] as IDBObjectStore).name === 'image_cache',
    );
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((args) => args[1] === 24)).toBe(true);
  });

  it('rejects aborted and concurrently mutated scans rather than returning mixed revisions', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(scanStorageAssets({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });

    await addAsset({ conversationId: 1, url: 'before', blob: new Blob([pngHeader], { type: 'image/png' }) });
    const db = await openDb();
    await expect(
      scanStorageAssets({
        onProgress: async () => {
          await runTrackedTransaction(
            { db, stores: ['image_cache'], revisionScopes: ['image_cache'] },
            async ({ stores, markChanged }) => {
              await requestDone(
                stores.image_cache.add({ conversationId: 1, url: 'later', blob: new Blob([pngHeader]) }),
              );
              markChanged('image_cache');
            },
          );
        },
      }),
    ).rejects.toThrow('storage_insight_stale');
  });
});
