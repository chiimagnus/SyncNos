const NOTION_VERSION = '2022-06-28';

interface NotionApiError extends Error {
  status?: number;
  retryAfterMs?: number;
  code?: string;
  notionMessage?: string;
  requestId?: string;
}

interface NotionFetchArgs {
  accessToken?: string | null;
  method: string;
  path: string;
  body?: unknown;
  notionVersion?: string | null;
}

interface NotionSearchArgs {
  accessToken?: string | null;
  query?: string | null;
  pageSize?: number | null;
}

function safeJsonParse(text: string | null | undefined): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_e) {
    return null;
  }
}

function parseRetryAfterMs(res: Response | null | undefined): number {
  try {
    const raw =
      res && res.headers && typeof res.headers.get === 'function'
        ? String(res.headers.get('Retry-After') || '').trim()
        : '';
    if (!raw) return 0;
    const sec = Number(raw);
    if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
    const dateMs = Date.parse(raw);
    if (!Number.isFinite(dateMs)) return 0;
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  } catch (_e) {
    return 0;
  }
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

function getPageTitle(page: { properties?: Record<string, any>; url?: string } | null | undefined): string {
  try {
    const props = page && page.properties ? page.properties : {};
    for (const key of Object.keys(props)) {
      const p = props[key];
      if (p && p.type === 'title' && Array.isArray(p.title)) {
        const t = p.title
          .map((x: any) => x.plain_text || '')
          .join('')
          .trim();
        if (t) return t;
      }
    }
  } catch (_e) {
    // ignore
  }
  return page && page.url ? page.url : 'Untitled';
}

function buildSearchBody({
  query,
  pageSize,
  startCursor,
}: {
  query?: string | null;
  pageSize?: number;
  startCursor?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    filter: { property: 'object', value: 'page' },
    page_size: pageSize || 50,
  };
  const q = String(query || '').trim();
  if (q) body.query = q;
  if (startCursor) body.start_cursor = String(startCursor);
  return body;
}

async function searchPages({ accessToken, query, pageSize }: NotionSearchArgs) {
  const size = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Number(pageSize) : 50;
  let cursor: string | null = null;
  let guard = 0;

  while (guard < 20) {
    guard += 1;
    const body = buildSearchBody({ query, pageSize: size, startCursor: cursor });
    const res = await notionFetch({ accessToken, method: 'POST', path: '/v1/search', body });
    const results = Array.isArray(res && res.results) ? res.results : [];
    const usableParentPages = results.filter((item: any) => {
      if (!item || item.object !== 'page') return false;
      const parent = item.parent || null;
      if (!parent) return true;
      if (parent.database_id) return false;
      if (parent.type === 'database_id') return false;
      return true;
    });
    if (usableParentPages.length) {
      return { ...(res || {}), results: usableParentPages };
    }
    if (!res || !res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }

  return { results: [], has_more: false, next_cursor: null };
}

export { notionFetch, searchPages, getPageTitle, NOTION_VERSION };
