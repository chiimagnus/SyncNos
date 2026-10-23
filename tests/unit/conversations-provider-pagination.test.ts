import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement, StrictMode, useLayoutEffect } from 'react';

import { ConversationsProvider, useConversationsApp } from '../../src/viewmodels/conversations/conversations-context';

const getConversationListBootstrap = vi.fn();
const getConversationListPage = vi.fn();
const findConversationBySourceAndKey = vi.fn();
const getConversationById = vi.fn();
const getConversationDetail = vi.fn();
const deleteConversations = vi.fn();
const updateConversationUrl = vi.fn();
const backfillConversationImages = vi.fn();
const resolveDetailHeaderActions = vi.fn(async () => [] as any[]);
const subscribeDataRevisionChanges = vi.fn();
const whenDataRevisionObserverReady = vi.fn();
const requestDataRevisionRetry = vi.fn();
let storageChangeListener: ((changes: any, areaName: string) => void) | null = null;

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: any[]) => getConversationListBootstrap(...args),
  getConversationListPage: (...args: any[]) => getConversationListPage(...args),
  findConversationBySourceAndKey: (...args: any[]) => findConversationBySourceAndKey(...args),
  getConversationById: (...args: any[]) => getConversationById(...args),
  getConversationDetail: (...args: any[]) => getConversationDetail(...args),
  deleteConversations: (...args: any[]) => deleteConversations(...args),
  updateConversationUrl: (...args: any[]) => updateConversationUrl(...args),
  backfillConversationImages: (...args: any[]) => backfillConversationImages(...args),
}));

const clearFeedback = vi.fn();
const startSync = vi.fn();
vi.mock('../../src/viewmodels/conversations/useConversationSyncFeedback', () => ({
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
    clearFeedback,
    startSync,
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
  resolveDetailHeaderActions: (...args: any[]) => resolveDetailHeaderActions(...args),
}));

vi.mock('@services/integrations/detail-header-action-dependencies', () => ({
  hasDetailHeaderActionStorageDependencyChange: (changes: unknown, areaName: string) =>
    areaName === 'local' &&
    !!changes &&
    typeof changes === 'object' &&
    Object.keys(changes as Record<string, unknown>).some(
      (key) => key.startsWith('webclipper_sync_provider_') || key.startsWith('obsidian_'),
    ),
}));

vi.mock('@services/data-revisions/observer', () => ({
  subscribeDataRevisionChanges: (listener: (scopes: readonly string[]) => void) =>
    subscribeDataRevisionChanges(listener),
  whenDataRevisionObserverReady: () => whenDataRevisionObserverReady(),
  requestDataRevisionRetry: (scopes: readonly string[]) => requestDataRevisionRetry(scopes),
}));

vi.mock('@services/shared/storage', () => ({
  storageOnChanged: (listener: (changes: any, areaName: string) => void) => {
    storageChangeListener = listener;
    return () => {
      if (storageChangeListener === listener) storageChangeListener = null;
    };
  },
}));

