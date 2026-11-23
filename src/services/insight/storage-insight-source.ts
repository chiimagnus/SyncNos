import { openDb } from '@platform/idb/schema';
import { estimateOriginStorage } from '@platform/storage/storage-estimate';
import { readDataRevisionSnapshot } from '@services/data-revisions/storage-idb';
import { normalizeImageCacheAsset, type ImageCacheRow } from '@services/conversations/data/image-cache-read';
import { inspectImageBlob, type AnimationState, type ImageFormat } from '@services/insight/image-format';

export type StorageOverview = {
  imageCacheRecords: number;
  originUsageBytes: number | null;
  originQuotaBytes: number | null;
};

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('indexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('indexedDB transaction aborted'));
  });
}

export async function getStorageOverview(): Promise<StorageOverview> {
  const db = await openDb();
  const transaction = db.transaction('image_cache', 'readonly');
  const done = transactionDone(transaction);
  const estimate = estimateOriginStorage();
  const [imageCacheRecords, , origin] = await Promise.all([
    requestDone(transaction.objectStore('image_cache').count()),
    done,
    estimate,
  ]);

  return {
    imageCacheRecords,
    originUsageBytes: origin.usageBytes,
    originQuotaBytes: origin.quotaBytes,
  };
}

export type StorageAssetInfo = {
  id: number;
  conversationId: number;
  url: string;
  bytes: number;
  contentType: string;
  format: ImageFormat;
  animation: AnimationState;
  legacy: boolean;
  orphan: boolean;
  metadataMismatch: boolean;
  formatMismatch: boolean;
  readable: boolean;
};

export type StorageAssetScan = {
  records: number;
  readableCount: number;
  unreadableCount: number;
  orphanCount: number;
  legacyCount: number;
  metadataMismatchCount: number;
  formatMismatchCount: number;
  bytes: number;
  animatedCount: number;
  unknownAnimationCount: number;
  formats: Array<{ format: ImageFormat; count: number; bytes: number }>;
  topImages: StorageAssetInfo[];
  assetsById: Map<number, StorageAssetInfo>;
};

const SCAN_BATCH_SIZE = 24;
const TOP_IMAGE_LIMIT = 12;

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Storage scan cancelled', 'AbortError');
}

async function countCacheRows(db: IDBDatabase): Promise<number> {
  const transaction = db.transaction('image_cache', 'readonly');
  const done = transactionDone(transaction);
  const count = await requestDone(transaction.objectStore('image_cache').count());
  await done;
  return count;
}

async function listConversationIds(db: IDBDatabase): Promise<Set<number>> {
  const transaction = db.transaction('conversations', 'readonly');
  const done = transactionDone(transaction);
  const ids = new Set<number>();
  await new Promise<void>((resolve, reject) => {
    const request = transaction.objectStore('conversations').openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const id = Number(cursor.key);
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('indexedDB key cursor failed'));
  });
  await done;
  return ids;
}

async function nextAssetBatch(db: IDBDatabase, after: number | null): Promise<ImageCacheRow[]> {
  const transaction = db.transaction('image_cache', 'readonly');
  const done = transactionDone(transaction);
  const range = after == null ? undefined : IDBKeyRange.lowerBound(after, true);
  const rows = await requestDone(transaction.objectStore('image_cache').getAll(range, SCAN_BATCH_SIZE));
  await done;
  return rows as ImageCacheRow[];
}

function isFormatMismatch(contentType: string, format: ImageFormat): boolean {
  const claimed = contentType.split(';')[0]?.trim().toLowerCase();
  if (!claimed?.startsWith('image/') || format === 'unknown') return false;
  const normalized = claimed === 'image/jpg' ? 'image/jpeg' : claimed === 'image/apng' ? 'image/png' : claimed;
  return normalized !== `image/${format === 'svg' ? 'svg+xml' : format}`;
}

