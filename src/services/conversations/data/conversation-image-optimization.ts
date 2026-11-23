import { openDb } from '@platform/idb/schema';
import {
  DATA_REVISION_RECORD_KEY,
  DATA_REVISION_STORE_BY_SCOPE,
  normalizeDataRevisionRecord,
} from '@platform/idb/data-revision-record';
import { renderPngCandidate } from '@platform/image/canvas-codec';
import { getImageCacheAssetById, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import { inspectImageBlob } from '@services/conversations/data/image-format';
import { readDataRevision } from '@services/data-revisions/storage-idb';
import { runTrackedTransaction } from '@services/data-revisions/transaction';

export type ConversationOptimizationProgress = {
  processed: number;
  total: number;
  optimized: number;
  bytesSaved: number;
  cancelled: boolean;
};

function request<T>(item: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    item.onsuccess = () => resolve(item.result);
    item.onerror = () => reject(item.error || new Error('image_optimization_write_failed'));
  });
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Image optimization cancelled', 'AbortError');
}

function conflict(): never {
  throw new Error('image_optimization_conflict');
}

function contentType(value: unknown): string {
  return String(value || '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
}

async function plainPng(blob: Blob): Promise<boolean> {
  const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => signature[index] === value)) return false;
  let offset = 8;
  let sawIdat = false;
  for (let count = 0; count < 4096 && offset + 12 <= blob.size; count++) {
    const header = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    if (header.length !== 8) return false;
    const size = header[0]! * 0x1000000 + header[1]! * 65536 + header[2]! * 256 + header[3]!;
    const kind = String.fromCharCode(...header.slice(4, 8));
    const end = offset + 12 + size;
    if (end > blob.size) return false;
    if (!['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(kind)) return false;
    if (count === 0 && kind !== 'IHDR') return false;
    if (kind === 'IDAT') sawIdat = true;
    if (kind === 'IEND') return sawIdat && size === 0 && end === blob.size;
    offset = end;
  }
  return false;
}

function identicalPixels(left: Uint8ClampedArray, right: Uint8ClampedArray): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

async function sameBlobBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  for (let start = 0; start < a.size; start += 256 * 1024) {
    const end = Math.min(start + 256 * 1024, a.size);
    const [first, second] = await Promise.all([a.slice(start, end).arrayBuffer(), b.slice(start, end).arrayBuffer()]);
    const left = new Uint8Array(first);
    const right = new Uint8Array(second);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  }
  return true;
}

async function candidateFor(asset: ImageCacheAsset, signal?: AbortSignal): Promise<Blob | null> {
  if (
    asset.blob.size === 0 ||
    (asset.blob.type && asset.blob.type !== 'image/png') ||
    (contentType(asset.contentType) && contentType(asset.contentType) !== 'image/png')
  )
    return null;
  const format = await inspectImageBlob(asset.blob);
  if (format.format !== 'png' || format.animation !== 'static') return null;
  // Metadata, animation and unknown chunks must not silently disappear during canvas re-encoding.
  if (!(await plainPng(asset.blob))) return null;
  checkCancelled(signal);
  const encoded = await renderPngCandidate(asset.blob, signal);
  if (
    !encoded.blob.size ||
    encoded.blob.size >= asset.blob.size ||
    !identicalPixels(encoded.originalPixels, encoded.optimizedPixels)
  )
    return null;
  const output = await inspectImageBlob(encoded.blob);
  return output.format === 'png' && output.animation === 'static' ? encoded.blob : null;
}

async function commitAsset(input: {
  owner: number;
  original: ImageCacheAsset;
  optimized: Blob;
  expectedRevision: number;
}): Promise<number> {
  const { owner, original, optimized, expectedRevision } = input;
  if (
    original.conversationId !== owner ||
    optimized.size <= 0 ||
    optimized.size >= original.blob.size ||
    optimized.type !== 'image/png'
  )
    throw new Error('image_optimization_invalid_candidate');

  const db = await openDb();
  const revisionStore = DATA_REVISION_STORE_BY_SCOPE.image_cache;
  await runTrackedTransaction(
    { db, stores: ['image_cache', 'conversations', revisionStore], revisionScopes: ['image_cache'] },
    async ({ stores, markChanged }) => {
      const revision = normalizeDataRevisionRecord(
        await request(stores[revisionStore].get(DATA_REVISION_RECORD_KEY)),
      ).revision;
      if (revision !== expectedRevision) conflict();
      const row = (await request(stores.image_cache.get(original.id))) as Record<string, unknown> | undefined;
      if (
        !row ||
        Number(row.conversationId) !== owner ||
        row.url !== original.url ||
        contentType(row.contentType) !== 'image/png' ||
        (row.blob instanceof Blob && row.blob.size !== original.blob.size) ||
        (Number(row.byteSize) > 0 && Number(row.byteSize) !== original.blob.size)
      )
        conflict();
      const existing = await request(stores.conversations.get(owner));
      if (!existing) conflict();

      const next = {
        ...row,
        blob: optimized,
        byteSize: optimized.size,
        contentType: 'image/png',
        updatedAt: Math.max(Date.now(), Number(row.updatedAt || 0) + 1),
      };
      delete (next as Record<string, unknown>).dataUrl;
      await request(stores.image_cache.put(next));
      markChanged('image_cache');
    },
  );
  const saved = await getImageCacheAssetById({ id: original.id, conversationId: owner });
  if (!saved || saved.blob.size !== optimized.size || !(await sameBlobBytes(saved.blob, optimized))) {
    throw new Error('image_optimization_readback_failed');
  }
  return original.blob.size - optimized.size;
}

/** Sequential, opt-in, pixel-identical PNG optimization scoped to one content item. */
export async function optimizeConversationImages(input: {
  conversationId: number;
  ids: readonly number[];
  signal?: AbortSignal;
  onProgress?: (progress: ConversationOptimizationProgress) => void;
}): Promise<ConversationOptimizationProgress> {
  const { conversationId, signal, onProgress } = input;
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new Error('invalid_conversation_id');
  const ids = [...new Set(input.ids)].filter((id) => Number.isSafeInteger(id) && id > 0);
  const result: ConversationOptimizationProgress = {
    processed: 0,
    total: ids.length,
    optimized: 0,
    bytesSaved: 0,
    cancelled: false,
  };

  for (const id of ids) {
    if (signal?.aborted) {
      result.cancelled = true;
      break;
    }
    try {
      const expectedRevision = await readDataRevision('image_cache');
      const asset = await getImageCacheAssetById({ id, conversationId });
      if (asset) {
        let optimized: Blob | null = null;
        try {
          optimized = await candidateFor(asset, signal);
        } catch (error) {
          if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
          // Codec errors cannot justify touching the source image.
        }
        checkCancelled(signal);
        if (optimized) {
          try {
            const bytesSaved = await commitAsset({
              owner: conversationId,
              original: asset,
              optimized,
              expectedRevision,
            });
            result.optimized++;
            result.bytesSaved += bytesSaved;
          } catch (error) {
            if (!(error instanceof Error && error.message === 'image_optimization_conflict')) throw error;
            // Another writer changed this asset; leave it intact.
          }
        }
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        result.cancelled = true;
        break;
      }
      throw error;
    }
    result.processed++;
    onProgress?.({ ...result });
  }
  return result;
}
