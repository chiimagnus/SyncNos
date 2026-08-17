import { act, createElement, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationSearchSheet } from '@ui/conversations/ConversationSearchSheet';
import type { ConversationSearchSheetController } from '@viewmodels/conversations/search-sheet-types';

const first = {
  backendConversationId: 11,
  source: 'chatgpt',
  conversationKey: 'first',
  sourceType: 'chat',
  title: 'First result',
  url: '',
  siteKey: 'unknown',
  score: -2,
  lastCapturedAt: 10,
  snippet: 'first result',
  highlights: [{ start: 0, end: 5 }],
} as const;

const second = {
  ...first,
  backendConversationId: 22,
  conversationKey: 'second',
  title: 'Second result',
  lastCapturedAt: 20,
  snippet: 'second result',
  highlights: [{ start: 0, end: 6 }],
} as const;

const result = {
  cursor: null,
  factsRevision: 4,
  facets: { sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 2 }], sites: [] },
  hasMore: false,
  items: [first, second],
  submitted: { query: 'result', sourceKey: 'all', siteKey: 'all', sort: 'best' as const },
  truncatedByScanLimit: false,
};

function setupDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body><button id="trigger">trigger</button><div id="root"></div></body></html>',
    {
      url: 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/app.html',
      pretendToBeVisual: true,
    },
  );
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, writable: true, value: 390 });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Node: dom.window.Node,
    KeyboardEvent: dom.window.KeyboardEvent,
    PointerEvent: dom.window.PointerEvent ?? dom.window.MouseEvent,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', { configurable: true, value: () => {} });
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
    'Node',
    'KeyboardEvent',
    'PointerEvent',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    delete (globalThis as any)[key];
  }
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('ConversationSearchSheet narrow flow', () => {
  let root: ReactDOM.Root;
  const onClose = vi.fn();
  const onOpenFullConversation = vi.fn();

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    onClose.mockReset();
    onOpenFullConversation.mockReset();
    (document.getElementById('trigger') as HTMLButtonElement).focus();
  });

  afterEach(async () => {
    act(() => root.unmount());
    await flush();
    cleanupDom();
  });

  function Harness() {
    const [preview, setPreview] = useState<ConversationSearchSheetController['preview']>({
      detail: null,
      error: null,
      loading: false,
      reference: null,
    });
    const controller: ConversationSearchSheetController = {
      mode: 'search',
      draft: { query: 'result', sourceKey: 'all', siteKey: 'all', sort: 'best' },
      result,
      searchError: null,
      searchErrorCode: null,
      searchLoading: false,
      capabilityLoading: false,
      cursorStale: false,
      preview,
      openLocalSearch: vi.fn(async () => {}),
      close: vi.fn(),
      setQuery: vi.fn(),
      setSourceKey: vi.fn(),
      setSiteKey: vi.fn(),
      setSort: vi.fn(),
      submit: vi.fn(async () => {}),
      loadMore: vi.fn(async () => {}),
      selectResult: async (selected) => {
        setPreview({
          loading: false,
          error: null,
          reference: { source: selected.source, conversationKey: selected.conversationKey },
          detail: {
            conversationId: selected.backendConversationId,
            source: selected.source,
            conversationKey: selected.conversationKey,
            factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
            messages: [
              {
                id: 1,
                conversationId: selected.backendConversationId,
                messageKey: 'm1',
                role: 'user',
                contentText: `full ${selected.conversationKey}`,
              },
            ],
          },
        });
      },
      clearPreview: vi.fn(),
    };
    return createElement(ConversationSearchSheet, {
      controller,
      initialFacets: { sources: [], sites: [] },
      onClose,
      onOpenSettings: vi.fn(),
      onOpenFullConversation,
    });
  }

  it('keeps results mounted with scroll/selection while preview is shown and restores selected-result focus on Back', async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await flush();
    });
    const resultsPane = document.querySelector('[data-conversation-search-narrow-results]') as HTMLElement;
    const previewPane = document.querySelector('[data-conversation-search-narrow-preview]') as HTMLElement;
    const scrollRoot = resultsPane.querySelector('.tw-overflow-y-auto') as HTMLElement;
    expect(resultsPane.hidden).toBe(false);
    expect(previewPane.hidden).toBe(true);
    scrollRoot.scrollTop = 137;

    const options = [...document.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
    await act(async () => {
      options[1].click();
      await flush();
    });
    expect(document.querySelector('[data-conversation-search-narrow-results]')).toBe(resultsPane);
    expect(document.querySelector('[data-conversation-search-narrow-preview]')).toBe(previewPane);
    expect(resultsPane.hidden).toBe(true);
    expect(previewPane.hidden).toBe(false);
    expect(scrollRoot.scrollTop).toBe(137);
    expect(document.body.textContent).toContain('full second');
    expect(document.activeElement).toBe(document.querySelector('[data-conversation-search-preview-back]'));

    const back = document.querySelector('[data-conversation-search-preview-back]') as HTMLButtonElement;
    await act(async () => {
      back.click();
      await flush();
    });
    expect(resultsPane.hidden).toBe(false);
    expect(previewPane.hidden).toBe(true);
    expect(scrollRoot.scrollTop).toBe(137);
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
  });

  it('closes from preview with Escape and opens the explicit full-conversation action only on user request', async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await flush();
    });
    const option = [...document.querySelectorAll('[role="option"]')][0] as HTMLButtonElement;
    await act(async () => {
      option.click();
      await flush();
    });
    const open = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open full conversation'),
    )!;
    act(() => (open as HTMLButtonElement).click());
    expect(onOpenFullConversation).toHaveBeenCalledWith(first);

    const back = document.querySelector('[data-conversation-search-preview-back]') as HTMLButtonElement;
    act(() => back.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
