import { openDb } from '@platform/idb/schema';
import { estimateOriginStorage } from '@platform/storage/storage-estimate';
import { readDataRevisionSnapshot } from '@services/data-revisions/storage-idb';
import { normalizeImageCacheAsset, type ImageCacheRow } from '@services/conversations/data/image-cache-read';
import { inspectImageBlob, type AnimationState, type ImageFormat } from '@services/insight/image-format';
import { collectMarkdownImageReferences } from '@services/shared/markdown-image-references';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';
import { encodeConversationLoc } from '@services/shared/conversation-loc';

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
  title: string;
  source: string;
  loc: string;
};

export type StorageConversationRank = {
  conversationId: number;
  title: string;
  source: string;
  loc: string;
  bytes: number;
};

export type StorageContentSummary = {
  logicalTextBytes: number;
  byKind: Array<{ kind: string; bytes: number }>;
  commentBytes: number;
  orphanCommentBytes: number;
  imageOccurrences: number;
  uniqueImageTargets: number;
  uniqueLocalAssetIds: number;
  availableLocalOccurrences: number;
  brokenLocalOccurrences: number;
  otherImageOccurrences: number;
  unreferencedCacheRecords: number;
  topConversations: StorageConversationRank[];
  topSources: Array<{ source: string; bytes: number }>;
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
  content: StorageContentSummary;
};

const SCAN_BATCH_SIZE = 24;
const TOP_IMAGE_LIMIT = 12;

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Storage scan cancelled', 'AbortError');
}

async function countStorageRows(
  db: IDBDatabase,
  store: 'image_cache' | 'messages' | 'article_comments',
): Promise<number> {
  const transaction = db.transaction(store, 'readonly');
  const done = transactionDone(transaction);
  const count = await requestDone(transaction.objectStore(store).count());
  await done;
  return count;
}

type StorageOwner = {
  source: string;
  conversationKey: string;
  sourceType: string;
  title: string;
};

async function listConversationOwners(db: IDBDatabase): Promise<Map<number, StorageOwner>> {
  const transaction = db.transaction('conversations', 'readonly');
  const done = transactionDone(transaction);
  const owners = new Map<number, StorageOwner>();
  await new Promise<void>((resolve, reject) => {
    const request = transaction.objectStore('conversations').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const id = Number(cursor.key);
      if (Number.isSafeInteger(id) && id > 0) {
        const row = cursor.value as Record<string, unknown>;
        owners.set(id, {
          source: String(row.source || ''),
          conversationKey: String(row.conversationKey || ''),
          sourceType: String(row.sourceType || 'chat').toLowerCase(),
          title: String(row.title || '').trim(),
        });
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('indexedDB key cursor failed'));
  });
  await done;
  return owners;
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

async function describeAsset(row: ImageCacheRow, owners: ReadonlyMap<number, StorageOwner>): Promise<StorageAssetInfo> {
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
  const owner = owners.get(conversationId);
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
    title: owner?.title || '',
    source: owner?.source || '',
    loc:
      owner?.source && owner.conversationKey
        ? encodeConversationLoc({ source: owner.source, conversationKey: owner.conversationKey })
        : '',
  };
}

type MessageScanRow = {
  id?: number;
  conversationId?: number;
  contentMarkdown?: string;
  transcriptCues?: Array<{ text?: string }>;
  videoChapters?: Array<{ title?: string }>;
};
type CommentScanRow = { id?: number; conversationId?: number | null; commentText?: string; quoteText?: string };

async function nextContentBatch<T>(
  db: IDBDatabase,
  storeName: 'messages' | 'article_comments',
  after: number | null,
): Promise<T[]> {
  const transaction = db.transaction(storeName, 'readonly');
  const done = transactionDone(transaction);
  const range = after == null ? undefined : IDBKeyRange.lowerBound(after, true);
  const rows = await requestDone(transaction.objectStore(storeName).getAll(range, 12));
  await done;
  return rows as T[];
}

