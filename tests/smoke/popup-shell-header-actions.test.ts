import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';

const sendMock = vi.fn();
const popupCaptureHookMock = vi.hoisted(() => vi.fn());
const ensureExtensionAppTabMock = vi.fn();
const openOrFocusExtensionAppTabMock = vi.fn();
const publishPopupSyncSelectionHandoffMock = vi.fn();
const storageGetMock = vi.fn();
const storageSetMock = vi.fn();
const storageOnChangedMock = vi.fn();

vi.mock('../../src/platform/runtime/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/platform/runtime/runtime')>();
  return {
    ...actual,
    getURL: (path: string) => path,
  };
});

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsCreate: vi.fn(),
}));

vi.mock('../../src/services/shared/runtime', () => ({
  send: (...args: any[]) => sendMock(...args),
}));

vi.mock('../../src/services/shared/webext', () => ({
  ensureExtensionAppTab: (...args: any[]) => ensureExtensionAppTabMock(...args),
  openOrFocusExtensionAppTab: (...args: any[]) => openOrFocusExtensionAppTabMock(...args),
}));

vi.mock('../../src/services/shared/storage', () => ({
  storageGet: (...args: any[]) => storageGetMock(...args),
  storageSet: (...args: any[]) => storageSetMock(...args),
  storageOnChanged: (...args: any[]) => storageOnChangedMock(...args),
}));

vi.mock('../../src/services/conversations/popup-sync-selection-handoff', () => ({
  publishPopupSyncSelectionHandoff: (...args: any[]) => publishPopupSyncSelectionHandoffMock(...args),
}));

vi.mock('../../src/ui/shared/AppTooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/shared/AppTooltip')>();
  return {
    ...actual,
    AppTooltipHost: () => null,
  };
});

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  ConversationsProvider: ({ children }: { children: ReactNode }) => children,
  useConversationsApp: () => ({
    items: [],
    activeId: null,
    selectedIds: [41, 42],
    toggleAll: vi.fn(),
    toggleSelected: vi.fn(),
    setActiveId: vi.fn(),
    clearSelected: vi.fn(),
    openConversationExternalByLoc: vi.fn(),
    openConversationExternalBySourceKey: vi.fn(),
    openConversationExternalById: vi.fn(),
    exporting: false,
    syncFeedback: {
      provider: null,
      phase: 'idle',
      total: 0,
      done: 0,
      failures: [],
      message: '',
      updatedAt: 0,
      summary: null,
    },
    deleting: false,
    listSourceFilterKey: 'all',
    listSiteFilterKey: 'all',
    setListSourceFilterKeyPersistent: vi.fn(),
    setListSiteFilterKeyPersistent: vi.fn(),
    pendingListLocateId: null,
    consumeListLocate: vi.fn(),
    exportSelectedMarkdown: vi.fn(),
    syncSelected: vi.fn(),
    clearSyncFeedback: vi.fn(),
    deleteSelected: vi.fn(),
    refreshList: vi.fn(),
    setDetailSurfaceActive: vi.fn(),
  }),
}));

vi.mock('../../src/viewmodels/popup/usePopupCurrentPageCapture', () => ({
  usePopupCurrentPageCapture: (...args: any[]) => popupCaptureHookMock(...args),
}));

vi.mock('../../src/ui/conversations/ConversationsScene', () => ({
  ConversationsScene: (props: {
    listShell?: { rightSlot: ReactNode };
    onPopupSyncPreparing?: (provider: 'notion' | 'obsidian' | 'feishu' | 'github') => void | Promise<void>;
  }) => {
    const [mode, setMode] = useState<'list' | 'detail' | 'detail-empty' | 'detail-menu'>('list');
    const toList = () => {
      setMode('list');
    };
    return createElement(
      'div',
      null,
      mode === 'list' ? createElement('div', { 'data-list-shell': '1' }, props.listShell?.rightSlot ?? null) : null,
      createElement(
        'button',
        {
          type: 'button',
          onClick: toList,
        },
        'show-list',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            setMode('detail');
          },
        },
        'show-detail',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            setMode('detail-empty');
          },
        },
        'show-detail-empty',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            setMode('detail-menu');
          },
        },
        'show-detail-menu',
      ),
      createElement(
        'button',
        { type: 'button', onClick: () => void Promise.resolve(props.onPopupSyncPreparing?.('github')).catch(() => {}) },
        'sync-github',
      ),
      createElement(
        'button',
        { type: 'button', onClick: () => void Promise.resolve(props.onPopupSyncPreparing?.('notion')).catch(() => {}) },
        'sync-notion',
      ),
      createElement(
        'button',
        { type: 'button', onClick: () => void Promise.resolve(props.onPopupSyncPreparing?.('feishu')).catch(() => {}) },
        'sync-feishu',
      ),
      mode === 'detail' ? createElement('button', { 'aria-label': 'Open in Notion' }, 'open-in-notion') : null,
      mode === 'detail-menu' ? createElement('button', { 'aria-label': 'Open destinations' }, 'open-menu') : null,
    );
  },
}));

