import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBDatabase, IDBIndex, IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import {
  hasReusableImageCachePayload,
  reusableImageCacheByteSize,
} from '@services/conversations/data/image-cache-record';
import { closeDbForTests, openDb } from '../../src/platform/idb/schema';
import { readDataRevision } from '@services/data-revisions/storage-idb';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(t: IDBTransaction): Promise<true> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error('transaction failed'));
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

async function seedImageCacheRow(row: Record<string, unknown>): Promise<number> {
  const db = await openDb();
  const transaction = db.transaction(['image_cache'], 'readwrite');
  const id = Number(await reqToPromise(transaction.objectStore('image_cache').add(row as any)));
  await txDone(transaction);
  return id;
}

beforeEach(async () => {
  closeDbForTests();

  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(() => {
  closeDbForTests();
  vi.restoreAllMocks();
});

describe('image-inline', () => {
  it('shares one persisted reusable-payload rule with conversation merge', () => {
    const valid = { blob: new Blob(['data'], { type: 'image/png' }), byteSize: 4 };
    expect(hasReusableImageCachePayload(valid)).toBe(true);
    expect(reusableImageCacheByteSize(valid)).toBe(4);
    expect(reusableImageCacheByteSize({ blob: valid.blob, byteSize: 0 })).toBe(valid.blob.size);
    expect(hasReusableImageCachePayload({ blob: new Blob([]), byteSize: 0 })).toBe(false);
    expect(hasReusableImageCachePayload({ byteSize: 10 })).toBe(false);
  });

  it('replaces http(s)/data images with internal asset refs and reuses cache', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([9, 8, 7, 6])).toString('base64')}`;

    const messages1 = [
      { messageKey: 'm1', contentMarkdown: '![](https://example.com/a.png)', role: 'assistant', sequence: 1 },
      { messageKey: 'm2', contentMarkdown: '![](https://example.com/b.png)', role: 'assistant', sequence: 2 },
      { messageKey: 'm3', contentMarkdown: `![](${dataImageUrl})`, role: 'assistant', sequence: 3 },
    ];
    const r1 = await inlineChatImagesInMessages({ conversationId: 1, messages: messages1 });
    expect(r1.downloadedCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(messages1[0].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    expect(String(messages1[1].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    expect(String(messages1[2].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    expect(String(messages1[0].contentMarkdown)).not.toContain('data:image');
    expect(String(messages1[1].contentMarkdown)).not.toContain('data:image');
    expect(String(messages1[2].contentMarkdown)).not.toContain('data:image');

    // Ensure we do not store the full `data:` URL as an IndexedDB key/index value.
    const db = await openDb();
    const t = db.transaction(['image_cache'], 'readonly');
    const store = t.objectStore('image_cache');
    const rows = (await reqToPromise(store.getAll() as any)) as any[];
    await txDone(t);

    const dataRows = rows.filter((r) => String(r?.url || '').startsWith('data:'));
    expect(dataRows.length).toBe(1);
    expect(String(dataRows[0].url)).toMatch(/^data:image\/png;fnv1a64=[0-9a-f]{16}$/);
    expect(String(dataRows[0].url)).not.toContain('base64');
    expect(String(dataRows[0].url).length).toBeLessThan(80);

    // Simulate a new capture of the same message still referencing the same url.
    const messages2 = [
      { messageKey: 'm1', contentMarkdown: '![](https://example.com/a.png)', role: 'assistant', sequence: 1 },
      { messageKey: 'm3', contentMarkdown: `![](${dataImageUrl})`, role: 'assistant', sequence: 3 },
    ];
    const r2 = await inlineChatImagesInMessages({ conversationId: 1, messages: messages2 });
    expect(r2.fromCacheCount).toBe(2);
    expect(r2.downloadedCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(messages2[0].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    expect(String(messages2[1].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
  });

  it('prefetches multiple cached HTTP URLs in one readonly transaction and dedupes repeated references', async () => {
    const conversationId = 50;
    const firstUrl = 'https://example.com/first.png';
    const secondUrl = 'https://example.com/second.png';
    const firstId = await seedImageCacheRow({
      conversationId,
      url: firstUrl,
      blob: new Blob([Uint8Array.of(1)], { type: 'image/png' }),
      byteSize: 1,
      contentType: 'image/png',
      createdAt: 1,
      updatedAt: 1,
    });
    const secondId = await seedImageCacheRow({
      conversationId,
      url: secondUrl,
      blob: new Blob([Uint8Array.of(2)], { type: 'image/png' }),
      byteSize: 1,
      contentType: 'image/png',
      createdAt: 1,
      updatedAt: 1,
    });
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const getSpy = vi.spyOn(IDBIndex.prototype, 'get');
    const fetchMock = vi.fn();
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const messages = [
      { messageKey: 'm1', contentMarkdown: `![](${firstUrl})`, role: 'assistant', sequence: 1 },
      {
        messageKey: 'm2',
        contentMarkdown: `![](${firstUrl})\n\n![](${secondUrl})`,
        role: 'assistant',
        sequence: 2,
      },
    ];
    const result = await inlineChatImagesInMessages({ conversationId, messages });

    const readonlyImageTransactions = transactionSpy.mock.calls.filter(([storeNames, mode]) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return names.includes('image_cache') && mode === 'readonly';
    });
    const readonlyGets = getSpy.mock.contexts
      .map((context, index) => ({ context: context as IDBIndex, call: getSpy.mock.calls[index] }))
      .filter(
        ({ context }) =>
          context.name === 'by_conversationId_url' && context.objectStore.transaction.mode === 'readonly',
      );

    expect(readonlyImageTransactions).toHaveLength(1);
    expect(readonlyGets.map(({ call }) => call?.[0])).toEqual([
      [conversationId, firstUrl],
      [conversationId, secondUrl],
    ]);
    expect(result.fromCacheCount).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(messages[0].contentMarkdown).toBe(`![](syncnos-asset://${firstId})`);
    expect(messages[1].contentMarkdown).toBe(`![](syncnos-asset://${firstId})\n\n![](syncnos-asset://${secondId})`);
  });

  it('prefetches only messages selected by onlyMessageKeys', async () => {
    const conversationId = 51;
    const skippedUrl = 'https://example.com/skipped.png';
    const selectedUrl = 'https://example.com/selected.png';
    const selectedId = await seedImageCacheRow({
      conversationId,
      url: selectedUrl,
      blob: new Blob([Uint8Array.of(3)], { type: 'image/png' }),
      byteSize: 1,
      contentType: 'image/png',
      createdAt: 1,
      updatedAt: 1,
    });
    const getSpy = vi.spyOn(IDBIndex.prototype, 'get');
    const messages = [
      { messageKey: 'skip', contentMarkdown: `![](${skippedUrl})`, role: 'assistant', sequence: 1 },
      { messageKey: 'keep', contentMarkdown: `![](${selectedUrl})`, role: 'assistant', sequence: 2 },
    ];

    await inlineChatImagesInMessages({
      conversationId,
      messages,
      onlyMessageKeys: new Set(['keep']),
    });

    const readonlyGets = getSpy.mock.contexts
      .map((context, index) => ({ context: context as IDBIndex, call: getSpy.mock.calls[index] }))
      .filter(
        ({ context }) =>
          context.name === 'by_conversationId_url' && context.objectStore.transaction.mode === 'readonly',
      );
    expect(readonlyGets.map(({ call }) => call?.[0])).toEqual([[conversationId, selectedUrl]]);
    expect(messages[0].contentMarkdown).toBe(`![](${skippedUrl})`);
    expect(messages[1].contentMarkdown).toBe(`![](syncnos-asset://${selectedId})`);
  });

  it('prefers the canonical data-image cache key over the legacy raw data URL row', async () => {
    const conversationId = 52;
    const bytes = Uint8Array.from([5, 6, 7]);
    const dataImageUrl = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
    const canonicalId = await seedImageCacheRow({
      conversationId,
      url: 'data:image/png;fnv1a64=ae12121853988e6f',
      blob: new Blob([bytes], { type: 'image/png' }),
      byteSize: 3,
      contentType: 'image/png',
      createdAt: 1,
      updatedAt: 1,
    });
    await seedImageCacheRow({
      conversationId,
      url: dataImageUrl,
      dataUrl: dataImageUrl,
      blob: new Blob([Uint8Array.of(9)], { type: 'image/png' }),
      byteSize: 1,
      contentType: 'image/png',
      createdAt: 1,
      updatedAt: 1,
    });

    const messages = [{ messageKey: 'm1', contentMarkdown: `![](${dataImageUrl})`, role: 'assistant', sequence: 1 }];
    const result = await inlineChatImagesInMessages({ conversationId, messages, enableHttpImages: false });

    expect(result.fromCacheCount).toBe(1);
    expect(messages[0].contentMarkdown).toBe(`![](syncnos-asset://${canonicalId})`);
  });

  it('re-decodes a data-image cache miss only at materialization time instead of retaining its Blob from pre-scan', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'atob');
    const originalAtob = globalThis.atob;
    expect(typeof originalAtob).toBe('function');
    const atobSpy = vi.fn((input: string) => originalAtob(input));
    Object.defineProperty(globalThis, 'atob', { configurable: true, writable: true, value: atobSpy });

    try {
      const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([7, 8, 9])).toString('base64')}`;
      const messages = [{ messageKey: 'm1', contentMarkdown: `![](${dataImageUrl})`, role: 'assistant', sequence: 1 }];
      const result = await inlineChatImagesInMessages({ conversationId: 53, messages, enableHttpImages: false });

      expect(result.downloadedCount).toBe(1);
      expect(atobSpy).toHaveBeenCalledTimes(2);
      expect(messages[0].contentMarkdown).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'atob', descriptor);
      else delete (globalThis as any).atob;
    }
  });

  it('does not prefetch disabled HTTP candidates', async () => {
    await openDb();
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const fetchMock = vi.fn();
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;
    const messages = [
      {
        messageKey: 'm1',
        contentMarkdown: '![](https://example.com/disabled-a.png)\n\n![](https://example.com/disabled-b.png)',
        role: 'assistant',
        sequence: 1,
      },
    ];

    await inlineChatImagesInMessages({ conversationId: 54, messages, enableHttpImages: false });

    const readonlyImageTransactions = transactionSpy.mock.calls.filter(([storeNames, mode]) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return names.includes('image_cache') && mode === 'readonly';
    });
    expect(readonlyImageTransactions).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when the prefetched cache transaction aborts instead of redownloading as cache misses', async () => {
    await openDb();
    const originalGet = IDBIndex.prototype.get;
    vi.spyOn(IDBIndex.prototype, 'get').mockImplementation(function (this: IDBIndex, key: IDBValidKey | IDBKeyRange) {
      const request = originalGet.call(this, key);
      if (this.name === 'by_conversationId_url' && this.objectStore.transaction.mode === 'readonly') {
        queueMicrotask(() => this.objectStore.transaction.abort());
      }
      return request;
    });
    const fetchMock = vi.fn();
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;
    const messages = [
      {
        messageKey: 'm1',
        contentMarkdown: '![](https://example.com/cache-abort.png)',
        role: 'assistant',
        sequence: 1,
      },
    ];

    await expect(inlineChatImagesInMessages({ conversationId: 55, messages })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses a valid Blob without metadata-only repair or revision bump', async () => {
    const url = 'https://example.com/metadata-light.png';
    const db = await openDb();
    const seedTx = db.transaction(['image_cache'], 'readwrite');
    const winnerId = await reqToPromise<number>(
      seedTx.objectStore('image_cache').add({
        conversationId: 40,
        url,
        blob: new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
        createdAt: 5,
      }) as any,
    );
    await txDone(seedTx);

    const fetchMock = vi.fn();
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;
    expect(await readDataRevision('image_cache')).toBe(0);

    const messages = [{ messageKey: 'm1', contentMarkdown: `![](${url})`, role: 'assistant', sequence: 1 }];
    const result = await inlineChatImagesInMessages({ conversationId: 40, messages });

    expect(result.fromCacheCount).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(messages[0].contentMarkdown).toBe(`![](syncnos-asset://${winnerId})`);
    expect(await readDataRevision('image_cache')).toBe(0);

    const verifyTx = db.transaction(['image_cache'], 'readonly');
    const stored = await reqToPromise<any>(verifyTx.objectStore('image_cache').get(winnerId));
    await txDone(verifyTx);
    expect(Object.prototype.hasOwnProperty.call(stored, 'byteSize')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stored, 'contentType')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stored, 'updatedAt')).toBe(false);
  });

  it('bumps image revision when a legacy dataUrl cache row is actually repaired with a Blob', async () => {
    const conversationId = 42;
    const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([5, 6, 7])).toString('base64')}`;
    const db = await openDb();
    const seedTx = db.transaction(['image_cache'], 'readwrite');
    const legacyId = await reqToPromise<number>(
      seedTx.objectStore('image_cache').add({
        conversationId,
        url: dataImageUrl,
        dataUrl: dataImageUrl,
        byteSize: 0,
        contentType: 'image/png',
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    await txDone(seedTx);
    expect(await readDataRevision('image_cache')).toBe(0);

    const messages = [
      { messageKey: 'legacy-data', contentMarkdown: `![](${dataImageUrl})`, role: 'assistant', sequence: 1 },
    ];
    const result = await inlineChatImagesInMessages({ conversationId, messages, enableHttpImages: false });

    expect(result.fromCacheCount).toBe(1);
    expect(messages[0].contentMarkdown).toBe(`![](syncnos-asset://${legacyId})`);
    expect(await readDataRevision('image_cache')).toBe(1);
    const verifyTx = db.transaction(['image_cache'], 'readonly');
    const repaired = await reqToPromise<any>(verifyTx.objectStore('image_cache').get(legacyId));
    await txDone(verifyTx);
    expect(repaired.blob).toBeInstanceOf(Blob);
    expect(repaired.byteSize).toBe(3);
  });

  it('returns a transaction-time race winner without overwriting it or bumping revision', async () => {
    const conversationId = 41;
    const url = 'https://example.com/race.png';
    let winnerId = 0;
    const fetchMock = vi.fn(async () => {
      const db = await openDb();
      const seedTx = db.transaction(['image_cache'], 'readwrite');
      winnerId = Number(
        await reqToPromise(
          seedTx.objectStore('image_cache').add({
            conversationId,
            url,
            blob: new Blob([Uint8Array.from([9, 9, 9])], { type: 'image/png' }),
            byteSize: 3,
            contentType: 'image/png',
            createdAt: 10,
            updatedAt: 11,
          }),
        ),
      );
      await txDone(seedTx);
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const messages = [{ messageKey: 'm-race', contentMarkdown: `![](${url})`, role: 'assistant', sequence: 1 }];
    const result = await inlineChatImagesInMessages({ conversationId, messages });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(winnerId).toBeGreaterThan(0);
    expect(messages[0].contentMarkdown).toBe(`![](syncnos-asset://${winnerId})`);
    expect(result.downloadedCount).toBe(1);
    expect(await readDataRevision('image_cache')).toBe(0);

    const db = await openDb();
    const verifyTx = db.transaction(['image_cache'], 'readonly');
    const rows = await reqToPromise<any[]>(verifyTx.objectStore('image_cache').getAll());
    await txDone(verifyTx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: winnerId,
      byteSize: 3,
      contentType: 'image/png',
      createdAt: 10,
      updatedAt: 11,
    });
    expect(await rows[0].blob.arrayBuffer()).toEqual(await new Blob([Uint8Array.from([9, 9, 9])]).arrayBuffer());
  });

  it('preserves transient capture policies while converting data images', async () => {
    const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([3, 1, 4])).toString('base64')}`;
    const messages = [
      {
        messageKey: 'm-policy',
        role: 'assistant',
        sequence: 0,
        contentText: 'fallback',
        contentMarkdown: `fallback\n\n![](${dataImageUrl})`,
        captureSequencePolicy: 'preserve-existing-tail',
        captureMergePolicy: 'preserve-existing-markdown',
      },
    ];

    const result = await inlineChatImagesInMessages({ conversationId: 3, messages, enableHttpImages: false });

    expect(result.messages[0]).toMatchObject({
      captureSequencePolicy: 'preserve-existing-tail',
      captureMergePolicy: 'preserve-existing-markdown',
    });
    expect(result.messages[0].contentMarkdown).toMatch(/syncnos-asset:\/\/\d+/);
  });

  it('keeps http urls when disabled, but still assets data:image markdown', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([2, 4, 6, 8])).toString('base64')}`;
    const messages = [
      { messageKey: 'm1', contentMarkdown: '![](https://example.com/a.png)', role: 'assistant', sequence: 1 },
      { messageKey: 'm2', contentMarkdown: `![](${dataImageUrl})`, role: 'assistant', sequence: 2 },
    ];

    const res = await inlineChatImagesInMessages({
      conversationId: 2,
      messages,
      enableHttpImages: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.downloadedCount).toBe(1);
    expect(String(messages[0].contentMarkdown)).toBe('![](https://example.com/a.png)');
    expect(String(messages[1].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
  });
});
