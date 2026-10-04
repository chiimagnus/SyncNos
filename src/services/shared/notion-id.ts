export function normalizeNotionId(value: unknown): string {
  const compact = typeof value === 'string' ? value.trim().replace(/-/g, '') : '';
  return /^[0-9a-f]{32}$/i.test(compact) ? compact.toLowerCase() : '';
}
