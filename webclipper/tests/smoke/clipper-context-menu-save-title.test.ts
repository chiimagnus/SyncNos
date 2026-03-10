import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsQuery: vi.fn(),
  tabsSendMessage: vi.fn(),
}));

import { tabsSendMessage } from '../../src/platform/webext/tabs';
import { registerClipperContextMenu, unregisterClipperContextMenu } from '../../src/platform/context-menus/clipper-context-menu';

function createMenusApi() {
  const onShownListeners: Array<(info: any, tab: any) => void> = [];

  const api = {
    create: vi.fn(),
    update: vi.fn(),
    removeAll: vi.fn((cb: any) => cb?.()),
    refresh: vi.fn(),
    onClicked: { addListener: vi.fn() },
    onShown: {
      addListener: vi.fn((cb: any) => {
        onShownListeners.push(cb);
      }),
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

    registerClipperContextMenu();
    menusApi.__emitShown({ id: 7, url: 'https://chatgpt.com/c/123' });

    await new Promise((r) => setTimeout(r, 0));

    expect(menusApi.update).toHaveBeenCalledWith('syncnos_clipper_save_current_page', { title: 'Save current AI chat' });
  });
});

