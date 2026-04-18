function parseHttpUrl(raw: unknown): URL | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return url;
  } catch (_e) {
    return null;
  }
}

function normalizeHost(hostname: string): string {
  return String(hostname || '')
    .trim()
    .toLowerCase();
}

function isYoutubeHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  return h === 'www.youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be';
}

function isBilibiliHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  return h === 'www.bilibili.com' || h.endsWith('.bilibili.com') || h === 'bilibili.com';
}

function canonicalizeYoutubeUrl(url: URL): URL {
  const host = normalizeHost(url.hostname);
  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0] || '';
    const next = new URL('https://www.youtube.com/watch');
    if (id) next.searchParams.set('v', id);
    return next;
  }

  if (url.pathname.startsWith('/shorts/')) {
    const id = url.pathname.replace(/^\/shorts\//, '').split('/')[0] || '';
    const next = new URL('https://www.youtube.com/watch');
    if (id) next.searchParams.set('v', id);
    return next;
  }

  if (url.pathname === '/watch') {
    const v = String(url.searchParams.get('v') || '').trim();
    const next = new URL('https://www.youtube.com/watch');
    if (v) next.searchParams.set('v', v);
    return next;
  }

  const next = new URL(url.toString());
  next.hash = '';
  return next;
}

function canonicalizeBilibiliUrl(url: URL): URL {
  const match = String(url.pathname || '').match(/^\/video\/(BV[^/?#]+)\/?$/i);
  if (!match) {
    const next = new URL(url.toString());
    next.hash = '';
    return next;
  }

  const bvid = match[1];
  const next = new URL(`https://www.bilibili.com/video/${bvid}/`);
  const p = String(url.searchParams.get('p') || '').trim();
  if (p && /^\d+$/.test(p)) next.searchParams.set('p', String(Number(p)));
  return next;
}

export function canonicalizeVideoUrl(raw: unknown): string {
  const url = parseHttpUrl(raw);
  if (!url) return '';
  url.hash = '';

  if (isYoutubeHost(url.hostname)) return canonicalizeYoutubeUrl(url).toString();
  if (isBilibiliHost(url.hostname)) return canonicalizeBilibiliUrl(url).toString();
  return url.toString();
}

