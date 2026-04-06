export function safeString(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeHostname(value: unknown): string {
  const raw = safeString(value).toLowerCase();
  if (!raw) return '';
  const trimmedDot = raw.endsWith('.') ? raw.slice(0, -1) : raw;
  if (trimmedDot.startsWith('[') && trimmedDot.endsWith(']')) return trimmedDot.slice(1, -1);
  return trimmedDot;
}

export function parseHostnameFromUrl(url: unknown): string {
  const text = safeString(url);
  if (!text) return '';
  try {
    return normalizeHostname(new URL(text).hostname || '');
  } catch (_e) {
    return '';
  }
}
