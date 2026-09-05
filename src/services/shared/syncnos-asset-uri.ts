const SYNCNOS_ASSET_SCHEME_RE = /^syncnos-asset:\/\//i;
const SYNCNOS_ASSET_ID_RE = /^syncnos-asset:\/\/([0-9]+)$/i;

export function isSyncnosAssetUrl(value: unknown): boolean {
  return typeof value === 'string' && SYNCNOS_ASSET_SCHEME_RE.test(value.trim());
}

export function parseSyncnosAssetId(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const matched = SYNCNOS_ASSET_ID_RE.exec(value.trim());
  if (!matched) return null;
  const id = Number(matched[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function formatSyncnosAssetUrl(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError('SyncNos asset id must be a positive safe integer');
  }
  return `syncnos-asset://${id}`;
}
