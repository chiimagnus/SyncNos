import { normalizeHttpUrl } from '@services/url-cleaning/http-url';

const DISCOURSE_TOPIC_PATH_RE = /^\/t\/([^/]+)\/(\d+)(?:\/([^/]+))?\/?$/i;

export const DISCOURSE_TOPIC_PATH_RE_SOURCE = '^\\/t\\/([^/]+)\\/(\\d+)(?:\\/([^/]+))?\\/?$';
export const DISCOURSE_TOPIC_PATH_RE_FLAGS = 'i';

function parseDiscourseTopicPath(
  pathname: unknown,
  topicPathRe: RegExp = DISCOURSE_TOPIC_PATH_RE,
): {
  slug: string;
  topicId: string;
  postSegment: string | null;
} | null {
  const text = String(pathname || '').trim();
  if (!text) return null;
  const match = text.match(topicPathRe);
  if (!match) return null;
  return {
    slug: String(match[1] || '').trim(),
    topicId: String(match[2] || '').trim(),
    postSegment: match[3] ? String(match[3]).trim() : null,
  };
}

export function parseDiscourseTopicUrl(rawUrl: unknown): {
  origin: string;
  slug: string;
  topicId: string;
  postNumber: number | null;
  postSegment: string | null;
} | null {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const parsedPath = parseDiscourseTopicPath(url.pathname);
    if (!parsedPath) return null;
    const postNumberRaw = Number(parsedPath.postSegment);
    return {
      origin: url.origin,
      slug: parsedPath.slug,
      topicId: parsedPath.topicId,
      postNumber: Number.isFinite(postNumberRaw) && postNumberRaw > 0 ? postNumberRaw : null,
      postSegment: parsedPath.postSegment,
    };
  } catch (_e) {
    return null;
  }
}

export function isSameDiscourseTopicFloorUrl(currentUrl: string, expectedUrl: string): boolean {
  const current = parseDiscourseTopicUrl(currentUrl);
  const expected = parseDiscourseTopicUrl(expectedUrl);
  if (!current || !expected) return false;
  return (
    current.origin === expected.origin &&
    current.slug === expected.slug &&
    current.topicId === expected.topicId &&
    current.postNumber === expected.postNumber
  );
}

export function buildDiscourseTopicFloorUrl(
  topic: {
    origin: string;
    slug: string;
    topicId: string;
  },
  postNumber: number,
): string {
  return `${topic.origin}/t/${topic.slug}/${topic.topicId}/${Math.max(1, Math.floor(postNumber))}`;
}
