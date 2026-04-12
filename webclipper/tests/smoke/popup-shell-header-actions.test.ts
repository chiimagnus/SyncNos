import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';

const sendMock = vi.fn();
const openOrFocusExtensionAppTabMock = vi.fn();

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
  openOrFocusExtensionAppTab: (...args: any[]) => openOrFocusExtensionAppTabMock(...args),
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
    selectedIds: [],
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
    syncingNotion: false,
    syncingObsidian: false,
    deleting: false,
    listSourceFilterKey: 'all',
    listSiteFilterKey: 'all',
    setListSourceFilterKeyPersistent: vi.fn(),
    setListSiteFilterKeyPersistent: vi.fn(),
    pendingListLocateId: null,
    consumeListLocate: vi.fn(),
    exportSelectedMarkdown: vi.fn(),
    syncSelectedNotion: vi.fn(),
    syncSelectedObsidian: vi.fn(),
    clearSyncFeedback: vi.fn(),
    deleteSelected: vi.fn(),
    refreshList: vi.fn(),
    refreshActiveDetail: vi.fn(),
  }),
}));

vi.mock('../../src/viewmodels/popup/usePopupCurrentPageCapture', () => ({
  usePopupCurrentPageCapture: () => ({
    buttonDisabled: false,
    buttonLabel: 'Fetch AI Chat',
    capture: vi.fn(),
    captureState: { available: true, kind: 'chat', label: 'Fetch AI Chat', collectorId: 'chatgpt' },
    checking: false,
    fetching: false,
    refreshState: vi.fn(),
    status: null,
  }),
}));

vi.mock('../../src/ui/conversations/ConversationsScene', () => ({
  ConversationsScene: (props: {
    inlineNarrowDetailHeader?: boolean;
    listShell?: { rightSlot?: ReactNode; belowHeader?: ReactNode };
  }) => {
    const [mode, setMode] = useState<'list' | 'detail' | 'detail-empty' | 'detail-menu'>('list');
    const toList = () => {
      setMode('list');
    };
    return createElement(
      'div',
      null,
      createElement('div', { 'data-inline-narrow-detail-header': props.inlineNarrowDetailHeader ? '1' : '0' }),
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
    openOrFocusExtensionAppTabMock.mockReset();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('shows fetch and settings in list mode, then swaps to Open in Notion in detail mode', () => {
    act(() => {
      root!.render(createElement(PopupShell));
    });

    expect(document.querySelector('[aria-label="Fetch AI Chat"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open Settings"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
    expect(document.querySelector('[data-inline-narrow-detail-header="1"]')).toBeTruthy();

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

  it('keeps the popup detail header action area empty when no actions are available', () => {
    act(() => {
      root!.render(createElement(PopupShell));
    });

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

  it('shows a menu trigger in popup detail mode when multiple destinations exist', () => {
    act(() => {
      root!.render(createElement(PopupShell));
    });

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

  it('opens app.html and jumps to the resolved article conversation from the comments button', async () => {
    const { UI_MESSAGE_TYPES } = await import('../../src/services/protocols/message-contracts');
    const { ARTICLE_MESSAGE_TYPES } = await import('../../src/platform/messaging/message-contracts');
    const { encodeConversationLoc, buildConversationRouteFromLoc } =
      await import('../../src/services/shared/conversation-loc');

    sendMock.mockImplementation(async (type: string) => {
      if (type === UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE) {
        return {
          ok: true,
          data: { available: true, kind: 'article', label: 'Fetch Article', collectorId: 'web' },
          error: null,
        };
      }
      if (type === ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB) {
        return {
          ok: true,
          data: { conversationId: 1, url: 'https://example.com/a#x', title: 'A' },
          error: null,
        };
      }
      throw new Error(`unexpected message: ${type}`);
    });

    openOrFocusExtensionAppTabMock.mockResolvedValue({ id: 99, url: '/app.html' });
    (window as any).close = vi.fn();

    act(() => {
      root!.render(createElement(PopupShell));
    });

    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, {});
    });

    const commentsBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(commentsBtn).toBeTruthy();

    await vi.waitFor(() => {
      expect(commentsBtn!.disabled).toBe(false);
    });

    act(() => {
      commentsBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    const expectedLoc = encodeConversationLoc({
      source: 'web',
      conversationKey: 'article:https://example.com/a',
    });
    const expectedRoute = buildConversationRouteFromLoc(expectedLoc);

    await vi.waitFor(() => {
      expect(openOrFocusExtensionAppTabMock).toHaveBeenCalledWith({ route: expectedRoute });
      expect((window as any).close).toHaveBeenCalledTimes(1);
    });

    expect(sendMock).not.toHaveBeenCalledWith(
      UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL,
      expect.anything(),
    );
  });
});
