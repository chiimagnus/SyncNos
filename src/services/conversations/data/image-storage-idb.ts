import { openDb as openSchemaDb } from '@platform/idb/schema';
import { LocalDataContractError } from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';

import type {
  ImageAsset,
  ImageAssetOwner,
  ImageAssetReference,
  ImageAssetWriteInput,
  ImageStorage,
} from './image-storage';

type ImageCacheRow = Readonly<{
  blob?: unknown;
  byteSize?: unknown;
  contentType?: unknown;
  conversationId?: unknown;
  createdAt?: unknown;
  dataUrl?: unknown;
  id?: unknown;
  updatedAt?: unknown;
  url?: unknown;
}>;

let cachedDb: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

function protocolFailure(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
}

function ownerConversationId(owner: ImageAssetOwner): number {
  const id = Number(owner?.conversationId);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !String(owner?.source || '').trim() ||
    !String(owner?.conversationKey || '').trim()
  ) {
    throw new LocalDataContractError('STALE_REFERENCE');
  }
  return id;
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseContentType(value: unknown): string {
  const raw = String(value || '').trim();
  return raw ? raw.split(';')[0]!.trim().toLowerCase() : '';
}

function isDataImageUrl(url: unknown): boolean {
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(String(url || '').trim());
}

function base64ToBytes(base64: string): Uint8Array {
  const normalized = String(base64 || '').replace(/\s+/g, '');
  const atobFn = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof atobFn === 'function') {
    const binary = atobFn(normalized);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  const bufferApi = (globalThis as { Buffer?: { from: (input: string, encoding: string) => Uint8Array } }).Buffer;
  if (bufferApi?.from) return Uint8Array.from(bufferApi.from(normalized, 'base64'));
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(String(text || ''));
}

function decodeDataImageUrlToBlob(dataUrl: string): Blob | null {
  const value = String(dataUrl || '').trim();
  if (!isDataImageUrl(value)) return null;
  const commaAt = value.indexOf(',');
  if (commaAt <= 0) return null;
  const parts = value
    .slice('data:'.length, commaAt)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const contentType = parseContentType(parts[0]);
  if (!contentType.startsWith('image/')) return null;
  try {
    const bytes = parts.some((part) => part.toLowerCase() === 'base64')
      ? base64ToBytes(value.slice(commaAt + 1))
      : utf8ToBytes(decodeURIComponent(value.slice(commaAt + 1)));
    return bytes.byteLength > 0 ? new Blob([Uint8Array.from(bytes)], { type: contentType }) : null;
  } catch {
    return null;
  }
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

function transaction(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): Readonly<{ store: IDBObjectStore; transaction: IDBTransaction }> {
  const transaction = db.transaction(['image_cache'], mode);
  return { store: transaction.objectStore('image_cache'), transaction };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
  });
}

function blobFromRow(row: ImageCacheRow): Blob | null {
  if (row.blob instanceof Blob) return row.blob;
  if (row.blob instanceof ArrayBuffer) return new Blob([row.blob], { type: parseContentType(row.contentType) });
  if (ArrayBuffer.isView(row.blob)) {
    const view = row.blob;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return new Blob([copy], { type: parseContentType(row.contentType) });
  }
  return typeof row.dataUrl === 'string' ? decodeDataImageUrlToBlob(row.dataUrl) : null;
}

function referenceFromRow(row: ImageCacheRow, expectedConversationId: number): ImageAssetReference | null {
  const id = positiveId(row.id);
  const conversationId = positiveId(row.conversationId);
  const blob = blobFromRow(row);
  const byteSize = Number(row.byteSize) || blob?.size || 0;
  if (!id || conversationId !== expectedConversationId || !blob || !Number.isFinite(byteSize) || byteSize <= 0)
    return null;
  return Object.freeze({
    id,
    byteSize,
    contentType: parseContentType(row.contentType || blob.type),
  });
}

function assetFromRow(row: ImageCacheRow, expectedConversationId: number): ImageAsset | null {
  const reference = referenceFromRow(row, expectedConversationId);
  const blob = blobFromRow(row);
  if (!reference || !blob) return null;
  return Object.freeze({
    ...reference,
    blob,
    conversationId: expectedConversationId,
    url: String(row.url || '').trim(),
  });
}

