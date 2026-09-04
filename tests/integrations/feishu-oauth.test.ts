import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearFeishuOAuthAttemptAndToken,
  getFeishuOAuthDefaults,
  handleFeishuOAuthCallbackNavigation,
  refreshFeishuOAuthToken,
  saveFeishuOAuthConfig,
  startFeishuOAuthAttempt,
} from '@services/sync/feishu/auth/oauth';
import type { FeishuOAuthTokenV1 } from '@services/sync/feishu/auth/token-store';

const TOKEN_KEY = 'feishu_oauth_token_v1';
const CLIENT_ID_KEY = 'feishu_oauth_client_id';
const CLIENT_SECRET_KEY = 'feishu_oauth_client_secret';
const PROXY_KEY = 'feishu_oauth_token_exchange_proxy_url';
const PENDING_KEY = 'feishu_oauth_pending_state';
const ERROR_KEY = 'feishu_oauth_last_error';

type ChromeMock = ReturnType<typeof createChromeMock>;

function createChromeMock(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const tabsCreated: any[] = [];
  const tabsRemoved: number[] = [];
  const storeAtCreate: Record<string, unknown>[] = [];
  let failNextTabCreate = false;
  let failNextStorageSet = false;

  const runtime: any = {};
  const withLastError = (message: string, callback: () => void) => {
    runtime.lastError = { message };
    try {
      callback();
    } finally {
      delete runtime.lastError;
    }
  };

  const chromeMock = {
    runtime,
    storage: {
      local: {
        get(keys: string[], callback: (result: Record<string, unknown>) => void) {
          const result: Record<string, unknown> = {};
          for (const key of keys || []) {
            result[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
          }
          callback(result);
        },
        set(payload: Record<string, unknown>, callback: () => void) {
          if (failNextStorageSet) {
            failNextStorageSet = false;
            withLastError('storage set failed', callback);
            return;
          }
          Object.assign(store, payload || {});
          callback();
        },
        remove(keys: string[], callback: () => void) {
          for (const key of keys || []) delete store[key];
          callback();
        },
      },
    },
    tabs: {
      create(properties: any, callback: (tab: any) => void) {
        storeAtCreate.push(structuredClone(store));
        if (failNextTabCreate) {
          failNextTabCreate = false;
          withLastError('tabs create failed', () => callback(null));
          return;
        }
        tabsCreated.push({ ...properties });
        callback({ id: tabsCreated.length, ...properties });
      },
      remove(tabId: number, callback: () => void) {
        tabsRemoved.push(tabId);
        callback();
      },
    },
    __store: store,
    __tabsCreated: tabsCreated,
    __tabsRemoved: tabsRemoved,
    __storeAtCreate: storeAtCreate,
    failNextTabCreate() {
      failNextTabCreate = true;
    },
    failNextStorageSet() {
      failNextStorageSet = true;
    },
  };
  return chromeMock;
}

function jsonResponse(json: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(json),
  } as any;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  for (let index = 0; index < 30; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('timed out waiting for predicate');
}

function authConfig(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'app-id',
    clientSecret: 'app-secret',
    tokenExchangeProxyUrl: '',
    ...overrides,
  };
}

function token(accessToken: string, refreshToken = `${accessToken}-refresh`): FeishuOAuthTokenV1 {
  return { accessToken, refreshToken, expiresAt: 1, createdAt: 1 };
}

let chromeMock: ChromeMock;

beforeEach(() => {
  vi.restoreAllMocks();
  chromeMock = createChromeMock();
  // @ts-expect-error test global
  globalThis.browser = undefined;
  // @ts-expect-error test global
  globalThis.chrome = chromeMock;
});

