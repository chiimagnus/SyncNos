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
        title: 'First chat',
        source: 'gemini',
        conversationKey: 'conv-11',
        lastCapturedAt: Date.now(),
        url: 'https://example.com/chat/11',
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
      sources: [{ key: 'gemini', label: 'gemini', count: 1 }],
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
      title: 'First chat',
      source: 'gemini',
      conversationKey: 'conv-11',
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

describe('ConversationsScene popup Escape behavior', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    setActiveId.mockReset();
    openConversationExternalById.mockReset();
    openConversationExternalBySourceKey.mockReset();
    consumePendingOpenConversation.mockReset();
    consumePendingOpenConversation.mockReturnValue(null);
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('returns from detail to list on first Escape and restores list scrollTop', () => {
    act(() => {
      root!.render(createElement(ConversationsScene));
    });

    const firstListScroll = document.querySelector('.route-scroll') as HTMLDivElement | null;
    expect(firstListScroll).toBeTruthy();
    Object.defineProperty(firstListScroll!, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 180,
    });

    act(() => {
      firstListScroll!.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    });

    const row = document.querySelector('[data-conversation-id="11"]') as HTMLElement | null;
    expect(row).toBeTruthy();
    act(() => {
      row!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0 }));
    });

    expect(setActiveId).toHaveBeenCalledWith(11);
    expect(document.querySelector('[aria-label="Conversation detail"]')).toBeTruthy();

    const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-conversation-id="11"]')).toBeTruthy();
    const restoredListScroll = document.querySelector('.route-scroll') as HTMLDivElement | null;
    expect(restoredListScroll).toBeTruthy();
    expect(restoredListScroll?.scrollTop).toBe(180);

    const secondEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(secondEscape);
    });
    expect(secondEscape.defaultPrevented).toBe(false);
  });

  it('consumes pending-open source/key target and opens detail via precise API', () => {
    consumePendingOpenConversation.mockReturnValueOnce({
      conversationId: 99,
      source: 'chatgpt',
      conversationKey: 'conv-99',
    });

    act(() => {
      root!.render(createElement(ConversationsScene));
    });

    expect(openConversationExternalBySourceKey).toHaveBeenCalledWith('chatgpt', 'conv-99');
    expect(openConversationExternalById).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Conversation detail"]')).toBeTruthy();
  });
});
