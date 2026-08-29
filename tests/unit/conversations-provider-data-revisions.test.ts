import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

const getConversationListBootstrap = vi.fn();
const getConversationListPage = vi.fn();
const findConversationBySourceAndKey = vi.fn();
const findConversationById = vi.fn();
const getConversationDetail = vi.fn();
const deleteConversations = vi.fn();
const upsertConversation = vi.fn();
const mergeConversations = vi.fn();
const backfillConversationImages = vi.fn();
const resolveDetailHeaderActions = vi.fn(async () => [] as any[]);
const subscribeDataRevisionChanges = vi.fn();
const whenDataRevisionObserverReady = vi.fn();
const requestDataRevisionRetry = vi.fn();
let revisionListener: ((scopes: readonly string[]) => void) | null = null;
let revisionUnsubscribe = vi.fn();

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: any[]) => getConversationListBootstrap(...args),
  getConversationListPage: (...args: any[]) => getConversationListPage(...args),
  findConversationBySourceAndKey: (...args: any[]) => findConversationBySourceAndKey(...args),
  findConversationById: (...args: any[]) => findConversationById(...args),
  getConversationDetail: (...args: any[]) => getConversationDetail(...args),
  deleteConversations: (...args: any[]) => deleteConversations(...args),
  upsertConversation: (...args: any[]) => upsertConversation(...args),
  mergeConversations: (...args: any[]) => mergeConversations(...args),
  backfillConversationImages: (...args: any[]) => backfillConversationImages(...args),
}));

vi.mock('@services/data-revisions/observer', () => ({
  subscribeDataRevisionChanges: (listener: (scopes: readonly string[]) => void) => subscribeDataRevisionChanges(listener),
  whenDataRevisionObserverReady: () => whenDataRevisionObserverReady(),
  requestDataRevisionRetry: (scopes: readonly string[]) => requestDataRevisionRetry(scopes),
}));