vi.mock('@i18n', () => ({
  t: (key: string) => key,
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

function flushMicrotasks() {
  return Promise.resolve().then(() => undefined);
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

function makeConversation(id: number, source: string, conversationKey: string) {
  return {
    id,
    source,
    conversationKey,
    title: `${source}-${id}`,
    lastActivityAt: Date.now() - id * 100,
    url: `https://example.com/${conversationKey}`,
  };
}

function makePage(items: any[], facets?: { sources?: any[]; sites?: any[] }) {
  return {
    items,
    cursor: null,
    hasMore: false,
    summary: { totalCount: items.length, todayCount: items.length },
    facets: {
      sources: facets?.sources || [],
      sites: facets?.sites || [],
    },
  };
}

let latestState: any = null;
function Probe() {
  latestState = useConversationsApp();
  return null;
}

function StrictDetailDemandProbe() {
  latestState = useConversationsApp();
  const { setDetailSurfaceActive } = latestState;
  useLayoutEffect(() => {
    setDetailSurfaceActive(true);
    return () => setDetailSurfaceActive(false);
  }, [setDetailSurfaceActive]);
  return null;
}

describe('ConversationsProvider pagination state', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);

    latestState = null;
    clearFeedback.mockReset();
    startSync.mockReset();
    getConversationListBootstrap.mockReset();
    getConversationListPage.mockReset();
    findConversationBySourceAndKey.mockReset();
    getConversationById.mockReset();
    getConversationDetail.mockReset();
    deleteConversations.mockReset();
    updateConversationUrl.mockReset();
    backfillConversationImages.mockReset();
    resolveDetailHeaderActions.mockReset();
    resolveDetailHeaderActions.mockResolvedValue([]);
    subscribeDataRevisionChanges.mockReset();
    subscribeDataRevisionChanges.mockImplementation(() => () => {});
    whenDataRevisionObserverReady.mockReset();
    whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    requestDataRevisionRetry.mockReset();
    storageChangeListener = null;

    getConversationListPage.mockResolvedValue(makePage([]));
    getConversationById.mockImplementation((conversationId: number) =>
      Promise.resolve(makeConversation(Number(conversationId), 'chatgpt', `conv-${conversationId}`)),
    );
    getConversationDetail.mockResolvedValue({ conversationId: 0, messages: [] });
    deleteConversations.mockResolvedValue(null);
    updateConversationUrl.mockResolvedValue({
      status: 'updated',
      conversationId: 0,
      url: '',
      source: 'web',
      conversationKey: '',
      changed: false,
      merged: false,
      removedConversationId: null,
      conflictConversationId: null,
      mergeSummary: null,
    });
    backfillConversationImages.mockResolvedValue({
      scannedMessages: 0,
      updatedMessages: 0,
      inlinedCount: 0,
      fromCacheCount: 0,
      downloadedCount: 0,
      inlinedBytes: 0,
      warningFlags: [],
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;
    cleanupDom();
  });

  async function renderProvider(providerProps?: any) {
    await act(async () => {
      root!.render(createElement(ConversationsProvider, providerProps ?? null, createElement(Probe)));
      await flushMicrotasks();
      await flushMicrotasks();
    });
  }

  async function activateDetailSurface() {
    await act(async () => {
      latestState.setDetailSurfaceActive(true);
      await flushMicrotasks();
      await flushMicrotasks();
    });
  }

  it('keeps initial loading active until the first bootstrap settles', async () => {
    const firstPage = deferred<any>();
    getConversationListBootstrap.mockImplementation(() => firstPage.promise);

    await renderProvider();

    expect(latestState.loadingInitialList).toBe(true);
    expect(latestState.items).toEqual([]);

    await act(async () => {
      firstPage.resolve(makePage([]));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(latestState.loadingInitialList).toBe(false);
    expect(latestState.listError).toBeNull();
    expect(latestState.items).toEqual([]);
  });

  it('re-enters initial loading while retrying a failed empty bootstrap', async () => {
    const retryPage = deferred<any>();
    getConversationListBootstrap
      .mockRejectedValueOnce(new Error('initial read failed'))
      .mockImplementationOnce(() => retryPage.promise);

    await renderProvider();

    expect(latestState.loadingInitialList).toBe(false);
    expect(latestState.listError).toBe('initial read failed');
    expect(latestState.items).toEqual([]);

    let retryPromise!: Promise<void>;
    await act(async () => {
      retryPromise = latestState.refreshList();
      await flushMicrotasks();
    });
    expect(latestState.loadingInitialList).toBe(true);
    expect(latestState.listError).toBeNull();

    await act(async () => {
      retryPage.resolve(makePage([]));
      await retryPromise;
      await flushMicrotasks();
    });

    expect(latestState.loadingInitialList).toBe(false);
    expect(latestState.listError).toBeNull();
  });

  it('drops stale bootstrap responses during fast filter switching', async () => {
    const allReq = deferred<any>();
    const webReq = deferred<any>();
    const chatgptReq = deferred<any>();

    getConversationListBootstrap.mockImplementation((query: any) => {
      const sourceKey = String(query?.sourceKey || 'all')
        .trim()
        .toLowerCase();
      if (sourceKey === 'all') return allReq.promise;
      if (sourceKey === 'web') return webReq.promise;
      if (sourceKey === 'chatgpt') return chatgptReq.promise;
      return Promise.resolve(makePage([]));
    });

    await renderProvider();
    await act(async () => {
      allReq.resolve(
        makePage([makeConversation(1, 'chatgpt', 'conv-1')], {
          sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });
    expect(Array.isArray(latestState?.items)).toBe(true);

    act(() => {
      latestState.setListSourceFilterKeyPersistent('web');
      latestState.setListSourceFilterKeyPersistent('chatgpt');
    });

    await act(async () => {
      chatgptReq.resolve(
        makePage([makeConversation(201, 'chatgpt', 'conv-201')], {
          sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    await act(async () => {
      webReq.resolve(
        makePage([makeConversation(101, 'web', 'conv-101')], {
          sources: [{ key: 'web', label: 'web', count: 1 }],
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(String(latestState.listSourceFilterKey)).toBe('chatgpt');
    expect((latestState.items as any[]).map((item) => Number(item.id))).toEqual([201]);
  });

  it('validates a persisted web domain only against a successful facet snapshot', async () => {
    window.localStorage.setItem('webclipper_conversations_source_filter_key', 'web');
    window.localStorage.setItem('webclipper_conversations_site_filter_key', 'domain:missing.example');

    getConversationListBootstrap.mockImplementation((query: any) => {
      const siteKey = String(query?.siteKey || 'all')
        .trim()
        .toLowerCase();
      const facets = {
        sources: [{ key: 'web', label: 'web', count: 1 }],
        sites: [{ key: 'domain:example.com', label: 'example.com', count: 1 }],
      };
      if (siteKey === 'domain:missing.example') return Promise.resolve(makePage([], facets));
      return Promise.resolve(makePage([makeConversation(301, 'web', 'article-301')], facets));
    });

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(String(latestState.listSourceFilterKey)).toBe('web');
    expect(String(latestState.listSiteFilterKey)).toBe('all');
    expect(window.localStorage.getItem('webclipper_conversations_site_filter_key')).toBeNull();
    expect(getConversationListBootstrap.mock.calls.map(([query]) => query?.siteKey)).toEqual([
      'domain:missing.example',
      'all',
    ]);
  });

  it('merges a successful continuation page and commits its pagination bundle', async () => {
    const firstPage = {
      ...makePage([makeConversation(1, 'chatgpt', 'conv-1')], {
        sources: [{ key: 'chatgpt', label: 'chatgpt', count: 3 }],
      }),
      cursor: { lastActivityAt: 100, id: 1 },
      hasMore: true,
      summary: { totalCount: 3, todayCount: 1 },
    };
    const secondPage = {
      ...makePage([makeConversation(2, 'gemini', 'conv-2')], {
        sources: [
          { key: 'chatgpt', label: 'chatgpt', count: 2 },
          { key: 'gemini', label: 'gemini', count: 1 },
        ],
        sites: [{ key: 'domain:example.com', label: 'example.com', count: 3 }],
      }),
      cursor: { lastActivityAt: 50, id: 2 },
      hasMore: true,
      summary: { totalCount: 3, todayCount: 2 },
    };
    const thirdPage = makePage([]);
    getConversationListBootstrap.mockResolvedValue(firstPage);
    getConversationListPage.mockResolvedValueOnce(secondPage).mockResolvedValueOnce(thirdPage);

    await renderProvider();
    await act(async () => {
      await latestState.loadMoreList();
      await flushMicrotasks();
    });

    expect((latestState.items as any[]).map((item) => Number(item.id))).toEqual([1, 2]);
    expect(latestState.listHasMore).toBe(true);
    expect(latestState.listSummary).toEqual({ totalCount: 3, todayCount: 2 });
    expect(latestState.listFacets).toEqual(secondPage.facets);
    expect(getConversationListPage).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      { lastActivityAt: 100, id: 1 },
      expect.any(Number),
    );

    await act(async () => {
      await latestState.loadMoreList();
      await flushMicrotasks();
    });
    expect(getConversationListPage).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      { lastActivityAt: 50, id: 2 },
      expect.any(Number),
    );
  });

  it('keeps the committed page bundle when loading more fails', async () => {
    const firstPage = {
      ...makePage([makeConversation(1, 'chatgpt', 'conv-1')], {
        sources: [{ key: 'chatgpt', label: 'chatgpt', count: 2 }],
      }),
      cursor: { lastActivityAt: 100, id: 1 },
      hasMore: true,
      summary: { totalCount: 2, todayCount: 1 },
    };
    getConversationListBootstrap.mockResolvedValue(firstPage);
    getConversationListPage.mockRejectedValue(new Error('page read failed'));

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      await latestState.loadMoreList();
      await flushMicrotasks();
    });

    expect((latestState.items as any[]).map((item) => Number(item.id))).toEqual([1]);
    expect(latestState.listHasMore).toBe(true);
    expect(latestState.listSummary).toEqual({ totalCount: 2, todayCount: 1 });
    expect(requestDataRevisionRetry).toHaveBeenCalledWith(['conversations', 'article_comments']);

    getConversationListPage.mockResolvedValue(makePage([]));
    await act(async () => {
      await latestState.loadMoreList();
      await flushMicrotasks();
    });
    expect(getConversationListPage).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      { lastActivityAt: 100, id: 1 },
      expect.any(Number),
    );
  });

  it('supports open by source+key even when target is not in loaded items', async () => {
    getConversationListBootstrap.mockResolvedValue(
      makePage([], {
        sources: [],
      }),
    );
    findConversationBySourceAndKey.mockResolvedValue({
      id: 999,
      source: 'chatgpt',
      conversationKey: 'conv-999',
      title: 'Target conversation',
      url: 'https://example.com/chat/999',
      sourceType: 'chat',
      lastActivityAt: Date.now(),
    });

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    await act(async () => {
      await latestState.openConversationExternalBySourceKey('chatgpt', 'conv-999');
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(findConversationBySourceAndKey).toHaveBeenCalledWith('chatgpt', 'conv-999');
    expect(Number(latestState.activeId)).toBe(999);
    expect(latestState.selectedConversation).toBeTruthy();
    expect(String(latestState.selectedConversation?.conversationKey || '')).toBe('conv-999');
    expect((latestState.items as any[]).some((item) => Number(item.id) === 999)).toBe(false);
  });

  it('preserves requested activeId across bootstrap even when target is not in loaded items', async () => {
    const bootstrapReq = deferred<any>();
    getConversationListBootstrap.mockImplementation(() => bootstrapReq.promise);
    findConversationBySourceAndKey.mockResolvedValue({
      id: 999,
      source: 'chatgpt',
      conversationKey: 'conv-999',
      title: 'Target conversation',
      url: 'https://example.com/chat/999',
      sourceType: 'chat',
      lastActivityAt: Date.now(),
    });

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    await act(async () => {
      await latestState.openConversationExternalBySourceKey('chatgpt', 'conv-999');
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.activeId)).toBe(999);
    expect(Number(latestState.pendingListLocateId)).toBe(999);
    expect(String(latestState.selectedConversation?.conversationKey || '')).toBe('conv-999');

    await act(async () => {
      bootstrapReq.resolve(
        makePage([makeConversation(1, 'chatgpt', 'conv-1')], {
          sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.activeId)).toBe(999);
    expect(String(latestState.selectedConversation?.conversationKey || '')).toBe('conv-999');
    expect((latestState.items as any[]).map((item) => Number(item.id))).toEqual([1]);
  });

  it('bootstraps initialOpenLoc before fetching the first list page', async () => {
    const findReq = deferred<any>();
    findConversationBySourceAndKey.mockImplementation(() => findReq.promise);
    getConversationListBootstrap.mockResolvedValue(
      makePage([makeConversation(1, 'chatgpt', 'conv-1')], {
        sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
      }),
    );

    await renderProvider({ initialOpenLoc: { source: 'chatgpt', conversationKey: 'conv-999' } });
    expect(latestState.loadingInitialList).toBe(true);
    expect(getConversationListBootstrap).not.toHaveBeenCalled();

    await act(async () => {
      findReq.resolve({
        id: 999,
        source: 'chatgpt',
        conversationKey: 'conv-999',
        title: 'Target conversation',
        url: 'https://example.com/chat/999',
        sourceType: 'chat',
        lastActivityAt: Date.now(),
      });
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(getConversationListBootstrap).toHaveBeenCalled();
    expect(latestState.loadingInitialList).toBe(false);
    expect(Number(latestState.activeId)).toBe(999);
    expect(String(latestState.selectedConversation?.conversationKey || '')).toBe('conv-999');
  });

  it('deduplicates StrictMode detail-demand layout replay before the active target is established', async () => {
    const target = makeConversation(7, 'chatgpt', 'conv-7');
    findConversationBySourceAndKey.mockResolvedValue(target);
    getConversationListBootstrap.mockResolvedValue(makePage([]));
    getConversationById.mockResolvedValue(target);
    getConversationDetail.mockResolvedValue({ conversationId: 7, messages: [] });

    await act(async () => {
      root!.render(
        createElement(
          StrictMode,
          null,
          createElement(
            ConversationsProvider,
            { initialOpenLoc: { source: 'chatgpt', conversationKey: 'conv-7' } },
            createElement(StrictDetailDemandProbe),
          ),
        ),
      );
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.activeId)).toBe(7);
    expect(getConversationById).toHaveBeenCalledTimes(1);
    expect(getConversationById).toHaveBeenCalledWith(7);
    expect(getConversationDetail).toHaveBeenCalledTimes(1);
    expect(getConversationDetail).toHaveBeenCalledWith(7);
  });

  it('keeps list bootstrap free of hidden point, detail, and Header reads', async () => {
    getConversationListBootstrap.mockResolvedValue(makePage([makeConversation(1, 'chatgpt', 'conv-1')]));

    await renderProvider();

    expect(Number(latestState.activeId)).toBe(1);
    expect(latestState.loadingDetail).toBe(false);
    expect(getConversationById).not.toHaveBeenCalled();
    expect(getConversationDetail).not.toHaveBeenCalled();
    expect(resolveDetailHeaderActions).not.toHaveBeenCalled();
  });

  it('keeps an active detail surface idle when the authoritative list is empty', async () => {
    getConversationListBootstrap.mockResolvedValue(makePage([]));

    await renderProvider();
    await activateDetailSurface();

    expect(latestState.activeId).toBeNull();
    expect(latestState.loadingDetail).toBe(false);
    expect(getConversationById).not.toHaveBeenCalled();
    expect(getConversationDetail).not.toHaveBeenCalled();
    expect(resolveDetailHeaderActions).not.toHaveBeenCalled();
  });

  it('starts exactly one point/detail activation when hidden selection and detail route open in one batch', async () => {
    const first = makeConversation(1, 'chatgpt', 'conv-1');
    const second = makeConversation(2, 'chatgpt', 'conv-2');
    getConversationListBootstrap.mockResolvedValue(makePage([first, second]));
    getConversationById.mockImplementation(async (conversationId: number) =>
      Number(conversationId) === 2 ? second : first,
    );
    getConversationDetail.mockImplementation(async (conversationId: number) => ({
      conversationId: Number(conversationId),
      messages: [],
    }));

    await renderProvider();
    expect(getConversationById).not.toHaveBeenCalled();
    expect(getConversationDetail).not.toHaveBeenCalled();

    act(() => {
      latestState.activateLoadedConversation(2);
      latestState.setDetailSurfaceActive(true);
    });
    expect(latestState.loadingDetail).toBe(true);

    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(getConversationById).toHaveBeenCalledTimes(1);
    expect(getConversationById).toHaveBeenCalledWith(2);
    expect(getConversationDetail).toHaveBeenCalledTimes(1);
    expect(getConversationDetail).toHaveBeenCalledWith(2);
    expect(Number(latestState.detail?.conversationId)).toBe(2);
  });

  it('keeps detail state aligned with the current active conversation', async () => {
    getConversationListBootstrap.mockResolvedValue(
      makePage([
        makeConversation(1, 'web', 'article-1'),
        makeConversation(2, 'web', 'article-2'),
        makeConversation(3, 'web', 'article-3'),
      ]),
    );
    const detailReqs = new Map<number, ReturnType<typeof deferred<any>>>();
    getConversationDetail.mockImplementation((conversationId: number) => {
      const id = Number(conversationId);
      const req = deferred<any>();
      detailReqs.set(id, req);
      return req.promise;
    });

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.activeId)).toBe(1);
    expect(getConversationDetail).not.toHaveBeenCalled();

    await activateDetailSurface();

    await act(async () => {
      detailReqs.get(1)?.resolve({
        conversationId: 1,
        messages: [{ id: 11, conversationId: 1, role: 'assistant', contentMarkdown: 'article one' }],
      });
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.detail?.conversationId)).toBe(1);

    act(() => {
      latestState.setActiveId(2);
    });
    expect(Number(latestState.activeId)).toBe(2);
    expect(latestState.detail).toBe(null);

    act(() => {
      latestState.setActiveId(3);
    });

    await act(async () => {
      detailReqs.get(2)?.resolve({
        conversationId: 2,
        messages: [{ id: 21, conversationId: 2, role: 'assistant', contentMarkdown: 'stale article two' }],
      });
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.activeId)).toBe(3);
    expect(latestState.detail).toBe(null);

    await act(async () => {
      detailReqs.get(3)?.resolve({
        conversationId: 3,
        messages: [{ id: 31, conversationId: 3, role: 'assistant', contentMarkdown: 'article three' }],
      });
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.detail?.conversationId)).toBe(3);
    expect(String(latestState.detail?.messages?.[0]?.contentMarkdown || '')).toBe('article three');
  });

  it('re-resolves detail header actions when a sync provider gate changes', async () => {
    getConversationListBootstrap.mockResolvedValue(makePage([makeConversation(401, 'chatgpt', 'conv-401')]));
    getConversationDetail.mockResolvedValue({ conversationId: 401, messages: [] });

    await renderProvider();
    await activateDetailSurface();

    const initialCalls = resolveDetailHeaderActions.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    expect(storageChangeListener).toBeTruthy();

    await act(async () => {
      storageChangeListener?.(
        { webclipper_sync_provider_notion_enabled: { oldValue: true, newValue: false } },
        'local',
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(resolveDetailHeaderActions.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(resolveDetailHeaderActions.mock.calls.at(-1)?.[0]?.conversation?.id).toBe(401);

    const afterProviderChangeCalls = resolveDetailHeaderActions.mock.calls.length;
    await act(async () => {
      storageChangeListener?.({ unrelated_key: { oldValue: 1, newValue: 2 } }, 'local');
      await flushMicrotasks();
    });
    expect(resolveDetailHeaderActions).toHaveBeenCalledTimes(afterProviderChangeCalls);
  });

  it('delegates article URL conflict detection and merge to the canonical background mutation', async () => {
    const selected = {
      ...makeConversation(501, 'web', 'article-old'),
      sourceType: 'article',
      url: 'https://example.com/old',
    };
    const unrelated = {
      ...makeConversation(503, 'web', 'article-unrelated'),
      sourceType: 'article',
      url: 'https://example.com/unrelated',
    };
    getConversationListBootstrap.mockResolvedValue(makePage([selected, unrelated]));
    getConversationById.mockResolvedValue(selected);
    getConversationDetail.mockResolvedValue({ conversationId: 501, messages: [] });
    updateConversationUrl
      .mockResolvedValueOnce({
        status: 'conflict',
        conversationId: 501,
        url: 'https://example.com/target',
        source: 'web',
        conversationKey: 'article:https://example.com/target',
        changed: false,
        merged: false,
        removedConversationId: null,
        conflictConversationId: 502,
        mergeSummary: null,
      })
      .mockResolvedValueOnce({
        status: 'updated',
        conversationId: 501,
        url: 'https://example.com/target',
        source: 'web',
        conversationKey: 'article:https://example.com/target',
        changed: true,
        merged: true,
        removedConversationId: 502,
        conflictConversationId: null,
        mergeSummary: {
          keptConversationId: 501,
          removedConversationId: 502,
          movedMessages: 0,
          movedImageCache: 0,
          merged: true,
        },
      });
    getConversationById.mockResolvedValueOnce(selected).mockResolvedValueOnce({
      ...selected,
      conversationKey: 'article:https://example.com/target',
      url: 'https://example.com/target',
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    try {
      await renderProvider();
      await act(async () => {
        await flushMicrotasks();
        await flushMicrotasks();
      });

      await act(async () => {
        await latestState.updateSelectedConversationUrl('https://example.com/target');
      });

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(updateConversationUrl).toHaveBeenNthCalledWith(1, 501, 'https://example.com/target', false);
      expect(updateConversationUrl).toHaveBeenNthCalledWith(2, 501, 'https://example.com/target', true);
    } finally {
      confirm.mockRestore();
    }
  });

  it('provides cache-images tools action for article conversations', async () => {
    const article = {
      ...makeConversation(301, 'web', 'article-301'),
      sourceType: 'article',
      url: 'https://example.com/article-301',
    };
    getConversationListBootstrap.mockResolvedValue(
      makePage([article], {
        sources: [{ key: 'web', label: 'web', count: 1 }],
        sites: [{ key: 'example.com', label: 'example.com', count: 1 }],
      }),
    );
    getConversationById.mockResolvedValue(article);

    await renderProvider();
    await activateDetailSurface();
    await act(async () => {
      await flushMicrotasks();
    });

    expect(String(latestState.selectedConversation?.sourceType || '')).toBe('article');

    const actions = Array.isArray(latestState.detailHeaderActions) ? latestState.detailHeaderActions : [];
    const cacheAction = actions.find((action: any) => String(action?.id || '').trim() === 'cache-images');
    expect(cacheAction).toBeTruthy();
    expect(String(cacheAction?.slot || '')).toBe('tools');
  });
});
