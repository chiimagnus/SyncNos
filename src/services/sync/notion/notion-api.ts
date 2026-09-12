const NOTION_VERSION = '2022-06-28';

interface NotionApiError extends Error {
  status?: number;
  retryAfterMs?: number;
  code?: string;
  notionMessage?: string;
  requestId?: string;
}

interface NotionFetchArgs {
  accessToken: string;
  method: string;
  path: string;
  body?: unknown;
  notionVersion?: string;
}

function safeJsonParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_e) {
    return null;
  }
}

function parseRetryAfterMs(res: Response): number {
  const raw = String(res.headers.get('Retry-After') || '').trim();
  if (!raw) return 0;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return 0;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : 0;
}

async function notionFetch({ accessToken, method, path, body, notionVersion }: NotionFetchArgs) {
  if (!accessToken) throw new Error('missing notion access token');
  const url = `https://api.notion.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': notionVersion || NOTION_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err: NotionApiError = new Error(`notion api failed: ${method} ${path} HTTP ${res.status} ${text}`);
    err.status = res.status;
    const retryAfterMs = parseRetryAfterMs(res);
    if (retryAfterMs > 0) err.retryAfterMs = retryAfterMs;
    const parsed = safeJsonParse(text) as Record<string, unknown> | null;
    if (parsed && typeof parsed === 'object') {
      if (parsed.code) err.code = String(parsed.code);
      if (parsed.message) err.notionMessage = String(parsed.message);
      const rid = parsed.request_id || parsed.requestId || parsed.requestID;
      if (rid) err.requestId = String(rid);
    }
    if (!err.notionMessage) {
      const fallback = String(text || '').trim();
      if (fallback) err.notionMessage = fallback;
    }
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

function getPageTitle(page: { properties?: Record<string, any>; url?: string }): string {
  const props = page.properties || {};
  for (const key of Object.keys(props)) {
    const property = props[key];
    if (property?.type !== 'title' || !Array.isArray(property.title)) continue;
    const title = property.title
      .map((item: any) => item.plain_text || '')
      .join('')
      .trim();
    if (title) return title;
  }
  return page.url || 'Untitled';
}

export { notionFetch, getPageTitle };
