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

function stripCommonSubdomainPrefixes(hostname: string): string {
  let current = normalizeHostname(hostname);
  if (!current) return '';

  const prefixes = ['www', 'm', 'mobile', 'amp'];
  for (let step = 0; step < 6; step += 1) {
    const parts = current.split('.').filter(Boolean);
    if (parts.length <= 2) return current;
    const head = parts[0];
    if (!prefixes.includes(head)) return current;
    parts.shift();
    current = parts.join('.');
  }
  return current;
}

const MULTI_PART_SUFFIXES = new Set([
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'github.io',
  'co.jp',
  'com.au',
  'com.hk',
  'com.tw',
]);

function toETldPlusOne(hostname: string): string {
  const host = stripCommonSubdomainPrefixes(hostname);
  if (!host) return '';
  if (host === 'localhost') return host;
  if (isIPv4(host) || isIPv6(host)) return host;

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;

  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  const suffix2 = `${secondLast}.${last}`;

  if (MULTI_PART_SUFFIXES.has(suffix2)) {
    const start = Math.max(0, parts.length - 3);
    return parts.slice(start).join('.');
  }

  return parts.slice(-2).join('.');
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

export function toRegistrableDomain(hostname: string): string {
  return toETldPlusOne(hostname);
}

export function parseRegistrableDomainFromUrl(url: unknown): string {
  const hostname = parseHostnameFromUrl(url);
  if (!hostname) return '';
  return toRegistrableDomain(hostname);
}
