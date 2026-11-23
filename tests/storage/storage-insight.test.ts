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
    expect(progress.at(-1)).toEqual({ processed: 29, total: 29 });
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