async function readById(id: number): Promise<ImageCacheRow | null> {
  const db = await openDb();
  const { store, transaction: current } = transaction(db, 'readonly');
  const row = (await requestToPromise(store.get(id) as IDBRequest<ImageCacheRow | undefined>)) ?? null;
  await transactionDone(current);
  return row;
}

async function readByUrl(conversationId: number, url: string): Promise<ImageCacheRow | null> {
  const db = await openDb();
  const { store, transaction: current } = transaction(db, 'readonly');
  const index = store.index('by_conversationId_url');
  const row =
    (await requestToPromise(index.get([conversationId, url]) as IDBRequest<ImageCacheRow | undefined>)) ?? null;
  await transactionDone(current);
  return row;
}

async function putImageAsset(input: ImageAssetWriteInput, lease: FactsOperationLease): Promise<ImageAssetReference> {
  const conversationId = ownerConversationId(input.owner);
  const url = String(input.url || '').trim();
  if (!url || !(input.blob instanceof Blob)) throw new LocalDataContractError('INVALID_ARGUMENT');
  const byteSize = Number(input.byteSize) || input.blob.size || 0;
  if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize !== input.blob.size) {
    throw new LocalDataContractError('INVALID_ARGUMENT');
  }
  const contentType = parseContentType(input.contentType || input.blob.type);
  if (!contentType) throw new LocalDataContractError('INVALID_ARGUMENT');
  assertFactsOperationLease(lease);
  const db = await openDb();
  assertFactsOperationLease(lease);
  const { store, transaction: current } = transaction(db, 'readwrite');
  const index = store.index('by_conversationId_url');
  const existing = await requestToPromise(index.get([conversationId, url]) as IDBRequest<ImageCacheRow | undefined>);
  assertFactsOperationLease(lease);
  const now = Date.now();
  const dataUrl = String(input.dataUrl || '').trim();
  const record = {
    ...(positiveId(existing?.id) ? { id: positiveId(existing?.id)! } : {}),
    conversationId,
    url,
    ...(dataUrl ? { dataUrl } : typeof existing?.dataUrl === 'string' ? { dataUrl: existing.dataUrl } : {}),
    blob: input.blob,
    byteSize,
    contentType,
    createdAt: Number(existing?.createdAt) || now,
    updatedAt: now,
  };
  const nextId = Number((await requestToPromise(store.put(record))) || existing?.id);
  await transactionDone(current);
  assertFactsOperationLease(lease);
  if (!Number.isSafeInteger(nextId) || nextId <= 0) protocolFailure();
  return Object.freeze({ id: nextId, byteSize, contentType });
}

export function createIdbImageStorage(lease: FactsOperationLease): ImageStorage {
  const assertLease = () => assertFactsOperationLease(lease);
  return Object.freeze({
    async findAssetByUrl(owner, rawUrl) {
      const conversationId = ownerConversationId(owner);
      const url = String(rawUrl || '').trim();
      if (!url) return null;
      assertLease();
      const row = await readByUrl(conversationId, url);
      assertLease();
      if (!row) return null;
      const reference = referenceFromRow(row, conversationId);
      if (reference) return reference;
      if (typeof row.dataUrl !== 'string') return null;
      const blob = decodeDataImageUrlToBlob(row.dataUrl);
      if (!blob) return null;
      return await putImageAsset(
        { owner, url, blob, byteSize: blob.size, contentType: blob.type, dataUrl: row.dataUrl },
        lease,
      );
    },
    async getAsset(owner, rawId) {
      const conversationId = ownerConversationId(owner);
      const id = positiveId(rawId);
      if (!id) return null;
      assertLease();
      const row = await readById(id);
      assertLease();
      return row ? assetFromRow(row, conversationId) : null;
    },
    async putAsset(input) {
      return await putImageAsset(input, lease);
    },
  });
}

export async function __closeImageStorageDbForTests(): Promise<void> {
  try {
    (cachedDb || (openingDb ? await openingDb : null))?.close();
  } finally {
    cachedDb = null;
    openingDb = null;
  }
}
