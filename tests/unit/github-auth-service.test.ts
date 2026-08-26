import { beforeEach, describe, expect, it, vi } from 'vitest';

let store: Record<string, unknown>;

vi.mock('@platform/storage/local', () => ({
  storageGet: async (keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
    }
    return out;
  },
  storageSet: async (items: Record<string, unknown>) => {
    Object.assign(store, structuredClone(items));
  },
}));

function connectedState(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    state: 'connected' as const,
    token: {
      accessToken: 'ACCESS_SENTINEL_SECRET',
      accessExpiresAt: 28_801_000,
      refreshToken: 'REFRESH_SENTINEL_SECRET',
      refreshExpiresAt: 15_552_001_000,
      createdAt: 1_000,
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('github auth service', () => {
  beforeEach(() => {
    store = {};
    vi.resetModules();
  });

  it('returns a valid access token without refreshing when outside the skew window', async () => {
    const { replaceGithubAuthState } = await import('@services/sync/github/auth/auth-store');
    await replaceGithubAuthState(connectedState());
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { getValidAccessToken } = await import('@services/sync/github/auth/github-auth-service');

    expect(await getValidAccessToken({ fetchImpl, now: () => 1_000 })).toBe('ACCESS_SENTINEL_SECRET');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes at the skew boundary and atomically rotates the 8h/6month token pair', async () => {
    const { replaceGithubAuthState, getGithubAuthState } = await import('@services/sync/github/auth/auth-store');
    await replaceGithubAuthState(connectedState({ accessExpiresAt: 301_000 }));
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return jsonResponse({
        access_token: 'ACCESS_ROTATED_SECRET',
        expires_in: 28_800,
        refresh_token: 'REFRESH_ROTATED_SECRET',
        refresh_token_expires_in: 15_552_000,
      });
    }) as unknown as typeof fetch;
    const { getValidAccessToken } = await import('@services/sync/github/auth/github-auth-service');

    expect(await getValidAccessToken({ fetchImpl, now: () => 1_000 })).toBe('ACCESS_ROTATED_SECRET');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://github.com/login/oauth/access_token');
    expect(requests[0].init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(Object.fromEntries(new URLSearchParams(String(requests[0].init?.body)))).toEqual({
      client_id: 'Iv23li7lctsW4U5YthUV',
      refresh_token: 'REFRESH_SENTINEL_SECRET',
      grant_type: 'refresh_token',
    });
    expect(await getGithubAuthState()).toEqual({
      version: 1,
      state: 'connected',
      token: {
        accessToken: 'ACCESS_ROTATED_SECRET',
        accessExpiresAt: 28_801_000,
        refreshToken: 'REFRESH_ROTATED_SECRET',
        refreshExpiresAt: 15_552_001_000,
        createdAt: 1_000,
      },
    });
  });

  it('shares one refresh request across concurrent callers for the same rotating refresh token', async () => {
    const { replaceGithubAuthState } = await import('@services/sync/github/auth/auth-store');
    await replaceGithubAuthState(connectedState({ accessExpiresAt: 2_000 }));

    let release: (() => void) | null = null;
    const fetchImpl = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return jsonResponse({
        access_token: 'ACCESS_ROTATED_SECRET',
        expires_in: 28_800,
        refresh_token: 'REFRESH_ROTATED_SECRET',
        refresh_token_expires_in: 15_552_000,
      });
    }) as unknown as typeof fetch;
    const { getValidAccessToken } = await import('@services/sync/github/auth/github-auth-service');

    const first = getValidAccessToken({ fetchImpl, now: () => 1_000 });
    const second = getValidAccessToken({ fetchImpl, now: () => 1_000 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    release?.();
    expect(await Promise.all([first, second])).toEqual(['ACCESS_ROTATED_SECRET', 'ACCESS_ROTATED_SECRET']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clears auth and returns auth-required for an expired refresh token or missing refresh token', async () => {
    const { replaceGithubAuthState, getGithubAuthState } = await import('@services/sync/github/auth/auth-store');
    const { getValidAccessToken } = await import('@services/sync/github/auth/github-auth-service');

    await replaceGithubAuthState(connectedState({ accessExpiresAt: 2_000, refreshExpiresAt: 999 }));
    await expect(getValidAccessToken({ now: () => 1_000 })).rejects.toMatchObject({
      code: 'github_auth_required',
    });
    expect(await getGithubAuthState()).toEqual({ version: 1, state: 'disconnected' });

    await replaceGithubAuthState(
      connectedState({ accessExpiresAt: 2_000, refreshToken: undefined, refreshExpiresAt: undefined }),
    );
    await expect(getValidAccessToken({ now: () => 1_000 })).rejects.toMatchObject({
      code: 'github_auth_required',
    });
    expect(await getGithubAuthState()).toEqual({ version: 1, state: 'disconnected' });
  });

  it('clears auth on deterministic invalid refresh but never leaks token sentinels in the error', async () => {
    const { replaceGithubAuthState, getGithubAuthState } = await import('@services/sync/github/auth/auth-store');
    await replaceGithubAuthState(connectedState({ accessExpiresAt: 2_000 }));
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'bad_refresh_token' }, 400)) as unknown as typeof fetch;
    const { getValidAccessToken } = await import('@services/sync/github/auth/github-auth-service');

    let caught: unknown;
    try {
      await getValidAccessToken({ fetchImpl, now: () => 1_000 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'github_auth_required' });
    expect(String(caught)).not.toMatch(/ACCESS_SENTINEL_SECRET|REFRESH_SENTINEL_SECRET/);
    expect(await getGithubAuthState()).toEqual({ version: 1, state: 'disconnected' });
  });

  it('clears only the auth record that matches the access token rejected by GitHub', async () => {
    const { replaceGithubAuthState, getGithubAuthState } = await import('@services/sync/github/auth/auth-store');
    const { clearGithubAuthForAccessToken } = await import('@services/sync/github/auth/github-auth-service');
    await replaceGithubAuthState(connectedState({ accessToken: 'ACCESS_ROTATED_SECRET' }));

    await clearGithubAuthForAccessToken('STALE_ACCESS_SECRET');
    expect((await getGithubAuthState()).state).toBe('connected');

    await clearGithubAuthForAccessToken('ACCESS_ROTATED_SECRET');
    expect(await getGithubAuthState()).toEqual({ version: 1, state: 'disconnected' });
  });

  it('preserves the previous complete token record on transient or incomplete refresh failure', async () => {
    const { replaceGithubAuthState, getGithubAuthState } = await import('@services/sync/github/auth/auth-store');
    await replaceGithubAuthState(connectedState({ accessExpiresAt: 2_000 }));
    const original = await getGithubAuthState();
    const { getValidAccessToken } = await import('@services/sync/github/auth/github-auth-service');

    const networkFetch = vi.fn(async () => {
      throw new TypeError('network failed');
    }) as unknown as typeof fetch;
    await expect(getValidAccessToken({ fetchImpl: networkFetch, now: () => 1_000 })).rejects.toMatchObject({
      code: 'github_auth_refresh_failed',
    });
    expect(await getGithubAuthState()).toEqual(original);

    const incompleteFetch = vi.fn(async () =>
      jsonResponse({ access_token: 'NEW_ACCESS_ONLY', expires_in: 28_800 }),
    ) as unknown as typeof fetch;
    await expect(getValidAccessToken({ fetchImpl: incompleteFetch, now: () => 1_000 })).rejects.toMatchObject({
      code: 'github_auth_refresh_failed',
    });
    expect(await getGithubAuthState()).toEqual(original);
  });
});
