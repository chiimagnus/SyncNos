import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

const mocks = vi.hoisted(() => ({
  getConversationListBootstrap: vi.fn(),
  getConversationListPage: vi.fn(),
  findConversationBySourceAndKey: vi.fn(),
  getConversationById: vi.fn(),
  getConversationDetail: vi.fn(),
  deleteConversations: vi.fn(),
  upsertConversation: vi.fn(),
  mergeConversations: vi.fn(),
  backfillConversationImages: vi.fn(),
  buildMarkdown: vi.fn(),
  buildJson: vi.fn(),
  formatExternalMarkdown: vi.fn(),
  writeTextToClipboard: vi.fn(),
  resolveDetailHeaderActions: vi.fn(),
  getEnabledSyncProviders: vi.fn(),
  subscribeDataRevisionChanges: vi.fn(),
  whenDataRevisionObserverReady: vi.fn(),
  requestDataRevisionRetry: vi.fn(),
}));

vi.mock('@services/conversations/client/repo', () => ({
  getConversationListBootstrap: (...args: any[]) => mocks.getConversationListBootstrap(...args),
  getConversationListPage: (...args: any[]) => mocks.getConversationListPage(...args),
  findConversationBySourceAndKey: (...args: any[]) => mocks.findConversationBySourceAndKey(...args),
  getConversationById: (...args: any[]) => mocks.getConversationById(...args),
  getConversationDetail: (...args: any[]) => mocks.getConversationDetail(...args),
  deleteConversations: (...args: any[]) => mocks.deleteConversations(...args),
  upsertConversation: (...args: any[]) => mocks.upsertConversation(...args),
  mergeConversations: (...args: any[]) => mocks.mergeConversations(...args),
  backfillConversationImages: (...args: any[]) => mocks.backfillConversationImages(...args),
}));

vi.mock('@services/sync/local/markdown-export', () => ({
  buildConversationsMarkdownZipExport: (...args: any[]) => mocks.buildMarkdown(...args),
}));

vi.mock('@services/sync/local/json-export', () => ({
  buildConversationsJsonZipExport: (...args: any[]) => mocks.buildJson(...args),
}));

vi.mock('@services/conversations/external-markdown', () => ({
  formatConversationMarkdownForExternalOutput: (...args: any[]) => mocks.formatExternalMarkdown(...args),
}));

vi.mock('@services/shared/clipboard', () => ({
  writeTextToClipboard: (...args: any[]) => mocks.writeTextToClipboard(...args),
}));

vi.mock('@services/data-revisions/observer', () => ({
  subscribeDataRevisionChanges: (...args: any[]) => mocks.subscribeDataRevisionChanges(...args),
  whenDataRevisionObserverReady: () => mocks.whenDataRevisionObserverReady(),
  requestDataRevisionRetry: (...args: any[]) => mocks.requestDataRevisionRetry(...args),
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
  resolveDetailHeaderActions: (...args: any[]) => mocks.resolveDetailHeaderActions(...args),
  hasDetailHeaderActionStorageDependencyChange: () => false,
}));

vi.mock('@services/sync/sync-provider-gate', () => ({
  getEnabledSyncProviders: () => mocks.getEnabledSyncProviders(),
  hasSyncProviderEnabledStorageChange: () => false,
}));

vi.mock('@services/shared/storage', () => ({
  storageOnChanged: () => () => {},
}));

vi.mock('@i18n', () => ({
  t: (key: string) => key,
}));

import { ConversationsProvider, useConversationsApp } from '@viewmodels/conversations/conversations-context';

function conversation(id: number) {
  return {
    id,
    source: 'chatgpt',
    conversationKey: `chat-${id}`,
    title: `Chat ${id}`,
    url: `https://example.com/${id}`,
    lastCapturedAt: 1_700_000_000_000 + id,
  };
}

function page() {
  return {
    items: [conversation(1), conversation(2)],
    cursor: null,
    hasMore: false,
    summary: { totalCount: 2, todayCount: 2 },
    facets: { sources: [], sites: [] },
  };
}

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

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLAnchorElement', { configurable: true, value: dom.window.HTMLAnchorElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).HTMLAnchorElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  delete (globalThis as any).alert;
}

let latestState: any = null;
function Probe() {
  latestState = useConversationsApp();
  return null;
}

