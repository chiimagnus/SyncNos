import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sceneState = vi.hoisted(() => ({
  isNarrow: true,
  route: 'list' as 'list' | 'detail' | 'comments',
  listRestoreKey: 0,
  searchMode: 'closed' as 'closed' | 'disabled' | 'search',
  closeSearch: vi.fn(),
  openDetail: vi.fn(),
  openComments: vi.fn(),
  returnToDetail: vi.fn(),
  returnToList: vi.fn(),
}));

vi.mock('@ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => sceneState.isNarrow,
}));

vi.mock('@ui/shared/hooks/useNarrowListDetailCommentsRoute', () => ({
  useNarrowListDetailCommentsRoute: () => ({
    route: sceneState.route,
    openDetail: sceneState.openDetail,
    openComments: sceneState.openComments,
    returnToDetail: sceneState.returnToDetail,
    returnToList: sceneState.returnToList,
    listRestoreKey: sceneState.listRestoreKey,
  }),
}));

vi.mock('@ui/conversations/pending-open', () => ({
  consumePendingOpenConversation: () => null,
}));

vi.mock('@ui/conversations/ConversationListPane', () => ({
  ConversationListPane: () => createElement('div', { 'data-scene-list': '' }, 'list'),
}));

vi.mock('@ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: () => createElement('div', { 'data-scene-detail': '' }, 'detail'),
}));

vi.mock('@ui/conversations/ArticleCommentsSection', () => ({
  ArticleCommentsSection: () => createElement('div', { 'data-scene-comments': '' }, 'comments'),
}));

vi.mock('@viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    selectedConversation: {
      id: 7,
      source: 'chatgpt',
      sourceType: 'chat',
      conversationKey: 'thread-7',
      url: '',
    },
    openConversationExternalBySourceKey: vi.fn(),
    listFacets: { sources: [], sites: [] },
    localSearchSheet: {
      mode: sceneState.searchMode,
      draft: { query: '', sourceKey: 'all', siteKey: 'all', sort: 'best' },
      result: null,
      searchError: null,
      searchErrorCode: null,
      searchLoading: false,
      capabilityLoading: false,
      cursorStale: false,
      preview: { detail: null, error: null, loading: false, reference: null },
      close: sceneState.closeSearch,
      openLocalSearch: vi.fn(),
      setQuery: vi.fn(),
      setSourceKey: vi.fn(),
      setSiteKey: vi.fn(),
      setSort: vi.fn(),
      submit: vi.fn(),
      loadMore: vi.fn(),
      selectResult: vi.fn(),
      clearPreview: vi.fn(),
    },
  }),
}));

import { ConversationsScene } from '@ui/conversations/ConversationsScene';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/app.html',
    pretendToBeVisual: true,
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete (globalThis as any)[key];
  }
}

describe('ConversationsScene search overlay host', () => {
  let root: ReactDOM.Root;

  beforeEach(() => {
    setupDom();
    sceneState.isNarrow = true;
    sceneState.route = 'list';
    sceneState.listRestoreKey = 0;
    sceneState.searchMode = 'closed';
    sceneState.closeSearch.mockReset();
    sceneState.openDetail.mockReset();
    sceneState.openComments.mockReset();
    sceneState.returnToDetail.mockReset();
    sceneState.returnToList.mockReset();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => root.unmount());
    cleanupDom();
  });

  function renderScene() {
    act(() => root.render(createElement(ConversationsScene)));
  }

  it('keeps one stable scene root and sibling overlay host while existing route branches change', () => {
    renderScene();
    const sceneRoot = document.querySelector('[data-conversations-scene-root]');
    const underlay = document.querySelector('[data-conversations-scene-underlay]');
    const overlayHost = document.querySelector('[data-conversations-scene-overlay-host]');
    const list = document.querySelector('[data-scene-list]');
    expect(sceneRoot).toBeTruthy();
    expect(underlay).toBeTruthy();
    expect(overlayHost).toBeTruthy();
    expect(list).toBeTruthy();
    expect(overlayHost?.childNodes).toHaveLength(0);

    renderScene();
    expect(document.querySelector('[data-conversations-scene-root]')).toBe(sceneRoot);
    expect(document.querySelector('[data-conversations-scene-underlay]')).toBe(underlay);
    expect(document.querySelector('[data-conversations-scene-overlay-host]')).toBe(overlayHost);
    expect(document.querySelector('[data-scene-list]')).toBe(list);

    sceneState.route = 'detail';
    renderScene();
    expect(document.querySelector('[data-conversations-scene-root]')).toBe(sceneRoot);
    expect(document.querySelector('[data-conversations-scene-underlay]')).toBe(underlay);
    expect(document.querySelector('[data-conversations-scene-overlay-host]')).toBe(overlayHost);
    expect(document.querySelector('[data-scene-list]')).toBeNull();
    expect(document.querySelector('[data-scene-detail]')).toBeTruthy();

    sceneState.isNarrow = false;
    renderScene();
    expect(document.querySelector('[data-conversations-scene-root]')).toBe(sceneRoot);
    expect(document.querySelector('[data-conversations-scene-underlay]')).toBe(underlay);
    expect(document.querySelector('[data-conversations-scene-overlay-host]')).toBe(overlayHost);
    expect(document.querySelector('[data-scene-list]')).toBeTruthy();
    expect(document.querySelector('[data-scene-detail]')).toBeTruthy();
  });

  it('makes the stable underlay inert while the same-root search modal is open and restores it on close', () => {
    renderScene();
    const sceneRoot = document.querySelector('[data-conversations-scene-root]');
    const underlay = document.querySelector('[data-conversations-scene-underlay]');
    const overlayHost = document.querySelector('[data-conversations-scene-overlay-host]');

    sceneState.searchMode = 'disabled';
    renderScene();
    expect(document.querySelector('[data-conversations-scene-root]')).toBe(sceneRoot);
    expect(document.querySelector('[data-conversations-scene-underlay]')).toBe(underlay);
    expect(document.querySelector('[data-conversations-scene-overlay-host]')).toBe(overlayHost);
    expect(underlay?.getAttribute('inert')).toBe('');
    expect(underlay?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1);

    sceneState.searchMode = 'closed';
    renderScene();
    expect(underlay?.hasAttribute('inert')).toBe(false);
    expect(underlay?.hasAttribute('aria-hidden')).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
