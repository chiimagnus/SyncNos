import { describe, expect, it, vi } from 'vitest';

import { createGithubApiClient, GithubApiError, type GithubApiClock } from '@services/sync/github/github-api-client';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function fixedClock(now = 1_000): GithubApiClock {
  return {
    now: () => now,
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
}

describe('github api client', () => {
  it('centralizes GitHub headers and decodes GET/POST/PATCH JSON', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return jsonResponse({ ok: true, method: init?.method });
    }) as unknown as typeof fetch;
    const client = createGithubApiClient({
      getAccessToken: async () => 'ACCESS_SENTINEL_SECRET',
      onUnauthorized: vi.fn(),
      fetchImpl,
      clock: fixedClock(),
    });

    expect(await client.get('/user')).toEqual({ ok: true, method: 'GET' });
    expect(await client.post('/git/blobs', { content: 'hello' })).toEqual({ ok: true, method: 'POST' });
    expect(await client.patch('/git/refs/heads/main', { force: false })).toEqual({ ok: true, method: 'PATCH' });

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/git/blobs',
      'https://api.github.com/git/refs/heads/main',
    ]);
    for (const request of requests) {
      expect(request.init?.headers).toMatchObject({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ACCESS_SENTINEL_SECRET',
        'X-GitHub-Api-Version': '2026-03-10',
      });
    }
    expect(requests[0].init?.headers).not.toHaveProperty('Content-Type');
    expect(requests[1].init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(requests[1].init?.body).toBe('{"content":"hello"}');
    expect(requests[2].init?.body).toBe('{"force":false}');
  });

  it('uses AbortController timeout without clearing auth state', async () => {
    const onUnauthorized = vi.fn();
    const clearTimeout = vi.fn();
    const clock: GithubApiClock = {
      now: () => 1_000,
      setTimeout: (callback) => {
        callback();
        return 7;
      },
      clearTimeout,
    };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    const client = createGithubApiClient({
      getAccessToken: async () => 'ACCESS_SENTINEL_SECRET',
      onUnauthorized,
      fetchImpl,
      clock,
    });

    await expect(client.get('/user')).rejects.toMatchObject({ code: 'github_timeout', status: 0 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(clearTimeout).toHaveBeenCalledWith(7);
  });

  it('treats HTTP 401 as auth transition, clears once and never replays the request', async () => {
    const onUnauthorized = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: 'Bad credentials ACCESS_SENTINEL_SECRET' }, 401, {
        'x-github-request-id': 'REQ-401',
      }),
    ) as unknown as typeof fetch;
    const client = createGithubApiClient({
      getAccessToken: async () => 'ACCESS_SENTINEL_SECRET',
      onUnauthorized,
      fetchImpl,
      clock: fixedClock(),
    });

    let caught: unknown;
    try {
      await client.get('/user');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GithubApiError);
    expect(caught).toMatchObject({ code: 'github_auth_required', status: 401, requestId: 'REQ-401' });
    expect(String(caught)).not.toContain('ACCESS_SENTINEL_SECRET');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledWith('ACCESS_SENTINEL_SECRET');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404])('returns bounded safe HTTP metadata for status %s', async (status) => {
    const token = 'ACCESS_SENTINEL_SECRET';
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { message: `Denied ${token}\nBearer SHOULD_NOT_LEAK`, documentation_url: 'https://docs.example/private' },
        status,
        {
          'x-github-request-id': `REQ-${status}`,
          'retry-after': '2',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '123',
        },
      ),
    ) as unknown as typeof fetch;
    const client = createGithubApiClient({
      getAccessToken: async () => token,
      onUnauthorized: vi.fn(),
      fetchImpl,
      clock: fixedClock(1_000),
    });

    let caught: any;
    try {
      await client.get('/repos/owner/repo');
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'github_http_error',
      status,
      requestId: `REQ-${status}`,
      retryAfterMs: 2_000,
      rateLimitRemaining: 0,
      rateLimitResetAt: 123_000,
    });
    expect(caught.safeMessage.length).toBeLessThanOrEqual(240);
    expect(caught.safeMessage).not.toMatch(/ACCESS_SENTINEL_SECRET|SHOULD_NOT_LEAK/);
    expect(JSON.stringify(caught)).not.toMatch(
      /Authorization|documentation_url|ACCESS_SENTINEL_SECRET|SHOULD_NOT_LEAK/,
    );
  });

  it('keeps network failures safe and rejects external/invalid paths before fetch', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network ACCESS_SENTINEL_SECRET');
    }) as unknown as typeof fetch;
    const client = createGithubApiClient({
      getAccessToken: async () => 'ACCESS_SENTINEL_SECRET',
      onUnauthorized: vi.fn(),
      fetchImpl,
      clock: fixedClock(),
    });

    let caught: any;
    try {
      await client.get('/user');
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'github_network_error', status: 0, safeMessage: 'github_network_error' });
    expect(JSON.stringify(caught)).not.toContain('ACCESS_SENTINEL_SECRET');

    await expect(client.get('https://evil.example/user')).rejects.toMatchObject({
      safeMessage: 'github_api_path_invalid',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed successful JSON without retaining the response body', async () => {
    const fetchImpl = vi.fn(async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch;
    const client = createGithubApiClient({
      getAccessToken: async () => 'ACCESS_SENTINEL_SECRET',
      onUnauthorized: vi.fn(),
      fetchImpl,
      clock: fixedClock(),
    });
    await expect(client.get('/user')).rejects.toMatchObject({
      code: 'github_response_invalid',
      status: 200,
      safeMessage: 'github_response_invalid',
    });
  });
});
