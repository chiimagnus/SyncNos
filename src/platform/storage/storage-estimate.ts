export type OriginStorageEstimate = { usageBytes: number | null; quotaBytes: number | null };

export async function estimateOriginStorage(): Promise<OriginStorageEstimate> {
  try {
    const result = await globalThis.navigator?.storage?.estimate?.();
    const valid = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    return { usageBytes: valid(result?.usage), quotaBytes: valid(result?.quota) };
  } catch (_error) {
    return { usageBytes: null, quotaBytes: null };
  }
}
