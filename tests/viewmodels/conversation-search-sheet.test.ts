import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationSearchSheet } from '@viewmodels/conversations/useConversationSearchSheet';
import type { ConversationSearchSheetController } from '@viewmodels/conversations/search-sheet-types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const firstPage = {
  cursor: { literal: 'hello', token: 'page-2' },
  factsRevision: 7,
  facets: { sources: [{ key: 'chatgpt', label: 'chatgpt', count: 2 }], sites: [] },
  hasMore: true,
  items: [
    {
      backendConversationId: 10,
      source: 'chatgpt',
      conversationKey: 'stable-1',
      sourceType: 'chat',
      title: 'First',
      url: '',
      siteKey: 'unknown',
      score: null,
      lastCapturedAt: 10,
      snippet: 'hello',
      highlights: [{ start: 0, end: 5 }],
    },
  ],
  truncatedByScanLimit: false,
} as const;

function setupDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div><input id="editor" /><textarea id="notes"></textarea><div id="rich-editor" contenteditable="true"><span id="rich-editor-child">draft</span></div></body></html>',
    {
    url: 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/app.html',
      pretendToBeVisual: true,
    },
  );
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    Node: dom.window.Node,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  for (const key of [
    'window',
    'document',
    'navigator',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'KeyboardEvent',
    'Node',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    delete (globalThis as any)[key];
  }
}

