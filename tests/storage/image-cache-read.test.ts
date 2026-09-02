import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBDatabase, IDBKeyRange, IDBObjectStore, indexedDB } from 'fake-indexeddb';

import { closeDbForTests, openDb } from '@platform/idb/schema';
import {
  getImageCacheAssetById,
  getImageCacheAssetsByIds,
} from '@services/conversations/data/image-cache-read';

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
  });
}

async function deleteDb(name: string): Promise<void> {
  const request = indexedDB.deleteDatabase(name);
  await reqToPromise(request as unknown as IDBRequest<unknown>);
}

async function seedImageCacheRow(row: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(['image_cache'], 'readwrite');
  const done = txDone(transaction);
  await reqToPromise(transaction.objectStore('image_cache').put(row as any));
  await done;
}

function imageCacheTransactions(calls: unknown[][]): unknown[][] {
  return calls.filter(([storeNames]) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return names.includes('image_cache');
  });
}

describe('image cache bulk reader', () => {
  beforeEach(async () => {
    closeDbForTests();
    // @ts-expect-error fake IndexedDB test global
    globalThis.indexedDB = indexedDB;
    // @ts-expect-error fake IndexedDB test global
    globalThis.IDBKeyRange = IDBKeyRange;
    await deleteDb('webclipper');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDbForTests();
  });

  it('reads deduped ids in one readonly transaction and preserves normalization semantics', async () => {
    await seedImageCacheRow({
      id: 1,
      conversationId: 42,
      url: 'https://example.com/blob.png',
      blob: new Blob([Uint8Array.of(1, 2)], { type: 'image/png' }),
      byteSize: 2,
      contentType: 'IMAGE/PNG',
    });
    await seedImageCacheRow({
      id: 1.5,
      conversationId: 42,
      url: 'https://example.com/fractional.png',
      blob: new Blob([Uint8Array.of(9)], { type: 'image/png' }),
      byteSize: 1,
      contentType: 'image/png',
    });
    await seedImageCacheRow({
      id: 2,
      conversationId: 42,
      url: 'https://example.com/array-buffer.png',
      blob: Uint8Array.of(3, 4, 5).buffer,
      byteSize: 3,
      contentType: 'image/png; charset=utf-8',
    });
    await seedImageCacheRow({
      id: 3,
      conversationId: 42,
      url: 'https://example.com/view.png',
      blob: Uint8Array.of(6, 7),
      byteSize: 2,
      contentType: 'image/webp',
    });
    await seedImageCacheRow({
      id: 4,
      conversationId: 42,
      url: 'legacy:data-url',
      dataUrl: 'data:image/png;base64,AQID',
      byteSize: 3,
      contentType: 'image/png',
    });
    await seedImageCacheRow({
      id: 5,
      conversationId: 0,
      url: 'https://example.com/invalid-owner.png',
      blob: new Blob([Uint8Array.of(1)], { type: 'image/png' }),
      byteSize: 1,
      contentType: 'image/png',
    });
    await seedImageCacheRow({
      id: 6,
      conversationId: 99,
      url: 'https://example.com/other-conversation.png',
      blob: new Blob([Uint8Array.of(1)], { type: 'image/png' }),
      byteSize: 1,
      contentType: 'image/png',
    });
    await seedImageCacheRow({
      id: 7,
      conversationId: 42,
      url: 'https://example.com/empty.png',
      blob: new Blob([], { type: 'image/png' }),
      byteSize: 0,
      contentType: 'image/png',
    });

    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');
    const assets = await getImageCacheAssetsByIds({
      ids: [1, 1, 1.5, 2, 3, 4, 5, 6, 7, 0, -1, Number.NaN, Number.POSITIVE_INFINITY],
      conversationId: 42,
    });

    const imageGets = getSpy.mock.contexts.filter((context) => String((context as IDBObjectStore)?.name || '') === 'image_cache');
    expect(imageCacheTransactions(transactionSpy.mock.calls)).toHaveLength(1);
    expect(imageGets).toHaveLength(8);
    expect([...assets.keys()]).toEqual([1, 1.5, 2, 3, 4]);

    expect(assets.get(1)).toMatchObject({
      id: 1,
      conversationId: 42,
      url: 'https://example.com/blob.png',
      byteSize: 2,
      contentType: 'image/png',
    });
    expect(assets.get(1)?.blob).toBeInstanceOf(Blob);
    expect(assets.get(1.5)?.byteSize).toBe(1);
    expect(assets.get(2)?.blob.size).toBe(3);
    expect(assets.get(2)?.contentType).toBe('image/png; charset=utf-8');
    expect(assets.get(3)?.blob.size).toBe(2);
    expect(assets.get(4)?.blob.size).toBe(3);
    expect(assets.has(5)).toBe(false);
    expect(assets.has(6)).toBe(false);
    expect(assets.has(7)).toBe(false);
  });

  it('uses blob size and blob content type when legacy metadata is absent', async () => {
    await seedImageCacheRow({
      id: 8,
      conversationId: 42,
      url: 'https://example.com/fallback.webp',
      blob: new Blob([Uint8Array.of(1, 2, 3, 4)], { type: 'image/webp' }),
    });

    const assets = await getImageCacheAssetsByIds({ ids: [8], conversationId: 42 });
    expect(assets.get(8)).toMatchObject({ byteSize: 4, contentType: 'image/webp' });
  });

  it('does not open IndexedDB when there are no valid positive finite ids', async () => {
    await openDb();
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');

    const assets = await getImageCacheAssetsByIds({
      ids: [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      conversationId: 42,
    });

    expect(assets.size).toBe(0);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('rejects the whole bulk read when its readonly transaction aborts', async () => {
    await seedImageCacheRow({
      id: 9,
      conversationId: 42,
      url: 'https://example.com/abort.png',
      blob: new Blob([Uint8Array.of(1)], { type: 'image/png' }),
      byteSize: 1,
      contentType: 'image/png',
    });

    const originalTransaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (...args: any[]) {
      const transaction = (originalTransaction as any).apply(this, args) as IDBTransaction;
      const names = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (args[1] === 'readonly' && names.includes('image_cache')) queueMicrotask(() => transaction.abort());
      return transaction;
    });

    await expect(getImageCacheAssetsByIds({ ids: [9], conversationId: 42 })).rejects.toBeTruthy();
  });

  it('keeps the single reader as a thin compatibility surface over bulk ownership and missing semantics', async () => {
    await seedImageCacheRow({
      id: 10,
      conversationId: 42,
      url: 'https://example.com/single.png',
      blob: new Blob([Uint8Array.of(1, 2, 3)], { type: 'image/png' }),
      byteSize: 3,
      contentType: 'image/png',
    });

    await expect(getImageCacheAssetById({ id: 10, conversationId: 42 })).resolves.toMatchObject({
      id: 10,
      conversationId: 42,
      byteSize: 3,
    });
    await expect(getImageCacheAssetById({ id: 10, conversationId: 99 })).resolves.toBeNull();
    await expect(getImageCacheAssetById({ id: 404, conversationId: 42 })).resolves.toBeNull();
    await expect(getImageCacheAssetById({ id: 0, conversationId: 42 })).resolves.toBeNull();
  });
});