import PopupShell from '../../src/ui/popup/PopupShell';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { sendMessage: () => {} } },
  });
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: dom.window.CustomEvent,
  });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
}

async function renderPopupShell(root: ReactDOM.Root) {
  await act(async () => {
    root.render(createElement(PopupShell));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

async function waitForPopupUi<T>(callback: () => T | Promise<T>): Promise<T> {
  return vi.waitFor(callback, { timeout: 3000, interval: 20 });
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

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).chrome;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).Event;
  delete (globalThis as any).CustomEvent;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('PopupShell header actions', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    sendMock.mockReset();
    popupCaptureHookMock.mockReset();
    popupCaptureHookMock.mockReturnValue({
      buttonDisabled: false,
      buttonLabel: 'Fetch AI Chat',
      capture: vi.fn(),
      captureState: { readiness: 'ready', kind: 'chat', label: 'Fetch AI Chat', collectorId: 'chatgpt' },
      checking: false,
      status: null,
    });
    ensureExtensionAppTabMock.mockReset();
    openOrFocusExtensionAppTabMock.mockReset();
    publishPopupSyncSelectionHandoffMock.mockReset();
    storageGetMock.mockReset();
    storageSetMock.mockReset();
    storageOnChangedMock.mockReset();
    ensureExtensionAppTabMock.mockResolvedValue({ id: 9, url: 'chrome-extension://syncnos/app.html#/' });
    publishPopupSyncSelectionHandoffMock.mockResolvedValue(undefined);
    storageGetMock.mockResolvedValue({});
    storageSetMock.mockResolvedValue(undefined);
    storageOnChangedMock.mockReturnValue(() => {});
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = null;
    cleanupDom();
  });

  it('shows fetch and settings in list mode, then swaps to Open in Notion in detail mode', async () => {
    await renderPopupShell(root!);

    expect(document.querySelector('[aria-label="Fetch AI Chat"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open Settings"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();

    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Fetch AI Chat"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Open Settings"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="More actions coming soon"]')).toBeFalsy();
  });

  it('keeps the popup detail header action area empty when no actions are available', async () => {
    await renderPopupShell(root!);

    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail-empty',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Fetch AI Chat"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Open Settings"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="More actions coming soon"]')).toBeFalsy();
  });

  it('shows a menu trigger in popup detail mode when multiple destinations exist', async () => {
    await renderPopupShell(root!);

    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail-menu',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Open destinations"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
  });

  it('keeps current-page capture status in the button without rendering a duplicate header banner', async () => {
    await renderPopupShell(root!);

    expect(document.querySelector('[aria-label="Fetch AI Chat"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('ChatGPT · Waiting for messages…');
  });

  it('publishes the selection and ensures a background App tab for popup syncs', async () => {
    await renderPopupShell(root!);

    const syncButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'sync-github',
    ) as HTMLButtonElement;
    await act(async () => {
      syncButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForPopupUi(() => {
      expect(publishPopupSyncSelectionHandoffMock).toHaveBeenCalledWith([41, 42]);
      expect(ensureExtensionAppTabMock).toHaveBeenCalledTimes(1);
    });
    expect(openOrFocusExtensionAppTabMock).not.toHaveBeenCalled();
  });

  it('does not ensure the App tab when the popup selection handoff cannot be published', async () => {
    publishPopupSyncSelectionHandoffMock.mockRejectedValueOnce(new Error('storage unavailable'));
    await renderPopupShell(root!);

    const syncButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'sync-github',
    ) as HTMLButtonElement;
    await act(async () => {
      syncButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForPopupUi(() => {
      expect(publishPopupSyncSelectionHandoffMock).toHaveBeenCalledWith([41, 42]);
    });
    expect(ensureExtensionAppTabMock).not.toHaveBeenCalled();
    expect(openOrFocusExtensionAppTabMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Notion', 'sync-notion', 'webclipper_popup_notion_sync_open_tab_dont_show_v1'],
    ['Feishu', 'sync-feishu', 'webclipper_popup_feishu_sync_open_tab_dont_show_v1'],
  ])(
    'keeps the %s sync nudge while background App-tab ensure does not foreground automatically',
    async (_name, label, key) => {
      act(() => {
        root!.render(createElement(PopupShell));
      });

      const syncButton = Array.from(document.querySelectorAll('button')).find(
        (el) => el.textContent === label,
      ) as HTMLButtonElement;
      await act(async () => {
        syncButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitForPopupUi(() => {
        expect(ensureExtensionAppTabMock).toHaveBeenCalledTimes(1);
        expect(storageGetMock).toHaveBeenCalledWith([key]);
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      });
      expect(openOrFocusExtensionAppTabMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Notion', 'sync-notion', 'webclipper_popup_notion_sync_open_tab_dont_show_v1'],
    ['Feishu', 'sync-feishu', 'webclipper_popup_feishu_sync_open_tab_dont_show_v1'],
  ])(
    'uses the %s dont-show key only to hide the nudge, not to foreground or skip App-tab ensure',
    async (_name, label, key) => {
      storageGetMock.mockImplementation(async (keys: string[]) => (keys.includes(key) ? { [key]: true } : {}));
      act(() => {
        root!.render(createElement(PopupShell));
      });

      const syncButton = Array.from(document.querySelectorAll('button')).find(
        (el) => el.textContent === label,
      ) as HTMLButtonElement;
      await act(async () => {
        syncButton.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitForPopupUi(() => {
        expect(ensureExtensionAppTabMock).toHaveBeenCalledTimes(1);
        expect(storageGetMock).toHaveBeenCalledWith([key]);
      });
      expect(document.querySelector('[role="dialog"]')).toBeFalsy();
      expect(openOrFocusExtensionAppTabMock).not.toHaveBeenCalled();
    },
  );

  it('foregrounds the App only when the user explicitly confirms the Notion nudge', async () => {
    (window as any).close = vi.fn();
    openOrFocusExtensionAppTabMock.mockResolvedValue({ id: 9 });
    await renderPopupShell(root!);

    const syncButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'sync-notion',
    ) as HTMLButtonElement;
    await act(async () => {
      syncButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForPopupUi(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const buttons = Array.from(dialog.querySelectorAll('button'));
    act(() => buttons.at(-1)!.click());

    await waitForPopupUi(() => {
      expect(openOrFocusExtensionAppTabMock).toHaveBeenCalledWith({ route: '/' });
      expect((window as any).close).toHaveBeenCalledTimes(1);
    });
  });

  it('persists the Feishu dont-show choice on dismiss without foregrounding the App', async () => {
    await renderPopupShell(root!);

    const syncButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'sync-feishu',
    ) as HTMLButtonElement;
    await act(async () => {
      syncButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForPopupUi(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const checkbox = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => checkbox.click());
    const buttons = Array.from(dialog.querySelectorAll('button'));
    act(() => buttons[0]!.click());

    await waitForPopupUi(() => {
      expect(storageSetMock).toHaveBeenCalledWith({ webclipper_popup_feishu_sync_open_tab_dont_show_v1: true });
      expect(document.querySelector('[role="dialog"]')).toBeFalsy();
    });
    expect(openOrFocusExtensionAppTabMock).not.toHaveBeenCalled();
  });

  it('opens the inpage comments sidebar from the popup comments button without a second state query', async () => {
    const { UI_MESSAGE_TYPES } = await import('../../src/services/protocols/message-contracts');
    popupCaptureHookMock.mockReturnValue({
      buttonDisabled: false,
      buttonLabel: 'Fetch Article',
      capture: vi.fn(),
      captureState: { readiness: 'ready', kind: 'article', label: 'Fetch Article', collectorId: 'web' },
      checking: false,
      status: null,
    });

    sendMock.mockImplementation(async (type: string) => {
      if (type === UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL) {
        return {
          ok: true,
          data: { opened: true },
          error: null,
        };
      }
      throw new Error(`unexpected message: ${type}`);
    });

    (window as any).close = vi.fn();

    await renderPopupShell(root!);

    expect(sendMock).not.toHaveBeenCalledWith(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, {});

    const commentsBtn = document.querySelector(
      '[aria-label="Open in-page comments sidebar"]',
    ) as HTMLButtonElement | null;
    expect(commentsBtn).toBeTruthy();

    await waitForPopupUi(() => {
      expect(commentsBtn!.disabled).toBe(false);
    });

    await act(async () => {
      commentsBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await vi.waitFor(() => {
        expect(sendMock).toHaveBeenCalledWith(UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL, {
          source: 'popup',
        });
        expect((window as any).close).toHaveBeenCalledTimes(1);
      });
    });

    expect(openOrFocusExtensionAppTabMock).not.toHaveBeenCalled();
  });

  it('allows a pending comments request to settle after the popup unmounts without a mounted-state guard', async () => {
    const { UI_MESSAGE_TYPES } = await import('../../src/services/protocols/message-contracts');
    popupCaptureHookMock.mockReturnValue({
      buttonDisabled: false,
      buttonLabel: 'Fetch Article',
      capture: vi.fn(),
      captureState: { readiness: 'ready', kind: 'article', label: 'Fetch Article', collectorId: 'web' },
      checking: false,
      status: null,
    });
    const pending = deferred<{ ok: boolean; data: { opened: boolean }; error: null }>();
    sendMock.mockImplementation((type: string) => {
      if (type === UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL) return pending.promise;
      throw new Error(`unexpected message: ${type}`);
    });
    (window as any).close = vi.fn();

    await renderPopupShell(root!);
    const commentsBtn = document.querySelector(
      '[aria-label="Open in-page comments sidebar"]',
    ) as HTMLButtonElement | null;
    expect(commentsBtn).toBeTruthy();

    act(() => {
      commentsBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith(UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL, {
        source: 'popup',
      }),
    );

    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = null;

    pending.resolve({ ok: true, data: { opened: false }, error: null });
    await pending.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect((window as any).close).not.toHaveBeenCalled();
  });
});