describe('conversation search sheet viewmodel', () => {
  let root: ReactDOM.Root;
  let latest: ConversationSearchSheetController;
  let sourceKey = 'web';
  let siteKey = 'domain:example.test';
  const client = {
    getCapability: vi.fn(),
    search: vi.fn(),
    preview: vi.fn(),
  };

  function Harness() {
    latest = useConversationSearchSheet({
      listSourceFilterKey: sourceKey,
      listSiteFilterKey: siteKey,
      dependencies: {
        client: client as any,
        createRequestId: (sequence) => `req-${sequence}`,
      },
    });
    return null;
  }

  async function render() {
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });
  }

  beforeEach(async () => {
    setupDom();
    sourceKey = 'web';
    siteKey = 'domain:example.test';
    client.getCapability.mockReset().mockResolvedValue({ searchable: true });
    client.search.mockReset().mockResolvedValue({ requestId: 'req-1', page: firstPage });
    client.preview.mockReset().mockResolvedValue({
      conversationId: 99,
      source: 'chatgpt',
      conversationKey: 'stable-1',
      factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
      messages: [],
    });
    root = ReactDOM.createRoot(document.getElementById('root')!);
    await render();
  });

  afterEach(async () => {
    act(() => root.unmount());
    await Promise.resolve();
    cleanupDom();
  });

  it('copies current list filters only when opened and uses capability without searching', async () => {
    sourceKey = 'chatgpt';
    siteKey = 'domain:should-be-ignored.test';
    await render();

    await act(async () => {
      await latest.openLocalSearch();
    });
    expect(latest.mode).toBe('search');
    expect(latest.draft).toEqual({ query: '', sourceKey: 'chatgpt', siteKey: 'all', sort: 'best' });
    expect(client.getCapability).toHaveBeenCalledTimes(1);
    expect(client.search).not.toHaveBeenCalled();

    act(() => latest.close());
    sourceKey = 'web';
    siteKey = 'domain:new.test';
    await render();
    await act(async () => latest.openLocalSearch());
    expect(latest.draft.siteKey).toBe('domain:new.test');
  });

  it('opens an explanation state when Local Database is not active and never searches', async () => {
    client.getCapability.mockResolvedValue({ searchable: false });
    await act(async () => latest.openLocalSearch());
    expect(latest.mode).toBe('disabled');
    expect(client.search).not.toHaveBeenCalled();
    await act(async () => latest.submit());
    expect(client.search).not.toHaveBeenCalled();
  });

  it('keeps draft edits local and sends only an explicit submit', async () => {
    await act(async () => latest.openLocalSearch());
    act(() => {
      latest.setQuery('hello');
      latest.setSourceKey('chatgpt');
      latest.setSiteKey('domain:ignored.test');
      latest.setSort('recent');
    });
    expect(client.search).not.toHaveBeenCalled();
    expect(latest.draft).toEqual({ query: 'hello', sourceKey: 'chatgpt', siteKey: 'all', sort: 'recent' });

    await act(async () => latest.submit());
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(client.search).toHaveBeenCalledWith({
      requestId: 'req-1',
      query: 'hello',
      sourceKey: 'chatgpt',
      siteKey: 'all',
      sort: 'recent',
    });
  });

  it('invalidates pagination on any draft change and never auto-resubmits', async () => {
    await act(async () => latest.openLocalSearch());
    act(() => latest.setQuery('hello'));
    await act(async () => latest.submit());
    expect(latest.result?.cursor).toEqual({ literal: 'hello', token: 'page-2' });

    act(() => latest.setSort('recent'));
    expect(latest.result?.cursor).toBeNull();
    expect(latest.result?.hasMore).toBe(false);
    expect(client.search).toHaveBeenCalledTimes(1);
  });

  it('ignores an in-flight load-more page after the draft changes', async () => {
    await act(async () => latest.openLocalSearch());
    act(() => latest.setQuery('hello'));
    await act(async () => latest.submit());
    const pending = deferred<any>();
    client.search.mockImplementationOnce(() => pending.promise);
    let loadPromise!: Promise<void>;
    await act(async () => {
      loadPromise = latest.loadMore();
      await Promise.resolve();
    });
    act(() => latest.setSort('recent'));
    expect(latest.result?.cursor).toBeNull();
    expect(latest.searchLoading).toBe(false);

    pending.resolve({
      requestId: 'req-2',
      page: {
        ...firstPage,
        cursor: null,
        hasMore: false,
        items: [{ ...firstPage.items[0], conversationKey: 'late-page' }],
      },
    });
    await act(async () => loadPromise);
    expect(latest.result?.items).toEqual(firstPage.items);
    expect(latest.result?.cursor).toBeNull();
  });

  it('keeps existing results on STALE_SEARCH_CURSOR and requires explicit resubmit', async () => {
    await act(async () => latest.openLocalSearch());
    act(() => latest.setQuery('hello'));
    await act(async () => latest.submit());
    const stale = Object.assign(new Error('changed'), { code: 'STALE_SEARCH_CURSOR' });
    client.search.mockRejectedValueOnce(stale);

    await act(async () => latest.loadMore());
    expect(latest.cursorStale).toBe(true);
    expect(latest.result?.items).toEqual(firstPage.items);
    expect(latest.result?.cursor).toBeNull();
    expect(client.search).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(client.search).toHaveBeenCalledTimes(2);
  });

  it('marks focus-refreshed results stale without auto-searching and only clears the notice on explicit resubmit', async () => {
    await act(async () => latest.openLocalSearch());
    act(() => latest.setQuery('hello'));
    await act(async () => latest.submit());
    await act(async () => latest.selectResult(firstPage.items[0] as any));
    expect(latest.preview.detail).not.toBeNull();

    act(() => latest.markResultsStale());
    expect(latest.cursorStale).toBe(true);
    expect(latest.result?.items).toEqual(firstPage.items);
    expect(latest.result?.cursor).toBeNull();
    expect(latest.result?.hasMore).toBe(false);
    expect(latest.preview).toMatchObject({ loading: false, detail: null, reference: null });
    expect(client.search).toHaveBeenCalledTimes(1);

    client.search.mockResolvedValueOnce({ requestId: 'req-2', page: { ...firstPage, cursor: null, hasMore: false } });
    await act(async () => latest.submit());
    expect(client.search).toHaveBeenCalledTimes(2);
    expect(latest.cursorStale).toBe(false);
  });

  it('does not let a late focus-revision guard stale a newer explicit submit', async () => {
    await act(async () => latest.openLocalSearch());
    act(() => latest.setQuery('hello'));
    await act(async () => latest.submit());
    const lateFocusGuard = latest.captureRevisionStaleGuard();

    client.search.mockResolvedValueOnce({
      requestId: 'req-2',
      page: { ...firstPage, factsRevision: 8, cursor: null, hasMore: false },
    });
    await act(async () => latest.submit());
    expect(latest.result?.factsRevision).toBe(8);
    expect(latest.cursorStale).toBe(false);

    act(() => lateFocusGuard());
    expect(latest.result?.factsRevision).toBe(8);
    expect(latest.cursorStale).toBe(false);
    expect(client.search).toHaveBeenCalledTimes(2);
  });

  it('lets a newer explicit submit supersede an older response', async () => {
    await act(async () => latest.openLocalSearch());
    const first = deferred<any>();
    client.search
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({
        requestId: 'req-2',
        page: { ...firstPage, cursor: null, hasMore: false, items: [{ ...firstPage.items[0], title: 'New' }] },
      });
    act(() => latest.setQuery('old'));
    let oldPromise!: Promise<void>;
    await act(async () => {
      oldPromise = latest.submit();
      await Promise.resolve();
    });
    act(() => latest.setQuery('new'));
    await act(async () => latest.submit());
    expect(latest.result?.items[0]?.title).toBe('New');

    first.resolve({ requestId: 'req-1', page: { ...firstPage, items: [{ ...firstPage.items[0], title: 'Old' }] } });
    await act(async () => oldPromise);
    expect(latest.result?.items[0]?.title).toBe('New');
  });

  it('ignores a late preview after close', async () => {
    await act(async () => latest.openLocalSearch());
    const pending = deferred<any>();
    client.preview.mockImplementationOnce(() => pending.promise);
    let previewPromise!: Promise<void>;
    await act(async () => {
      previewPromise = latest.selectResult(firstPage.items[0] as any);
      await Promise.resolve();
    });
    expect(latest.preview.loading).toBe(true);
    act(() => latest.close());
    pending.resolve({ conversationId: 1, messages: [] });
    await act(async () => previewPromise);
    expect(latest.mode).toBe('closed');
    expect(latest.preview).toMatchObject({ loading: false, detail: null, reference: null });
  });

  it('handles Cmd/Ctrl+K only for the focused SyncNos document and ignores IME/editable targets', async () => {
    const dispatch = async (target: EventTarget, init: KeyboardEventInit) => {
      await act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...init }));
        await Promise.resolve();
      });
    };

    await dispatch(document.body, { ctrlKey: true, isComposing: true } as any);
    await dispatch(document.getElementById('editor')!, { metaKey: true });
    await dispatch(document.getElementById('notes')!, { ctrlKey: true });
    await dispatch(document.getElementById('rich-editor')!, { metaKey: true });
    await dispatch(document.getElementById('rich-editor-child')!, { ctrlKey: true });
    expect(client.getCapability).not.toHaveBeenCalled();
    expect(client.search).not.toHaveBeenCalled();

    await dispatch(document.body, { ctrlKey: true });
    expect(client.getCapability).toHaveBeenCalledTimes(1);
    expect(latest.mode).toBe('search');

    await dispatch(document.body, { metaKey: true });
    expect(client.getCapability).toHaveBeenCalledTimes(1);
    expect(client.search).not.toHaveBeenCalled();
  });
});
