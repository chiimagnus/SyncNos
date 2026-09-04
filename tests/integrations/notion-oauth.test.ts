import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getNotionOAuthDefaults,
  handleNotionOAuthCallbackNavigation,
  setupNotionOAuthNavigationListener,
  startNotionOAuthAttempt,
} from '@services/sync/notion/auth/oauth';

function mockChromeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const removed: string[][] = [];
  const setPayloads: Record<string, unknown>[] = [];
  const createdTabs: any[] = [];
  const chromeMock: any = {
    runtime: {},
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const key of keys) out[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          setPayloads.push({ ...(payload || {}) });
          if (chromeMock.__failNextSet) {
            chromeMock.__failNextSet = false;
            chromeMock.runtime.lastError = { message: 'storage.set failed for test' };
            cb();
            delete chromeMock.runtime.lastError;
            return;
          }
          for (const [key, value] of Object.entries(payload || {})) store[key] = value;
          cb();
        },
        remove(keys: string[], cb: () => void) {
          const list = Array.isArray(keys) ? keys : [];
          removed.push(list.slice());
          if (chromeMock.__failNextRemove) {
            chromeMock.__failNextRemove = false;
            chromeMock.runtime.lastError = { message: 'storage.remove failed for test' };
            cb();
            delete chromeMock.runtime.lastError;
            return;
          }
          for (const key of list) delete store[key];
          cb();
        },
      },
    },
    tabs: {
      create(properties: any, cb: (tab: any) => void) {
        createdTabs.push({ ...properties });
        if (chromeMock.__failNextTabCreate) {
          chromeMock.__failNextTabCreate = false;
          chromeMock.runtime.lastError = { message: 'tabs.create failed for test' };
          cb(null);
          delete chromeMock.runtime.lastError;
          return;
        }
        cb({ id: createdTabs.length, ...properties });
      },
      remove(tabId: number, cb: () => void) {
        store.__tabsRemoved = Array.isArray(store.__tabsRemoved) ? store.__tabsRemoved : [];
        (store.__tabsRemoved as any[]).push(tabId);
        cb();
      },
    },
    __store: store,
    __removed: removed,
    __setPayloads: setPayloads,
    __createdTabs: createdTabs,
    __failNextTabCreate: false,
    __failNextSet: false,
    __failNextRemove: false,
  };
  return chromeMock;
}

function mockFetchJsonOk(json: unknown) {
  return async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(json),
    }) as any;
}

