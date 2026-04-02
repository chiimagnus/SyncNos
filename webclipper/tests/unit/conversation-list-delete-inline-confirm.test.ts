import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationListPane } from '../../src/ui/conversations/ConversationListPane';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
  formatConversationTitle: (text: string) => text,
}));

const deleteSelected = vi.fn();

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    items: [
      {
        id: 11,
        title: 'First chat',
        source: 'gemini',
        conversationKey: 'conv-11',
        commentThreadCount: 3,
        lastCapturedAt: Date.now(),
        url: 'https://example.com/chat/11',
      },
    ],
    activeId: 11,
    selectedIds: [11],
    toggleAll: vi.fn(),
    toggleSelected: vi.fn(),
    setActiveId: vi.fn(),
    clearSelected: vi.fn(),
    openConversationExternalById: vi.fn(),
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
    listSourceFilterKey: 'all',
    listSiteFilterKey: 'all',
    setListSourceFilterKeyPersistent: vi.fn(),
    setListSiteFilterKeyPersistent: vi.fn(),
    pendingListLocateId: null,
    consumeListLocate: vi.fn(),
    exportSelectedMarkdown: vi.fn(),
    syncSelectedNotion: vi.fn(),
    syncSelectedObsidian: vi.fn(),
    clearSyncFeedback: vi.fn(),
    deleteSelected,
  }),
}));

vi.mock('../../src/services/sync/sync-provider-gate', () => ({
  getEnabledSyncProviders: () => Promise.resolve(['obsidian', 'notion']),
  syncProviderEnabledStorageKey: (provider: string) => `sync_provider_enabled.${provider}`,
}));

vi.mock('../../src/services/shared/storage', () => ({
  storageOnChanged: () => () => {},
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

describe('ConversationListPane delete button inline confirmation', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    deleteSelected.mockReset();
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

  it('arms delete on first click and deletes on second click', async () => {
    await act(async () => {
      root!.render(createElement(ConversationListPane));
      await flushMicrotasks();
    });

    const btn = document.getElementById('btnDelete') as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toContain('deleteButton');
    expect(btn!.textContent).toContain('×');
    expect(btn!.className).toContain('webclipper-btn--danger-tint');

    await act(async () => {
      btn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(deleteSelected).toHaveBeenCalledTimes(0);
    expect(btn!.textContent).toContain('deleteButton');
    expect(btn!.textContent).not.toContain('×');
    expect(btn!.className).toContain('webclipper-btn--danger');

    await act(async () => {
      btn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(deleteSelected).toHaveBeenCalledTimes(1);
  });

  it('cancels armed delete on Escape and outside click', async () => {
    await act(async () => {
      root!.render(createElement(ConversationListPane));
      await flushMicrotasks();
    });

    const btn = document.getElementById('btnDelete') as HTMLButtonElement | null;
    expect(btn).toBeTruthy();

    await act(async () => {
      btn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(btn!.textContent).toContain('deleteButton');
    expect(btn!.textContent).not.toContain('×');

    const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => {
      document.dispatchEvent(escape);
      await flushMicrotasks();
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(btn!.textContent).toContain('deleteButton');
    expect(btn!.textContent).toContain('×');

    await act(async () => {
      btn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(btn!.textContent).toContain('deleteButton');
    expect(btn!.textContent).not.toContain('×');

    await act(async () => {
      document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(btn!.textContent).toContain('deleteButton');
    expect(btn!.textContent).toContain('×');
    expect(deleteSelected).toHaveBeenCalledTimes(0);
  });

  it('renders comment thread chip when count is greater than zero', async () => {
    await act(async () => {
      root!.render(createElement(ConversationListPane));
      await flushMicrotasks();
    });

    expect(document.body.textContent || '').toContain('💬');
    expect(document.body.textContent || '').toContain('3');
  });
});
