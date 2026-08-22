import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsQuery: vi.fn(),
  tabsSendMessage: vi.fn(),
}));

import { UI_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';
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
  it('registers every UI message synchronously while current-page work waits for locale', async () => {
    const locale = deferred<void>();
    const { router, handlers } = createRouter();
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 7, url: 'https://example.com/' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: { available: true }, error: null } as any);

    registerUiMessageHandlers(router, { localeReady: locale.promise });

    expect([...handlers.keys()].sort()).toEqual(Object.values(UI_MESSAGE_TYPES).sort());

    const responsePromise = handlers.get(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE)?.();
    await flushMicrotasks();
    expect(tabsQuery).not.toHaveBeenCalled();
    expect(tabsSendMessage).not.toHaveBeenCalled();

    locale.resolve();
    await expect(responsePromise).resolves.toEqual({ ok: true, data: { available: true }, error: null });
    expect(tabsQuery).toHaveBeenCalledTimes(1);
    expect(tabsSendMessage).toHaveBeenCalledTimes(1);
  });

  it('continues current-page handling after locale readiness rejects', async () => {
    const locale = deferred<void>();
    const { router, handlers } = createRouter();
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 7, url: 'https://example.com/' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: { captured: true }, error: null } as any);

    registerUiMessageHandlers(router, { localeReady: locale.promise });
    const responsePromise = handlers.get(UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE)?.();

    locale.reject(new Error('locale failed'));
    await expect(responsePromise).resolves.toEqual({ ok: true, data: { captured: true }, error: null });
    expect(tabsQuery).toHaveBeenCalledTimes(1);
    expect(tabsSendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not gate popup or comments handlers on locale readiness', async () => {
    const locale = deferred<void>();
    const { router, handlers } = createRouter();
    const openPopup = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error test global
    globalThis.chrome = { action: { openPopup } };
    vi.mocked(tabsSendMessage).mockResolvedValue(null as any);

    registerUiMessageHandlers(router, { localeReady: locale.promise });

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
  });
});