async function scanStoredContent(
  db: IDBDatabase,
  owners: ReadonlyMap<number, StorageOwner>,
  assets: ReadonlyMap<number, StorageAssetInfo>,
  signal?: AbortSignal,
  onProgress?: (value: { phase: 'messages' | 'comments'; processed: number; total: number }) => void | Promise<void>,
): Promise<StorageContentSummary> {
  const textEncoder = new TextEncoder();
  const kindBytes = new Map<string, number>();
  const referencedAssetIds = new Set<number>();
  const imageTargets = new Set<string>();
  let imageOccurrences = 0;
  let availableLocalOccurrences = 0;
  let brokenLocalOccurrences = 0;
  let otherImageOccurrences = 0;
  let commentBytes = 0;
  let orphanCommentBytes = 0;
  let messageTotalBytes = 0;
  const [totalMessages, totalComments] = await Promise.all([
    countStorageRows(db, 'messages'),
    countStorageRows(db, 'article_comments'),
  ]);
  let processed = 0;

  let cursor: number | null = null;
  while (true) {
    checkCancelled(signal);
    const batch: MessageScanRow[] = await nextContentBatch<MessageScanRow>(db, 'messages', cursor);
    if (!batch.length) break;
    for (const message of batch) {
      checkCancelled(signal);
      processed++;
      const ownerId = Number(message.conversationId);
      const owner = owners.get(ownerId);
      const markdown = String(message.contentMarkdown || '');
      const supplementary =
        !markdown && Array.isArray(message.transcriptCues)
          ? message.transcriptCues.map((cue) => String(cue.text || '')).join('\n')
          : '';
      const chapterText =
        !markdown && Array.isArray(message.videoChapters)
          ? message.videoChapters.map((chapter) => String(chapter.title || '')).join('\n')
          : '';
      const amount =
        textEncoder.encode(markdown || supplementary).byteLength + textEncoder.encode(chapterText).byteLength;
      messageTotalBytes += amount;
      const kind = owner?.sourceType || 'orphan';
      kindBytes.set(kind, (kindBytes.get(kind) || 0) + amount);

      for (const reference of collectMarkdownImageReferences(markdown)) {
        imageOccurrences++;
        imageTargets.add(reference.target);
        const assetId = parseSyncnosAssetId(reference.target);
        if (assetId != null || isSyncnosAssetUrl(reference.target)) {
          if (assetId != null) referencedAssetIds.add(assetId);
          const asset = assetId == null ? null : assets.get(assetId);
          if (asset?.readable && asset.conversationId === ownerId) availableLocalOccurrences++;
          else brokenLocalOccurrences++;
        } else otherImageOccurrences++;
      }
    }
    cursor = Number(batch[batch.length - 1]!.id);
    if (!Number.isSafeInteger(cursor)) throw new Error('invalid message key');
    await onProgress?.({ phase: 'messages', processed, total: totalMessages });
    if (batch.length < 12) break;
  }

  cursor = null;
  processed = 0;
  while (true) {
    checkCancelled(signal);
    const batch: CommentScanRow[] = await nextContentBatch<CommentScanRow>(db, 'article_comments', cursor);
    if (!batch.length) break;
    for (const comment of batch) {
      checkCancelled(signal);
      processed++;
      const bytes =
        textEncoder.encode(String(comment.commentText || '')).byteLength +
        textEncoder.encode(String(comment.quoteText || '')).byteLength;
      commentBytes += bytes;
      const ownerId = Number(comment.conversationId);
      if (!owners.has(ownerId)) orphanCommentBytes += bytes;
    }
    cursor = Number(batch[batch.length - 1]!.id);
    if (!Number.isSafeInteger(cursor)) throw new Error('invalid comment key');
    await onProgress?.({ phase: 'comments', processed, total: totalComments });
    if (batch.length < 12) break;
  }

  const imageBytes = new Map<number, number>();
  for (const asset of assets.values()) {
    if (!asset.readable || !owners.has(asset.conversationId)) continue;
    imageBytes.set(asset.conversationId, (imageBytes.get(asset.conversationId) || 0) + asset.bytes);
  }
  const topConversations = Array.from(imageBytes, ([id, bytes]) => {
    const owner = owners.get(id)!;
    return {
      conversationId: id,
      title: owner.title || owner.conversationKey,
      source: owner.source,
      loc:
        owner.source && owner.conversationKey
          ? encodeConversationLoc({ source: owner.source, conversationKey: owner.conversationKey })
          : '',
      bytes,
    };
  })
    .sort((a, b) => b.bytes - a.bytes || a.conversationId - b.conversationId)
    .slice(0, 12);
  const sourceBytes = new Map<string, number>();
  for (const [id, value] of imageBytes) {
    const source = owners.get(id)?.source || '';
    sourceBytes.set(source, (sourceBytes.get(source) || 0) + value);
  }
  return {
    logicalTextBytes: messageTotalBytes + commentBytes,
    byKind: [...kindBytes].map(([kind, bytes]) => ({ kind, bytes })).sort((a, b) => b.bytes - a.bytes),
    commentBytes,
    orphanCommentBytes,
    imageOccurrences,
    uniqueImageTargets: imageTargets.size,
    uniqueLocalAssetIds: referencedAssetIds.size,
    availableLocalOccurrences,
    brokenLocalOccurrences,
    otherImageOccurrences,
    unreferencedCacheRecords: [...assets.keys()].filter((id) => !referencedAssetIds.has(id)).length,
    topConversations,
    topSources: [...sourceBytes]
      .map(([source, bytes]) => ({ source, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.source.localeCompare(b.source)),
  };
}

export async function scanStorageAssets(
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: {
      phase: 'images' | 'messages' | 'comments';
      processed: number;
      total: number;
    }) => void | Promise<void>;
  } = {},
): Promise<StorageAssetScan> {
  checkCancelled(options.signal);
  const db = await openDb();
  const before = await readDataRevisionSnapshot();
  const [owners, total] = await Promise.all([listConversationOwners(db), countStorageRows(db, 'image_cache')]);
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
    await options.onProgress?.({ phase: 'images', processed: records, total });
    if (rows.length < SCAN_BATCH_SIZE) break;
  }

  checkCancelled(options.signal);
  const content = await scanStoredContent(db, owners, assetsById, options.signal, options.onProgress);
  const afterRevisions = await readDataRevisionSnapshot();
  if (
    before.image_cache !== afterRevisions.image_cache ||
    before.conversations !== afterRevisions.conversations ||
    before.messages !== afterRevisions.messages ||
    before.article_comments !== afterRevisions.article_comments
  ) {
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
    content,
  };
}
