import type { VideoPlatform } from '@services/shared/video-capture';

function parseHttpUrl(raw: unknown): URL | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch (_error) {
    return null;
  }
}

function normalizeHost(hostname: string): string {
  return String(hostname || '')
    .trim()
    .toLowerCase();
}

function detectYoutubeHost(hostname: string): VideoPlatform | null {
  const host = normalizeHost(hostname);
  return host === 'www.youtube.com' || host === 'youtu.be' ? 'youtube' : null;
}

function detectBilibiliHost(hostname: string): VideoPlatform | null {
  const host = normalizeHost(hostname);
  return host === 'www.bilibili.com' || host === 'bilibili.com' ? 'bilibili' : null;
}

function readYoutubeVideoId(url: URL): string {
  const host = normalizeHost(url.hostname);
  if (host === 'youtu.be') {
    const match = url.pathname.match(/^\/([^/]+)\/?$/);
    return match?.[1]?.trim() || '';
  }
  if (host === 'www.youtube.com' && url.pathname === '/watch') {
    return String(url.searchParams.get('v') || '').trim();
  }
  return '';
}

function readBilibiliBvid(url: URL): string {
  const pathname = String(url.pathname || '');
  const videoMatch = pathname.match(/^\/video\/(BV[0-9A-Za-z]+)\/?$/);
  if (videoMatch?.[1]) return videoMatch[1];

  if (!/^\/list\/watchlater\/?$/.test(pathname)) return '';
  const queryBvid = String(url.searchParams.get('bvid') || '').trim();
  return /^BV[0-9A-Za-z]+$/.test(queryBvid) ? queryBvid : '';
}

export function detectVideoPlatformHost(raw: unknown): VideoPlatform | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  return detectYoutubeHost(url.hostname) || detectBilibiliHost(url.hostname);
}

export function detectSupportedVideoPagePlatform(raw: unknown): VideoPlatform | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  if (detectYoutubeHost(url.hostname)) return readYoutubeVideoId(url) ? 'youtube' : null;
  if (detectBilibiliHost(url.hostname)) return readBilibiliBvid(url) ? 'bilibili' : null;
  return null;
}

export function canonicalizeVideoUrl(raw: unknown): string {
  const url = parseHttpUrl(raw);
  if (!url) return '';
  url.hash = '';

  if (detectYoutubeHost(url.hostname)) {
    const videoId = readYoutubeVideoId(url);
    if (videoId) {
      const canonical = new URL('https://www.youtube.com/watch');
      canonical.searchParams.set('v', videoId);
      return canonical.toString();
    }
  }

  if (detectBilibiliHost(url.hostname)) {
    const bvid = readBilibiliBvid(url);
    if (bvid) {
      const canonical = new URL(`https://www.bilibili.com/video/${bvid}/`);
      const p = String(url.searchParams.get('p') || '').trim();
      if (/^\d+$/.test(p)) {
        const part = Number(p);
        if (Number.isSafeInteger(part) && part > 1) canonical.searchParams.set('p', String(part));
      }
      return canonical.toString();
    }
  }

  return url.toString();
}
