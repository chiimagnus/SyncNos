import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { closeDbForTests, openDb } from '@platform/idb/schema';
import { readDataRevision } from '@services/data-revisions/storage-idb';
import { runTrackedTransaction } from '@services/data-revisions/transaction';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';

const codec = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('@platform/image/canvas-codec', () => ({
  renderPngCandidate: (...args: unknown[]) => codec.render(...args),
}));
import { optimizeConversationImages } from '@services/conversations/data/conversation-image-optimization';

function request<T>(item: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    item.onsuccess = () => resolve(item.result);
    item.onerror = () => reject(item.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

const chunk = (kind: string, bytes: number[] = []) => [
  (bytes.length >>> 24) & 255,
  (bytes.length >>> 16) & 255,
  (bytes.length >>> 8) & 255,
  bytes.length & 255,
  ...Array.from(kind, (ch) => ch.charCodeAt(0)),
  ...bytes,
  0,
  0,
  0,
  0,
];

function png(payloadLength = 0, ancillary = false): Blob {
  return new Blob(
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
        ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
        ...(ancillary ? chunk('tEXt', [1, 2, 3]) : []),
        ...chunk('IDAT', Array(payloadLength).fill(7)),
        ...chunk('IEND'),
      ]),
    ],
    { type: 'image/png' },
  );
}

const source = png(600);
const smaller = png(16);
const pixels = new Uint8ClampedArray([44, 66, 88, 255]);
const output = (blob = smaller, after = pixels) => ({
  blob,
  originalPixels: pixels,
  optimizedPixels: after,
});

async function addOwner(key: string) {
  const db = await openDb();
  const tx = db.transaction('conversations', 'readwrite');
  const completed = done(tx);
  const id = Number(
    await request(
      tx.objectStore('conversations').add({
        source: 'web',
        sourceType: 'article',
        conversationKey: key,
        lastActivityAt: 8,
      }),
    ),
  );
  await completed;
  return id;
}

async function addAsset(conversationId: number, blob: Blob = source, contentType = blob.type) {
  const db = await openDb();
  const tx = db.transaction('image_cache', 'readwrite');
  const completed = done(tx);
  const id = Number(
    await request(
      tx.objectStore('image_cache').add({
        conversationId,
        url: 'https://example.com/' + Math.random() + '.png',
        blob,
        contentType,
        byteSize: blob.size,
        createdAt: 10,
        updatedAt: 11,
        dataUrl: 'data:image/png;base64,AAAA',
      }),
    ),
  );
  await completed;
  return id;
}

async function row(id: number) {
  const db = await openDb();
  const tx = db.transaction('image_cache', 'readonly');
  const completed = done(tx);
  const found = (await request(tx.objectStore('image_cache').get(id))) as Record<string, unknown>;
  await completed;
  return found;
}

