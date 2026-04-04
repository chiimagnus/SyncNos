import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { encodeConversationLoc } from '../../src/services/shared/conversation-loc';
import type { ReactNode } from 'react';

const { responsiveTierState } = vi.hoisted(() => ({
  responsiveTierState: { value: 'wide' as 'narrow' | 'medium' | 'wide' },
}));

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => {
    const labels: Record<string, string> = {
      collapseSidebar: 'Collapse sidebar',
      expandSidebar: 'Expand sidebar',
    };
    return labels[key] || key;
  },
}));

vi.mock('../../src/ui/shared/hooks/useResponsiveTier', () => ({
  useResponsiveTier: () => responsiveTierState.value,
}));

vi.mock('../../src/ui/shared/AppTooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/shared/AppTooltip')>();
  return {
    ...actual,
    AppTooltipHost: () => null,
  };
});

vi.mock('../../src/ui/app/routes/Settings', () => ({
  default: () => createElement('div', null, 'settings'),
}));
vi.mock('../../src/ui/conversations/ConversationsScene', () => ({
  ConversationsScene: (props: {
    listShell?: { rightSlot?: ReactNode };
    wideDetail?: ReactNode;
    wideHideList?: boolean;
  }) =>
    createElement(
      'div',
      null,
      props.wideHideList ? null : createElement('div', null, props.listShell?.rightSlot ?? null),
      props.wideDetail ?? null,
    ),
}));

const openConversationExternalByLoc = vi.fn();

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  ConversationsProvider: ({
    children,
    initialOpenLoc,
  }: {
    children: React.ReactNode;
    initialOpenLoc?: { source: string; conversationKey: string } | null;
  }) => {
    if (initialOpenLoc) {
      // Mirrors the real provider: consume initial loc after mount, not during render.
      Promise.resolve()
        .then(() => openConversationExternalByLoc(initialOpenLoc))
        .catch(() => {});
    }
    return children;
  },
  useConversationsApp: () => ({
    items: [],
    activeId: null,
    selectedIds: [],
    toggleAll: vi.fn(),
    toggleSelected: vi.fn(),
    setActiveId: vi.fn(),
    clearSelected: vi.fn(),
    openConversationExternalByLoc,
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
    selectedConversation: null,
  }),
}));

vi.mock('../../src/ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: ({ onExpandSidebar }: { onExpandSidebar?: () => void }) =>
    createElement(
      'div',
      null,
      createElement(
        'header',
        null,
        onExpandSidebar
          ? createElement(
              'button',
              { type: 'button', onClick: onExpandSidebar, 'aria-label': 'Expand sidebar' },
              'expand',
            )
          : null,
      ),
      createElement('div', null, 'detail-pane'),
    ),
}));

import AppShell from '../../src/ui/app/AppShell';

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

describe('AppShell sidebar collapse', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    openConversationExternalByLoc.mockReset();
    responsiveTierState.value = 'wide';
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('keeps an expand button visible after collapsing the sidebar (wide mode)', () => {
    act(() => {
      root!.render(createElement(AppShell));
    });

    const collapseBtn = document.querySelector('[aria-label="Collapse sidebar"]') as HTMLButtonElement | null;
    expect(collapseBtn).toBeTruthy();

    act(() => {
      collapseBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    const expandBtn = document.querySelector('[aria-label="Expand sidebar"]') as HTMLButtonElement | null;
    expect(expandBtn).toBeTruthy();
    expect(expandBtn!.closest('header')).toBeTruthy();

    act(() => {
      expandBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Collapse sidebar"]')).toBeTruthy();
  });

  it('consumes external loc via provider precise-open API', async () => {
    const loc = encodeConversationLoc({ source: 'chatgpt', conversationKey: 'conv-42' });
    window.location.hash = `/?loc=${loc}`;

    await act(async () => {
      root!.render(createElement(AppShell));
      await flushMicrotasks();
    });

    expect(openConversationExternalByLoc).toHaveBeenCalledTimes(1);
    expect(openConversationExternalByLoc).toHaveBeenCalledWith({
      source: 'chatgpt',
      conversationKey: 'conv-42',
    });
  });
});
