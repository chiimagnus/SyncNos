import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationListPane } from '../../src/ui/conversations/ConversationListPane';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
  formatConversationTitle: (text: string) => text,
}));

const getEnabledSyncProviders = vi.fn<() => Promise<Array<'obsidian' | 'notion'>>>();
vi.mock('../../src/services/sync/sync-provider-gate', () => ({
  getEnabledSyncProviders: () => getEnabledSyncProviders(),
  syncProviderEnabledStorageKey: (provider: string) => `sync_provider_enabled.${provider}`,
}));

vi.mock('../../src/services/shared/storage', () => ({
  storageOnChanged: () => () => {},
}));

let currentState: any = null;
vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => currentState,
}));

let observerCallback:
  | ((entries: Array<{ isIntersecting: boolean; target: Element }>, observer: unknown) => void)
  | null = null;
let observedTarget: Element | null = null;

class MockIntersectionObserver {
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: number[] = [];

  constructor(
    callback: (entries: Array<{ isIntersecting: boolean; target: Element }>, observer: unknown) => void,
    _options?: unknown,
  ) {
    observerCallback = callback;
  }

  observe(target: Element) {
    observedTarget = target;
  }

  unobserve(_target: Element) {}

  disconnect() {}

  takeRecords() {
    return [];
  }
}