beforeEach(async () => {
  closeDbForTests();
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  codec.render.mockReset();
  await request(indexedDB.deleteDatabase('webclipper'));
});
afterEach(() => {
  closeDbForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('image optimization scoped to one detail item', () => {
  it('commits smaller pixel-identical PNG preserving owner, ID and original Markdown references', async () => {
    const owner = await addOwner('article');
    const id = await addAsset(owner);
    const db = await openDb();
    const messageTx = db.transaction('messages', 'readwrite');
    const completed = done(messageTx);
    await request(
      messageTx.objectStore('messages').add({
        conversationId: owner,
        messageKey: 'content',
        role: 'article',
        sequence: 1,
        contentMarkdown: `![图片](syncnos-asset://${id})`,
      }),
    );
    await completed;
    const revision = await readDataRevision('image_cache');
    codec.render.mockResolvedValueOnce(output());
    const progress = vi.fn();
    const result = await optimizeConversationImages({ conversationId: owner, ids: [id, id], onProgress: progress });

    expect(result).toEqual({
      total: 1,
      processed: 1,
      optimized: 1,
      bytesSaved: source.size - smaller.size,
      cancelled: false,
    });
    expect(progress).toHaveBeenCalledOnce();
    expect(await readDataRevision('image_cache')).toBe(revision + 1);
    const saved = await row(id);
    expect(saved).toMatchObject({
      id,
      conversationId: owner,
      contentType: 'image/png',
      byteSize: smaller.size,
      createdAt: 10,
    });
    expect(saved.dataUrl).toBeUndefined();
    expect(Number(saved.updatedAt)).toBeGreaterThan(11);
    const parsed = await getImageCacheAssetById({ id, conversationId: owner });
    expect(await parsed?.blob.arrayBuffer()).toEqual(await smaller.arrayBuffer());
    const verify = db.transaction(['messages', 'conversations'], 'readonly');
    const verifyCompleted = done(verify);
    const messages = (await request(verify.objectStore('messages').getAll())) as Array<{ contentMarkdown: string }>;
    const convo = (await request(verify.objectStore('conversations').get(owner))) as { lastActivityAt: number };
    await verifyCompleted;
    expect(messages[0]!.contentMarkdown).toBe(`![图片](syncnos-asset://${id})`);
    expect(convo.lastActivityAt).toBe(8);
  });

  it('excludes foreign owner, animated PNG, PNG metadata, wrong MIME, and JPEG without codec invocation', async () => {
    const owner = await addOwner('owner');
    const foreignOwner = await addOwner('other');
    const foreign = await addAsset(foreignOwner);
    const apng = new Blob(
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
          ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
          ...chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 1]),
          ...chunk('IDAT'),
          ...chunk('IEND'),
        ]),
      ],
      { type: 'image/png' },
    );
    const ids = [
      foreign,
      await addAsset(owner, apng),
      await addAsset(owner, png(500, true)),
      await addAsset(owner, source, 'image/jpeg'),
      await addAsset(owner, new Blob(['JPEG'], { type: 'image/jpeg' })),
    ];
    const result = await optimizeConversationImages({ conversationId: owner, ids });
    expect(result).toMatchObject({ processed: ids.length, optimized: 0, bytesSaved: 0 });
    expect(codec.render).not.toHaveBeenCalled();
    expect(await readDataRevision('image_cache')).toBe(0);
    expect((await row(foreign)).blob).toBeInstanceOf(Blob);
  });

  it('rejects changed pixels or non-saving outputs without replacing the image', async () => {
    const owner = await addOwner('pixel');
    const id = await addAsset(owner);
    codec.render.mockResolvedValueOnce(output(smaller, new Uint8ClampedArray([44, 66, 89, 255])));
    codec.render.mockResolvedValueOnce(output(png(900)));
    const first = await optimizeConversationImages({ conversationId: owner, ids: [id] });
    const second = await optimizeConversationImages({ conversationId: owner, ids: [id] });
    expect(first.optimized).toBe(0);
    expect(second.optimized).toBe(0);
    expect((await row(id)).byteSize).toBe(source.size);
    expect(await readDataRevision('image_cache')).toBe(0);
  });

  it('refuses to overwrite concurrent changes made while encoding', async () => {
    const owner = await addOwner('concurrent');
    const id = await addAsset(owner);
    codec.render.mockImplementationOnce(async () => {
      const db = await openDb();
      await runTrackedTransaction(
        { db, stores: ['image_cache'], revisionScopes: ['image_cache'] },
        async ({ stores, markChanged }) => {
          const old = (await request(stores.image_cache.get(id))) as Record<string, unknown>;
          await request(stores.image_cache.put({ ...old, updatedAt: 999 }));
          markChanged('image_cache');
        },
      );
      return output();
    });
    const result = await optimizeConversationImages({ conversationId: owner, ids: [id] });
    expect(result.optimized).toBe(0);
    expect((await row(id)).updatedAt).toBe(999);
    expect((await row(id)).byteSize).toBe(source.size);
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('stops on cancellation between assets and leaves the remaining bytes intact', async () => {
    const owner = await addOwner('abort');
    const first = await addAsset(owner);
    const second = await addAsset(owner);
    codec.render.mockResolvedValue(output());
    const abort = new AbortController();
    const result = await optimizeConversationImages({
      conversationId: owner,
      ids: [first, second],
      signal: abort.signal,
      onProgress: () => abort.abort(),
    });
    expect(result).toMatchObject({ processed: 1, total: 2, optimized: 1, cancelled: true });
    expect((await row(first)).byteSize).toBe(smaller.size);
    expect((await row(second)).byteSize).toBe(source.size);
  });

  it('does not report storage write failures as a successful skip', async () => {
    const owner = await addOwner('write-fail');
    const id = await addAsset(owner);
    codec.render.mockResolvedValueOnce(output());
    const previous = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      if (this.name === 'image_cache') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return previous.apply(this, args as [unknown]);
    });
    await expect(optimizeConversationImages({ conversationId: owner, ids: [id] })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    spy.mockRestore();
    expect((await row(id)).byteSize).toBe(source.size);
    expect(await readDataRevision('image_cache')).toBe(0);
  });
});
