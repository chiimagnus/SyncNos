function safeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeHostname(value: string): string {
  const raw = safeString(value).toLowerCase();
  if (!raw) return '';
  const trimmedDot = raw.endsWith('.') ? raw.slice(0, -1) : raw;
  if (trimmedDot.startsWith('[') && trimmedDot.endsWith(']')) return trimmedDot.slice(1, -1);
  return trimmedDot;
}

function isIPv4(hostname: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split('.');
  return parts.every((part) => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function isIPv6(hostname: string): boolean {
  return hostname.includes(':');
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