function flushMicrotasks() {
  return Promise.resolve().then(() => undefined);
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
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: MockIntersectionObserver,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(globalThis.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
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
  delete (globalThis as any).IntersectionObserver;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  observerCallback = null;
  observedTarget = null;
}

function baseConversation(id: number, source = 'chatgpt') {
  return {
    id,
    title: `Conversation ${id}`,
    source,
    conversationKey: `conv-${id}`,
    lastCapturedAt: Date.now() - id * 1000,
    url: `https://example.com/chat/${id}`,
  };
}

function buildState(overrides: Record<string, unknown> = {}) {
  const items = [baseConversation(11), baseConversation(22)];
  return {
    items,
    activeId: 11,
    selectedIds: [],
    toggleAll: vi.fn(),
    toggleSelected: vi.fn(),
    setActiveId: vi.fn(),
    clearSelected: vi.fn(),
    openConversationExternalByLoc: vi.fn(),
    openConversationExternalBySourceKey: vi.fn(),
    openConversationExternalById: vi.fn(),
    loadMoreList: vi.fn(async () => {}),
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
    loadingList: false,
    loadingInitialList: false,
    loadingMoreList: false,
    listError: null,
    listCursor: { lastCapturedAt: Date.now() - 9999, id: 1 },
    listHasMore: true,
    listSummary: { totalCount: items.length, todayCount: items.length },
    listFacets: {
      sources: [{ key: 'chatgpt', label: 'chatgpt', count: items.length }],
      sites: [],
    },
    listSourceFilterKey: 'all',
    listSiteFilterKey: 'all',
    setListSourceFilterKeyPersistent: vi.fn(),
    setListSiteFilterKeyPersistent: vi.fn(),
    pendingListLocateId: null,
    requestListLocate: vi.fn(),
    consumeListLocate: vi.fn(() => null),
    exportSelectedMarkdown: vi.fn(),
    syncSelectedNotion: vi.fn(),
    syncSelectedObsidian: vi.fn(),
    clearSyncFeedback: vi.fn(),
    deleteSelected: vi.fn(),
    refreshList: vi.fn(async () => {}),
    refreshActiveDetail: vi.fn(async () => {}),
    ...overrides,
  };
}

async function triggerIntersection(isIntersecting: boolean) {
  expect(observerCallback).toBeTruthy();
  expect(observedTarget).toBeTruthy();
  await act(async () => {
    observerCallback?.([{ isIntersecting, target: observedTarget as Element }], {});
    await flushMicrotasks();
  });
}

describe('ConversationListPane pagination behaviors', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    getEnabledSyncProviders.mockReset();
    getEnabledSyncProviders.mockResolvedValue(['notion']);
    currentState = buildState();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;
    cleanupDom();
  });

  async function renderPane() {
    await act(async () => {
      root!.render(createElement(ConversationListPane));
      await flushMicrotasks();
    });
  }

  it('triggers auto pagination near bottom and respects gate conditions', async () => {
    const loadMoreList = vi.fn(async () => {});
    currentState = buildState({ listHasMore: true, loadingMoreList: false, loadMoreList });

    await renderPane();
    await triggerIntersection(true);
    expect(loadMoreList).toHaveBeenCalledTimes(1);

    currentState = { ...currentState, loadingMoreList: true };
    await renderPane();
    await triggerIntersection(true);
    expect(loadMoreList).toHaveBeenCalledTimes(1);

    currentState = { ...currentState, loadingMoreList: false, listHasMore: false };
    await renderPane();
    await triggerIntersection(true);
    expect(loadMoreList).toHaveBeenCalledTimes(1);
  });

  it('keeps select-all and batch tooltip semantics scoped to loaded visible items', async () => {
    const toggleAll = vi.fn();
    currentState = buildState({
      selectedIds: [11, 22, 999],
      toggleAll,
    });

    await renderPane();
    await act(async () => {
      await flushMicrotasks();
    });

    const selectAllLabel = document.querySelector('label[aria-label="selectAll"]') as HTMLLabelElement | null;
    expect(selectAllLabel).toBeTruthy();
    expect(String(selectAllLabel?.getAttribute('data-tooltip-content') || '')).toContain(
      'tooltipLoadedVisibleSelectionScope',
    );

    const selectAllCheckbox = document.getElementById('chkSelectAll') as HTMLInputElement | null;
    expect(selectAllCheckbox).toBeTruthy();
    await act(async () => {
      selectAllCheckbox!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(toggleAll).toHaveBeenCalledWith([11, 22]);

    const deleteBtn = document.getElementById('btnDelete') as HTMLButtonElement | null;
    const exportBtn = document.getElementById('btnExport') as HTMLButtonElement | null;
    const syncBtn = document.getElementById('btnSyncProvider') as HTMLButtonElement | null;
    expect(deleteBtn).toBeTruthy();
    expect(exportBtn).toBeTruthy();
    expect(syncBtn).toBeTruthy();

    const deleteTooltip = deleteBtn?.closest('[data-tooltip-content]')?.getAttribute('data-tooltip-content') || '';
    const exportTooltip = exportBtn?.closest('[data-tooltip-content]')?.getAttribute('data-tooltip-content') || '';
    const syncTooltip = syncBtn?.closest('[data-tooltip-content]')?.getAttribute('data-tooltip-content') || '';
    expect(deleteTooltip).toContain('tooltipLoadedVisibleSelectionScope');
    expect(exportTooltip).toContain('tooltipLoadedVisibleSelectionScope');
    expect(syncTooltip).toContain('tooltipLoadedVisibleSelectionScope');
  });

  it('shows select-all as indeterminate until all conversations are selected', async () => {
    currentState = buildState({
      items: [baseConversation(11), baseConversation(22)],
      selectedIds: [11, 22],
      listSummary: { totalCount: 693, todayCount: 2 },
      listHasMore: true,
    });

    await renderPane();
    await act(async () => {
      await flushMicrotasks();
    });

    const selectAllCheckbox = document.getElementById('chkSelectAll') as HTMLInputElement | null;
    expect(selectAllCheckbox).toBeTruthy();
    expect(selectAllCheckbox!.checked).toBe(false);
    expect(selectAllCheckbox!.indeterminate).toBe(true);
  });

  it('re-applies indeterminate state even when it stays true across renders', async () => {
    currentState = buildState({
      items: [baseConversation(11), baseConversation(22)],
      selectedIds: [11, 22],
      listSummary: { totalCount: 693, todayCount: 2 },
      listHasMore: true,
    });

    await renderPane();
    await act(async () => {
      await flushMicrotasks();
    });

    const selectAllCheckbox = document.getElementById('chkSelectAll') as HTMLInputElement | null;
    expect(selectAllCheckbox).toBeTruthy();
    expect(selectAllCheckbox!.indeterminate).toBe(true);

    // Simulate browser clearing the indeterminate UI on click; the component should re-apply it.
    selectAllCheckbox!.indeterminate = false;
    expect(selectAllCheckbox!.indeterminate).toBe(false);

    currentState = buildState({
      items: [baseConversation(11), baseConversation(22), baseConversation(33), baseConversation(44)],
      selectedIds: [11, 22, 33, 44],
      listSummary: { totalCount: 693, todayCount: 4 },
      listHasMore: true,
    });
    await renderPane();
    await act(async () => {
      await flushMicrotasks();
    });

    const nextCheckbox = document.getElementById('chkSelectAll') as HTMLInputElement | null;
    expect(nextCheckbox).toBeTruthy();
    expect(nextCheckbox!.checked).toBe(false);
    expect(nextCheckbox!.indeterminate).toBe(true);
  });

  it('converges pending locate by loading more when target is not in first batch', async () => {
    const consumeListLocate = vi.fn(() => {
      currentState = { ...currentState, pendingListLocateId: null };
      return 33;
    });
    const loadMoreList = vi.fn(async () => {
      currentState = {
        ...currentState,
        items: [...currentState.items, baseConversation(33)],
        listHasMore: false,
      };
    });
    currentState = buildState({
      items: [baseConversation(11), baseConversation(22)],
      pendingListLocateId: 33,
      listHasMore: true,
      loadingInitialList: false,
      loadingMoreList: false,
      loadMoreList,
      consumeListLocate,
    });

    await renderPane();
    expect(loadMoreList).toHaveBeenCalledTimes(1);
    expect(consumeListLocate).toHaveBeenCalledTimes(1);
    expect(loadMoreList.mock.invocationCallOrder[0]).toBeLessThan(consumeListLocate.mock.invocationCallOrder[0]);
  });
});