describe('ConversationsProvider selected export wiring', () => {
  let root: ReactDOM.Root | null = null;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let anchorClick: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    latestState = null;
    vi.clearAllMocks();

    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.subscribeDataRevisionChanges.mockReturnValue(() => {});
    mocks.getConversationListBootstrap.mockResolvedValue(page());
    mocks.getConversationListPage.mockResolvedValue({ ...page(), items: [] });
    mocks.getConversationById.mockImplementation(async (id: number) => conversation(Number(id)));
    mocks.getConversationDetail.mockImplementation(async (id: number) => ({ conversationId: id, messages: [] }));
    mocks.resolveDetailHeaderActions.mockResolvedValue([]);
    mocks.getEnabledSyncProviders.mockResolvedValue([]);
    mocks.formatExternalMarkdown.mockResolvedValue('# markdown\n');
    mocks.writeTextToClipboard.mockResolvedValue(true);
    mocks.deleteConversations.mockResolvedValue(null);
    mocks.upsertConversation.mockResolvedValue({});
    mocks.mergeConversations.mockResolvedValue({});
    mocks.backfillConversationImages.mockResolvedValue({});

    createObjectURL = vi.fn(() => 'blob:export-test');
    revokeObjectURL = vi.fn();
    Object.defineProperty(globalThis.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;
    anchorClick.mockRestore();
    cleanupDom();
  });

  async function renderProvider() {
    await act(async () => {
      root!.render(createElement(ConversationsProvider, null, createElement(Probe)));
      await flushMicrotasks();
    });
    expect((latestState.items as any[]).map((item) => item.id)).toEqual([1, 2]);
  }

  it('exports only the selected conversation and completes the JSON download lifecycle', async () => {
    await renderProvider();
    await act(async () => {
      latestState.toggleSelected(2);
      await flushMicrotasks();
    });
    expect(latestState.selectedIds).toEqual([2]);

    const pending = deferred<{ zipBlob: Blob; filename: string }>();
    const zipBlob = new Blob(['json-zip'], { type: 'application/zip' });
    mocks.buildJson.mockReturnValue(pending.promise);
    vi.useFakeTimers();

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = latestState.exportSelectedJson();
      await flushMicrotasks();
    });
    expect(latestState.exporting).toBe(true);
    expect(mocks.buildJson).toHaveBeenCalledWith({ conversations: [expect.objectContaining({ id: 2 })] });
    expect(mocks.buildMarkdown).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ zipBlob, filename: 'SyncNos-json-test.zip' });
      await exportPromise;
      await flushMicrotasks();
    });
    expect(latestState.exporting).toBe(false);
    expect(createObjectURL).toHaveBeenCalledWith(zipBlob);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    const clickedAnchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(clickedAnchor.download).toBe('SyncNos-json-test.zip');
    expect(clickedAnchor.href).toBe('blob:export-test');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await flushMicrotasks();
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export-test');
  });

  it('restores exporting state and alerts when JSON building fails', async () => {
    await renderProvider();
    await act(async () => {
      latestState.toggleSelected(1);
      await flushMicrotasks();
    });
    const alertSpy = vi.fn();
    Object.defineProperty(globalThis, 'alert', { configurable: true, value: alertSpy });
    mocks.buildJson.mockRejectedValue(new Error('json failed'));

    await act(async () => {
      await latestState.exportSelectedJson();
      await flushMicrotasks();
    });

    expect(latestState.exporting).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith('json failed');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('keeps Markdown isolated and leaves both builders untouched for an empty selection', async () => {
    await renderProvider();
    await act(async () => {
      await latestState.exportSelectedJson();
      await latestState.exportSelectedMarkdown();
      await flushMicrotasks();
    });
    expect(mocks.buildJson).not.toHaveBeenCalled();
    expect(mocks.buildMarkdown).not.toHaveBeenCalled();

    const markdownBlob = new Blob(['markdown-zip'], { type: 'application/zip' });
    mocks.buildMarkdown.mockResolvedValue({ zipBlob: markdownBlob, filename: 'SyncNos-md-test.zip' });
    await act(async () => {
      latestState.toggleSelected(1);
      await flushMicrotasks();
    });
    await act(async () => {
      await latestState.exportSelectedMarkdown();
      await flushMicrotasks();
    });

    expect(mocks.buildMarkdown).toHaveBeenCalledWith({ conversations: [expect.objectContaining({ id: 1 })] });
    expect(mocks.buildJson).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(markdownBlob);
  });
});
