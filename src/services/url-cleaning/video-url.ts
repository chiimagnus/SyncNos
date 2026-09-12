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
  if (!detectBilibiliHost(url.hostname)) return '';
  const match = String(url.pathname || '').match(/^\/video\/(BV[0-9A-Za-z]+)\/?$/);
  return match?.[1] || '';
}

export function detectVideoPlatformHost(raw: unknown): VideoPlatform | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  return detectYoutubeHost(url.hostname) || detectBilibiliHost(url.hostname);
}

export function detectSupportedVideoPagePlatform(raw: unknown): VideoPlatform | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  const platform = detectVideoPlatformHost(url.toString());
  if (platform === 'youtube') return readYoutubeVideoId(url) ? 'youtube' : null;
  if (platform === 'bilibili') return readBilibiliBvid(url) ? 'bilibili' : null;
  return null;
}

function canonicalizeYoutubeUrl(url: URL): URL {
  const videoId = readYoutubeVideoId(url);
  if (!videoId) {
    const unchanged = new URL(url.toString());
    unchanged.hash = '';
    return unchanged;
  }
  const canonical = new URL('https://www.youtube.com/watch');
  canonical.searchParams.set('v', videoId);
  return canonical;
}

function canonicalizeBilibiliUrl(url: URL): URL {
  const bvid = readBilibiliBvid(url);
  if (!bvid) {
    const unchanged = new URL(url.toString());
    unchanged.hash = '';
    return unchanged;
  }

  const canonical = new URL(`https://www.bilibili.com/video/${bvid}/`);
  const p = String(url.searchParams.get('p') || '').trim();
  if (/^\d+$/.test(p)) {
    const part = Number(p);
    if (Number.isSafeInteger(part) && part > 1) canonical.searchParams.set('p', String(part));
  }
  return canonical;
}

export function canonicalizeVideoUrl(raw: unknown): string {
  const url = parseHttpUrl(raw);
  if (!url) return '';
  url.hash = '';

  const platform = detectSupportedVideoPagePlatform(url.toString());
  if (platform === 'youtube') return canonicalizeYoutubeUrl(url).toString();
  if (platform === 'bilibili') return canonicalizeBilibiliUrl(url).toString();
  return url.toString();
}