function mockFetchTextError(status: number, text: string) {
  return async () =>
    ({
      ok: false,
      status,
      text: async () => text,
    }) as any;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function installChrome(initial: Record<string, unknown> = {}) {
  // @ts-expect-error test global
  globalThis.browser = undefined;
  const chromeMock = mockChromeStorage(initial);
  // @ts-expect-error test global
  globalThis.chrome = chromeMock;
  return chromeMock;
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notion oauth (ts)', () => {
  it('setupNotionOAuthNavigationListener registers webNavigation listener (chrome)', () => {
    const chromeMock = installChrome();
    chromeMock.webNavigation = {
      onCommitted: {
        addListener(cb: any) {
          chromeMock.__webNavCb = cb;
        },
      },
    };

    setupNotionOAuthNavigationListener();
    expect(typeof chromeMock.__webNavCb).toBe('function');
  });

  it('startNotionOAuthAttempt uses secure state and the canonical fixed client id', async () => {
    const chromeMock = installChrome({ notion_oauth_client_id: 'legacy-ignored' });
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used for OAuth state');
    });

    const started = await startNotionOAuthAttempt();

    expect(started.state).toMatch(/^[0-9a-f]{32}$/);
    expect(chromeMock.__store.notion_oauth_pending_state).toBe(started.state);
    expect(chromeMock.__store.notion_oauth_last_error).toBe('');
    expect(chromeMock.__createdTabs).toHaveLength(1);
    const opened = new URL(chromeMock.__createdTabs[0].url);
    expect(opened.origin + opened.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(opened.searchParams.get('client_id')).toBe('2a8d872b-594c-8060-9a2b-00377c27ec32');
    expect(opened.searchParams.get('client_id')).not.toBe('legacy-ignored');
    expect(opened.searchParams.get('state')).toBe(started.state);
    randomSpy.mockRestore();
  });

  it('START fails closed without Web Crypto and does not create durable pending state or a tab', async () => {
    const chromeMock = installChrome();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      await expect(startNotionOAuthAttempt()).rejects.toThrow('oauth_secure_random_unavailable');
      expect(chromeMock.__store.notion_oauth_pending_state).toBeUndefined();
      expect(chromeMock.__createdTabs).toHaveLength(0);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
      else delete (globalThis as any).crypto;
    }
  });

  it('tab creation failure conditionally rolls back its pending state and does not poison the owner queue', async () => {
    const chromeMock = installChrome();
    chromeMock.__failNextTabCreate = true;

    await expect(startNotionOAuthAttempt()).rejects.toThrow('tabs.create failed for test');
    expect(chromeMock.__store.notion_oauth_pending_state).toBeUndefined();

    const second = await startNotionOAuthAttempt();
    expect(chromeMock.__store.notion_oauth_pending_state).toBe(second.state);
    expect(chromeMock.__createdTabs).toHaveLength(2);
  });

  it('ignores invalid or lookalike callback urls', async () => {
    const chromeMock = installChrome({ notion_oauth_pending_state: 's1' });
    const urls = [
      'not a url',
      'https://chiimagnus.github.io.evil.example/syncnos-oauth/callback?code=c&state=s1',
      'https://chiimagnus.github.io/syncnos-oauth/callback-extra?code=c&state=s1',
      'https://chiimagnus.github.io/syncnos-oauth/callback/child?code=c&state=s1',
    ];

    for (const url of urls) {
      expect(await handleNotionOAuthCallbackNavigation({ url, tabId: 1 })).toBe(false);
    }
    expect(chromeMock.__store.notion_oauth_pending_state).toBe('s1');
    expect(chromeMock.__store.notion_oauth_token_v1).toBeUndefined();
  });

  it('requires current state before applying an OAuth error', async () => {
    const chromeMock = installChrome({ notion_oauth_pending_state: 's1', notion_oauth_last_error: '' });
    const { redirectUri } = getNotionOAuthDefaults();

    expect(await handleNotionOAuthCallbackNavigation({ url: `${redirectUri}?error=access_denied`, tabId: 1 })).toBe(
      false,
    );
    expect(
      await handleNotionOAuthCallbackNavigation({
        url: `${redirectUri}?error=access_denied&state=stale`,
        tabId: 1,
      }),
    ).toBe(false);
    expect(chromeMock.__store.notion_oauth_pending_state).toBe('s1');
    expect(chromeMock.__store.notion_oauth_last_error).toBe('');

    expect(
      await handleNotionOAuthCallbackNavigation({
        url: `${redirectUri}?error=access_denied&state=s1`,
        tabId: 1,
      }),
    ).toBe(true);
    expect(chromeMock.__store.notion_oauth_pending_state).toBe('');
    expect(chromeMock.__store.notion_oauth_last_error).toBe('access_denied');
  });

  it('ignores a code callback when the pending state mismatches', async () => {
    const chromeMock = installChrome({ notion_oauth_pending_state: 's2' });
    const { redirectUri } = getNotionOAuthDefaults();
    const fetchImpl = vi.fn(mockFetchJsonOk({ access_token: 't' })) as any;

    const handled = await handleNotionOAuthCallbackNavigation(
      { url: `${redirectUri}?code=c&state=s1`, tabId: 7 },
      { fetchImpl, now: () => 123 },
    );

    expect(handled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(chromeMock.__store.notion_oauth_token_v1).toBeUndefined();
    expect(chromeMock.__store.__tabsRemoved).toBeUndefined();
  });

  it('does not let an old in-flight success overwrite a newer START attempt', async () => {
    const chromeMock = installChrome({ notion_oauth_pending_state: 's1', notion_oauth_last_error: '' });
    const { redirectUri } = getNotionOAuthDefaults();
    const response = deferred<any>();
    const fetchImpl = vi.fn(() => response.promise) as any;

    const oldCallback = handleNotionOAuthCallbackNavigation(
      { url: `${redirectUri}?code=old&state=s1`, tabId: 7 },
      { fetchImpl, now: () => 123 },
    );
    await flushMicrotasks();
    const newer = await startNotionOAuthAttempt();
    response.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'old-token' }) });
    expect(await oldCallback).toBe(true);

    expect(chromeMock.__store.notion_oauth_pending_state).toBe(newer.state);
    expect(chromeMock.__store.notion_oauth_token_v1).toBeUndefined();
    expect(chromeMock.__store.notion_oauth_last_error).toBe('');
    expect(chromeMock.__store.__tabsRemoved).toBeUndefined();
  });

  it('does not let an old in-flight failure clear or error a newer START attempt', async () => {
    const chromeMock = installChrome({ notion_oauth_pending_state: 's1', notion_oauth_last_error: '' });
    const { redirectUri } = getNotionOAuthDefaults();
    const response = deferred<any>();
    const fetchImpl = vi.fn(() => response.promise) as any;

    const oldCallback = handleNotionOAuthCallbackNavigation(
      { url: `${redirectUri}?code=old&state=s1`, tabId: 8 },
      { fetchImpl, now: () => 456 },
    );
    await flushMicrotasks();
    const newer = await startNotionOAuthAttempt();
    response.resolve({ ok: false, status: 400, text: async () => 'old failure' });
    expect(await oldCallback).toBe(true);

    expect(chromeMock.__store.notion_oauth_pending_state).toBe(newer.state);
    expect(chromeMock.__store.notion_oauth_last_error).toBe('');
    expect(chromeMock.__store.notion_oauth_token_v1).toBeUndefined();
  });

  it('fails a terminal success atomically without leaving a token behind a still-current pending state', async () => {
    const chromeMock = installChrome({ notion_oauth_pending_state: 's1', notion_oauth_last_error: 'old' });
    const { redirectUri } = getNotionOAuthDefaults();
    chromeMock.__failNextSet = true;

    await expect(
      handleNotionOAuthCallbackNavigation(
        { url: `${redirectUri}?code=c&state=s1`, tabId: 7 },
        {
          fetchImpl: mockFetchJsonOk({ access_token: 't', workspace: { id: 'w1', name: 'W' } }) as any,
          now: () => 456,
        },
      ),
    ).rejects.toThrow('storage.set failed for test');

    expect(chromeMock.__store.notion_oauth_token_v1).toBeUndefined();
    expect(chromeMock.__store.notion_oauth_pending_state).toBe('s1');
    expect(chromeMock.__store.notion_oauth_last_error).toBe('old');
    expect(chromeMock.__store.__tabsRemoved).toBeUndefined();
  });

  it('stores a current token, clears pending/error, and closes the callback tab', async () => {
    const chromeMock = installChrome({ notion_oauth_pending_state: 's1', notion_oauth_last_error: 'old' });
    const { redirectUri } = getNotionOAuthDefaults();

    const handled = await handleNotionOAuthCallbackNavigation(
      { url: `${redirectUri}?code=c&state=s1`, tabId: 7 },
      {
        fetchImpl: mockFetchJsonOk({ access_token: 't', workspace: { id: 'w1', name: 'W' } }) as any,
        now: () => 456,
      },
    );

    expect(handled).toBe(true);
    expect(chromeMock.__store.notion_oauth_pending_state).toBe('');
    expect(chromeMock.__store.notion_oauth_last_error).toBe('');
    expect(chromeMock.__store.__tabsRemoved).toEqual([7]);
    expect(chromeMock.__store.notion_oauth_token_v1).toEqual({
      accessToken: 't',
      workspaceId: 'w1',
      workspaceName: 'W',
      createdAt: 456,
    });
  });

  it('records a current token-exchange failure and clears only that attempt', async () => {
    const chromeMock = installChrome({ notion_oauth_pending_state: 's1', notion_oauth_last_error: '' });
    const { redirectUri } = getNotionOAuthDefaults();

    const handled = await handleNotionOAuthCallbackNavigation(
      { url: `${redirectUri}?code=c&state=s1`, tabId: 8 },
      { fetchImpl: mockFetchTextError(500, 'worker failed') as any, now: () => 789 },
    );

    expect(handled).toBe(true);
    expect(chromeMock.__store.notion_oauth_pending_state).toBe('');
    expect(chromeMock.__store.notion_oauth_last_error).toContain('token exchange failed');
    expect(chromeMock.__store.notion_oauth_token_v1).toBeUndefined();
  });
});
