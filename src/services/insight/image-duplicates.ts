import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import { readDataRevisionSnapshot } from '@services/data-revisions/storage-idb';
import { IncrementalSha256 } from '@services/shared/incremental-sha256';
import type { StorageAssetInfo } from '@services/insight/storage-insight-source';

export type DuplicateImageGroup = {
  bytes: number;
  sha256: string;
  assets: StorageAssetInfo[];
};
export type DuplicateImageReport = {
  candidates: number;
  hashed: number;
  hashErrors: number;
  duplicateGroups: number;
  potentialRedundantBytes: number;
  groups: DuplicateImageGroup[];
};

const READ_CHUNK_BYTES = 256 * 1024;

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Duplicate image scan cancelled', 'AbortError');
}

async function sha256Blob(blob: Blob, signal?: AbortSignal): Promise<string> {
  const hasher = new IncrementalSha256();
  for (let start = 0; start < blob.size; start += READ_CHUNK_BYTES) {
    assertActive(signal);
    const next = Math.min(blob.size, start + READ_CHUNK_BYTES);
    const chunk = new Uint8Array(await blob.slice(start, next).arrayBuffer());
    assertActive(signal);
    hasher.update(chunk);
  }
  return hasher.digestHex();
}

/** Reports possible duplicate bytes only. Never mutates or merges asset IDs. */
export async function scanDuplicateImageAssets(
  assets: readonly StorageAssetInfo[],
  options: {
    signal?: AbortSignal;
    onProgress?: (value: { processed: number; total: number }) => void | Promise<void>;
  } = {},
): Promise<DuplicateImageReport> {
  assertActive(options.signal);
  const before = await readDataRevisionSnapshot();
  const unique = new Map<number, StorageAssetInfo>();
  for (const asset of assets) {
    if (
      !asset.readable ||
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0 ||
      !Number.isSafeInteger(asset.conversationId) ||
      asset.conversationId <= 0 ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0
    )
      continue;
    if (!unique.has(asset.id)) unique.set(asset.id, asset);
  }

  const bySize = new Map<number, StorageAssetInfo[]>();
  for (const asset of unique.values()) {
    const current = bySize.get(asset.bytes) || [];
    current.push(asset);
    bySize.set(asset.bytes, current);
  }
  const candidates = [...bySize.values()].filter((rows) => rows.length > 1).flat();
  const hashes = new Map<string, DuplicateImageGroup>();
  let processed = 0;
  let hashed = 0;
  let hashErrors = 0;

  for (const meta of candidates) {
    assertActive(options.signal);
    try {
      const asset = await getImageCacheAssetById({ id: meta.id, conversationId: meta.conversationId });
      if (!asset || asset.blob.size !== meta.bytes || asset.url !== meta.url) {
        hashErrors++;
      } else {
        const hash = await sha256Blob(asset.blob, options.signal);
        const key = `${meta.bytes}:${hash}`;
        const group = hashes.get(key) ?? { bytes: meta.bytes, sha256: hash, assets: [] };
        group.assets.push(meta);
        hashes.set(key, group);
        hashed++;
      }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      hashErrors++;
    }
    processed++;
    await options.onProgress?.({ processed, total: candidates.length });
  }
  assertActive(options.signal);

  const after = await readDataRevisionSnapshot();
  if (before.image_cache !== after.image_cache || before.conversations !== after.conversations) {
    throw new Error('storage_insight_stale');
  }
  const groups = [...hashes.values()]
    .filter((group) => group.assets.length > 1)
    .map((group) => ({
      ...group,
      assets: group.assets.sort((a, b) => a.id - b.id),
    }))
    .sort((a, b) => (b.assets.length - 1) * b.bytes - (a.assets.length - 1) * a.bytes);

  return {
    candidates: candidates.length,
    hashed,
    hashErrors,
    duplicateGroups: groups.length,
    potentialRedundantBytes: groups.reduce((sum, group) => sum + (group.assets.length - 1) * group.bytes, 0),
    groups,
  };
}
