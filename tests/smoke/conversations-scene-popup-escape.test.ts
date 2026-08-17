import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationsScene } from '../../src/ui/conversations/ConversationsScene';

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
}));

const setActiveId = vi.fn();
const openLegacyIdbConversationById = vi.fn(async () => false);
const openConversationExternalBySourceKey = vi.fn(async () => true);
const consumePendingOpenConversation = vi.fn(() => null);

vi.mock('../../src/ui/conversations/pending-open', () => ({
  consumePendingOpenConversation: () => consumePendingOpenConversation(),
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
    openLocalSearch: vi.fn(async () => {}),
    localSearchSheet: { mode: 'closed', capabilityLoading: false, close: vi.fn() },
    pendingListLocateId: null,
    requestListLocate: vi.fn(),
    consumeListLocate: vi.fn(() => null),
    openConversationExternalByLoc: vi.fn(),
    openConversationExternalBySourceKey,
    openLegacyIdbConversationById,
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

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('ConversationsScene popup Escape behavior', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    setActiveId.mockReset();
    openLegacyIdbConversationById.mockReset().mockResolvedValue(false);
    openConversationExternalBySourceKey.mockReset().mockResolvedValue(true);
    consumePendingOpenConversation.mockReset();
    consumePendingOpenConversation.mockReturnValue(null);
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      await flushImmediate();
    });
    root = null;
    cleanupDom();
  });

  it('returns from detail to list on first Escape and restores list scrollTop', async () => {
    await act(async () => {
      root!.render(createElement(ConversationsScene));
      await flushImmediate();
    });

    const firstListScroll = document.querySelector('.route-scroll') as HTMLDivElement | null;
    expect(firstListScroll).toBeTruthy();
    Object.defineProperty(firstListScroll!, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 180,
    });

    await act(async () => {
      firstListScroll!.dispatchEvent(new window.Event('scroll', { bubbles: true }));
      await flushImmediate();
    });

    const row = document.querySelector('[data-conversation-id="11"]') as HTMLElement | null;
    expect(row).toBeTruthy();
    await act(async () => {
      row!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0 }));
      await flushImmediate();
    });

    expect(setActiveId).toHaveBeenCalledWith(11);
    expect(document.querySelector('[aria-label="Conversation detail"]')).toBeTruthy();

    const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => {
      document.dispatchEvent(event);
      await flushImmediate();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-conversation-id="11"]')).toBeTruthy();
    const restoredListScroll = document.querySelector('.route-scroll') as HTMLDivElement | null;
    expect(restoredListScroll).toBeTruthy();
    expect(restoredListScroll?.scrollTop).toBe(180);

    const secondEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => {
      document.dispatchEvent(secondEscape);
      await flushImmediate();
    });
    expect(secondEscape.defaultPrevented).toBe(false);
  });

  it('consumes a stable pending-open target and opens detail via precise identity', async () => {
    consumePendingOpenConversation.mockReturnValueOnce({ source: 'chatgpt', conversationKey: 'conv-99' });

    await act(async () => {
      root!.render(createElement(ConversationsScene));
      await flushImmediate();
    });

    expect(openConversationExternalBySourceKey).toHaveBeenCalledWith('chatgpt', 'conv-99');
    expect(openLegacyIdbConversationById).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Conversation detail"]')).toBeTruthy();
  });

  it('consumes legacy numeric pending state but does not open detail when the context rejects non-IDB resolution', async () => {
    consumePendingOpenConversation.mockReturnValueOnce({ legacyIdbConversationId: 99 });

    await act(async () => {
      root!.render(createElement(ConversationsScene));
      await flushImmediate();
    });

    expect(openLegacyIdbConversationById).toHaveBeenCalledWith(99);
    expect(openConversationExternalBySourceKey).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Conversation detail"]')).toBeFalsy();
  });
});
