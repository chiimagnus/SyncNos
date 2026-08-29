export type PersistedImageCachePayload = {
  blob?: unknown;
  byteSize?: unknown;
};

export function reusableImageCacheByteSize(row: PersistedImageCachePayload | null | undefined): number {
  if (!row || typeof Blob === 'undefined' || !(row.blob instanceof Blob)) return 0;
  const declared = Number(row.byteSize);
  if (Number.isFinite(declared) && declared > 0) return declared;
  const blobSize = Number(row.blob.size);
  return Number.isFinite(blobSize) && blobSize > 0 ? blobSize : 0;
}

export function hasReusableImageCachePayload(row: PersistedImageCachePayload | null | undefined): boolean {
  return reusableImageCacheByteSize(row) > 0;
}
