import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationsProvider, useConversationsApp } from '../../src/viewmodels/conversations/conversations-context';

const getConversationListBootstrap = vi.fn();
const getConversationListPage = vi.fn();
const findConversationBySourceAndKey = vi.fn();
const findConversationById = vi.fn();
const getConversationDetail = vi.fn();
const deleteConversations = vi.fn();
const upsertConversation = vi.fn();
const updateConversationTitle = vi.fn();
const mergeConversations = vi.fn();
const backfillConversationImages = vi.fn();

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: any[]) => getConversationListBootstrap(...args),
  getConversationListPage: (...args: any[]) => getConversationListPage(...args),
  findConversationBySourceAndKey: (...args: any[]) => findConversationBySourceAndKey(...args),
  findConversationById: (...args: any[]) => findConversationById(...args),
  getConversationDetail: (...args: any[]) => getConversationDetail(...args),
  deleteConversations: (...args: any[]) => deleteConversations(...args),
  upsertConversation: (...args: any[]) => upsertConversation(...args),
  updateConversationTitle: (...args: any[]) => updateConversationTitle(...args),
  mergeConversations: (...args: any[]) => mergeConversations(...args),
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
    syncingNotion: false,
    syncingObsidian: false,
  }),
}));

vi.mock('@services/comments/client/repo', () => ({
  migrateArticleCommentsCanonicalUrl: vi.fn(async () => null),
}));

vi.mock('@services/integrations/detail-header-actions', () => ({
  resolveDetailHeaderActions: vi.fn(async () => []),
}));

vi.mock('@services/shared/ports', () => ({
  connectPort: () => ({
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    disconnect: vi.fn(),
  }),
}));

