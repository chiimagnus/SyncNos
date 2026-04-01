const DISCOURSE_TOPIC_PATH_RE = /^\/t\/([^/]+)\/(\d+)(?:\/(\d+))?\/?$/i;

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

export function normalizeHttpUrl(raw: unknown): string {
  const url = parseHttpUrl(raw);
  if (!url) return '';
  url.hash = '';
  return url.toString();
}

export function canonicalizeArticleUrl(raw: unknown): string {
  const url = parseHttpUrl(raw);
  if (!url) return '';
  url.hash = '';

  const match = url.pathname.match(DISCOURSE_TOPIC_PATH_RE);
  if (match) {
    const slug = match[1];
    const topicId = match[2];
    url.pathname = `/t/${slug}/${topicId}`;
    url.search = '';
  }

  return url.toString();
}
