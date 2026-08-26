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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function deviceStartBody(overrides: Record<string, unknown> = {}) {
  return {
    device_code: 'DEVICE_SENTINEL_SECRET',
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5,
    ...overrides,
  };
}

describe('github device flow', () => {
  beforeEach(() => {
    store = {};
    vi.resetModules();
  });

  it('starts with public client_id only and stores a recoverable pending state', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return jsonResponse(deviceStartBody());
    }) as unknown as typeof fetch;
    const { startDeviceFlow } = await import('@services/sync/github/auth/device-flow');
    const { GITHUB_AUTH_STATE_KEY, getGithubAuthState } = await import('@services/sync/github/auth/auth-store');

    const summary = await startDeviceFlow({ fetchImpl, now: () => 1_000 });
    expect(summary).toEqual({
      state: 'pending',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 901_000,
      nextPollAt: 6_000,
    });
    expect(JSON.stringify(summary)).not.toContain('DEVICE_SENTINEL_SECRET');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://github.com/login/device/code');
    expect(requests[0].init?.method).toBe('POST');
    expect(requests[0].init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(String(requests[0].init?.body)).toBe('client_id=Iv23li7lctsW4U5YthUV');
    expect(Object.keys(store)).toEqual([GITHUB_AUTH_STATE_KEY]);
    expect((await getGithubAuthState()).state).toBe('pending');
  });

  it('rejects a non-GitHub verification URI without persisting the device code', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(deviceStartBody({ verification_uri: 'https://evil.example/device' })),
    ) as unknown as typeof fetch;
    const { startDeviceFlow } = await import('@services/sync/github/auth/device-flow');
    await expect(startDeviceFlow({ fetchImpl, now: () => 1_000 })).rejects.toMatchObject({
      code: 'github_device_verification_uri_invalid',
    });
    expect(JSON.stringify(store)).not.toContain('DEVICE_SENTINEL_SECRET');
  });

  it('does not poll early and uses the exact device grant URN when due', async () => {
    let now = 1_000;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [deviceStartBody(), { error: 'authorization_pending' }];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return jsonResponse(responses.shift());
    }) as unknown as typeof fetch;
    const { pollDeviceFlowOnce, startDeviceFlow } = await import('@services/sync/github/auth/device-flow');

    await startDeviceFlow({ fetchImpl, now: () => now });
    requests.length = 0;
    now = 5_999;
    const early = await pollDeviceFlowOnce({ fetchImpl, now: () => now });
    expect(early).toMatchObject({ state: 'pending', nextPollAt: 6_000 });
    expect(requests).toHaveLength(0);

    now = 6_000;
    const pending = await pollDeviceFlowOnce({ fetchImpl, now: () => now });
    expect(pending).toMatchObject({ state: 'pending', nextPollAt: 11_000 });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://github.com/login/oauth/access_token');
    expect(requests[0].init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const body = new URLSearchParams(String(requests[0].init?.body));
    expect(Object.fromEntries(body)).toEqual({
      client_id: 'Iv23li7lctsW4U5YthUV',
      device_code: 'DEVICE_SENTINEL_SECRET',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  });

  it('accumulates slow_down by five seconds and never falls back to the old interval', async () => {
    let now = 1_000;
    const responses = [deviceStartBody(), { error: 'slow_down' }, { error: 'slow_down' }];
    const fetchImpl = vi.fn(async () => jsonResponse(responses.shift())) as unknown as typeof fetch;
    const { pollDeviceFlowOnce, startDeviceFlow } = await import('@services/sync/github/auth/device-flow');
    const { getGithubAuthState } = await import('@services/sync/github/auth/auth-store');

    await startDeviceFlow({ fetchImpl, now: () => now });
    now = 6_000;
    await pollDeviceFlowOnce({ fetchImpl, now: () => now });
    let state = await getGithubAuthState();
    expect(state.state === 'pending' && state.pending.intervalMs).toBe(10_000);
    expect(state.state === 'pending' && state.pending.nextPollAt).toBe(16_000);

    now = 16_000;
    await pollDeviceFlowOnce({ fetchImpl, now: () => now });
    state = await getGithubAuthState();
    expect(state.state === 'pending' && state.pending.intervalMs).toBe(15_000);
    expect(state.state === 'pending' && state.pending.nextPollAt).toBe(31_000);
  });

  it.each(['network', 'invalid_json', 'unknown_error'] as const)(
    'keeps the minimum polling interval after a %s poll failure',
    async (failureKind) => {
      let now = 1_000;
      let pollRequests = 0;
      const fetchImpl = vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith('/login/device/code')) return jsonResponse(deviceStartBody());
        pollRequests += 1;
        if (failureKind === 'network') throw new Error('network failed');
        if (failureKind === 'invalid_json') return new Response('not-json', { status: 200 });
        return jsonResponse({ error: 'unexpected_oauth_error' });
      }) as unknown as typeof fetch;
      const { pollDeviceFlowOnce, startDeviceFlow } = await import('@services/sync/github/auth/device-flow');
      const { getGithubAuthState } = await import('@services/sync/github/auth/auth-store');

      await startDeviceFlow({ fetchImpl, now: () => now });
      now = 6_000;
      await expect(pollDeviceFlowOnce({ fetchImpl, now: () => now })).rejects.toMatchObject({
        code: 'github_device_poll_failed',
      });
      let state = await getGithubAuthState();
      expect(state.state === 'pending' && state.pending.nextPollAt).toBe(11_000);
      expect(pollRequests).toBe(1);

      now = 6_001;
      await expect(pollDeviceFlowOnce({ fetchImpl, now: () => now })).resolves.toMatchObject({
        state: 'pending',
        nextPollAt: 11_000,
      });
      state = await getGithubAuthState();
      expect(state.state === 'pending' && state.pending.nextPollAt).toBe(11_000);
      expect(pollRequests).toBe(1);
    },
  );

  it('atomically replaces pending with connected without returning token secrets', async () => {
    let now = 1_000;
    const responses = [
      deviceStartBody(),
      {
        access_token: 'ACCESS_SENTINEL_SECRET',
        expires_in: 28_800,
        refresh_token: 'REFRESH_SENTINEL_SECRET',
        refresh_token_expires_in: 15_552_000,
        token_type: 'bearer',
      },
    ];
    const fetchImpl = vi.fn(async () => jsonResponse(responses.shift())) as unknown as typeof fetch;
    const { pollDeviceFlowOnce, startDeviceFlow } = await import('@services/sync/github/auth/device-flow');
    const { getGithubAuthState } = await import('@services/sync/github/auth/auth-store');

    await startDeviceFlow({ fetchImpl, now: () => now });
    now = 6_000;
    const summary = await pollDeviceFlowOnce({ fetchImpl, now: () => now });
    expect(summary).toEqual({ state: 'connected' });
    expect(JSON.stringify(summary)).not.toMatch(
      /ACCESS_SENTINEL_SECRET|REFRESH_SENTINEL_SECRET|DEVICE_SENTINEL_SECRET/,
    );

    const state = await getGithubAuthState();
    expect(state).toEqual({
      version: 1,
      state: 'connected',
      token: {
        accessToken: 'ACCESS_SENTINEL_SECRET',
        accessExpiresAt: 28_806_000,
        refreshToken: 'REFRESH_SENTINEL_SECRET',
        refreshExpiresAt: 15_552_006_000,
        createdAt: 6_000,
      },
    });
    expect(JSON.stringify(store)).not.toContain('pending');
  });

  it.each([
    ['expired_token', 'github_device_expired'],
    ['access_denied', 'github_device_denied'],
    ['device_flow_disabled', 'github_device_disabled'],
    ['incorrect_device_code', 'github_device_invalid'],
  ])('clears pending state for terminal %s', async (remoteError, expectedCode) => {
    let now = 1_000;
    const responses = [deviceStartBody(), { error: remoteError }];
    const fetchImpl = vi.fn(async () => jsonResponse(responses.shift())) as unknown as typeof fetch;
    const { pollDeviceFlowOnce, startDeviceFlow } = await import('@services/sync/github/auth/device-flow');
    const { getGithubAuthState } = await import('@services/sync/github/auth/auth-store');

    await startDeviceFlow({ fetchImpl, now: () => now });
    now = 6_000;
    await expect(pollDeviceFlowOnce({ fetchImpl, now: () => now })).rejects.toMatchObject({ code: expectedCode });
    expect(await getGithubAuthState()).toEqual({ version: 1, state: 'disconnected' });
  });

  it('restores pending after module reload and supports explicit cancel', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(deviceStartBody())) as unknown as typeof fetch;
    let mod = await import('@services/sync/github/auth/device-flow');
    await mod.startDeviceFlow({ fetchImpl, now: () => 1_000 });

    vi.resetModules();
    mod = await import('@services/sync/github/auth/device-flow');
    const { getGithubSafeAuthSummary } = await import('@services/sync/github/auth/auth-store');
    expect(await getGithubSafeAuthSummary()).toMatchObject({ state: 'pending', userCode: 'ABCD-EFGH' });
    expect(await mod.cancelDeviceFlow()).toEqual({ state: 'disconnected' });
    expect(await getGithubSafeAuthSummary()).toEqual({ state: 'disconnected' });
  });
});