describe('Feishu OAuth owner', () => {
  it('starts with secure state after persisting immutable config and pending state', async () => {
    const started = await startFeishuOAuthAttempt(authConfig());

    expect(started.state).toMatch(/^[0-9a-f]{32}$/);
    expect(chromeMock.__store).toMatchObject({
      [CLIENT_ID_KEY]: 'app-id',
      [CLIENT_SECRET_KEY]: 'app-secret',
      [PROXY_KEY]: '',
      [PENDING_KEY]: started.state,
      [ERROR_KEY]: '',
    });
    expect(chromeMock.__tabsCreated).toHaveLength(1);
    expect(chromeMock.__storeAtCreate[0]).toMatchObject({
      [CLIENT_ID_KEY]: 'app-id',
      [CLIENT_SECRET_KEY]: 'app-secret',
      [PENDING_KEY]: started.state,
    });

    const opened = new URL(chromeMock.__tabsCreated[0].url);
    expect(opened.searchParams.get('client_id')).toBe('app-id');
    expect(opened.searchParams.get('app_id')).toBe('app-id');
    expect(opened.searchParams.get('state')).toBe(started.state);
  });

  it('requires the exact redirect and current state even for OAuth errors', async () => {
    const { state } = await startFeishuOAuthAttempt(authConfig());
    const { redirectUri } = getFeishuOAuthDefaults();

    expect(
      await handleFeishuOAuthCallbackNavigation({ url: `${redirectUri}.evil?error=denied&state=${state}`, tabId: 1 }),
    ).toBe(false);
    expect(await handleFeishuOAuthCallbackNavigation({ url: `${redirectUri}?error=denied`, tabId: 1 })).toBe(false);
    expect(
      await handleFeishuOAuthCallbackNavigation({ url: `${redirectUri}?error=denied&state=other-provider`, tabId: 1 }),
    ).toBe(false);
    expect(chromeMock.__store[PENDING_KEY]).toBe(state);
    expect(chromeMock.__store[ERROR_KEY]).toBe('');
  });

  it('atomically records a current OAuth error and terminates only that attempt', async () => {
    const { state } = await startFeishuOAuthAttempt(authConfig());

    expect(
      await handleFeishuOAuthCallbackNavigation({
        url: `${getFeishuOAuthDefaults().redirectUri}?error=access_denied&state=${state}`,
        tabId: 1,
      }),
    ).toBe(true);

    expect(chromeMock.__store[PENDING_KEY]).toBe('');
    expect(chromeMock.__store[ERROR_KEY]).toBe('access_denied');
    expect(chromeMock.__store[TOKEN_KEY]).toBeUndefined();
  });

  it('does not clear a current attempt when its terminal OAuth error snapshot cannot be persisted', async () => {
    const { state } = await startFeishuOAuthAttempt(authConfig());
    chromeMock.failNextStorageSet();

    await expect(
      handleFeishuOAuthCallbackNavigation({
        url: `${getFeishuOAuthDefaults().redirectUri}?error=access_denied&state=${state}`,
        tabId: 1,
      }),
    ).rejects.toThrow('storage set failed');

    expect(chromeMock.__store[PENDING_KEY]).toBe(state);
    expect(chromeMock.__store[ERROR_KEY]).toBe('');
    expect(chromeMock.__store[TOKEN_KEY]).toBeUndefined();
  });

  it('atomically commits a current token, terminates the attempt, and closes the callback tab', async () => {
    const { state } = await startFeishuOAuthAttempt(authConfig());

    expect(
      await handleFeishuOAuthCallbackNavigation(
        { url: `${getFeishuOAuthDefaults().redirectUri}?code=code-1&state=${state}`, tabId: 9 },
        {
          fetchImpl: vi.fn(async () =>
            jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 60 }),
          ) as any,
          now: () => 1000,
        },
      ),
    ).toBe(true);

    expect(chromeMock.__store[PENDING_KEY]).toBe('');
    expect(chromeMock.__store[ERROR_KEY]).toBe('');
    expect(chromeMock.__store[TOKEN_KEY]).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 61000,
      createdAt: 1000,
    });
    expect(chromeMock.__tabsRemoved).toEqual([9]);
  });

  it('does not persist a token or close the callback tab when the terminal success snapshot fails', async () => {
    const { state } = await startFeishuOAuthAttempt(authConfig());
    chromeMock.failNextStorageSet();

    await expect(
      handleFeishuOAuthCallbackNavigation(
        { url: `${getFeishuOAuthDefaults().redirectUri}?code=code-1&state=${state}`, tabId: 9 },
        {
          fetchImpl: vi.fn(async () =>
            jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 60 }),
          ) as any,
          now: () => 1000,
        },
      ),
    ).rejects.toThrow('storage set failed');

    expect(chromeMock.__store[PENDING_KEY]).toBe(state);
    expect(chromeMock.__store[ERROR_KEY]).toBe('');
    expect(chromeMock.__store[TOKEN_KEY]).toBeUndefined();
    expect(chromeMock.__tabsRemoved).toEqual([]);
  });

  it('keeps pending on a config no-op and invalidates it before a real config change', async () => {
    const { state } = await startFeishuOAuthAttempt(authConfig());

    await saveFeishuOAuthConfig(authConfig());
    expect(chromeMock.__store[PENDING_KEY]).toBe(state);

    const saved = await saveFeishuOAuthConfig(authConfig({ clientId: 'new-app' }));
    expect(saved).toMatchObject({ clientId: 'new-app', clientSecretPresent: true });
    expect(chromeMock.__store[PENDING_KEY]).toBeUndefined();

    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'must-not-write' }));
    const handled = await handleFeishuOAuthCallbackNavigation(
      { url: `${getFeishuOAuthDefaults().redirectUri}?code=old&state=${state}`, tabId: 1 },
      { fetchImpl: fetchImpl as any },
    );
    expect(handled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(chromeMock.__store[TOKEN_KEY]).toBeUndefined();
  });

  it('reads current auth config once per config save owner mutation', async () => {
    Object.assign(chromeMock.__store, authConfig());
    const getSpy = vi.spyOn(chromeMock.storage.local, 'get');

    await saveFeishuOAuthConfig(authConfig({ clientId: 'new-app' }));

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the callback precheck config snapshot and rejects its result after config changes', async () => {
    const { state } = await startFeishuOAuthAttempt(authConfig());
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body).toMatchObject({ client_id: 'app-id', client_secret: 'app-secret', code: 'code-1' });
      await saveFeishuOAuthConfig(authConfig({ clientId: 'new-app', clientSecret: 'new-secret' }));
      return jsonResponse({ access_token: 'stale-token', refresh_token: 'stale-refresh', expires_in: 60 });
    });

    expect(
      await handleFeishuOAuthCallbackNavigation(
        { url: `${getFeishuOAuthDefaults().redirectUri}?code=code-1&state=${state}`, tabId: 9 },
        { fetchImpl: fetchImpl as any, now: () => 100 },
      ),
    ).toBe(true);
    expect(chromeMock.__store[TOKEN_KEY]).toBeUndefined();
    expect(chromeMock.__tabsRemoved).toEqual([]);
  });

  it('does not let stale success or stale failure mutate a newer attempt', async () => {
    const first = await startFeishuOAuthAttempt(authConfig());
    let newerState = '';
    const successFetch = vi.fn(async () => {
      newerState = (await startFeishuOAuthAttempt(authConfig())).state;
      return jsonResponse({ access_token: 'old-success', refresh_token: 'old-refresh', expires_in: 60 });
    });
    await handleFeishuOAuthCallbackNavigation(
      { url: `${getFeishuOAuthDefaults().redirectUri}?code=first&state=${first.state}`, tabId: 3 },
      { fetchImpl: successFetch as any },
    );
    expect(chromeMock.__store[PENDING_KEY]).toBe(newerState);
    expect(chromeMock.__store[TOKEN_KEY]).toBeUndefined();

    const second = newerState;
    let latestState = '';
    const failureFetch = vi.fn(async () => {
      latestState = (await startFeishuOAuthAttempt(authConfig())).state;
      throw new Error('old exchange failed');
    });
    await handleFeishuOAuthCallbackNavigation(
      { url: `${getFeishuOAuthDefaults().redirectUri}?code=second&state=${second}`, tabId: 4 },
      { fetchImpl: failureFetch as any },
    );
    expect(chromeMock.__store[PENDING_KEY]).toBe(latestState);
    expect(chromeMock.__store[ERROR_KEY]).toBe('');
  });

  it('startup defaults mutate through the owner and invalidate an older pending attempt', async () => {
    chromeMock.__store[PENDING_KEY] = 'old-client-id-attempt';
    (globalThis as any).__SYNCNOS_FEISHU_OAUTH_CLIENT_ID__ = 'default-app-id';
    (globalThis as any).__SYNCNOS_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL__ =
      'https://default-worker.example.com/exchange';

    try {
      vi.resetModules();
      const reloaded = await import('@services/sync/feishu/auth/oauth');
      await reloaded.ensureDefaultFeishuOAuthClientId();
      expect(chromeMock.__store[CLIENT_ID_KEY]).toBe('default-app-id');
      expect(chromeMock.__store[PENDING_KEY]).toBeUndefined();

      chromeMock.__store[PENDING_KEY] = 'old-proxy-attempt';
      await reloaded.ensureDefaultFeishuOAuthProxyUrl();
      expect(chromeMock.__store[PROXY_KEY]).toBe('https://default-worker.example.com/exchange');
      expect(chromeMock.__store[PENDING_KEY]).toBeUndefined();
    } finally {
      delete (globalThis as any).__SYNCNOS_FEISHU_OAUTH_CLIENT_ID__;
      delete (globalThis as any).__SYNCNOS_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL__;
    }
  });

  it('disconnect cleanup removes only token and attempt state while preserving auth config and folder settings', async () => {
    Object.assign(chromeMock.__store, {
      [TOKEN_KEY]: token('connected'),
      [CLIENT_ID_KEY]: 'app-id',
      [CLIENT_SECRET_KEY]: 'app-secret',
      [PROXY_KEY]: 'https://worker.example.com/exchange',
      [PENDING_KEY]: 'pending',
      [ERROR_KEY]: 'error',
      feishu_chat_folder: 'AIChats',
      feishu_article_folder: 'WebArticles',
      feishu_video_folder: 'Videos',
    });

    const cleared = await clearFeishuOAuthAttemptAndToken();

    expect(cleared).toEqual([TOKEN_KEY, PENDING_KEY, ERROR_KEY]);
    expect(chromeMock.__store[TOKEN_KEY]).toBeUndefined();
    expect(chromeMock.__store[PENDING_KEY]).toBeUndefined();
    expect(chromeMock.__store[ERROR_KEY]).toBeUndefined();
    expect(chromeMock.__store).toMatchObject({
      [CLIENT_ID_KEY]: 'app-id',
      [CLIENT_SECRET_KEY]: 'app-secret',
      [PROXY_KEY]: 'https://worker.example.com/exchange',
      feishu_chat_folder: 'AIChats',
      feishu_article_folder: 'WebArticles',
      feishu_video_folder: 'Videos',
    });
  });

  it('rolls back only its own pending state when tab creation fails and the queue remains usable', async () => {
    chromeMock.failNextTabCreate();
    await expect(startFeishuOAuthAttempt(authConfig())).rejects.toThrow('tabs create failed');
    expect(chromeMock.__store[PENDING_KEY]).toBeUndefined();

    const saved = await saveFeishuOAuthConfig(authConfig({ clientId: 'after-failure' }));
    expect(saved.clientId).toBe('after-failure');
    const next = await startFeishuOAuthAttempt(authConfig({ clientId: 'after-failure' }));
    expect(chromeMock.__store[PENDING_KEY]).toBe(next.state);
  });
});

