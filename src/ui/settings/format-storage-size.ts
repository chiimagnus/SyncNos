/** Browser-style decimal units (1 KB = 1,000 bytes), not binary KiB/MiB units. */
export function formatStorageSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  const maximumFractionDigits = index > 0 && value < 10 ? 1 : 0;
  return `${value.toLocaleString(undefined, { maximumFractionDigits })} ${units[index]}`;
}
