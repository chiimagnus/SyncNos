import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchChatgptPageInMainWorld } from '@services/integrations/chatgpt/api-main-fetch';

const base = { conversationId: 'conversation-1', before: '', numTurns: 10, timeoutMs: 1000 };

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://chatgpt.com', pathname: '/c/conversation-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatGPT MAIN-world paged API request', () => {
  it('fetches session and only one requested page without exposing the bearer token', async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/session') return new Response(JSON.stringify({ accessToken: 'SECRET_TOKEN' }));
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer SECRET_TOKEN');
      return new Response(JSON.stringify({ conversation_id: 'conversation-1', messages: [{ id: 'message-1' }] }));
    });
    vi.stubGlobal('fetch', fetchFn);

    const result = await fetchChatgptPageInMainWorld(base);
    expect(result).toMatchObject({ ok: true, data: { conversation_id: 'conversation-1' } });
    expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][0]).toBe(
      '/backend-api/conversations/conversation-1?include_has_versions=true&num_turns=10',
    );
  });

  it('reads older pages by cursor and supports a one-turn head recheck', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify(url === '/api/auth/session' ? { accessToken: 'token' } : { messages: [], page_info: {} }),
        );
      }),
    );
    await fetchChatgptPageInMainWorld({ ...base, before: 'older-message' });
    await fetchChatgptPageInMainWorld({ ...base, numTurns: 1 });
    expect(urls).toContain(
      '/backend-api/conversations/conversation-1/messages?before=older-message&include_has_versions=true&num_turns=10',
    );
    expect(urls).toContain('/backend-api/conversations/conversation-1?include_has_versions=true&num_turns=1');
    expect(urls.some((url) => url.startsWith('/backend-api/conversation/'))).toBe(false);
  });

  it('rejects cross-conversation identities, invalid cursor strings and foreign origins without requesting auth', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    await expect(fetchChatgptPageInMainWorld({ ...base, conversationId: 'other' })).resolves.toMatchObject({
      ok: false,
      code: 'chatgpt_api_navigation_changed',
    });
    await expect(fetchChatgptPageInMainWorld({ ...base, before: '../other' })).resolves.toMatchObject({
      ok: false,
      code: 'chatgpt_api_page_cursor_invalid',
    });
    vi.stubGlobal('location', { origin: 'https://evil.example', pathname: '/c/conversation-1' });
    await expect(fetchChatgptPageInMainWorld(base)).resolves.toMatchObject({
      ok: false,
      code: 'chatgpt_api_navigation_changed',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not return the session token or private server error body on HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/auth/session'
          ? new Response(JSON.stringify({ accessToken: 'SECRET' }))
          : new Response('PRIVATE_BODY', { status: 503 }),
      ),
    );
    const result = await fetchChatgptPageInMainWorld(base);
    expect(result).toMatchObject({ ok: false, code: 'chatgpt_api_page_http', status: 503 });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_BODY');
  });

  it('distinguishes session failures from page failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('login required', { status: 401 })),
    );
    await expect(fetchChatgptPageInMainWorld(base)).resolves.toMatchObject({
      ok: false,
      code: 'chatgpt_api_session_http',
      status: 401,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}))),
    );
    await expect(fetchChatgptPageInMainWorld(base)).resolves.toMatchObject({
      ok: false,
      code: 'chatgpt_api_session_schema',
    });
  });

  it('rejects responses when the page navigates during the request', async () => {
    let index = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (index++ === 0) return new Response(JSON.stringify({ accessToken: 'token' }));
        vi.stubGlobal('location', { origin: 'https://chatgpt.com', pathname: '/c/other' });
        return new Response(JSON.stringify({ messages: [{ id: 'irrelevant' }] }));
      }),
    );
    await expect(fetchChatgptPageInMainWorld(base)).resolves.toMatchObject({
      ok: false,
      code: 'chatgpt_api_navigation_changed',
    });
  });
});
