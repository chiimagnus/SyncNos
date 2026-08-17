import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationsProvider, useConversationsApp } from '../../src/viewmodels/conversations/conversations-context';

const TEST_FACTS_EPOCH = 'idb-v1';
const getConversationListBootstrap = vi.fn();
const getConversationListPage = vi.fn();
const findConversationBySourceAndKey = vi.fn();
const findConversationById = vi.fn();
const getConversationDetail = vi.fn();
const deleteConversations = vi.fn();
const updateArticleUrl = vi.fn();
const backfillConversationImages = vi.fn();
const getConversationImageAsset = vi.fn();

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: unknown[]) => getConversationListBootstrap(...args),
  getConversationListPage: (...args: unknown[]) => getConversationListPage(...args),
  findConversationBySourceAndKey: (...args: unknown[]) => findConversationBySourceAndKey(...args),
  findConversationById: (...args: unknown[]) => findConversationById(...args),
  getConversationDetail: (...args: unknown[]) => getConversationDetail(...args),
  deleteConversations: (...args: unknown[]) => deleteConversations(...args),
  updateArticleUrl: (...args: unknown[]) => updateArticleUrl(...args),
  backfillConversationImages: (...args: unknown[]) => backfillConversationImages(...args),
}));

vi.mock('@services/conversations/client/images', () => ({
  getConversationImageAsset: (...args: unknown[]) => getConversationImageAsset(...args),
}));

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
    clearFeedback: vi.fn(),
    startSync: vi.fn(),
    syncingNotion: false,
    syncingObsidian: false,
    syncingFeishu: false,
  }),
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
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
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

function article(id: number, url: string, title: string) {
  return {
    id,
    sourceType: 'article',
    source: 'web',
    conversationKey: `article:${url}`,
    factsEpoch: TEST_FACTS_EPOCH,
    title,
    url,
    lastCapturedAt: 1000 - id,
  };
}

function page(items: any[]) {
  return {
    factsEpoch: TEST_FACTS_EPOCH,
    items,
    cursor: null,
    hasMore: false,
    summary: { totalCount: items.length, todayCount: items.length },
    facets: { sources: [], sites: [] },
  };
}

let latestState: ReturnType<typeof useConversationsApp> | null = null;
function Probe() {
  latestState = useConversationsApp();
  return null;
}

function flush() {
  return Promise.resolve().then(() => undefined);
}

describe('ConversationsProvider article URL editing', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    latestState = null;
    for (const mock of [
      getConversationListBootstrap,
      getConversationListPage,
      findConversationBySourceAndKey,
      findConversationById,
      getConversationDetail,
      deleteConversations,
      updateArticleUrl,
      backfillConversationImages,
      getConversationImageAsset,
    ]) {
      mock.mockReset();
    }
    getConversationListPage.mockResolvedValue(page([]));
    findConversationBySourceAndKey.mockResolvedValue(null);
    findConversationById.mockResolvedValue(null);
    getConversationDetail.mockResolvedValue({ conversationId: 1, messages: [] });
    deleteConversations.mockResolvedValue(null);
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
      await flush();
    });
    root = null;
    vi.unstubAllGlobals();
    cleanupDom();
  });

  async function renderWith(items: any[]) {
    getConversationListBootstrap.mockResolvedValue(page(items));
    await act(async () => {
      root!.render(createElement(ConversationsProvider, null, createElement(Probe)));
      await flush();
      await flush();
      await flush();
    });
    expect(latestState?.selectedConversation).toBeTruthy();
  }

  it('confirms one loaded conflict and sends one compound request with both stable identities and the same epoch', async () => {
    const source = article(1, 'https://example.com/source', 'Source');
    const target = article(2, 'https://example.com/target', 'Target');
    await renderWith([source, target]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    updateArticleUrl.mockResolvedValue({
      commentsUpdated: 0,
      conversationId: target.id,
      conversationKey: target.conversationKey,
      source: target.source,
      merged: true,
      removedConversationId: source.id,
    });

    await act(async () => {
      await latestState!.updateSelectedConversationUrl(`${target.url}#fragment`);
      await flush();
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(updateArticleUrl).toHaveBeenCalledTimes(1);
    expect(updateArticleUrl).toHaveBeenCalledWith({
      conversation: expect.objectContaining({
        source: source.source,
        conversationKey: source.conversationKey,
        factsEpoch: TEST_FACTS_EPOCH,
      }),
      confirmedConflict: expect.objectContaining({
        source: target.source,
        conversationKey: target.conversationKey,
        factsEpoch: TEST_FACTS_EPOCH,
      }),
      fromCanonicalUrl: source.url,
      toCanonicalUrl: target.url,
    });
  });

  it('does not start any facts write when the user cancels conflict merge confirmation', async () => {
    const source = article(1, 'https://example.com/source', 'Source');
    const target = article(2, 'https://example.com/target', 'Target');
    await renderWith([source, target]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await expect(latestState!.updateSelectedConversationUrl(target.url)).rejects.toThrow('SYNCNOS_URL_EDIT_CANCELLED');
    expect(updateArticleUrl).not.toHaveBeenCalled();
  });

  it('sends no merge intent when the current list has no destination conflict', async () => {
    const source = article(1, 'https://example.com/source', 'Source');
    await renderWith([source]);
    updateArticleUrl.mockResolvedValue({
      commentsUpdated: 0,
      conversationId: source.id,
      conversationKey: 'article:https://example.com/new',
      source: 'web',
      merged: false,
    });

    await act(async () => {
      await latestState!.updateSelectedConversationUrl('https://example.com/new#fragment');
      await flush();
    });

    expect(updateArticleUrl).toHaveBeenCalledTimes(1);
    expect(updateArticleUrl.mock.calls[0]?.[0]).not.toHaveProperty('confirmedConflict');
    expect(updateArticleUrl.mock.calls[0]?.[0]).toMatchObject({
      fromCanonicalUrl: source.url,
      toCanonicalUrl: 'https://example.com/new',
    });
  });

  it('refreshes stable handles after a stale URL mutation rejection without retrying the write', async () => {
    const source = article(1, 'https://example.com/source', 'Source');
    await renderWith([source]);
    const stale = Object.assign(new Error('stale facts epoch'), { code: 'STALE_BACKEND_EPOCH' });
    updateArticleUrl.mockRejectedValue(stale);
    const bootstrapCallsBefore = getConversationListBootstrap.mock.calls.length;

    let caught: unknown;
    await act(async () => {
      try {
        await latestState!.updateSelectedConversationUrl('https://example.com/new');
      } catch (error) {
        caught = error;
      }
      await flush();
      await flush();
    });
    expect(caught).toBe(stale);

    expect(updateArticleUrl).toHaveBeenCalledTimes(1);
    expect(getConversationListBootstrap.mock.calls.length).toBeGreaterThan(bootstrapCallsBefore);
  });

  it('alerts and refreshes after a stale delete rejection without retrying the destructive command', async () => {
    const source = article(1, 'https://example.com/source', 'Source');
    await renderWith([source]);
    act(() => latestState!.toggleSelected(1));
    const stale = Object.assign(new Error('stale reference'), { code: 'STALE_REFERENCE' });
    deleteConversations.mockRejectedValue(stale);
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    const bootstrapCallsBefore = getConversationListBootstrap.mock.calls.length;

    await act(async () => {
      await latestState!.deleteSelected();
      await flush();
      await flush();
    });

    expect(deleteConversations).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('stale reference');
    expect(getConversationListBootstrap.mock.calls.length).toBeGreaterThan(bootstrapCallsBefore);
  });
});
