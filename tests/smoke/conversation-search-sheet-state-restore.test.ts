import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scene = vi.hoisted(() => ({
  searchMode: 'closed' as 'closed' | 'search',
  openDetail: vi.fn(),
  openComments: vi.fn(),
  returnToDetail: vi.fn(),
  returnToList: vi.fn(),
  closeSearch: vi.fn(),
  openBySourceKey: vi.fn(async () => {}),
  openById: vi.fn(async () => {}),
}));

vi.mock('@ui/shared/hooks/useIsNarrowScreen', () => ({ useIsNarrowScreen: () => true }));

vi.mock('@ui/shared/hooks/useNarrowListDetailCommentsRoute', () => ({
  useNarrowListDetailCommentsRoute: () => ({
    route: 'list',
    openDetail: scene.openDetail,
    openComments: scene.openComments,
    returnToDetail: scene.returnToDetail,
    returnToList: scene.returnToList,
    listRestoreKey: 0,
  }),
}));

vi.mock('@ui/conversations/pending-open', () => ({ consumePendingOpenConversation: () => null }));
vi.mock('@ui/conversations/ConversationListPane', () => ({
  ConversationListPane: () => createElement('div', { 'data-underlying-list': '', tabIndex: -1 }, 'persistent list'),
}));
vi.mock('@ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: () => createElement('div', { 'data-underlying-detail': '' }, 'detail'),
}));
vi.mock('@ui/conversations/ArticleCommentsSection', () => ({
  ArticleCommentsSection: () => createElement('div', { 'data-underlying-comments': '' }, 'comments'),
}));

const searchResult = {
  backendConversationId: 999,
  source: 'chatgpt',
  conversationKey: 'search-key',
  sourceType: 'chat',
  title: 'Search hit',
  url: '',
  siteKey: 'unknown',
  score: -1,
  lastCapturedAt: 9,
  snippet: 'hit',
  highlights: [{ start: 0, end: 3 }],
} as const;

const selectedConversation = {
  id: 7,
  source: 'chatgpt',
  sourceType: 'chat',
  conversationKey: 'underlying-selected',
  title: 'Underlying selection',
  url: '',
};

vi.mock('@viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    selectedConversation,
    openConversationExternalBySourceKey: scene.openBySourceKey,
    openConversationExternalById: scene.openById,
    listFacets: { sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 3 }], sites: [] },
    localSearchSheet: {
      mode: scene.searchMode,
      draft: { query: 'hit', sourceKey: 'all', siteKey: 'all', sort: 'best' },
      result: {
        cursor: null,
        factsRevision: 2,
        facets: { sources: [], sites: [] },
        hasMore: false,
        items: [searchResult],
        submitted: { query: 'hit', sourceKey: 'all', siteKey: 'all', sort: 'best' },
        truncatedByScanLimit: false,
      },
      searchError: null,
      searchErrorCode: null,
      searchLoading: false,
      capabilityLoading: false,
      cursorStale: false,
      preview: {
        loading: false,
        error: null,
        reference: { source: 'chatgpt', conversationKey: 'search-key' },
        detail: {
          conversationId: 999,
          source: 'chatgpt',
          conversationKey: 'search-key',
          factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
          messages: [{ id: 1, conversationId: 999, messageKey: 'm1', role: 'user', contentText: 'full hit' }],
        },
      },
      close: scene.closeSearch,
      openLocalSearch: vi.fn(async () => {}),
      setQuery: vi.fn(),
      setSourceKey: vi.fn(),
      setSiteKey: vi.fn(),
      setSort: vi.fn(),
      submit: vi.fn(async () => {}),
      loadMore: vi.fn(async () => {}),
      selectResult: vi.fn(async () => {}),
      clearPreview: vi.fn(),
    },
  }),
}));

import { ConversationsScene } from '@ui/conversations/ConversationsScene';

function setupDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body><button id="trigger">trigger</button><div id="root"></div></body></html>',
    {
      url: 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/app.html',
      pretendToBeVisual: true,
    },
  );
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, writable: true, value: 390 });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Node: dom.window.Node,
    KeyboardEvent: dom.window.KeyboardEvent,
    PointerEvent: dom.window.PointerEvent ?? dom.window.MouseEvent,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  for (const key of [
    'window',
    'document',
    'navigator',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'Node',
    'KeyboardEvent',
    'PointerEvent',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    delete (globalThis as any)[key];
  }
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('conversation search sheet underlying-state restoration', () => {
  let root: ReactDOM.Root;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    scene.searchMode = 'closed';
    scene.openDetail.mockReset();
    scene.openComments.mockReset();
    scene.returnToDetail.mockReset();
    scene.returnToList.mockReset();
    scene.closeSearch.mockReset();
    scene.openBySourceKey.mockReset().mockResolvedValue(undefined);
    scene.openById.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    act(() => root.unmount());
    await flush();
    cleanupDom();
  });

  function renderScene() {
    act(() => root.render(createElement(ConversationsScene)));
  }

  it('keeps the underlying list DOM, scroll and route untouched while the overlay opens and closes', async () => {
    renderScene();
    const underlay = document.querySelector('[data-conversations-scene-underlay]') as HTMLElement;
    const list = document.querySelector('[data-underlying-list]') as HTMLElement;
    list.scrollTop = 211;

    scene.searchMode = 'search';
    renderScene();
    await act(async () => flush());
    expect(document.querySelector('[data-conversations-scene-underlay]')).toBe(underlay);
    expect(document.querySelector('[data-underlying-list]')).toBe(list);
    expect(list.scrollTop).toBe(211);
    expect(underlay.hasAttribute('inert')).toBe(true);
    expect(scene.openDetail).not.toHaveBeenCalled();
    expect(scene.openComments).not.toHaveBeenCalled();
    expect(scene.returnToList).not.toHaveBeenCalled();
    expect(scene.returnToDetail).not.toHaveBeenCalled();

    scene.searchMode = 'closed';
    renderScene();
    await act(async () => flush());
    expect(document.querySelector('[data-underlying-list]')).toBe(list);
    expect(list.scrollTop).toBe(211);
    expect(underlay.hasAttribute('inert')).toBe(false);
    expect(selectedConversation.conversationKey).toBe('underlying-selected');
  });

  it('opens a full search result only through the existing stable source/key detail flow', async () => {
    scene.searchMode = 'search';
    renderScene();
    await act(async () => flush());
    const option = document.querySelector('[role="option"]') as HTMLButtonElement;
    await act(async () => {
      option.click();
      await flush();
    });
    const open = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open full conversation'),
    )!;
    await act(async () => {
      (open as HTMLButtonElement).click();
      await flush();
    });

    expect(scene.closeSearch).toHaveBeenCalledTimes(1);
    expect(scene.openBySourceKey).toHaveBeenCalledWith('chatgpt', 'search-key');
    expect(scene.openById).not.toHaveBeenCalled();
    expect(scene.openDetail).toHaveBeenCalledTimes(1);
    expect(scene.openComments).not.toHaveBeenCalled();
  });
});