async function describeAsset(row: ImageCacheRow, owners: Set<number>): Promise<StorageAssetInfo> {
  const id = Number(row.id);
  const conversationId = Number(row.conversationId);
  const asset = normalizeImageCacheAsset({ id, row });
  const blob = asset?.blob;
  const readable = !!blob && blob.size > 0;
  let format: ImageFormat = 'unknown';
  let animation: AnimationState = 'unknown';
  if (readable && blob) {
    try {
      ({ format, animation } = await inspectImageBlob(blob));
    } catch (_error) {
      // Bytes may be readable even when the inspection API is unavailable.
    }
  }
  const contentType = String(row.contentType || blob?.type || '')
    .trim()
    .toLowerCase();
  return {
    id,
    conversationId,
    url: String(row.url || ''),
    bytes: readable ? blob!.size : 0,
    contentType,
    format,
    animation,
    legacy: !row.blob && typeof row.dataUrl === 'string',
    orphan: !owners.has(conversationId),
    metadataMismatch: readable && Number(row.byteSize) > 0 && Number(row.byteSize) !== blob!.size,
    formatMismatch: isFormatMismatch(contentType, format),
    readable,
  };
}

export async function scanStorageAssets(
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: { processed: number; total: number }) => void | Promise<void>;
  } = {},
): Promise<StorageAssetScan> {
  checkCancelled(options.signal);
  const db = await openDb();
  const before = await readDataRevisionSnapshot();
  const [owners, total] = await Promise.all([listConversationIds(db), countCacheRows(db)]);
  const formats = new Map<ImageFormat, { count: number; bytes: number }>();
  const assetsById = new Map<number, StorageAssetInfo>();
  const topImages: StorageAssetInfo[] = [];
  let after: number | null = null;
  let records = 0;
  let readableCount = 0;
  let unreadableCount = 0;
  let orphanCount = 0;
  let legacyCount = 0;
  let metadataMismatchCount = 0;
  let formatMismatchCount = 0;
  let bytes = 0;
  let animatedCount = 0;
  let unknownAnimationCount = 0;

  while (true) {
    checkCancelled(options.signal);
    const rows = await nextAssetBatch(db, after);
    if (!rows.length) break;

    for (const row of rows) {
      checkCancelled(options.signal);
      const item = await describeAsset(row, owners);
      records++;
      if (item.readable) readableCount++;
      else unreadableCount++;
      if (item.orphan) orphanCount++;
      if (item.legacy) legacyCount++;
      if (item.metadataMismatch) metadataMismatchCount++;
      if (item.formatMismatch) formatMismatchCount++;
      bytes += item.bytes;
      if (item.animation === 'animated') animatedCount++;
      if (item.readable && item.animation === 'unknown') unknownAnimationCount++;
      const distribution = formats.get(item.format) || { count: 0, bytes: 0 };
      distribution.count++;
      distribution.bytes += item.bytes;
      formats.set(item.format, distribution);
      assetsById.set(item.id, item);
      if (item.readable) {
        topImages.push(item);
        topImages.sort((a, b) => b.bytes - a.bytes || a.id - b.id);
        if (topImages.length > TOP_IMAGE_LIMIT) topImages.pop();
      }
    }

    after = Number(rows[rows.length - 1]!.id);
    if (!Number.isFinite(after)) throw new Error('invalid image cache key');
    await options.onProgress?.({ processed: records, total });
    if (rows.length < SCAN_BATCH_SIZE) break;
  }

  checkCancelled(options.signal);
  const afterRevisions = await readDataRevisionSnapshot();
  if (before.image_cache !== afterRevisions.image_cache || before.conversations !== afterRevisions.conversations) {
    throw new Error('storage_insight_stale');
  }
  return {
    records,
    readableCount,
    unreadableCount,
    orphanCount,
    legacyCount,
    metadataMismatchCount,
    formatMismatchCount,
    bytes,
    animatedCount,
    unknownAnimationCount,
    formats: Array.from(formats, ([format, stat]) => ({ format, ...stat })).sort((a, b) => b.bytes - a.bytes),
    topImages,
    assetsById,
  };
}
