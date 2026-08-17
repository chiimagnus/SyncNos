import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

const getConversationListBootstrap = vi.fn();
const getConversationListPage = vi.fn();
const markResultsStale = vi.fn();
const submitSearch = vi.fn();
const monitorSetFactsEpoch = vi.fn();
const monitorCheckForExternalChange = vi.fn();

const searchController = {
  mode: 'search' as const,
  draft: { query: 'needle', siteKey: 'all', sort: 'best' as const, sourceKey: 'all' },
  result: null,
  searchError: null,
  searchErrorCode: null,
  searchLoading: false,
  capabilityLoading: false,
  cursorStale: false,
  preview: { detail: null, error: null, loading: false, reference: null },
  openLocalSearch: vi.fn(async () => {}),
  close: vi.fn(),
  setQuery: vi.fn(),
  setSourceKey: vi.fn(),
  setSiteKey: vi.fn(),
  setSort: vi.fn(),
  submit: submitSearch,
  loadMore: vi.fn(async () => {}),
  selectResult: vi.fn(async () => {}),
  clearPreview: vi.fn(),
  markResultsStale,
};

vi.mock('@viewmodels/conversations/useConversationSearchSheet', () => ({
  useConversationSearchSheet: () => searchController,
}));

vi.mock('@viewmodels/conversations/local-revision-refresh', () => ({
  createLocalFactsRevisionMonitor: () => ({
    setFactsEpoch: monitorSetFactsEpoch,
    checkForExternalChange: monitorCheckForExternalChange,
  }),
}));

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: any[]) => getConversationListBootstrap(...args),
  getConversationListPage: (...args: any[]) => getConversationListPage(...args),
  findConversationBySourceAndKey: vi.fn(async () => null),
  findConversationById: vi.fn(async () => null),
  getConversationDetail: vi.fn(async () => ({ id: 1, messages: [] })),
  deleteConversations: vi.fn(async () => ({ deleted: 0 })),
  updateArticleUrl: vi.fn(async () => null),
  backfillConversationImages: vi.fn(async () => null),
}));

vi.mock('@services/conversations/client/images', () => ({
  getConversationImageAsset: vi.fn(async () => null),
}));

vi.mock('@viewmodels/conversations/useConversationSyncFeedback', () => ({
  useConversationSyncFeedback: () => ({
    feedback: {
      provider: null,
      phase: 'idle',
      total: 0,
      done: 0,
      failures: [],
      message: '',
      updatedAt: 0,
      summary: null,
    },
    clearFeedback: vi.fn(),
    startSync: vi.fn(),
    syncingNotion: false,
    syncingObsidian: false,
    syncingFeishu: false,
  }),
}));

vi.mock('@services/comments/client/repo', () => ({
  addArticleComment: vi.fn(),
  deleteArticleCommentById: vi.fn(async () => true),
  listArticleCommentsByCanonicalUrl: vi.fn(async () => []),
  listArticleCommentsByConversationId: vi.fn(async () => []),
  migrateArticleCommentsCanonicalUrl: vi.fn(async () => null),
}));

vi.mock('@services/integrations/detail-header-actions', () => ({
  resolveDetailHeaderActions: vi.fn(async () => []),
}));

vi.mock('@services/shared/ports', () => ({
  connectPort: () => ({
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    disconnect: vi.fn(),
  }),
}));

vi.mock('@i18n', () => ({ t: (key: string) => key }));

import { ConversationsProvider } from '../../src/viewmodels/conversations/conversations-context';

const NATIVE_EPOCH = 'native:11111111-1111-4111-8111-111111111111';

function page() {
  return {
    factsEpoch: NATIVE_EPOCH,
    items: [],
    cursor: null,
    hasMore: false,
    summary: { totalCount: 0, todayCount: 0 },
    facets: { sources: [], sites: [] },
  };
}

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
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('conversation search focus revision refresh', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    getConversationListBootstrap.mockReset().mockResolvedValue(page());
    getConversationListPage.mockReset();
    markResultsStale.mockReset();
    submitSearch.mockReset();
    monitorSetFactsEpoch.mockReset();
    monitorCheckForExternalChange.mockReset().mockImplementation(async (refresh: () => Promise<void>) => {
      await refresh();
      return true;
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    cleanupDom();
  });

  it('marks the current search stale after a native focus refresh and never auto-resubmits it', async () => {
    await act(async () => {
      root!.render(createElement(ConversationsProvider, null, null));
      await flush();
    });
    expect(monitorSetFactsEpoch).toHaveBeenCalledWith(NATIVE_EPOCH);
    expect(monitorSetFactsEpoch).not.toHaveBeenCalledWith(null);

    await act(async () => {
      window.dispatchEvent(new window.Event('focus'));
      await flush();
    });

    expect(monitorCheckForExternalChange).toHaveBeenCalledTimes(1);
    expect(getConversationListBootstrap).toHaveBeenCalledTimes(2);
    expect(markResultsStale).toHaveBeenCalledTimes(1);
    expect(submitSearch).not.toHaveBeenCalled();
    expect(monitorSetFactsEpoch).not.toHaveBeenCalledWith(null);
  });

  it('does not stale or resubmit search when the revision monitor reports no refresh', async () => {
    monitorCheckForExternalChange.mockResolvedValue(false);
    await act(async () => {
      root!.render(createElement(ConversationsProvider, null, null));
      await flush();
    });

    await act(async () => {
      window.dispatchEvent(new window.Event('focus'));
      await flush();
    });

    expect(markResultsStale).not.toHaveBeenCalled();
    expect(submitSearch).not.toHaveBeenCalled();
  });
});
