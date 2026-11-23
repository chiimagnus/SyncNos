import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';

import { openDb, closeDbForTests } from '@platform/idb/schema';
import { readDataRevision } from '@services/data-revisions/storage-idb';
import { runTrackedTransaction } from '@services/data-revisions/transaction';
import { commitImageOptimization } from '@services/conversations/data/image-optimization-commit';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('request failed'));
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}
const pngBytes = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 73, 68, 65, 84, 0, 0, 0, 0,
]);
const source = new Blob([pngBytes, new Uint8Array(400)], { type: 'image/png' });
const candidate = new Blob([pngBytes], { type: 'image/png' });

type Setup = Awaited<ReturnType<typeof setup>>;

async function setup(options: { dataUrl?: string } = {}) {
  const db = await openDb();
  const conversationTx = db.transaction('conversations', 'readwrite');
  const ownerId = Number(
    await requestResult(
      conversationTx.objectStore('conversations').add({
        source: 'web',
        sourceType: 'article',
        conversationKey: 'my-article',
        lastActivityAt: 5,
      }),
    ),
  );
  await complete(conversationTx);
  const tx = db.transaction(['image_cache', 'messages'], 'readwrite');
  const id = Number(
    await requestResult(
      tx.objectStore('image_cache').add({
        conversationId: ownerId,
        url: 'https://example.com/img.png',
        blob: source,
        byteSize: source.size,
        contentType: 'image/png',
        createdAt: 17,
        updatedAt: 19,
        ...(options.dataUrl ? { dataUrl: options.dataUrl } : {}),
      }),
    ),
  );
  await requestResult(
    tx.objectStore('messages').add({
      conversationId: ownerId,
      messageKey: 'article_body',
      role: 'article',
      contentMarkdown: `![image](syncnos-asset://${id})`,
      sequence: 1,
      updatedAt: 42,
    }),
  );
  await complete(tx);
  const preview = {
    ok: true as const,
    originalBlob: source,
    optimizedBlob: candidate,
    originalBytes: source.size,
    optimizedBytes: candidate.size,
    savedBytes: source.size - candidate.size,
    contentType: 'image/png' as const,
    width: 1,
    height: 1,
    pixelsEqual: true,
  };
  const asset = {
    id,
    conversationId: ownerId,
    url: 'https://example.com/img.png',
    blob: source,
    byteSize: source.size,
    contentType: 'image/png',
  };
  return { db, id, ownerId, asset, preview, expectedRevision: await readDataRevision('image_cache') };
}
async function readAfter(setupResult: Setup) {
  const tx = setupResult.db.transaction(['image_cache', 'messages', 'conversations'], 'readonly');
  const result = await Promise.all([
    requestResult(tx.objectStore('image_cache').get(setupResult.id)),
    requestResult(tx.objectStore('messages').getAll()),
    requestResult(tx.objectStore('conversations').get(setupResult.ownerId)),
  ]);
  await complete(tx);
  return { asset: result[0] as any, messages: result[1] as any[], conversation: result[2] as any };
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

describe('atomic image optimization commit', () => {
  it('replaces one Blob with the same ID/ownership and publishes a durable image revision', async () => {
    const data = await setup({ dataUrl: 'data:image/png;base64,AAAA' });
    const result = await commitImageOptimization({
      selection: { id: data.id, conversationId: data.ownerId },
      originalAsset: data.asset,
      preview: data.preview,
      expectedRevision: data.expectedRevision,
    });
    expect(result).toMatchObject({ id: data.id, bytesSaved: source.size - candidate.size, contentType: 'image/png' });
    const after = await readAfter(data);
    expect(after.asset).toMatchObject({
      id: data.id,
      conversationId: data.ownerId,
      url: data.asset.url,
      contentType: 'image/png',
      byteSize: candidate.size,
      createdAt: 17,
    });
    expect(after.asset).not.toHaveProperty('dataUrl');
    expect(after.asset.updatedAt).toBeGreaterThan(19);
    expect(after.asset.blob).toBeInstanceOf(Blob);
    expect(new Uint8Array(await after.asset.blob.arrayBuffer())).toEqual(new Uint8Array(await candidate.arrayBuffer()));
    expect(after.messages[0]?.contentMarkdown).toBe(`![image](syncnos-asset://${data.id})`);
    expect(after.conversation.lastActivityAt).toBe(5);
    expect(await readDataRevision('image_cache')).toBe(data.expectedRevision + 1);
  });

  it('converts an actual legacy Data URL-only row only after a verified save', async () => {
    const data = await setup();
    const legacy = data.db.transaction('image_cache', 'readwrite');
    const row: any = await requestResult(legacy.objectStore('image_cache').get(data.id));
    delete row.blob;
    row.dataUrl = 'data:image/png;base64,' + Buffer.from(await source.arrayBuffer()).toString('base64');
    await requestResult(legacy.objectStore('image_cache').put(row));
    await complete(legacy);

    const converted = await getImageCacheAssetById({ id: data.id, conversationId: data.ownerId });
    expect(converted?.blob).toBeInstanceOf(Blob);
    await commitImageOptimization({
      selection: { id: data.id, conversationId: data.ownerId },
      originalAsset: converted!,
      preview: { ...data.preview, originalBlob: converted!.blob },
      expectedRevision: data.expectedRevision,
    });
    const after = await readAfter(data);
    expect(after.asset).not.toHaveProperty('dataUrl');
    expect(after.asset.blob.size).toBe(candidate.size);
  });

  it('fails closed when preview revision is stale and leaves existing bytes intact', async () => {
    const data = await setup();
    await runTrackedTransaction(
      { db: data.db, stores: ['image_cache'], revisionScopes: ['image_cache'] },
      async ({ stores, markChanged }) => {
        const old: any = await requestResult(stores.image_cache.get(data.id));
        await requestResult(stores.image_cache.put({ ...old, updatedAt: 999 }));
        markChanged('image_cache');
      },
    );
    await expect(
      commitImageOptimization({
        selection: { id: data.id, conversationId: data.ownerId },
        originalAsset: data.asset,
        preview: data.preview,
        expectedRevision: data.expectedRevision,
      }),
    ).rejects.toThrow('image_optimization_conflict');
    const after = await readAfter(data);
    expect(after.asset.blob.size).toBe(source.size);
    expect(after.asset.updatedAt).toBe(999);
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('does not overwrite a direct untracked size/mtime change or a missing owner', async () => {
    const data = await setup();
    const update = data.db.transaction('image_cache', 'readwrite');
    const row: any = await requestResult(update.objectStore('image_cache').get(data.id));
    await requestResult(update.objectStore('image_cache').put({ ...row, byteSize: 5, updatedAt: 25 }));
    await complete(update);
    await expect(
      commitImageOptimization({
        selection: { id: data.id, conversationId: data.ownerId },
        originalAsset: data.asset,
        preview: data.preview,
        expectedRevision: data.expectedRevision,
      }),
    ).rejects.toThrow('image_optimization_conflict');

    const ownerDelete = data.db.transaction('conversations', 'readwrite');
    await requestResult(ownerDelete.objectStore('conversations').delete(data.ownerId));
    await complete(ownerDelete);
    await expect(
      commitImageOptimization({
        selection: { id: data.id, conversationId: data.ownerId },
        originalAsset: data.asset,
        preview: data.preview,
        expectedRevision: data.expectedRevision,
      }),
    ).rejects.toThrow('image_optimization_conflict');
    expect((await readAfter(data)).asset.blob.size).toBe(source.size);
  });

  it('does not permit ambiguous outcomes to be retried with a stale preview', async () => {
    const data = await setup();
    const command = {
      selection: { id: data.id, conversationId: data.ownerId },
      originalAsset: data.asset,
      preview: data.preview,
      expectedRevision: data.expectedRevision,
    };
    await commitImageOptimization(command);
    await expect(commitImageOptimization(command)).rejects.toThrow('image_optimization_conflict');
    expect((await readAfter(data)).asset.blob.size).toBe(candidate.size);
  });

  it('rejects changed pixels or malformed candidate metadata before writing', async () => {
    const data = await setup();
    await expect(
      commitImageOptimization({
        selection: { id: data.id, conversationId: data.ownerId },
        originalAsset: data.asset,
        preview: { ...data.preview, pixelsEqual: false },
        expectedRevision: data.expectedRevision,
      }),
    ).rejects.toThrow('image_optimization_invalid_preview');

    await expect(
      commitImageOptimization({
        selection: { id: data.id, conversationId: data.ownerId },
        originalAsset: data.asset,
        preview: { ...data.preview, optimizedBytes: 1 },
        expectedRevision: data.expectedRevision,
      }),
    ).rejects.toThrow('image_optimization_invalid_preview');
    expect(await readDataRevision('image_cache')).toBe(0);
  });

  it('preserves original data and revision when a storage write fails', async () => {
    const data = await setup();
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args: any[]) {
      if (this.name === 'image_cache') throw new DOMException('quota exceeded', 'QuotaExceededError');
      return (original as any).apply(this, args);
    });
    await expect(
      commitImageOptimization({
        selection: { id: data.id, conversationId: data.ownerId },
        originalAsset: data.asset,
        preview: data.preview,
        expectedRevision: data.expectedRevision,
      }),
    ).rejects.toThrow('quota exceeded');
    expect((await readAfter(data)).asset.blob.size).toBe(source.size);
    expect(await readDataRevision('image_cache')).toBe(0);
  });
});
