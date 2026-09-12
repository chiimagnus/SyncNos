import { listVideoInterceptedResponses, requestVideoPageMeta } from '@collectors/video/video-bridge-store';
import {
  parseBilibiliSubtitleJson,
  parseBilibiliViewPointsJson,
  parseWebVtt,
  parseYoutubeJson3,
  parseYoutubeTimedtextXml,
  type TranscriptCue,
} from '@collectors/video/video-transcript-parse';
import { canonicalizeVideoUrl, detectSupportedVideoPagePlatform } from '@services/url-cleaning/video-url';
import {
  classifyVideoResponseUrl,
  type VideoChapter,
  type VideoPageMetaCandidate,
  type VideoPageMetaCandidates,
  type VideoPlatform,
  type VideoResponseKind,
} from '@services/shared/video-capture';

type VideoTranscriptMeta = {
  platform: VideoPlatform;
  url: string;
  title: string;
  author: string;
  description: string;
  durationSeconds: number | null;
  thumbnailUrl: string;
};

type VideoTranscriptExtraction = {
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

function normalizeDuration(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function selectMetaCandidate(
  candidates: VideoPageMetaCandidates | null,
  currentUrl: string,
): VideoPageMetaCandidate | null {
  if (!candidates) return null;
  for (const candidate of [candidates.state, candidates.dom]) {
    if (!candidate) continue;
    if (canonicalizeVideoUrl(candidate.identityUrl) === currentUrl) return candidate;
  }
  return null;
}

async function collectMeta(): Promise<VideoTranscriptMeta> {
  const href = String(location.href || '');
  const platform = detectSupportedVideoPagePlatform(href);
  if (!platform) throw new Error('unsupported video page');
  const canonical = canonicalizeVideoUrl(href);
  const candidates = await requestVideoPageMeta();
  const candidate = selectMetaCandidate(candidates, canonical);

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
      if (classifyVideoResponseUrl(item.url) !== kind) return false;
      return canonicalizeVideoUrl(item.pageUrl) === currentUrl;
    })
    .reverse();
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
  for (const item of listCurrentResponses(currentUrl, 'youtube-timedtext')) {
    const cues = parseYoutubeBody(item.bodyText);
    if (cues.length) return cues;
  }
  return [];
}

function extractBilibiliCuesFromIntercept(currentUrl: string): TranscriptCue[] {
  for (const item of listCurrentResponses(currentUrl, 'bilibili-subtitle')) {
    const cues = parseBilibiliSubtitleJson(item.bodyText);
    if (cues.length) return cues;
  }
  return [];
}

function extractBilibiliChaptersFromIntercept(currentUrl: string): VideoChapter[] | null {
  for (const item of listCurrentResponses(currentUrl, 'bilibili-chapters')) {
    const chapters = parseBilibiliViewPointsJson(item.bodyText);
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

  return {
    meta,
    cues: extractBilibiliCuesFromIntercept(meta.url),
    chapters: extractBilibiliChaptersFromIntercept(meta.url),
  };
}
