export type VideoPlatform = 'youtube' | 'bilibili';

export type VideoChapter = {
  title: string;
  startSeconds: number;
  endSeconds: number | null;
};

export type VideoPageMetaCandidate = {
  identityUrl: string;
  title?: string;
  author?: string;
  description?: string;
  durationSeconds?: number | null;
  thumbnailUrl?: string;
};

export type VideoPageMetaCandidates = {
  state: VideoPageMetaCandidate | null;
  dom: VideoPageMetaCandidate | null;
  activeSubtitleLanguage: string;
};

export type VideoResponseKind = 'youtube-timedtext' | 'bilibili-player';

export type VideoSubtitleStatus = 'ok' | 'empty' | 'off' | 'unavailable';

export function classifyVideoResponseUrl(raw: unknown): VideoResponseKind | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch (_error) {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if ((host === 'youtube.com' || host === 'www.youtube.com') && path === '/api/timedtext') {
    return 'youtube-timedtext';
  }

  if (host === 'api.bilibili.com' && path === '/x/player/wbi/v2') {
    return 'bilibili-player';
  }

  return null;
}
