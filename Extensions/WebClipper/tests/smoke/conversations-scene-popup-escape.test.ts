import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationsScene } from '../../src/ui/conversations/ConversationsScene';

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
}));

const setActiveId = vi.fn();

vi.mock('../../src/ui/conversations/conversations-context', () => ({
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
    exportSelectedMarkdown: vi.fn(),
    syncSelectedNotion: vi.fn(),
    syncSelectedObsidian: vi.fn(),
    clearSyncFeedback: vi.fn(),
    deleteSelected: vi.fn(),
    loadingList: false,
    listError: null,
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
});
