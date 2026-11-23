import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

import { closeDbForTests, openDb } from '@platform/idb/schema';
import { runTrackedTransaction } from '@services/data-revisions/transaction';
import { scanDuplicateImageAssets } from '@services/insight/image-duplicates';
import type { StorageAssetInfo } from '@services/insight/storage-insight-source';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('idb_error'));
  });
}
async function createConversation(id: number): Promise<void> {
  const db = await openDb();
  await requestResult(
    db
      .transaction('conversations', 'readwrite')
      .objectStore('conversations')
      .add({
        id,
        source: 'web',
        sourceType: 'article',
        conversationKey: `article-${id}`,
        lastActivityAt: id,
      }),
  );
}
async function addImage(owner: number, url: string, bytes: Uint8Array): Promise<StorageAssetInfo> {
  const db = await openDb();
  const id = Number(
    await requestResult(
      db
        .transaction('image_cache', 'readwrite')
        .objectStore('image_cache')
        .add({
          conversationId: owner,
          url,
          blob: new Blob([bytes], { type: 'image/png' }),
          byteSize: bytes.length,
          contentType: 'image/png',
        }),
    ),
  );
  return {
    id,
    conversationId: owner,
    url,
    bytes: bytes.byteLength,
    contentType: 'image/png',
    format: 'png',
    animation: 'static',
    legacy: false,
    orphan: false,
    metadataMismatch: false,
    formatMismatch: false,
    readable: true,
    title: `Article ${owner}`,
    source: 'web',
    loc: '',
  };
}

beforeEach(async () => {
  closeDbForTests();
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  await requestResult(indexedDB.deleteDatabase('webclipper'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  closeDbForTests();
});

describe('read-only duplicate image analysis', () => {
  it('groups different URLs and owners only by exact SHA-256, not by URL or byte size', async () => {
    await createConversation(1);
    await createConversation(2);
    const a = await addImage(1, 'https://same.test/a.png', Uint8Array.of(1, 2, 3, 4));
    const b = await addImage(2, 'https://other.test/a.png', Uint8Array.of(1, 2, 3, 4));
    const c = await addImage(2, 'https://same.test/a.png', Uint8Array.of(4, 3, 2, 1));
    const d = await addImage(1, 'only.png', Uint8Array.of(7, 8));
    const unhashable = { ...d, id: 999, bytes: 4, readable: false };
    const result = await scanDuplicateImageAssets([a, b, c, d, unhashable]);
    expect(result).toMatchObject({
      candidates: 3,
      hashed: 3,
      duplicateGroups: 1,
      potentialRedundantBytes: 4,
      hashErrors: 0,
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.assets.map((asset) => asset.id)).toEqual([a.id, b.id]);
    expect(result.groups[0]?.bytes).toBe(4);
    expect(result.groups[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.groups[0]?.assets.map((asset) => asset.conversationId)).toEqual([1, 2]);
  });

  it('reads large files in bounded chunks, never materializes whole Blob into one ArrayBuffer', async () => {
    await createConversation(1);
    const large = new Uint8Array(800_000);
    for (let i = 0; i < large.length; i++) large[i] = i % 251;
    const a = await addImage(1, 'large-a', large);
    const b = await addImage(1, 'large-b', large);
    const slice = vi.spyOn(Blob.prototype, 'slice');
    const result = await scanDuplicateImageAssets([a, b]);
    expect(result.potentialRedundantBytes).toBe(large.byteLength);
    const readWindows = slice.mock.calls.filter(([start, end]) => typeof start === 'number' && typeof end === 'number');
    expect(readWindows.length).toBeGreaterThanOrEqual(6);
    expect(readWindows.every(([start, end]) => Number(end) - Number(start) <= 256 * 1024)).toBe(true);
  });

  it('ignores missing assets, invalid owners, and stale size metadata while keeping an explicit error count', async () => {
    await createConversation(1);
    const a = await addImage(1, 'valid-a', Uint8Array.of(1, 2, 3, 4));
    const b = await addImage(1, 'valid-b', Uint8Array.of(1, 2, 3, 4));
    const wrongOwner = { ...b, conversationId: 999 };
    const missing = { ...a, id: 777 };
    const result = await scanDuplicateImageAssets([a, wrongOwner, missing, { ...a, bytes: 999 }]);
    expect(result.groups).toHaveLength(0);
    expect(result.hashErrors).toBeGreaterThanOrEqual(1);
    expect(result.potentialRedundantBytes).toBe(0);
  });

  it('rejects a concurrent image-cache revision instead of reporting an inconsistent snapshot', async () => {
    await createConversation(1);
    const a = await addImage(1, 'a', Uint8Array.of(1, 2));
    const b = await addImage(1, 'b', Uint8Array.of(1, 2));
    let changed = false;
    const db = await openDb();
    await expect(
      scanDuplicateImageAssets([a, b], {
        onProgress: async () => {
          if (changed) return;
          changed = true;
          await runTrackedTransaction(
            { db, stores: ['image_cache'], revisionScopes: ['image_cache'] },
            async ({ stores, markChanged }) => {
              await requestResult(
                stores.image_cache.add({
                  conversationId: 1,
                  url: 'late',
                  blob: new Blob([Uint8Array.of(3)]),
                  byteSize: 1,
                  contentType: 'image/png',
                }),
              );
              markChanged('image_cache');
            },
          );
        },
      }),
    ).rejects.toThrow('storage_insight_stale');
  });

  it('cancels before later hashing and never changes any image records', async () => {
    await createConversation(1);
    const a = await addImage(1, 'a', Uint8Array.of(1, 2));
    const b = await addImage(1, 'b', Uint8Array.of(1, 2));
    const controller = new AbortController();
    const db = await openDb();
    const before = await requestResult(db.transaction('image_cache').objectStore('image_cache').count());
    await expect(
      scanDuplicateImageAssets([a, b], {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const after = await requestResult(db.transaction('image_cache').objectStore('image_cache').count());
    expect(after).toBe(before);
  });
});
