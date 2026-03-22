import { describe, expect, it } from 'vitest';

import {
  ensureDefaultNotionOAuthClientId,
  getNotionOAuthDefaults,
  handleNotionOAuthCallbackNavigation,
  setupNotionOAuthNavigationListener,
} from '@services/sync/notion/auth/oauth';

function mockChromeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const removed: string[][] = [];
  const setPayloads: Record<string, unknown>[] = [];

  return {
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
          }
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          setPayloads.push({ ...(payload || {}) });
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        },
        remove(keys: string[], cb: () => void) {
          const arr = Array.isArray(keys) ? keys : [];
          removed.push(arr.slice());
          for (const k of arr) delete store[k];
          cb();
        },
      },
    },
    tabs: {
      remove(tabId: number, cb: () => void) {
        store.__tabsRemoved = Array.isArray(store.__tabsRemoved) ? store.__tabsRemoved : [];
        (store.__tabsRemoved as any[]).push(tabId);
        cb();
      },
    },
    __store: store,
    __removed: removed,
    __setPayloads: setPayloads,
  };
}

function mockFetchJsonOk(json: unknown) {
  return async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(json),
    }) as any;
}

describe('notion oauth (ts)', () => {
  it('setupNotionOAuthNavigationListener registers webNavigation listener (chrome)', async () => {
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const chromeMock: any = mockChromeStorage();
    chromeMock.webNavigation = {
      onCommitted: {
        addListener(cb: any) {
          chromeMock.__webNavCb = cb;
        },
      },
    };
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    setupNotionOAuthNavigationListener();
    expect(typeof chromeMock.__webNavCb).toBe('function');
  });

  it('ensureDefaultNotionOAuthClientId sets default id and removes secret', async () => {
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const chromeMock = mockChromeStorage({
      notion_oauth_client_secret: 'should_be_removed',
    });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    await ensureDefaultNotionOAuthClientId();

    expect(String(chromeMock.__store.notion_oauth_client_id || '')).toMatch(/[0-9a-f-]{36}/i);
    expect(Object.prototype.hasOwnProperty.call(chromeMock.__store, 'notion_oauth_client_secret')).toBe(false);
  });

  it('handleNotionOAuthCallbackNavigation ignores non-callback urls', async () => {
    // @ts-expect-error test global
    globalThis.browser = undefined;
    const chromeMock = mockChromeStorage({ notion_oauth_pending_state: 's1' });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const handled = await handleNotionOAuthCallbackNavigation({
      url: 'https://example.com/?code=c&state=s1',
      tabId: 1,
    });

    expect(handled).toBe(false);
    expect(chromeMock.__store.notion_oauth_token_v1).toBeUndefined();
  });

  it('handleNotionOAuthCallbackNavigation persists error param', async () => {
    // @ts-expect-error test global
    globalThis.browser = undefined;
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const { redirectUri } = getNotionOAuthDefaults();
    const handled = await handleNotionOAuthCallbackNavigation({
      url: `${redirectUri}?error=access_denied`,
      tabId: 1,
    });

    expect(handled).toBe(true);
    expect(String(chromeMock.__store.notion_oauth_last_error || '')).toBe('access_denied');
  });

  it('handleNotionOAuthCallbackNavigation ignores when pending state mismatches', async () => {
    // @ts-expect-error test global
    globalThis.browser = undefined;
    const chromeMock = mockChromeStorage({ notion_oauth_pending_state: 's2' });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const { redirectUri } = getNotionOAuthDefaults();
    const handled = await handleNotionOAuthCallbackNavigation(
      { url: `${redirectUri}?code=c&state=s1`, tabId: 7 },
      { fetchImpl: mockFetchJsonOk({ access_token: 't' }) as any, now: () => 123 },
    );

    expect(handled).toBe(false);
    expect(chromeMock.__store.notion_oauth_token_v1).toBeUndefined();
    expect(chromeMock.__store.__tabsRemoved).toBeUndefined();
  });

  it('handleNotionOAuthCallbackNavigation stores token, clears pending state, clears last error, closes tab', async () => {
    // @ts-expect-error test global
    globalThis.browser = undefined;
    const chromeMock = mockChromeStorage({ notion_oauth_pending_state: 's1' });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const { redirectUri } = getNotionOAuthDefaults();
    const handled = await handleNotionOAuthCallbackNavigation(
      { url: `${redirectUri}?code=c&state=s1`, tabId: 7 },
      {
        fetchImpl: mockFetchJsonOk({ access_token: 't', workspace: { id: 'w1', name: 'W' } }) as any,
        now: () => 456,
      },
    );

    expect(handled).toBe(true);
    expect(chromeMock.__store.notion_oauth_pending_state).toBeUndefined();
    expect(String(chromeMock.__store.notion_oauth_last_error || '')).toBe('');
    expect(chromeMock.__store.__tabsRemoved).toEqual([7]);

    const token = chromeMock.__store.notion_oauth_token_v1 as any;
    expect(token).toBeTruthy();
    expect(token.accessToken).toBe('t');
    expect(token.workspaceId).toBe('w1');
    expect(token.workspaceName).toBe('W');
    expect(token.createdAt).toBe(456);
  });
});