describe('Feishu token refresh owner', () => {
  it('skips old refresh HTTP when the durable token was already replaced or disconnected', async () => {
    const expected = token('old');
    const current = token('new');
    chromeMock.__store[TOKEN_KEY] = current;
    chromeMock.__store[CLIENT_ID_KEY] = 'app-id';
    chromeMock.__store[CLIENT_SECRET_KEY] = 'app-secret';
    const fetchImpl = vi.fn();

    await expect(refreshFeishuOAuthToken(expected, { fetchImpl: fetchImpl as any })).resolves.toEqual(current);
    expect(fetchImpl).not.toHaveBeenCalled();

    delete chromeMock.__store[TOKEN_KEY];
    await expect(refreshFeishuOAuthToken(expected, { fetchImpl: fetchImpl as any })).rejects.toThrow(
      'Feishu is not connected',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not resurrect a token when Disconnect wins during an in-flight refresh', async () => {
    const expected = token('old');
    chromeMock.__store[TOKEN_KEY] = expected;
    chromeMock.__store[CLIENT_ID_KEY] = 'app-id';
    chromeMock.__store[CLIENT_SECRET_KEY] = 'app-secret';
    const network = deferred<any>();
    const fetchImpl = vi.fn(() => network.promise);

    const refresh = refreshFeishuOAuthToken(expected, { fetchImpl: fetchImpl as any, now: () => 1000 });
    await waitFor(() => fetchImpl.mock.calls.length === 1);
    await clearFeishuOAuthAttemptAndToken();
    network.resolve(jsonResponse({ access_token: 'stale-refreshed', refresh_token: 'stale-refresh', expires_in: 60 }));

    await expect(refresh).rejects.toThrow('Feishu is not connected');
    expect(chromeMock.__store[TOKEN_KEY]).toBeUndefined();
  });

  it('returns a newer durable token instead of overwriting it after an old refresh finishes', async () => {
    const expected = token('old');
    const newer = token('newer');
    chromeMock.__store[TOKEN_KEY] = expected;
    chromeMock.__store[CLIENT_ID_KEY] = 'app-id';
    chromeMock.__store[CLIENT_SECRET_KEY] = 'app-secret';
    const network = deferred<any>();
    const fetchImpl = vi.fn(() => network.promise);

    const refresh = refreshFeishuOAuthToken(expected, { fetchImpl: fetchImpl as any, now: () => 1000 });
    await waitFor(() => fetchImpl.mock.calls.length === 1);
    chromeMock.__store[TOKEN_KEY] = newer;
    network.resolve(jsonResponse({ access_token: 'old-result', refresh_token: 'old-result-refresh', expires_in: 60 }));

    await expect(refresh).resolves.toEqual(newer);
    expect(chromeMock.__store[TOKEN_KEY]).toEqual(newer);
  });

  it('rejects an in-flight result after auth config changes, then refreshes with the new config', async () => {
    const expected = token('old');
    chromeMock.__store[TOKEN_KEY] = expected;
    chromeMock.__store[CLIENT_ID_KEY] = 'app-id';
    chromeMock.__store[CLIENT_SECRET_KEY] = 'app-secret';
    chromeMock.__store[PROXY_KEY] = '';
    const firstNetwork = deferred<any>();
    const firstFetch = vi.fn(() => firstNetwork.promise);

    const firstRefresh = refreshFeishuOAuthToken(expected, { fetchImpl: firstFetch as any, now: () => 1000 });
    await waitFor(() => firstFetch.mock.calls.length === 1);
    await saveFeishuOAuthConfig(authConfig({ clientId: 'new-app', clientSecret: 'new-secret' }));
    firstNetwork.resolve(
      jsonResponse({ access_token: 'stale-result', refresh_token: 'stale-refresh', expires_in: 60 }),
    );

    await expect(firstRefresh).rejects.toThrow('feishu_oauth_refresh_stale_config');
    expect(chromeMock.__store[TOKEN_KEY]).toEqual(expected);

    const secondFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body).toMatchObject({
        client_id: 'new-app',
        client_secret: 'new-secret',
        refresh_token: expected.refreshToken,
      });
      return jsonResponse({ access_token: 'fresh-result', refresh_token: 'fresh-refresh', expires_in: 120 });
    });
    const refreshed = await refreshFeishuOAuthToken(expected, { fetchImpl: secondFetch as any, now: () => 2000 });
    expect(refreshed).toMatchObject({ accessToken: 'fresh-result', refreshToken: 'fresh-refresh', expiresAt: 122000 });
    expect(chromeMock.__store[TOKEN_KEY]).toEqual(refreshed);
  });

  it('commits a normal current-token refresh', async () => {
    const expected = token('old');
    chromeMock.__store[TOKEN_KEY] = expected;
    chromeMock.__store[CLIENT_ID_KEY] = 'app-id';
    chromeMock.__store[CLIENT_SECRET_KEY] = 'app-secret';
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 30 }),
    );

    const refreshed = await refreshFeishuOAuthToken(expected, { fetchImpl: fetchImpl as any, now: () => 5000 });
    expect(refreshed).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: 35000,
      createdAt: 5000,
    });
    expect(chromeMock.__store[TOKEN_KEY]).toEqual(refreshed);
  });
});
