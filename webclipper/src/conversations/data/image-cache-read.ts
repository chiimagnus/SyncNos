import { openDb as openSchemaDb } from '../../platform/idb/schema';

type ImageCacheRow = {
  id?: number;
  conversationId: number;
  url: string;
  blob?: Blob;
  byteSize?: number;
  contentType?: string;
};

export type ImageCacheAsset = {
  id: number;
  conversationId: number;
  url: string;
  blob: Blob;
  byteSize: number;
  contentType: string;
};

let cachedDb: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

async function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb;
  if (openingDb) return openingDb;
  openingDb = openSchemaDb()
    .then((db) => {
      cachedDb = db;
      return db;
    })
    .finally(() => {
      openingDb = null;
    });
  return openingDb;
}

function tx(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
): { t: IDBTransaction; stores: Record<string, IDBObjectStore> } {
  const t = db.transaction(storeNames, mode);
  const stores: Record<string, IDBObjectStore> = {};
  for (const name of storeNames) stores[name] = t.objectStore(name);
  return { t, stores };
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
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

export async function getImageCacheAssetById(input: {
  id: number;
  conversationId?: number | null;
}): Promise<ImageCacheAsset | null> {
  const id = Number(input.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const db = await openDb();
  const { t, stores } = tx(db, ['image_cache'], 'readonly');
  const row = (await reqToPromise(stores.image_cache.get(id as any) as any)) as ImageCacheRow | undefined;
  await txDone(t);

  if (!row || !(row.blob instanceof Blob)) return null;
  const conversationId = Number(row.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) return null;

  const expectedConversationId = Number(input.conversationId);
  if (Number.isFinite(expectedConversationId) && expectedConversationId > 0 && expectedConversationId !== conversationId) {
    return null;
  }

  const byteSize = Number(row.byteSize) || row.blob.size || 0;
  if (byteSize <= 0) return null;

  const contentType = String(row.contentType || row.blob.type || '').trim().toLowerCase();
  return {
    id,
    conversationId,
    url: String(row.url || ''),
    blob: row.blob,
    byteSize,
    contentType,
  };
}
