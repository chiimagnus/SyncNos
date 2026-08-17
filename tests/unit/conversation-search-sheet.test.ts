import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationSearchSheet } from '@ui/conversations/ConversationSearchSheet';
import { splitSearchSnippetHighlights } from '@ui/conversations/search-highlight';
import type { ConversationSearchSheetController } from '@viewmodels/conversations/search-sheet-types';

const resultItem = {
  backendConversationId: 77,
  source: 'chatgpt',
  conversationKey: 'stable-key',
  sourceType: 'chat',
  title: 'Search result',
  url: '',
  siteKey: 'unknown',
  score: -1,
  lastCapturedAt: 123,
  snippet: 'A😀 Café <img src=x onerror=alert(1)>',
  highlights: [{ start: 1, end: 3 }],
} as const;

const resultState = {
  cursor: { literal: 'Café', token: 'next' },
  factsRevision: 8,
  facets: { sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 1 }], sites: [] },
  hasMore: true,
  items: [resultItem],
  submitted: { query: 'Café', sourceKey: 'all', siteKey: 'all', sort: 'best' as const },
  truncatedByScanLimit: false,
};

function makeController(overrides: Partial<ConversationSearchSheetController> = {}): ConversationSearchSheetController {
  return {
    mode: 'search',
    draft: { query: 'Café', sourceKey: 'all', siteKey: 'all', sort: 'best' },
    result: resultState,
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
    submit: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    selectResult: vi.fn(async () => {}),
    clearPreview: vi.fn(),
    markResultsStale: vi.fn(),
    captureRevisionStaleGuard: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

function setupDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body><button id="trigger">Search trigger</button><button id="destination">Destination</button><div id="root"></div></body></html>',
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
    Node: dom.window.Node,
    KeyboardEvent: dom.window.KeyboardEvent,
    PointerEvent: dom.window.PointerEvent ?? dom.window.MouseEvent,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
    configurable: true,
    value: () => {},
  });
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

describe('ConversationSearchSheet', () => {
  let root: ReactDOM.Root;
  let controller: ConversationSearchSheetController;
  const onClose = vi.fn();
  const onOpenSettings = vi.fn();
  const onOpenFullConversation = vi.fn();

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    controller = makeController();
    onClose.mockReset();
    onOpenSettings.mockReset();
    onOpenFullConversation.mockReset();
    (document.getElementById('trigger') as HTMLButtonElement).focus();
  });

  afterEach(async () => {
    act(() => root.unmount());
    await flush();
    cleanupDom();
  });

  function renderSheet(next = controller) {
    controller = next;
    act(() => {
      root.render(
        createElement(ConversationSearchSheet, {
          controller,
          initialFacets: {
            sources: [{ key: 'chatgpt', label: 'ChatGPT', count: 4 }],
            sites: [{ key: 'domain:example.test', label: 'example.test', count: 2 }],
          },
          onClose,
          onOpenSettings,
          onOpenFullConversation,
        }),
      );
    });
  }

  it('validates UTF-16 half-open highlights and falls back when an offset splits a surrogate pair', () => {
    expect(splitSearchSnippetHighlights('A😀B', [{ start: 1, end: 3 }])).toEqual([
      { highlighted: false, text: 'A' },
      { highlighted: true, text: '😀' },
      { highlighted: false, text: 'B' },
    ]);
    expect(splitSearchSnippetHighlights('A😀B', [{ start: 2, end: 3 }])).toEqual([
      { highlighted: false, text: 'A😀B' },
    ]);
  });

  it('renders one modal, autofocuses query, escapes snippet markup, selects results and exposes explicit pagination', async () => {
    renderSheet();
    await act(async () => flush());
    expect(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1);
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/search query/i);
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelectorAll('mark')).toHaveLength(1);

    const result = document.querySelector('[role="option"]') as HTMLButtonElement;
    act(() => result.click());
    expect(controller.selectResult).toHaveBeenCalledWith(resultItem);

    const loadMore = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Load more'),
    )!;
    act(() => (loadMore as HTMLButtonElement).click());
    expect(controller.loadMore).toHaveBeenCalledTimes(1);
  });

  it('traps Tab, closes on Escape/backdrop, and restores the opening trigger after unmount', async () => {
    renderSheet();
    await act(async () => flush());
    const close = document.querySelector('[aria-label="Close local search"]') as HTMLButtonElement;
    close.focus();
    act(() =>
      close.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).not.toBe(close);

    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    const backdrop = document.querySelector('[data-conversation-search-backdrop]') as HTMLElement;
    act(() =>
      backdrop.dispatchEvent(new (globalThis.PointerEvent as any)('pointerdown', { bubbles: true, cancelable: true })),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    await act(async () => flush());
    expect(document.activeElement).toBe(document.getElementById('trigger'));
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  it('keeps the disabled state actionable and leaves navigation focus owned by Backup settings', async () => {
    const destination = document.getElementById('destination') as HTMLButtonElement;
    onOpenSettings.mockImplementationOnce(() => destination.focus());
    renderSheet(makeController({ mode: 'disabled', result: null }));
    await act(async () => flush());
    expect(document.body.textContent).toContain('Local search requires Local Database');
    const button = [...document.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Local Database settings'),
    )!;
    act(() => (button as HTMLButtonElement).click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    await act(async () => flush());
    expect(document.activeElement).toBe(destination);
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  it('shows typed FTS/busy errors and leaves full-conversation navigation focus with the destination', async () => {
    const destination = document.getElementById('destination') as HTMLButtonElement;
    onOpenFullConversation.mockImplementationOnce(() => destination.focus());
    renderSheet(
      makeController({
        searchError: 'raw host error',
        searchErrorCode: 'FTS_UNAVAILABLE',
        preview: {
          loading: false,
          error: null,
          reference: { source: 'chatgpt', conversationKey: 'stable-key' },
          detail: {
            conversationId: 77,
            source: 'chatgpt',
            conversationKey: 'stable-key',
            factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
            messages: [{ id: 1, conversationId: 77, messageKey: 'm1', role: 'user', contentText: 'full message' }],
          },
        },
      }),
    );
    await act(async () => flush());
    expect(document.body.textContent).toContain('Full-text search is unavailable');
    expect(document.body.textContent).toContain('full message');
    const open = [...document.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Open full conversation'),
    )!;
    act(() => (open as HTMLButtonElement).click());
    expect(onOpenFullConversation).toHaveBeenCalledWith(resultItem);
    act(() => root.unmount());
    await act(async () => flush());
    expect(document.activeElement).toBe(destination);
    root = ReactDOM.createRoot(document.getElementById('root')!);

    renderSheet(makeController({ searchError: 'busy', searchErrorCode: 'MIGRATION_IN_PROGRESS' }));
    expect(document.body.textContent).toContain('migration is in progress');
  });
});
