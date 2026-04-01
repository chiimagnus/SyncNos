import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => {
    const labels: Record<string, string> = {
      backToChatsAria: 'Back to chats',
      settingsDialogAria: 'Settings dialog',
      closeSettings: 'Close settings',
      resizeSidebar: 'Resize sidebar',
      expandSidebar: 'Expand sidebar',
    };
    return labels[key] || key;
  },
}));

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
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

vi.mock('../../src/ui/app/conversations/CapturedListSidebar', () => ({
  CapturedListSidebar: () => createElement('div', null, 'sidebar'),
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  ConversationsProvider: ({ children }: { children: React.ReactNode }) => children,
  useConversationsApp: () => ({
    items: [],
    activeId: null,
    selectedIds: [],
    toggleAll: vi.fn(),
    toggleSelected: vi.fn(),
    selectedConversation: null,
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
  }),
}));

vi.mock('../../src/ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: () => createElement('div', null, 'detail-pane'),
}));

vi.mock('../../src/ui/conversations/ConversationsScene', () => ({
  ConversationsScene: (props: { onPopupHeaderStateChange?: (state: any) => void; inlineNarrowDetailHeader?: boolean }) => {
    const [mode, setMode] = useState<'list' | 'detail' | 'detail-empty'>('list');
    const toList = () => {
      setMode('list');
      props.onPopupHeaderStateChange?.({ mode: 'list' });
    };
    return createElement(
      'div',
      null,
      createElement('div', { 'data-inline-narrow-detail-header': props.inlineNarrowDetailHeader ? '1' : '0' }),
      createElement(
        'button',
        {
          type: 'button',
          onClick: toList,
        },
        'show-list',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            setMode('detail');
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
                  onTrigger: async () => {},
                },
              ],
              onBack: toList,
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
            setMode('detail-empty');
            props.onPopupHeaderStateChange?.({
              mode: 'detail',
              title: 'Conversation',
              subtitle: 'chatgpt · key',
              actions: [],
              onBack: toList,
            });
          },
        },
        'show-detail-empty',
      ),
      mode === 'detail' ? createElement('button', { 'aria-label': 'Open in Notion' }, 'open-in-notion') : null,
      mode === 'detail-empty' ? createElement('button', { 'aria-label': 'Back to chats' }, 'back') : null,
    );
  },
}));

import AppShell from '../../src/ui/app/AppShell';

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

describe('AppShell narrow detail header actions', () => {
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

  it('shows Open in Notion in narrow app detail mode', () => {
    act(() => {
      root!.render(createElement(AppShell));
    });

    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();
    expect(document.querySelector('[data-inline-narrow-detail-header="1"]')).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeTruthy();
  });

  it('keeps the narrow app detail header action area empty when no actions are available', () => {
    act(() => {
      root!.render(createElement(AppShell));
    });

    const detailButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.textContent === 'show-detail-empty',
    ) as HTMLButtonElement | undefined;
    expect(detailButton).toBeTruthy();

    act(() => {
      detailButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
    expect(document.querySelector('[aria-label="Back to chats"]')).toBeTruthy();
  });
});
