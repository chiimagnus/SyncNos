import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsQuery: vi.fn(),
  tabsSendMessage: vi.fn(),
}));

vi.mock('../../src/platform/webext/scripting', () => ({
  scriptingExecuteScript: vi.fn(),
}));

import { UI_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';
import { scriptingExecuteScript } from '../../src/platform/webext/scripting';
import { tabsQuery, tabsSendMessage } from '../../src/platform/webext/tabs';
import { registerUiMessageHandlers } from '../../src/platform/messaging/ui-background-handlers';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createRouter() {
  const handlers = new Map<string, (msg?: any, sender?: any) => Promise<any> | any>();
  return {
    handlers,
    router: {
      ok: (data: unknown) => ({ ok: true, data, error: null }),
      err: (message: string, extra?: unknown) => ({ ok: false, data: null, error: { message, extra: extra ?? null } }),
      register: vi.fn((type: string, handler: (msg?: any, sender?: any) => Promise<any> | any) => {
        handlers.set(type, handler);
      }),
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('UI background handler locale readiness', () => {
  it('registers every UI message synchronously and relays HTTP state without touching locale readiness', async () => {
    const locale = deferred<void>();
    const ensureLocaleReady = vi.fn(() => locale.promise);
    const { router, handlers } = createRouter();
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 7, url: 'https://example.com/' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: { readiness: 'ready' }, error: null } as any);

    registerUiMessageHandlers(router, { ensureLocaleReady });

    expect([...handlers.keys()].sort()).toEqual(Object.values(UI_MESSAGE_TYPES).sort());

    await expect(handlers.get(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE)?.()).resolves.toEqual({
      ok: true,
      data: { readiness: 'ready' },
      error: null,
    });
    expect(tabsQuery).toHaveBeenCalledTimes(1);
    expect(tabsSendMessage).toHaveBeenCalledTimes(1);
    expect(ensureLocaleReady).not.toHaveBeenCalled();
  });

  it('reinjects the current content bundle once when an updated extension has no receiver', async () => {
    const locale = deferred<void>();
    const ensureLocaleReady = vi.fn(() => locale.promise);
    const { router, handlers } = createRouter();
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 7, url: 'https://chatgpt.com/c/example' }] as any);
    vi.mocked(tabsSendMessage)
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ ok: true, data: { readiness: 'ready', kind: 'chat' }, error: null } as any);
    vi.mocked(scriptingExecuteScript).mockResolvedValue([]);

    registerUiMessageHandlers(router, { ensureLocaleReady });

    await expect(handlers.get(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE)?.()).resolves.toEqual({
      ok: true,
      data: { readiness: 'ready', kind: 'chat' },
      error: null,
    });
    expect(scriptingExecuteScript).toHaveBeenCalledTimes(1);
    expect(scriptingExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['content-scripts/content.js'],
    });
    expect(tabsSendMessage).toHaveBeenCalledTimes(2);
    expect(ensureLocaleReady).not.toHaveBeenCalled();
  });

  it('uses the same reinjection recovery for the in-page comments command', async () => {
    const ensureLocaleReady = vi.fn(async () => undefined);
    const { router, handlers } = createRouter();
    vi.mocked(tabsSendMessage)
      .mockRejectedValueOnce(new Error('No matching message handler'))
      .mockResolvedValueOnce({ ok: true });
    vi.mocked(scriptingExecuteScript).mockResolvedValue([]);

    registerUiMessageHandlers(router, { ensureLocaleReady });

    await expect(
      handlers.get(UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL)?.({ tabId: 9 }, null),
    ).resolves.toEqual({ ok: true, data: { opened: true }, error: null });
    expect(scriptingExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 9 },
      files: ['content-scripts/content.js'],
    });
    expect(tabsSendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not reinject for ordinary content-owned or transport failures', async () => {
    const ensureLocaleReady = vi.fn(async () => undefined);
    const { router, handlers } = createRouter();
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 7, url: 'https://example.com/' }] as any);
    vi.mocked(tabsSendMessage).mockRejectedValue(new Error('message port closed unexpectedly'));

    registerUiMessageHandlers(router, { ensureLocaleReady });

    await expect(handlers.get(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE)?.()).resolves.toMatchObject({
      ok: false,
      error: { extra: { code: 'CAPTURE_UNAVAILABLE' } },
    });
    expect(scriptingExecuteScript).not.toHaveBeenCalled();
  });

  it('passes through a content-owned capture error without loading background locale', async () => {
    const locale = deferred<void>();
    const ensureLocaleReady = vi.fn(() => locale.promise);
    const { router, handlers } = createRouter();
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 7, url: 'https://example.com/' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({
      ok: false,
      data: null,
      error: { message: 'content capture failed', extra: null },
    } as any);

    registerUiMessageHandlers(router, { ensureLocaleReady });

    await expect(handlers.get(UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE)?.()).resolves.toEqual({
      ok: false,
      data: null,
      error: { message: 'content capture failed', extra: { code: 'CAPTURE_FAILED' } },
    });
    expect(ensureLocaleReady).not.toHaveBeenCalled();
  });

  it('waits for locale only when background must synthesize a local fallback', async () => {
    const locale = deferred<void>();
    const ensureLocaleReady = vi.fn(() => locale.promise);
    const { router, handlers } = createRouter();
    vi.mocked(tabsQuery).mockResolvedValue([] as any);

    registerUiMessageHandlers(router, { ensureLocaleReady });
    const responsePromise = handlers.get(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE)?.();
    let settled = false;
    void responsePromise?.then(() => {
      settled = true;
    });

    await flushMicrotasks();
    expect(ensureLocaleReady).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(tabsSendMessage).not.toHaveBeenCalled();

    locale.resolve();
    const response = await responsePromise;
    expect(response).toMatchObject({
      ok: true,
      data: { readiness: 'unsupported', kind: 'unsupported' },
      error: null,
    });
  });

  it('continues a local fallback when locale initialization rejects', async () => {
    const ensureLocaleReady = vi.fn(async () => {
      throw new Error('locale failed');
    });
    const { router, handlers } = createRouter();
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 7, url: 'chrome://extensions/' }] as any);

    registerUiMessageHandlers(router, { ensureLocaleReady });

    await expect(handlers.get(UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE)?.()).resolves.toMatchObject({
      ok: false,
      data: null,
      error: { extra: { code: 'CAPTURE_UNAVAILABLE' } },
    });
    expect(ensureLocaleReady).toHaveBeenCalledTimes(1);
  });

  it('does not gate popup or comments handlers on locale readiness', async () => {
    const locale = deferred<void>();
    const ensureLocaleReady = vi.fn(() => locale.promise);
    const { router, handlers } = createRouter();
    const openPopup = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error test global
    globalThis.chrome = { action: { openPopup } };
    vi.mocked(tabsSendMessage).mockResolvedValue(null as any);

    registerUiMessageHandlers(router, { ensureLocaleReady });

    await expect(handlers.get(UI_MESSAGE_TYPES.OPEN_EXTENSION_POPUP)?.()).resolves.toEqual({
      ok: true,
      data: { opened: true },
      error: null,
    });
    await expect(
      handlers.get(UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL)?.({ tabId: 7 }, null),
    ).resolves.toEqual({ ok: true, data: { opened: true }, error: null });

    expect(openPopup).toHaveBeenCalledTimes(1);
    expect(tabsSendMessage).toHaveBeenCalledTimes(1);
    expect(ensureLocaleReady).not.toHaveBeenCalled();
  });
});
