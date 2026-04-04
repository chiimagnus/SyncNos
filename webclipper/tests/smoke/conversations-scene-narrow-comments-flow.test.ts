import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationsScene } from '../../src/ui/conversations/ConversationsScene';

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
}));

const setActiveId = vi.fn();
const openConversationExternalById = vi.fn();
const openConversationExternalBySourceKey = vi.fn();
const consumePendingOpenConversation = vi.fn(() => null);
const sidebarOpen = vi.fn(async () => {});
const subscribeSidebarClose = vi.fn((listener: () => void) => {
  currentSidebarCloseListener = listener;
  return () => {
    if (currentSidebarCloseListener === listener) currentSidebarCloseListener = null;
  };
});
let currentSidebarCloseListener: (() => void) | null = null;
const attachPanel = vi.fn();
const detachPanel = vi.fn();
const sessionSubscribe = vi.fn(() => () => {});
const setContext = vi.fn();
const getSessionSnapshot = vi.fn(() => ({
  attached: true,
  isOpen: true,
  busy: false,
  openRequested: false,
  focusRequested: false,
  focusComposerSignal: 0,
  quoteText: '',
  commentCount: 0,
  hasHandlers: true,
  lastOpenSource: null,
}));
const setLocatorRoot = vi.fn();
const getLocatorRoot = vi.fn(() => null);

