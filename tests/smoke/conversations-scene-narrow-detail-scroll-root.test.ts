import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationsScene } from '../../src/ui/conversations/ConversationsScene';

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
}));

vi.mock('../../src/ui/shared/hooks/useNarrowListDetailCommentsRoute', () => ({
  useNarrowListDetailCommentsRoute: () => ({
    route: 'detail' as const,
    openDetail: vi.fn(),
    openComments: vi.fn(),
    returnToDetail: vi.fn(),
    returnToList: vi.fn(),
    listRestoreKey: 'k',
  }),
}));

vi.mock('../../src/ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: () => createElement('div', { 'data-detail-pane': '1' }, 'detail'),
}));

const useConversationsAppMock = vi.fn(() => ({
  activeId: 11,
  selectedConversation: {
    id: 11,
    title: 'First chat',
    source: 'gemini',
    sourceType: 'article',
    conversationKey: 'conv-11',
    url: 'https://example.com/article/11',
  },
  selectedIds: [],
  toggleAll: vi.fn(),
  toggleSelected: vi.fn(),
  setActiveId: vi.fn(),
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
  openConversationExternalBySourceKey: vi.fn(),
  openConversationExternalById: vi.fn(),
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
    conversationId: 11,
    messages: [{ id: 'm-1', role: 'assistant', contentMarkdown: 'Alpha sentence.' }],
  },
  detailHeaderActions: [],
  refreshList: vi.fn(),
  refreshActiveDetail: vi.fn(),
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => useConversationsAppMock(),
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

describe('ConversationsScene narrow detail scroll root', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    useConversationsAppMock.mockReset();
    useConversationsAppMock.mockImplementation(() => ({
      activeId: 11,
      selectedConversation: {
        id: 11,
        title: 'First chat',
        source: 'gemini',
        sourceType: 'article',
        conversationKey: 'conv-11',
        url: 'https://example.com/article/11',
      },
      selectedIds: [],
      toggleAll: vi.fn(),
      toggleSelected: vi.fn(),
      setActiveId: vi.fn(),
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
      openConversationExternalBySourceKey: vi.fn(),
      openConversationExternalById: vi.fn(),
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
        conversationId: 11,
        messages: [{ id: 'm-1', role: 'assistant', contentMarkdown: 'Alpha sentence.' }],
      },
      detailHeaderActions: [],
      refreshList: vi.fn(),
      refreshActiveDetail: vi.fn(),
    }));
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('puts the detail route scroll root on the scene wrapper, not inside ConversationDetailPane', () => {
    act(() => {
      root!.render(createElement(ConversationsScene));
    });

    const routeScrollRoots = document.querySelectorAll('.route-scroll');
    expect(routeScrollRoots.length).toBe(1);

    const routeScrollRoot = document.querySelector('#root > .route-scroll') as HTMLDivElement | null;
    expect(routeScrollRoot).toBeTruthy();
    expect(routeScrollRoot?.className).toContain('tw-h-full');
    expect(routeScrollRoot?.className).toContain('tw-flex-col');
    expect(routeScrollRoot?.className).toContain('webclipper-detail-route-scroll');
    expect(routeScrollRoot?.querySelector('[data-detail-pane="1"]')).toBeTruthy();
  });
});
