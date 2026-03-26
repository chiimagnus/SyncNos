export function normalizePositiveInt(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.trunc(id);
}
