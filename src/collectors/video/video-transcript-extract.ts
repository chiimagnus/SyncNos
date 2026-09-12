import { listVideoInterceptedResponses, requestVideoPageMeta } from '@collectors/video/video-bridge-store';
import {
  parseBilibiliSubtitleJson,
  parseBilibiliViewPointsJson,
  parseWebVtt,
  parseYoutubeJson3,
  parseYoutubeTimedtextXml,
  type TranscriptCue,
} from '@collectors/video/video-transcript-parse';
import { canonicalizeVideoUrl } from '@services/url-cleaning/video-url';
import {
  classifyVideoResponseUrl,
  type VideoChapter,
  type VideoPageMetaCandidate,
  type VideoPageMetaCandidates,
  type VideoPlatform,
  type VideoResponseKind,
} from '@services/shared/video-capture';

export type VideoTranscriptMeta = {
  platform: VideoPlatform | 'unknown';
  url: string;
  title: string;
  author: string;
  description: string;
  durationSeconds: number | null;
  thumbnailUrl: string;
};

export type VideoTranscriptExtraction = {
  meta: VideoTranscriptMeta;
  cues: TranscriptCue[];
  chapters: VideoChapter[] | null;
};

type InterceptedResponse = ReturnType<typeof listVideoInterceptedResponses>[number];

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function inferPlatform(): VideoTranscriptMeta['platform'] {
  const host = String(location.hostname || '').toLowerCase();
  if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'youtu.be') return 'youtube';
  if (host === 'www.bilibili.com' || host === 'bilibili.com') return 'bilibili';
  return 'unknown';
}

function normalizeDuration(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function selectMetaCandidate(
  candidates: VideoPageMetaCandidates | null,
  currentUrl: string,
  platform: VideoTranscriptMeta['platform'],
): VideoPageMetaCandidate | null {
  if (!candidates || platform === 'unknown') return null;
  for (const candidate of [candidates.state, candidates.dom]) {
    if (!candidate || candidate.platform !== platform) continue;
    const identityUrl = canonicalizeVideoUrl(candidate.identityUrl);
    if (identityUrl && identityUrl === currentUrl) return candidate;
  }
  return null;
}

async function collectMeta(): Promise<VideoTranscriptMeta> {
  const platform = inferPlatform();
  const href = String(location.href || '');
  const canonical = canonicalizeVideoUrl(href) || href;
  const candidates = await requestVideoPageMeta();
  const candidate = selectMetaCandidate(candidates, canonical, platform);

  return {
    platform,
    url: canonical,
    title: normalizeText(candidate?.title),
    author: normalizeText(candidate?.author),
    description: normalizeText(candidate?.description),
    durationSeconds: normalizeDuration(candidate?.durationSeconds),
    thumbnailUrl: normalizeText(candidate?.thumbnailUrl),
  };
}

function listCurrentResponses(currentUrl: string, kind: VideoResponseKind): InterceptedResponse[] {
  return listVideoInterceptedResponses()
    .filter((item) => {
      if (!item || classifyVideoResponseUrl(item.url) !== kind) return false;
      const pageUrl = canonicalizeVideoUrl(item.pageUrl);
      return !!pageUrl && pageUrl === currentUrl;
    })
    .sort((left, right) => Number(right.at) - Number(left.at));
}

function parseYoutubeBody(bodyText: string): TranscriptCue[] {
  const body = normalizeText(bodyText);
  if (!body) return [];
  if (body.startsWith('WEBVTT')) return parseWebVtt(body);
  if (body.startsWith('{')) return parseYoutubeJson3(body);
  if (body.includes('<transcript') || body.includes('<text')) return parseYoutubeTimedtextXml(body);
  return [];
}

function extractYoutubeCuesFromIntercept(currentUrl: string): TranscriptCue[] {
  const picked = listCurrentResponses(currentUrl, 'youtube-timedtext')[0];
  return picked ? parseYoutubeBody(picked.bodyText) : [];
}

function extractBilibiliCuesFromIntercept(currentUrl: string): TranscriptCue[] {
  for (const item of listCurrentResponses(currentUrl, 'bilibili-subtitle')) {
    const cues = parseBilibiliSubtitleJson(String(item.bodyText || ''));
    if (cues.length) return cues;
  }
  return [];
}

function extractBilibiliChaptersFromIntercept(currentUrl: string): VideoChapter[] | null {
  for (const item of listCurrentResponses(currentUrl, 'bilibili-chapters')) {
    const chapters = parseBilibiliViewPointsJson(String(item.bodyText || ''));
    if (chapters !== null) return chapters;
  }
  return null;
}

export async function extractVideoTranscriptFromCurrentPage(): Promise<VideoTranscriptExtraction> {
  const meta = await collectMeta();

  if (meta.platform === 'youtube') {
    return {
      meta,
      cues: extractYoutubeCuesFromIntercept(meta.url),
      chapters: null,
    };
  }

  if (meta.platform === 'bilibili') {
    return {
      meta,
      cues: extractBilibiliCuesFromIntercept(meta.url),
      chapters: extractBilibiliChaptersFromIntercept(meta.url),
    };
  }

  return { meta, cues: [], chapters: null };
}
