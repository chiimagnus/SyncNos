import { canonicalizeVideoUrl } from '@services/url-cleaning/video-url';
import { listVideoInterceptedResponses, requestVideoPageMeta } from '@collectors/video/video-bridge-store';
import {
  parseBilibiliSubtitleJson,
  parseWebVtt,
  parseYoutubeJson3,
  parseYoutubeTimedtextXml,
  type TranscriptCue,
} from '@collectors/video/video-transcript-parse';

export type VideoTranscriptSource = 'A' | 'B' | 'C';

export type VideoTranscriptMeta = {
  platform: 'youtube' | 'bilibili' | 'unknown';
  url: string;
  title: string;
  author: string;
  durationSeconds: number | null;
  thumbnailUrl: string;
};

export type VideoTranscriptExtraction = {
  meta: VideoTranscriptMeta;
  cues: TranscriptCue[];
  source: VideoTranscriptSource;
  hasTimestamps: boolean;
};

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function isYoutubeHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return h === 'www.youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be';
}

function isBilibiliHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return h === 'www.bilibili.com' || h.endsWith('.bilibili.com') || h === 'bilibili.com';
}

function inferPlatform(): VideoTranscriptMeta['platform'] {
  const host = String(location.hostname || '').toLowerCase();
  if (isYoutubeHost(host)) return 'youtube';
  if (isBilibiliHost(host)) return 'bilibili';
  return 'unknown';
}

function fallbackTitle(): string {
  const fromDoc = normalizeText(document.title || '');
  if (fromDoc) return fromDoc;
  const og = normalizeText(document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '');
  return og;
}

function fallbackThumbnail(): string {
  const og = normalizeText(document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '');
  return og;
}

function fallbackAuthor(): string {
  const author = normalizeText(document.querySelector('meta[name="author"]')?.getAttribute('content') || '');
  return author;
}

async function collectMeta(): Promise<VideoTranscriptMeta> {
  const platform = inferPlatform();
  const href = String(location.href || '');
  const canonical = canonicalizeVideoUrl(href) || href;

  const meta = await requestVideoPageMeta({ timeoutMs: 1400 });
  const title = normalizeText(meta?.title) || fallbackTitle();
  const author = normalizeText(meta?.author) || fallbackAuthor();
  const durationSeconds =
    meta?.durationSeconds != null && Number.isFinite(Number(meta.durationSeconds))
      ? Math.max(0, Math.floor(Number(meta.durationSeconds)))
      : null;
  const thumbnailUrl = normalizeText(meta?.thumbnailUrl) || fallbackThumbnail();

  return {
    platform: meta?.platform === 'youtube' || meta?.platform === 'bilibili' ? meta.platform : platform,
    url: canonical,
    title,
    author,
    durationSeconds,
    thumbnailUrl,
  };
}

function pickLatestResponse(pred: (url: string, contentType: string, bodyText: string) => boolean) {
  const list = listVideoInterceptedResponses();
  const sorted = list
    .slice()
    .filter((r) => r && typeof r.url === 'string' && typeof r.bodyText === 'string')
    .sort((a, b) => Number(b.at) - Number(a.at));
  for (const item of sorted) {
    const url = String(item.url || '');
    const contentType = String(item.contentType || '');
    const bodyText = String(item.bodyText || '');
    if (pred(url, contentType, bodyText)) return item;
  }
  return null;
}

function extractYoutubeCuesFromIntercept(): TranscriptCue[] {
  const picked = pickLatestResponse((url) => url.toLowerCase().includes('youtube.com/api/timedtext'));
  if (!picked) return [];
  const body = normalizeText(picked.bodyText);
  if (!body) return [];

  if (body.startsWith('WEBVTT')) return parseWebVtt(body);
  if (body.trim().startsWith('{')) return parseYoutubeJson3(body);
  if (body.includes('<transcript') || body.includes('<text')) return parseYoutubeTimedtextXml(body);
  return [];
}

function extractBilibiliCuesFromIntercept(): TranscriptCue[] {
  const list = listVideoInterceptedResponses();
  const sorted = list
    .slice()
    .filter((r) => r && typeof r.url === 'string' && typeof r.bodyText === 'string')
    .sort((a, b) => Number(b.at) - Number(a.at));

  for (const item of sorted) {
    const urlLower = String(item.url || '').toLowerCase();
    if (!urlLower) continue;
    if (!urlLower.includes('/bfs/subtitle/') && !urlLower.includes('/bfs/ai_subtitle/')) continue;
    const cues = parseBilibiliSubtitleJson(String(item.bodyText || ''));
    if (cues.length) return cues;
  }

  return [];
}

function parseTimeToSeconds(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = m[1] ? Number(String(m[1]).replace(':', '')) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (![hours, minutes, seconds].every((x) => Number.isFinite(x))) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function extractYoutubeCuesFromDom(): TranscriptCue[] {
  const nodes = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer')) as HTMLElement[];
  if (!nodes.length) return [];

  const cues: TranscriptCue[] = [];
  for (const node of nodes) {
    const ts =
      normalizeText((node.querySelector('.segment-timestamp') as any)?.innerText || '') ||
      normalizeText((node.querySelector('div') as any)?.innerText || '');
    const text =
      normalizeText((node.querySelector('.segment-text') as any)?.innerText || '') ||
      normalizeText((node as any)?.innerText || '');
    const start = parseTimeToSeconds(ts);
    if (start == null) continue;
    if (!text) continue;
    cues.push({ start, text });
  }
  return cues;
}

function extractBilibiliCuesFromDom(): TranscriptCue[] {
  const panel = document.querySelector('.bpx-player-subtitle-panel-text') as HTMLElement | null;
  if (!panel) return [];
  const lines = Array.from(panel.querySelectorAll('*'))
    .map((el) => normalizeText((el as any)?.innerText || ''))
    .filter(Boolean);
  const unique = Array.from(new Set(lines));
  return unique.map((text, idx) => ({ start: idx, text }));
}

export async function extractVideoTranscriptFromCurrentPage(): Promise<VideoTranscriptExtraction> {
  const meta = await collectMeta();

  if (meta.platform !== 'youtube' && meta.platform !== 'bilibili') {
    return {
      meta,
      cues: [],
      source: 'C',
      hasTimestamps: false,
    };
  }

  if (meta.platform === 'youtube') {
    const cues = extractYoutubeCuesFromIntercept();
    if (cues.length) return { meta, cues, source: 'A', hasTimestamps: true };
    const dom = extractYoutubeCuesFromDom();
    if (dom.length) return { meta, cues: dom, source: 'B', hasTimestamps: true };
    return { meta, cues: [], source: 'C', hasTimestamps: false };
  }

  const cues = extractBilibiliCuesFromIntercept();
  if (cues.length) return { meta, cues, source: 'A', hasTimestamps: true };
  const dom = extractBilibiliCuesFromDom();
  if (dom.length) return { meta, cues: dom, source: 'B', hasTimestamps: false };
  return { meta, cues: [], source: 'C', hasTimestamps: false };
}