vi.mock('@services/url-cleaning/tracking-param-cleaner', () => ({
  cleanTrackingParamsUrl: vi.fn(async (url: string) => url),
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
    lastCapturedAt: Date.now() - id * 100,
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
    findConversationById.mockReset();
    getConversationDetail.mockReset();
    deleteConversations.mockReset();
    upsertConversation.mockReset();
    updateConversationTitle.mockReset();
    mergeConversations.mockReset();
    backfillConversationImages.mockReset();

    getConversationListPage.mockResolvedValue(makePage([]));
    findConversationById.mockResolvedValue(null);
    getConversationDetail.mockResolvedValue({ conversationId: 0, messages: [] });
    deleteConversations.mockResolvedValue(null);
    upsertConversation.mockResolvedValue({});
    updateConversationTitle.mockResolvedValue({});
    mergeConversations.mockResolvedValue({
      keptConversationId: 0,
      removedConversationId: 0,
      movedMessages: 0,
      movedImageCache: 0,
      merged: false,
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
      lastCapturedAt: Date.now(),
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
      lastCapturedAt: Date.now(),
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

  it('bootstraps the first list page without waiting for initialOpenLoc resolution', async () => {
    const findReq = deferred<any>();
    findConversationBySourceAndKey.mockImplementation(() => findReq.promise);
    const bootstrapReq = deferred<any>();
    getConversationListBootstrap.mockImplementation(() => bootstrapReq.promise);

    await renderProvider({ initialOpenLoc: { source: 'chatgpt', conversationKey: 'conv-999' } });
    expect(getConversationListBootstrap).toHaveBeenCalled();
    expect(Number(latestState.activeId)).toBe(0);
    expect(latestState.selectedConversation).toBeNull();
    expect(Boolean(latestState.startupInitialOpenPending)).toBe(true);

    await act(async () => {
      bootstrapReq.resolve(
        makePage([makeConversation(1, 'chatgpt', 'conv-1')], {
          sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
        }),
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect((latestState.items as any[]).map((item) => Number(item.id))).toEqual([1]);
    expect(latestState.selectedConversation).toBeNull();
    expect(Number(latestState.activeId)).toBe(0);

    await act(async () => {
      findReq.resolve({
        id: 999,
        source: 'chatgpt',
        conversationKey: 'conv-999',
        title: 'Target conversation',
        url: 'https://example.com/chat/999',
        sourceType: 'chat',
        lastCapturedAt: Date.now(),
      });
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.activeId)).toBe(999);
    expect(String(latestState.selectedConversation?.conversationKey || '')).toBe('conv-999');
    expect(Boolean(latestState.startupInitialOpenPending)).toBe(false);
  });

  it('resets filters to all/all before startup loc bootstrap runs', async () => {
    localStorage.setItem('webclipper_conversations_source_filter_key', 'claude');
    localStorage.setItem('webclipper_conversations_site_filter_key', 'domain:sspai.com');
    getConversationListBootstrap.mockResolvedValue(
      makePage([makeConversation(1, 'chatgpt', 'conv-1')], {
        sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
      }),
    );
    findConversationBySourceAndKey.mockResolvedValue(null);

    await renderProvider({ initialOpenLoc: { source: 'chatgpt', conversationKey: 'conv-999' } });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(getConversationListBootstrap).toHaveBeenCalledWith({ sourceKey: 'all', siteKey: 'all', limit: 100 }, 100);
    expect(String(latestState.listSourceFilterKey || '')).toBe('all');
    expect(String(latestState.listSiteFilterKey || '')).toBe('all');
  });

  it('keeps list visible without auto-selecting fallback conversation when startup loc misses', async () => {
    getConversationListBootstrap.mockResolvedValue(
      makePage([makeConversation(21, 'chatgpt', 'conv-21')], {
        sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
      }),
    );
    findConversationBySourceAndKey.mockResolvedValue(null);

    await renderProvider({ initialOpenLoc: { source: 'chatgpt', conversationKey: 'missing' } });
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect((latestState.items as any[]).map((item) => Number(item.id))).toEqual([21]);
    expect(Number(latestState.activeId)).toBe(0);
    expect(latestState.selectedConversation).toBeNull();
    expect(Boolean(latestState.startupInitialOpenPending)).toBe(false);
  });

  it('provides cache-images tools action for article conversations', async () => {
    getConversationListBootstrap.mockResolvedValue(
      makePage(
        [
          {
            ...makeConversation(301, 'web', 'article-301'),
            sourceType: 'article',
            url: 'https://example.com/article-301',
          },
        ],
        {
          sources: [{ key: 'web', label: 'web', count: 1 }],
          sites: [{ key: 'example.com', label: 'example.com', count: 1 }],
        },
      ),
    );

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(String(latestState.selectedConversation?.sourceType || '')).toBe('article');

    const actions = Array.isArray(latestState.detailHeaderActions) ? latestState.detailHeaderActions : [];
    const cacheAction = actions.find((action: any) => String(action?.id || '').trim() === 'cache-images');
    expect(cacheAction).toBeTruthy();
    expect(String(cacheAction?.slot || '')).toBe('tools');
  });

  it('updates selected conversation title locally after manual override and reset', async () => {
    getConversationListBootstrap.mockResolvedValue(
      makePage(
        [
          {
            ...makeConversation(401, 'chatgpt', 'conv-401'),
            title: 'Auto title',
          },
        ],
        {
          sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
        },
      ),
    );

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      await flushMicrotasks();
    });

    updateConversationTitle.mockResolvedValueOnce({
      id: 401,
      source: 'chatgpt',
      conversationKey: 'conv-401',
      title: 'Manual title',
      titleManuallyEdited: true,
      url: 'https://example.com/conv-401',
      sourceType: 'chat',
      lastCapturedAt: Number(latestState.selectedConversation?.lastCapturedAt || 0),
    });

    await act(async () => {
      await latestState.updateSelectedConversationTitle('Manual title');
      await flushMicrotasks();
    });

    expect(updateConversationTitle).toHaveBeenCalledWith({
      conversationId: 401,
      mode: 'set',
      title: 'Manual title',
    });
    expect(String(latestState.selectedConversation?.title || '')).toBe('Manual title');
    expect(latestState.selectedConversation?.titleManuallyEdited).toBe(true);
    expect(String((latestState.items as any[])[0]?.title || '')).toBe('Manual title');

    updateConversationTitle.mockResolvedValueOnce({
      id: 401,
      source: 'chatgpt',
      conversationKey: 'conv-401',
      title: 'Auto title 2',
      titleManuallyEdited: false,
      url: 'https://example.com/conv-401',
      sourceType: 'chat',
      lastCapturedAt: Number(latestState.selectedConversation?.lastCapturedAt || 0),
    });

    await act(async () => {
      await latestState.resetSelectedConversationTitle();
      await flushMicrotasks();
    });

    expect(updateConversationTitle).toHaveBeenLastCalledWith({
      conversationId: 401,
      mode: 'reset',
    });
    expect(String(latestState.selectedConversation?.title || '')).toBe('Auto title 2');
    expect(latestState.selectedConversation?.titleManuallyEdited).toBe(false);
    expect(String((latestState.items as any[])[0]?.title || '')).toBe('Auto title 2');
  });
});
