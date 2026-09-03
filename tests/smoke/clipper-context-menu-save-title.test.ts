import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsQuery: vi.fn(),
  tabsSendMessage: vi.fn(),
}));

import { tabsSendMessage } from '../../src/platform/webext/tabs';
import {
  registerClipperContextMenu,
  unregisterClipperContextMenu,
} from '../../src/platform/context-menus/clipper-context-menu';

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
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function createMenusApi() {
  const onClickedListeners: Array<(info: any, tab: any) => void> = [];
  const onShownListeners: Array<(info: any, tab: any) => void> = [];

  const api = {
    create: vi.fn(),
    update: vi.fn(),
    removeAll: vi.fn((cb: any) => cb?.()),
    refresh: vi.fn(),
    onClicked: {
      addListener: vi.fn((cb: any) => {
        onClickedListeners.push(cb);
      }),
    },
    onShown: {
      addListener: vi.fn((cb: any) => {
        onShownListeners.push(cb);
      }),
    },
    __emitClicked: (menuItemId: string) => {
      for (const cb of onClickedListeners) cb({ menuItemId }, null);
    },
    __emitShown: (tab: any) => {
      for (const cb of onShownListeners) cb({ menuIds: ['syncnos_clipper_root'] }, tab);
    },
  };
  return api;
}

afterEach(() => {
  vi.restoreAllMocks();
  unregisterClipperContextMenu();
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('clipper context menu save title', () => {
  it('switches to AI chat title when current page kind is chat', async () => {
    const menusApi = createMenusApi();

    // @ts-expect-error test global
    globalThis.chrome = {
      contextMenus: menusApi,
      storage: {
        local: {
          get: vi.fn((_keys: any, cb: any) => cb({})),
          set: vi.fn((_v: any, cb: any) => cb?.()),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    };

    vi.mocked(tabsSendMessage).mockResolvedValue({
      ok: true,
      data: { available: true, kind: 'chat', label: 'Fetch AI Chat', collectorId: 'chatgpt' },
      error: null,
    } as any);

    registerClipperContextMenu({
      ready: Promise.resolve(),
      readDisplayMode: async () => 'all',
      setDisplayMode: async (mode) => mode,
    });
    menusApi.__emitShown({ id: 7, url: 'https://chatgpt.com/c/123' });

    await flushMicrotasks();

    expect(menusApi.update).toHaveBeenCalledWith('syncnos_clipper_save_current_page', {
      title: 'Save current AI chat',
    });
  });

  it('registers listeners synchronously while localized menu work waits for locale readiness', async () => {
    const menusApi = createMenusApi();
    const locale = deferred<void>();
    const storageSet = vi.fn((_value: any, cb: any) => cb?.());
    const removeStorageListener = vi.fn();

    // @ts-expect-error test global
    globalThis.chrome = {
      contextMenus: menusApi,
      tabs: {
        query: vi.fn((_query: any, cb: any) => cb([{ id: 7, url: 'https://chatgpt.com/c/123' }])),
      },
      storage: {
        local: {
          get: vi.fn((_keys: any, cb: any) => cb({})),
          set: storageSet,
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: removeStorageListener,
        },
      },
    };

    registerClipperContextMenu({
      ready: locale.promise,
      readDisplayMode: async () => 'all',
      setDisplayMode: async (mode) => mode,
    });

    expect(menusApi.onClicked.addListener).toHaveBeenCalledTimes(1);
    expect(menusApi.onShown.addListener).toHaveBeenCalledTimes(1);
    expect(menusApi.create).not.toHaveBeenCalled();

    menusApi.__emitClicked('syncnos_clipper_mode_off');
    expect(storageSet).not.toHaveBeenCalledWith({ inpage_display_mode: 'off' }, expect.any(Function));

    menusApi.__emitShown({ id: 7, url: 'https://chatgpt.com/c/123' });
    await flushMicrotasks();
    expect(tabsSendMessage).not.toHaveBeenCalled();

    locale.resolve();
    await flushMicrotasks();

    expect(menusApi.create).toHaveBeenCalled();
    expect(tabsSendMessage).toHaveBeenCalled();
    expect(menusApi.refresh).toHaveBeenCalled();

    unregisterClipperContextMenu();
    expect(removeStorageListener).toHaveBeenCalledTimes(1);
  });

  it('falls back after locale readiness rejects instead of permanently blocking menus', async () => {
    const menusApi = createMenusApi();
    const locale = deferred<void>();

    // @ts-expect-error test global
    globalThis.chrome = {
      contextMenus: menusApi,
      storage: {
        local: {
          get: vi.fn((_keys: any, cb: any) => cb({})),
          set: vi.fn((_value: any, cb: any) => cb?.()),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    };

    registerClipperContextMenu({
      ready: locale.promise,
      readDisplayMode: async () => 'all',
      setDisplayMode: async (mode) => mode,
    });
    locale.reject(new Error('locale failed'));
    await flushMicrotasks();

    expect(menusApi.create).toHaveBeenCalled();
  });
});