vi.mock('@viewmodels/conversations/useConversationSyncFeedback', () => ({
  useConversationSyncFeedback: () => ({
    feedback: { provider: null, phase: 'idle', total: 0, done: 0, failures: [], message: '', updatedAt: 0, summary: null },
    clearFeedback: vi.fn(),
    startSync: vi.fn(),
    syncingNotion: false,
    syncingObsidian: false,
    syncingFeishu: false,
    syncingGithub: false,
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

vi.mock('@services/shared/storage', () => ({
  storageOnChanged: () => () => {},
}));

vi.mock('@services/shared/ports', () => ({
  connectPort: () => ({
    onMessage: { addListener: () => {}, removeListener: () => {} },
    onDisconnect: { addListener: () => {}, removeListener: () => {} },
    disconnect: () => {},
  }),
}));

vi.mock('@i18n', () => ({
  t: (key: string) => key,
}));

import { ConversationsProvider, useConversationsApp } from '@viewmodels/conversations/conversations-context';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function makeConversation(id: number, source = 'chatgpt') {
  return {
    id,
    source,
    conversationKey: `${source}-${id}`,
    title: `${source}-${id}`,
    url: `https://example.com/${source}/${id}`,
    lastCapturedAt: 1_700_000_000_000 + id,
  };
}

function makePage(items: any[], overrides: Record<string, unknown> = {}) {
  return {
    items,
    cursor: null,
    hasMore: false,
    summary: { totalCount: items.length, todayCount: items.length },
    facets: { sources: [], sites: [] },
    ...overrides,
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

let latestState: any = null;
function Probe() {
  latestState = useConversationsApp();
  return null;
}

describe('ConversationsProvider data revisions', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    latestState = null;
    revisionListener = null;
    revisionUnsubscribe = vi.fn();
    subscribeDataRevisionChanges.mockReset();
    subscribeDataRevisionChanges.mockImplementation((listener) => {
      revisionListener = listener;
      return revisionUnsubscribe;
    });
    whenDataRevisionObserverReady.mockReset();
    requestDataRevisionRetry.mockReset();
    getConversationListBootstrap.mockReset();
    getConversationListPage.mockReset();
    findConversationBySourceAndKey.mockReset();
    findConversationById.mockReset();
    getConversationDetail.mockReset();
    deleteConversations.mockReset();
    upsertConversation.mockReset();
    mergeConversations.mockReset();
    backfillConversationImages.mockReset();
    resolveDetailHeaderActions.mockReset();
    resolveDetailHeaderActions.mockResolvedValue([]);
    getConversationListPage.mockResolvedValue(makePage([]));
    findConversationById.mockResolvedValue(null);
    getConversationDetail.mockResolvedValue({ conversationId: 0, messages: [] });
    deleteConversations.mockResolvedValue(null);
    upsertConversation.mockResolvedValue({});
    mergeConversations.mockResolvedValue({});
    backfillConversationImages.mockResolvedValue({});
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;
    cleanupDom();
  });

  async function renderProvider() {
    await act(async () => {
      root!.render(createElement(ConversationsProvider, null, createElement(Probe)));
      await flushMicrotasks();
    });
  }

  it('subscribes before the first list read and allows a degraded readiness baseline', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    whenDataRevisionObserverReady.mockReturnValue(readiness.promise);
    getConversationListBootstrap.mockResolvedValue(makePage([makeConversation(1)]));

    await renderProvider();
    expect(subscribeDataRevisionChanges).toHaveBeenCalledTimes(1);
    expect(getConversationListBootstrap).not.toHaveBeenCalled();

    await act(async () => {
      readiness.resolve({ baselineAvailable: false });
      await flushMicrotasks();
    });

    expect(getConversationListBootstrap).toHaveBeenCalledTimes(1);
    expect((latestState.items as any[]).map((item) => item.id)).toEqual([1]);
  });

  it('invalidates an in-flight first list and runs one trailing fresh bootstrap for conversation/comment revisions', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    const firstPage = deferred<any>();
    getConversationListBootstrap.mockImplementationOnce(() => firstPage.promise).mockResolvedValueOnce(makePage([makeConversation(2)]));
    whenDataRevisionObserverReady.mockReturnValue(readiness.promise);

    await renderProvider();
    await act(async () => {
      readiness.resolve({ baselineAvailable: true });
      await flushMicrotasks();
    });
    expect(getConversationListBootstrap).toHaveBeenCalledTimes(1);

    revisionListener?.(['conversations', 'article_comments']);
    await act(async () => {
      firstPage.resolve(makePage([makeConversation(1)]));
      await flushMicrotasks();
    });

    expect(getConversationListBootstrap).toHaveBeenCalledTimes(2);
    expect((latestState.items as any[]).map((item) => item.id)).toEqual([2]);
  });

  it('uses the latest filter without replacing its observer subscription', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    whenDataRevisionObserverReady.mockReturnValue(readiness.promise);
    getConversationListBootstrap.mockImplementation((query: any) => {
      const source = String(query?.sourceKey || 'all');
      return Promise.resolve(makePage([makeConversation(source === 'web' ? 3 : 1, source === 'web' ? 'web' : 'chatgpt')]));
    });

    await renderProvider();
    await act(async () => {
      readiness.resolve({ baselineAvailable: true });
      await flushMicrotasks();
    });

    await act(async () => {
      latestState.setListSourceFilterKeyPersistent('web');
      await flushMicrotasks();
    });
    await act(async () => {
      revisionListener?.(['conversations']);
      await flushMicrotasks();
    });

    expect(subscribeDataRevisionChanges).toHaveBeenCalledTimes(1);
    expect(getConversationListBootstrap.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ sourceKey: 'web' }),
    );
    expect((latestState.items as any[]).map((item) => item.id)).toEqual([3]);
  });

  it('keeps the committed list bundle on a same-scope revision read failure and replays the next revision', async () => {
    whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    getConversationListBootstrap
      .mockResolvedValueOnce(
        makePage([makeConversation(1)], {
          cursor: { lastCapturedAt: 10, id: 1 },
          hasMore: true,
          summary: { totalCount: 7, todayCount: 3 },
          facets: { sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 7 }], sites: [] },
        }),
      )
      .mockRejectedValueOnce(new Error('temporary background failure'))
      .mockResolvedValueOnce(makePage([makeConversation(2)], { summary: { totalCount: 8, todayCount: 4 } }));

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
    });

    await act(async () => {
      revisionListener?.(['conversations']);
      await flushMicrotasks();
    });

    expect((latestState.items as any[]).map((item) => item.id)).toEqual([1]);
    expect(latestState.listCursor).toEqual({ lastCapturedAt: 10, id: 1 });
    expect(latestState.listHasMore).toBe(true);
    expect(latestState.listSummary).toEqual({ totalCount: 7, todayCount: 3 });
    expect(latestState.listFacets).toEqual({ sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 7 }], sites: [] });
    expect(requestDataRevisionRetry).toHaveBeenCalledWith(['conversations']);

    await act(async () => {
      revisionListener?.(['conversations']);
      await flushMicrotasks();
    });

    expect((latestState.items as any[]).map((item) => item.id)).toEqual([2]);
    expect(latestState.listSummary).toEqual({ totalCount: 8, todayCount: 4 });
  });

  it('clears the entire old bundle before a new filter read fails', async () => {
    whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    getConversationListBootstrap.mockImplementation((query: any) => {
      if (String(query?.sourceKey || 'all') === 'web') return Promise.reject(new Error('web read failed'));
      return Promise.resolve(
        makePage([makeConversation(1)], {
          cursor: { lastCapturedAt: 10, id: 1 },
          hasMore: true,
          summary: { totalCount: 7, todayCount: 3 },
          facets: { sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 7 }], sites: [] },
        }),
      );
    });

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      latestState.setListSourceFilterKeyPersistent('web');
      await flushMicrotasks();
    });

    expect(latestState.items).toEqual([]);
    expect(latestState.listCursor).toBeNull();
    expect(latestState.listHasMore).toBe(false);
    expect(latestState.listSummary).toEqual({ totalCount: 0, todayCount: 0 });
    expect(latestState.listFacets).toEqual({ sources: [], sites: [] });
    expect(latestState.listError).toBe('web read failed');
  });

  it('does not register a retry for a stale rejected list request', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    const firstPage = deferred<any>();
    whenDataRevisionObserverReady.mockReturnValue(readiness.promise);
    getConversationListBootstrap.mockImplementationOnce(() => firstPage.promise).mockResolvedValueOnce(makePage([makeConversation(2)]));

    await renderProvider();
    await act(async () => {
      readiness.resolve({ baselineAvailable: true });
      await flushMicrotasks();
    });
    expect(getConversationListBootstrap).toHaveBeenCalledTimes(1);

    await act(async () => {
      revisionListener?.(['conversations']);
      firstPage.reject(new Error('stale failure'));
      await flushMicrotasks();
    });

    expect(requestDataRevisionRetry).not.toHaveBeenCalled();
    expect((latestState.items as any[]).map((item) => item.id)).toEqual([2]);
  });

  it('unsubscribes the stable observer when the Provider unmounts', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    whenDataRevisionObserverReady.mockReturnValue(readiness.promise);
    getConversationListBootstrap.mockResolvedValue(makePage([]));

    await renderProvider();
    await act(async () => {
      await flushMicrotasks();
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;

    readiness.resolve({ baselineAvailable: true });
    await flushMicrotasks();

    expect(revisionUnsubscribe).toHaveBeenCalledTimes(1);
    expect(getConversationListBootstrap).not.toHaveBeenCalled();
  });
});
