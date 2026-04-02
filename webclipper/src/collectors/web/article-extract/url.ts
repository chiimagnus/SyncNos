export function normalizeNewlines(value: unknown) {
  return String(value || '').replace(/\r\n/g, '\n');
}

export function normalizeText(value: unknown) {
  return normalizeNewlines(value).trim();
}

export function sanitizeUrl(raw: unknown, baseHref: string) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^\/\//.test(text)) {
    try {
      const base = new URL(baseHref);
      return `${base.protocol}${text}`;
    } catch (_e) {
      return `https:${text}`;
    }
  }

  try {
    const resolved = new URL(text, baseHref).toString();
    return /^https?:\/\//i.test(resolved) ? resolved : '';
  } catch (_e) {
    return '';
  }
}

export function sanitizeWechatMediaUrl(raw: unknown, baseHref: string) {
  const resolved = sanitizeUrl(raw, baseHref);
  if (!resolved) return '';
  try {
    const url = new URL(resolved);
    url.searchParams.delete('tp');
    url.searchParams.delete('usePicPrefetch');
    url.searchParams.delete('wxfrom');
    url.searchParams.delete('from');
    return url.toString();
  } catch (_e) {
    return resolved;
  }
}

export function sanitizeSiteImageUrl(raw: unknown, baseHref: string, sanitizer: string) {
  const resolved = sanitizeUrl(raw, baseHref);
  if (!resolved) return '';

  if (sanitizer === 'stripAtSuffix') {
    try {
      const url = new URL(resolved);
      const idx = url.pathname.indexOf('@');
      if (idx > -1) url.pathname = url.pathname.slice(0, idx);
      return url.toString();
    } catch (_e) {
      const idx = resolved.indexOf('@');
      return idx > -1 ? resolved.slice(0, idx) : resolved;
    }
  }

  if (sanitizer === 'stripBangSuffix') {
    try {
      const url = new URL(resolved);
      const idx = url.pathname.indexOf('!');
      if (idx > -1) url.pathname = url.pathname.slice(0, idx);
      return url.toString();
    } catch (_e) {
      const idx = resolved.indexOf('!');
      return idx > -1 ? resolved.slice(0, idx) : resolved;
    }
  }

  return resolved;
}

