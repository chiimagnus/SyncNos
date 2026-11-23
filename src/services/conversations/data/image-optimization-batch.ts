import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import { createImageOptimizationPreview } from '@services/conversations/data/image-optimization';
import { commitImageOptimization } from '@services/conversations/data/image-optimization-commit';
import { readDataRevision } from '@services/data-revisions/storage-idb';

export type ImageOptimizationBatchSelection = { id: number; conversationId: number };
export type ImageOptimizationBatchEntry = ImageOptimizationBatchSelection & {
  status: 'saved' | 'no-savings' | 'skipped' | 'conflict' | 'failed';
  bytesSaved: number;
  reason?: string;
};
export type ImageOptimizationBatchResult = {
  total: number;
  processed: number;
  savedCount: number;
  noSavingsCount: number;
  skippedCount: number;
  conflictCount: number;
  failedCount: number;
  bytesSaved: number;
  cancelled: boolean;
  entries: ImageOptimizationBatchEntry[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConflict(code: string): boolean {
  return code === 'image_optimization_conflict' || code === 'storage_insight_stale';
}

function validSelection(value: ImageOptimizationBatchSelection): boolean {
  return (
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    Number.isSafeInteger(value.conversationId) &&
    value.conversationId > 0
  );
}

/**
 * Processes at most one Blob and candidate at a time. No speculative all-library Blob copies.
 * Cancellation stops future items but cannot roll back one already-committed transaction.
 */
export async function optimizeImageBatch(
  requested: readonly ImageOptimizationBatchSelection[],
  options: {
    signal?: AbortSignal;
    onProgress?: (state: ImageOptimizationBatchResult) => void | Promise<void>;
  } = {},
): Promise<ImageOptimizationBatchResult> {
  const seen = new Set<number>();
  const selections = requested.filter((item) => {
    if (!validSelection(item) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const result: ImageOptimizationBatchResult = {
    total: selections.length,
    processed: 0,
    savedCount: 0,
    noSavingsCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    failedCount: 0,
    bytesSaved: 0,
    cancelled: false,
    entries: [],
  };

  for (const selection of selections) {
    if (options.signal?.aborted) break;
    let entry: ImageOptimizationBatchEntry;
    try {
      const beforeRevision = await readDataRevision('image_cache');
      const asset = await getImageCacheAssetById(selection);
      if (!asset) {
        entry = { ...selection, status: 'skipped', bytesSaved: 0, reason: 'asset_unavailable' };
      } else {
        const preview = await createImageOptimizationPreview({
          blob: asset.blob,
          contentType: asset.contentType,
          signal: options.signal,
        });
        if (options.signal?.aborted) break;
        if (!preview.ok) {
          const status =
            preview.reason === 'no-savings'
              ? 'no-savings'
              : ['unsupported-format', 'metadata-unsafe', 'invalid-source', 'mime-mismatch', 'too-large'].includes(
                    preview.reason,
                  )
                ? 'skipped'
                : 'failed';
          entry = { ...selection, status, bytesSaved: 0, reason: preview.reason };
        } else {
          const afterRevision = await readDataRevision('image_cache');
          if (options.signal?.aborted) break;
          if (beforeRevision !== afterRevision) {
            entry = { ...selection, status: 'conflict', bytesSaved: 0, reason: 'storage_insight_stale' };
          } else {
            const saved = await commitImageOptimization({
              selection,
              originalAsset: asset,
              preview,
              expectedRevision: beforeRevision,
            });
            entry = { ...selection, status: 'saved', bytesSaved: saved.bytesSaved };
          }
        }
      }
    } catch (error) {
      if (options.signal?.aborted) break;
      const reason = errorMessage(error);
      entry = { ...selection, status: isConflict(reason) ? 'conflict' : 'failed', bytesSaved: 0, reason };
    }

    result.entries.push(entry);
    result.processed++;
    if (entry.status === 'saved') {
      result.savedCount++;
      result.bytesSaved += entry.bytesSaved;
    } else if (entry.status === 'no-savings') result.noSavingsCount++;
    else if (entry.status === 'skipped') result.skippedCount++;
    else if (entry.status === 'conflict') result.conflictCount++;
    else result.failedCount++;
    await options.onProgress?.({ ...result, entries: [...result.entries] });
  }

  result.cancelled = !!options.signal?.aborted && result.processed < result.total;
  return result;
}
