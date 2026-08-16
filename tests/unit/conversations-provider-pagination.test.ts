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
const updateArticleUrl = vi.fn();
const backfillConversationImages = vi.fn();
const getConversationImageAsset = vi.fn();
const TEST_FACTS_EPOCH = 'idb-v1';

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: any[]) => getConversationListBootstrap(...args),
  getConversationListPage: (...args: any[]) => getConversationListPage(...args),
  findConversationBySourceAndKey: (...args: any[]) => findConversationBySourceAndKey(...args),
  findConversationById: (...args: any[]) => findConversationById(...args),
  getConversationDetail: (...args: any[]) => getConversationDetail(...args),
  deleteConversations: (...args: any[]) => deleteConversations(...args),
  updateArticleUrl: (...args: any[]) => updateArticleUrl(...args),
  backfillConversationImages: (...args: any[]) => backfillConversationImages(...args),
}));

vi.mock('@services/conversations/client/images', () => ({
  getConversationImageAsset: (...args: any[]) => getConversationImageAsset(...args),
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
    factsEpoch: TEST_FACTS_EPOCH,
    title: `${source}-${id}`,
    lastCapturedAt: Date.now() - id * 100,
    url: `https://example.com/${conversationKey}`,
  };
}

function makePage(items: any[], facets?: { sources?: any[]; sites?: any[] }) {
  return {
    factsEpoch: TEST_FACTS_EPOCH,
    items: items.map((item) => ({ ...item, factsEpoch: item.factsEpoch || TEST_FACTS_EPOCH })),
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
    updateArticleUrl.mockReset();
    backfillConversationImages.mockReset();
    getConversationImageAsset.mockReset();

    getConversationListPage.mockResolvedValue(makePage([]));
    findConversationById.mockResolvedValue(null);
    getConversationDetail.mockResolvedValue({ conversationId: 0, messages: [] });
    deleteConversations.mockResolvedValue(null);
    updateArticleUrl.mockResolvedValue({
      commentsUpdated: 0,
      conversationId: 1,
      conversationKey: 'article:https://example.com/article',
      merged: false,
      source: 'web',
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
    getConversationImageAsset.mockResolvedValue(null);
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
      factsEpoch: TEST_FACTS_EPOCH,
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

    expect(findConversationBySourceAndKey).toHaveBeenCalledWith('chatgpt', 'conv-999', TEST_FACTS_EPOCH);
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
      factsEpoch: TEST_FACTS_EPOCH,
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

  it('bootstraps initialOpenLoc before fetching the first list page', async () => {
    const findReq = deferred<any>();
    findConversationBySourceAndKey.mockImplementation(() => findReq.promise);
    getConversationListBootstrap.mockResolvedValue(
      makePage([makeConversation(1, 'chatgpt', 'conv-1')], {
        sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }],
      }),
    );

    await renderProvider({ initialOpenLoc: { source: 'chatgpt', conversationKey: 'conv-999' } });
    expect(getConversationListBootstrap).not.toHaveBeenCalled();

    await act(async () => {
      findReq.resolve({
        id: 999,
        source: 'chatgpt',
        conversationKey: 'conv-999',
        factsEpoch: TEST_FACTS_EPOCH,
        title: 'Target conversation',
        url: 'https://example.com/chat/999',
        sourceType: 'chat',
        lastCapturedAt: Date.now(),
      });
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(getConversationListBootstrap).toHaveBeenCalled();
    expect(Number(latestState.activeId)).toBe(999);
    expect(String(latestState.selectedConversation?.conversationKey || '')).toBe('conv-999');
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
    getConversationDetail.mockImplementation((reference: any) => {
      const id = Number(reference?.conversationId);
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

    await act(async () => {
      detailReqs.get(1)?.resolve({
        conversationId: 1,
        source: 'web',
        conversationKey: 'article-1',
        factsEpoch: TEST_FACTS_EPOCH,
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
        source: 'web',
        conversationKey: 'article-2',
        factsEpoch: TEST_FACTS_EPOCH,
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
        source: 'web',
        conversationKey: 'article-3',
        factsEpoch: TEST_FACTS_EPOCH,
        messages: [{ id: 31, conversationId: 3, role: 'assistant', contentMarkdown: 'article three' }],
      });
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(Number(latestState.detail?.conversationId)).toBe(3);
    expect(String(latestState.detail?.messages?.[0]?.contentMarkdown || '')).toBe('article three');

    await act(async () => {
      await latestState.resolveDetailImageAsset(7);
    });
    expect(getConversationImageAsset).toHaveBeenCalledWith({
      assetId: 7,
      reference: {
        conversationId: 3,
        source: 'web',
        conversationKey: 'article-3',
        factsEpoch: TEST_FACTS_EPOCH,
      },
    });
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
});
