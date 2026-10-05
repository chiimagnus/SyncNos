import { listVideoInterceptedResponses, requestVideoPageMeta } from '@collectors/video/video-bridge-store';
import {
  parseBilibiliPlayerStateJson,
  parseBilibiliSubtitleJson,
  parseWebVtt,
  parseYoutubeJson3,
  parseYoutubeTimedtextXml,
  type BilibiliPlayerState,
  type BilibiliSubtitleTrack,
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
  type VideoSubtitleStatus,
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
  subtitleStatus: VideoSubtitleStatus;
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

async function collectPageContext(): Promise<{
  meta: VideoTranscriptMeta;
  activeSubtitleLanguage: string;
}> {
  const href = String(location.href || '');
  const platform = detectSupportedVideoPagePlatform(href);
  if (!platform) throw new Error('unsupported video page');
  const canonical = canonicalizeVideoUrl(href);
  const candidates = await requestVideoPageMeta();
  const candidate = selectMetaCandidate(candidates, canonical);

  return {
    meta: {
      platform,
      url: canonical,
      title: normalizeText(candidate?.title),
      author: normalizeText(candidate?.author),
      description: normalizeText(candidate?.description),
      durationSeconds: normalizeDuration(candidate?.durationSeconds),
      thumbnailUrl: normalizeText(candidate?.thumbnailUrl),
    },
    activeSubtitleLanguage: normalizeText(candidates?.activeSubtitleLanguage),
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

function currentBilibiliPlayerState(currentUrl: string): BilibiliPlayerState | null {
  const response = listCurrentResponses(currentUrl, 'bilibili-player')[0];
  return response ? parseBilibiliPlayerStateJson(response.bodyText) : null;
}

function resolveBilibiliSubtitleUrl(raw: string): string {
  try {
    const url = new URL(raw, 'https://www.bilibili.com/');
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host !== 'hdslb.com' && !host.endsWith('.hdslb.com')) return '';
    if (!path.startsWith('/bfs/subtitle/') && !path.startsWith('/bfs/ai_subtitle/')) return '';
    return url.toString();
  } catch (_error) {
    return '';
  }
}

async function fetchBilibiliSubtitle(track: BilibiliSubtitleTrack): Promise<TranscriptCue[]> {
  const url = resolveBilibiliSubtitleUrl(track.url);
  if (!url) return [];
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) return [];
    return parseBilibiliSubtitleJson(await response.text());
  } catch (_error) {
    return [];
  }
}

async function extractBilibiliTranscript(
  playerState: BilibiliPlayerState | null,
  activeSubtitleLanguage: string,
): Promise<{ cues: TranscriptCue[]; subtitleStatus: VideoSubtitleStatus }> {
  const tracks = playerState?.subtitleTracks ?? null;
  if (!activeSubtitleLanguage) {
    return { cues: [], subtitleStatus: tracks?.length === 0 ? 'empty' : 'off' };
  }

  const track = tracks?.find((item) => item.language === activeSubtitleLanguage);
  if (!track) return { cues: [], subtitleStatus: 'unavailable' };

  const cues = await fetchBilibiliSubtitle(track);
  return { cues, subtitleStatus: cues.length ? 'ok' : 'unavailable' };
}

export async function extractVideoTranscriptFromCurrentPage(): Promise<VideoTranscriptExtraction> {
  const { meta, activeSubtitleLanguage } = await collectPageContext();

  if (meta.platform === 'youtube') {
    const response = listCurrentResponses(meta.url, 'youtube-timedtext')[0];
    const cues = response ? parseYoutubeBody(response.bodyText) : [];
    return {
      meta,
      cues,
      chapters: null,
      subtitleStatus: cues.length ? 'ok' : response ? 'unavailable' : 'off',
    };
  }

  const playerState = currentBilibiliPlayerState(meta.url);
  const transcript = await extractBilibiliTranscript(playerState, activeSubtitleLanguage);
  return {
    meta,
    cues: transcript.cues,
    chapters: playerState?.chapters ?? null,
    subtitleStatus: transcript.subtitleStatus,
  };
}
