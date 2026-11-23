import { openDb } from '@platform/idb/schema';
import {
  DATA_REVISION_RECORD_KEY,
  DATA_REVISION_STORE_BY_SCOPE,
  normalizeDataRevisionRecord,
} from '@platform/idb/data-revision-record';
import {
  getImageCacheAssetById,
  normalizeImageCacheAsset,
  type ImageCacheAsset,
  type ImageCacheRow,
} from '@services/conversations/data/image-cache-read';
import type { ImageOptimizationPreview } from '@services/conversations/data/image-optimization';
import { inspectImageBlob } from '@services/insight/image-format';
import { runTrackedTransaction } from '@services/data-revisions/transaction';
import { IncrementalSha256 } from '@services/shared/incremental-sha256';

type ValidPreview = Extract<ImageOptimizationPreview, { ok: true }>;
type ImageOptimizationInput = {
  selection: { id: number; conversationId: number };
  originalAsset: ImageCacheAsset;
  preview: ValidPreview;
  expectedRevision: number;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('image_optimization_write_failed'));
  });
}

function conflict(): never {
  throw new Error('image_optimization_conflict');
}

async function sha256Blob(blob: Blob): Promise<string> {
  const hash = new IncrementalSha256();
  for (let start = 0; start < blob.size; start += 256 * 1024) {
    hash.update(new Uint8Array(await blob.slice(start, start + 256 * 1024).arrayBuffer()));
  }
  return hash.digestHex();
}

function imageMediaType(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(';')[0]!;
}

export async function commitImageOptimization(input: ImageOptimizationInput): Promise<{
  id: number;
  bytesSaved: number;
  contentType: string;
  byteSize: number;
}> {
  const { selection, originalAsset, preview, expectedRevision } = input;
  const id = Number(selection.id);
  const owner = Number(selection.conversationId);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(owner) ||
    owner <= 0 ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    originalAsset.id !== id ||
    originalAsset.conversationId !== owner ||
    originalAsset.blob.size !== preview.originalBytes ||
    preview.originalBlob !== originalAsset.blob ||
    preview.optimizedBlob.size !== preview.optimizedBytes ||
    preview.savedBytes !== preview.originalBytes - preview.optimizedBytes ||
    preview.optimizedBytes <= 0 ||
    preview.savedBytes <= 0 ||
    preview.contentType !== preview.optimizedBlob.type ||
    !['image/png', 'image/jpeg'].includes(preview.contentType) ||
    !preview.pixelsEqual
  ) {
    throw new Error('image_optimization_invalid_preview');
  }
  const image = await inspectImageBlob(preview.optimizedBlob);
  if (
    (image.format !== 'png' && image.format !== 'jpeg') ||
    image.animation !== 'static' ||
    `image/${image.format}` !== preview.contentType
  ) {
    throw new Error('image_optimization_invalid_preview');
  }
  const expectedSha = await sha256Blob(preview.optimizedBlob);
  const db = await openDb();
  const revisionStore = DATA_REVISION_STORE_BY_SCOPE.image_cache;

  await runTrackedTransaction(
    { db, stores: ['image_cache', 'conversations', revisionStore], revisionScopes: ['image_cache'] },
    async ({ stores, markChanged }) => {
      const revision = normalizeDataRevisionRecord(
        await requestResult(stores[revisionStore].get(DATA_REVISION_RECORD_KEY)),
      ).revision;
      if (revision !== expectedRevision) conflict();

      const row = (await requestResult(stores.image_cache.get(id))) as ImageCacheRow | undefined;
      const current = normalizeImageCacheAsset({ id, row, expectedConversationId: owner });
      if (
        !row ||
        !current ||
        current.conversationId !== owner ||
        current.url !== originalAsset.url ||
        current.blob.size !== originalAsset.blob.size ||
        imageMediaType(current.contentType) !== imageMediaType(originalAsset.contentType) ||
        (Number(row.byteSize) > 0 && Number(row.byteSize) !== originalAsset.byteSize)
      ) {
        conflict();
      }
      const conversation = await requestResult(stores.conversations.get(owner));
      if (!conversation) conflict();

      const updated: Record<string, unknown> = {
        ...row,
        id,
        conversationId: owner,
        url: originalAsset.url,
        blob: preview.optimizedBlob,
        byteSize: preview.optimizedBlob.size,
        contentType: preview.contentType,
        updatedAt: Math.max(Date.now(), Number((row as any).updatedAt || 0) + 1),
      };
      delete updated.dataUrl;
      await requestResult(stores.image_cache.put(updated));
      markChanged('image_cache');
    },
  );

  const readback = await getImageCacheAssetById({ id, conversationId: owner });
  if (
    !readback ||
    readback.blob.size !== preview.optimizedBlob.size ||
    imageMediaType(readback.contentType) !== preview.contentType ||
    (await sha256Blob(readback.blob)) !== expectedSha
  ) {
    throw new Error('image_optimization_readback_failed');
  }
  return {
    id,
    bytesSaved: preview.originalBytes - readback.blob.size,
    contentType: readback.contentType,
    byteSize: readback.blob.size,
  };
}