vi.mock('../../src/ui/conversations/pending-open', () => ({
  consumePendingOpenConversation: () => consumePendingOpenConversation(),
  consumePendingOpenConversationId: () => {
    const pending = consumePendingOpenConversation();
    const id = Number((pending as any)?.conversationId || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
  },
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    items: [
      {
        id: 11,
        title: 'First article',
        source: 'web',
        sourceType: 'article',
        conversationKey: 'conv-11',
        lastCapturedAt: Date.now(),
        url: 'https://example.com/article/11',
      },
    ],
    activeId: 11,
    selectedIds: [],
    toggleAll: vi.fn(),
    toggleSelected: vi.fn(),
    setActiveId,
    clearSelected: vi.fn(),
    exporting: false,
    listError: null,
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
    listCursor: null,
    listHasMore: false,
    listSummary: { totalCount: 1, todayCount: 1 },
    listFacets: {
      sources: [{ key: 'web', label: 'web', count: 1 }],
      sites: [],
    },
    loadingInitialList: false,
    loadingMoreList: false,
    setListSourceFilterKeyPersistent: vi.fn(),
    setListSiteFilterKeyPersistent: vi.fn(),
    pendingListLocateId: null,
    requestListLocate: vi.fn(),
    consumeListLocate: vi.fn(() => null),
    openConversationExternalByLoc: vi.fn(),
    openConversationExternalBySourceKey,
    openConversationExternalById,
    loadMoreList: vi.fn(async () => {}),
    exportSelectedMarkdown: vi.fn(),
    syncSelectedNotion: vi.fn(),
    syncSelectedObsidian: vi.fn(),
    clearSyncFeedback: vi.fn(),
    deleteSelected: vi.fn(),
    loadingList: false,
    loadingDetail: false,
    detailError: null,
    detail: {
      id: 11,
      messages: [{ id: 1, role: 'user', contentText: 'hello', updatedAt: Date.now() }],
    },
    selectedConversation: {
      id: 11,
      title: 'First article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'conv-11',
      url: 'https://example.com/article/11',
    },
    detailHeaderActions: [],
    refreshList: vi.fn(),
    refreshActiveDetail: vi.fn(),
  }),
}));

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
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  return dom;
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('ConversationsScene narrow comments flow', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    setActiveId.mockReset();
    openConversationExternalById.mockReset();
    openConversationExternalBySourceKey.mockReset();
    consumePendingOpenConversation.mockReset();
    consumePendingOpenConversation.mockReturnValue(null);
    sidebarOpen.mockReset();
    subscribeSidebarClose.mockClear();
    attachPanel.mockReset();
    detachPanel.mockReset();
    sessionSubscribe.mockReset();
    sessionSubscribe.mockImplementation(() => () => {});
    setContext.mockReset();
    getSessionSnapshot.mockReset();
    getSessionSnapshot.mockReturnValue({
      attached: true,
      isOpen: true,
      busy: false,
      openRequested: false,
      focusRequested: false,
      focusComposerSignal: 0,
      quoteText: '',
      commentCount: 0,
      hasHandlers: true,
      lastOpenSource: null,
    });
    setLocatorRoot.mockReset();
    getLocatorRoot.mockReset();
    getLocatorRoot.mockReturnValue(null);
    currentSidebarCloseListener = null;
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('goes list -> detail -> comments and returns via close + Escape', () => {
    const commentsSidebarRuntime = {
      sidebarSession: {
        attachPanel,
        detachPanel,
        subscribe: sessionSubscribe,
        getSnapshot: getSessionSnapshot,
      } as any,
      sidebarController: {
        open: sidebarOpen,
        setContext,
      } as any,
      sidebarSnapshot: {} as any,
      setLocatorRoot,
      getLocatorRoot,
      subscribeSidebarClose,
    };

    act(() => {
      root!.render(
        createElement(ConversationsScene, {
          commentsSidebarRuntime,
          inlineNarrowDetailHeader: true,
          narrowCommentsOpenSource: 'popup',
        }),
      );
    });

    expect(setContext).toHaveBeenCalledWith({
      canonicalUrl: 'https://example.com/article/11',
      conversationId: 11,
    });
    expect(document.querySelector('[data-conversation-id="11"]')).toBeTruthy();

    const row = document.querySelector('[data-conversation-id="11"]') as HTMLElement | null;
    expect(row).toBeTruthy();
    act(() => {
      row!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0 }));
    });

    const detail = document.querySelector('[aria-label="Conversation detail"]');
    expect(detail).toBeTruthy();

    const commentBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(commentBtn).toBeTruthy();
    act(() => {
      commentBtn!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      commentBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(sidebarOpen).toHaveBeenCalledTimes(1);
    expect(document.querySelector('webclipper-threaded-comments-panel')).toBeTruthy();
    const commentsPanel = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(commentsPanel?.getAttribute('data-layout')).toBe('full-width');
    expect(commentsPanel?.style.width).toBe('100%');
    expect(commentsPanel?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__resize-handle')).toBeFalsy();

    act(() => {
      currentSidebarCloseListener?.();
    });
    expect(document.querySelector('[aria-label="Conversation detail"]')).toBeTruthy();

    const commentBtnAfterClose = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(commentBtnAfterClose).toBeTruthy();
    act(() => {
      commentBtnAfterClose!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      commentBtnAfterClose!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(sidebarOpen).toHaveBeenCalledTimes(2);
    expect(document.querySelector('webclipper-threaded-comments-panel')).toBeTruthy();

    const firstEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(firstEscape);
    });
    expect(firstEscape.defaultPrevented).toBe(true);
    expect(document.querySelector('[aria-label="Conversation detail"]')).toBeTruthy();

    const secondEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(secondEscape);
    });
    expect(secondEscape.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-conversation-id="11"]')).toBeTruthy();
  });

  it('opens detail via pending source/key and then enters comments route', () => {
    consumePendingOpenConversation.mockReturnValueOnce({
      conversationId: 99,
      source: 'chatgpt',
      conversationKey: 'conv-99',
    });

    const commentsSidebarRuntime = {
      sidebarSession: {
        attachPanel,
        detachPanel,
        subscribe: sessionSubscribe,
        getSnapshot: getSessionSnapshot,
      } as any,
      sidebarController: {
        open: sidebarOpen,
        setContext,
      } as any,
      sidebarSnapshot: {} as any,
      setLocatorRoot,
      getLocatorRoot,
      subscribeSidebarClose,
    };

    act(() => {
      root!.render(
        createElement(ConversationsScene, {
          commentsSidebarRuntime,
          inlineNarrowDetailHeader: true,
          narrowCommentsOpenSource: 'popup',
        }),
      );
    });

    expect(setContext).toHaveBeenCalledWith({
      canonicalUrl: 'https://example.com/article/11',
      conversationId: 11,
    });
    expect(openConversationExternalBySourceKey).toHaveBeenCalledWith('chatgpt', 'conv-99');
    expect(document.querySelector('[aria-label="Conversation detail"]')).toBeTruthy();

    const commentBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(commentBtn).toBeTruthy();
    act(() => {
      commentBtn!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      commentBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(sidebarOpen).toHaveBeenCalledTimes(1);
    expect(document.querySelector('webclipper-threaded-comments-panel')).toBeTruthy();
    const commentsPanel = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(commentsPanel?.getAttribute('data-layout')).toBe('full-width');
    expect(commentsPanel?.style.width).toBe('100%');
  });
});
