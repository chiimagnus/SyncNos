type PageRequest = {
  conversationId: string;
  before?: string;
  numTurns: number;
  timeoutMs: number;
};

type PageResult = { ok: true; data: any } | { ok: false; code: string; status?: number };

// chrome.scripting.executeScript serializes this function into the page MAIN world.
export async function fetchChatgptPageInMainWorld(input: PageRequest): Promise<PageResult> {
  const pageId = String(input?.conversationId || '');
  const pathname = String(location.pathname || '');
  const match = pathname.match(/^\/c\/([^/]+)\/?$/) || pathname.match(/^\/g\/[^/]+\/c\/([^/]+)\/?$/);
  if (location.origin !== 'https://chatgpt.com' || !match || match[1] !== pageId) {
    return { ok: false, code: 'chatgpt_api_navigation_changed' };
  }
  const before = String(input?.before || '');
  if (before && !/^[0-9a-zA-Z_-]+$/.test(before)) return { ok: false, code: 'chatgpt_api_page_cursor_invalid' };
  const numTurns = input?.numTurns === 1 ? 1 : 10;
  const timeoutMs = Math.max(1, Math.min(60_000, Number(input?.timeoutMs) || 30_000));

  const request = async (url: string, init: RequestInit, prefix: string): Promise<PageResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: controller.signal, credentials: 'include' });
      } catch (_error) {
        return { ok: false, code: prefix + '_' + (controller.signal.aborted ? 'timeout' : 'network') };
      }
      if (!response.ok) return { ok: false, code: prefix + '_http', status: response.status };
      try {
        return { ok: true, data: await response.json() };
      } catch (_error) {
        return { ok: false, code: prefix + '_' + (controller.signal.aborted ? 'timeout' : 'schema') };
      }
    } finally {
      clearTimeout(timer);
    }
  };

  const session = await request('/api/auth/session', { method: 'GET' }, 'chatgpt_api_session');
  if (!session.ok) return session;
  const token = typeof session.data?.accessToken === 'string' ? session.data.accessToken.trim() : '';
  if (!token) return { ok: false, code: 'chatgpt_api_session_schema' };

  const base = '/backend-api/conversations/' + encodeURIComponent(pageId);
  const query = 'include_has_versions=true&num_turns=' + numTurns;
  const endpoint = before ? base + '/messages?before=' + encodeURIComponent(before) + '&' + query : base + '?' + query;
  const page = await request(
    endpoint,
    { method: 'GET', headers: { Authorization: 'Bearer ' + token } },
    'chatgpt_api_page',
  );
  if (location.origin !== 'https://chatgpt.com' || location.pathname !== pathname) {
    return { ok: false, code: 'chatgpt_api_navigation_changed' };
  }
  return page;
}
