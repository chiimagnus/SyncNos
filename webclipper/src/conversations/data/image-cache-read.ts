import { openDb as openSchemaDb } from '../../platform/idb/schema';

type ImageCacheRow = {
  id?: number;
  conversationId: number;
  url: string;
  dataUrl?: string;
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

function parseContentType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split(';')[0]!.trim().toLowerCase();
}

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
}

function base64ToBytes(base64: string): Uint8Array {
  const normalized = String(base64 || '').replace(/\s+/g, '');
  if (!normalized) return new Uint8Array();

  const atobFn = (globalThis as any).atob as ((input: string) => string) | undefined;
  if (typeof atobFn === 'function') {
    const binary = atobFn(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const bufferApi = (globalThis as any).Buffer as any;
  if (bufferApi && typeof bufferApi.from === 'function') {
    const nodeBuffer = bufferApi.from(normalized, 'base64');
    return new Uint8Array(nodeBuffer);
  }

  throw new Error('base64 decoder unavailable');
}

function utf8ToBytes(text: string): Uint8Array {
  const encoder = (globalThis as any).TextEncoder as (new () => TextEncoder) | undefined;
  if (encoder) {
    return new encoder().encode(String(text || ''));
  }
  const bufferApi = (globalThis as any).Buffer as any;
  if (bufferApi && typeof bufferApi.from === 'function') {
    const nodeBuffer = bufferApi.from(String(text || ''), 'utf8');
    return new Uint8Array(nodeBuffer);
  }
  const raw = String(text || '');
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i) & 0xff;
  return out;
}

function decodeDataImageUrlToBlob(dataUrl: string): Blob | null {
  const safeDataUrl = String(dataUrl || '').trim();
  if (!isDataImageUrl(safeDataUrl)) return null;

  const commaAt = safeDataUrl.indexOf(',');
  if (commaAt <= 0) return null;

  const meta = safeDataUrl.slice('data:'.length, commaAt).trim();
  const payload = safeDataUrl.slice(commaAt + 1);
  const metaParts = meta
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const contentType = parseContentType(metaParts[0] || '');
  if (!contentType.startsWith('image/')) return null;

  const isBase64 = metaParts.some((part) => part.toLowerCase() === 'base64');
  let bytes: Uint8Array;
  try {
    bytes = isBase64 ? base64ToBytes(payload) : utf8ToBytes(decodeURIComponent(payload));
  } catch (_e) {
    return null;
  }

  if ((bytes.byteLength || 0) <= 0) return null;
  return new Blob([Uint8Array.from(bytes)], { type: contentType });
}

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

  if (!row) return null;
  const conversationId = Number(row.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) return null;

  const expectedConversationId = Number(input.conversationId);
  if (Number.isFinite(expectedConversationId) && expectedConversationId > 0 && expectedConversationId !== conversationId) {
    return null;
  }

  let blob: Blob | null = null;
  const rawBlob = (row as any).blob as unknown;
  if (rawBlob instanceof Blob) {
    blob = rawBlob;
  } else if (rawBlob instanceof ArrayBuffer) {
    blob = new Blob([rawBlob], { type: parseContentType(row.contentType) });
  } else if (ArrayBuffer.isView(rawBlob)) {
    const view = rawBlob as ArrayBufferView;
    const copy = new ArrayBuffer(view.byteLength);
    new Uint8Array(copy).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    blob = new Blob([copy], { type: parseContentType(row.contentType) });
  } else if (!blob && row.dataUrl) {
    blob = decodeDataImageUrlToBlob(row.dataUrl);
  }

  if (!blob) return null;

  const byteSize = Number(row.byteSize) || blob.size || 0;
  if (byteSize <= 0) return null;

  const contentType = String(row.contentType || blob.type || '').trim().toLowerCase();
  return {
    id,
    conversationId,
    url: String(row.url || ''),
    blob,
    byteSize,
    contentType,
  };
}
