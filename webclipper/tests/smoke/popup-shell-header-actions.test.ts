import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';

vi.mock('../../src/platform/runtime/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/platform/runtime/runtime')>();
  return {
    ...actual,
    getURL: (path: string) => path,
  };
});

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsCreate: vi.fn(),
}));

vi.mock('../../src/ui/shared/AppTooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/shared/AppTooltip')>();
  return {
    ...actual,
    AppTooltipHost: () => null,
  };
});

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  ConversationsProvider: ({ children }: { children: ReactNode }) => children,
  useConversationsApp: () => ({
    items: [],
    activeId: null,
    selectedIds: [],
    toggleAll: vi.fn(),
    toggleSelected: vi.fn(),
    setActiveId: vi.fn(),
    clearSelected: vi.fn(),
    openConversationExternalByLoc: vi.fn(),
    openConversationExternalBySourceKey: vi.fn(),
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
    deleteSelected: vi.fn(),
    refreshList: vi.fn(),
    refreshActiveDetail: vi.fn(),
  }),
}));

vi.mock('../../src/viewmodels/popup/usePopupCurrentPageCapture', () => ({
  usePopupCurrentPageCapture: () => ({
    buttonDisabled: false,
    buttonLabel: 'Fetch AI Chat',
    capture: vi.fn(),
    captureState: { available: true, kind: 'chat', label: 'Fetch AI Chat', collectorId: 'chatgpt' },
    checking: false,
    fetching: false,
    refreshState: vi.fn(),
    status: null,
  }),
}));

vi.mock('../../src/ui/conversations/ConversationsScene', () => ({
  ConversationsScene: (props: { onPopupHeaderStateChange?: (state: any) => void }) =>
    createElement(
      'div',
      null,
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            props.onPopupHeaderStateChange?.({ mode: 'list' });
          },
        },
        'show-list',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            props.onPopupHeaderStateChange?.({
              mode: 'detail',
              title: 'Conversation',
              subtitle: 'chatgpt · key',
              actions: [
                {
                  id: 'open-in-notion',
                  label: 'Open in Notion',
                  kind: 'external-link',
                  provider: 'notion',
                  slot: 'open',
                  href: 'https://www.notion.so/example',
                  onTrigger: vi.fn(async () => {}),
                },
              ],
              onBack: () => {
                props.onPopupHeaderStateChange?.({ mode: 'list' });
              },
            });
          },
        },
        'show-detail',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            props.onPopupHeaderStateChange?.({
              mode: 'detail',
              title: 'Conversation',
              subtitle: 'chatgpt · key',
              actions: [],
              onBack: () => {
                props.onPopupHeaderStateChange?.({ mode: 'list' });
              },
            });
          },
        },
        'show-detail-empty',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            props.onPopupHeaderStateChange?.({
              mode: 'detail',
              title: 'Conversation',
              subtitle: 'chatgpt · key',
              actions: [
                {
                  id: 'open-in-notion',
                  label: 'Open in Notion',
                  provider: 'notion',
                  kind: 'external-link',
                  slot: 'open',
                  href: 'https://www.notion.so/example',
                  onTrigger: vi.fn(async () => {}),
                },
                {
                  id: 'open-in-obsidian',
                  label: 'Open in Obsidian',
                  provider: 'obsidian',
                  kind: 'open-target',
                  slot: 'open',
                  onTrigger: vi.fn(async () => {}),
                },
              ],
              onBack: () => {
                props.onPopupHeaderStateChange?.({ mode: 'list' });
              },
            });
          },
        },
        'show-detail-menu',
      ),
    ),
}));

import PopupShell from '../../src/ui/popup/PopupShell';

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
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: dom.window.CustomEvent,
  });
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
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).Event;
  delete (globalThis as any).CustomEvent;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('PopupShell header actions', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('shows fetch and settings in list mode, then swaps to Open in Notion in detail mode', () => {
    act(() => {
      root!.render(createElement(PopupShell));
    });

    expect(document.querySelector('[aria-label="Fetch AI Chat"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open Settings"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();

    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Fetch AI Chat"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Open Settings"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="More actions coming soon"]')).toBeFalsy();
  });

  it('keeps the popup detail header action area empty when no actions are available', () => {
    act(() => {
      root!.render(createElement(PopupShell));
    });

    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail-empty',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Fetch AI Chat"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Open Settings"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="More actions coming soon"]')).toBeFalsy();
  });

  it('shows a menu trigger in popup detail mode when multiple destinations exist', () => {
    act(() => {
      root!.render(createElement(PopupShell));
    });

    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail-menu',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Open destinations"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
  });
});
