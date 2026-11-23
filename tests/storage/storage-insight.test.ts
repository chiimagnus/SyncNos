import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore, IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { openDb, closeDbForTests } from '@platform/idb/schema';
import { getStorageOverview } from '@services/insight/storage-insight-source';

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
