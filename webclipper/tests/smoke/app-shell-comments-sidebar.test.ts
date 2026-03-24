import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const currentState = {
  items: [],
  activeId: null,
  selectedIds: [],
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
  deleteSelected: vi.fn(),
  selectedConversation: {
    id: 21,
    title: 'Article',
    source: 'web',
    sourceType: 'article',
    conversationKey: 'article-21',
    url: 'https://example.com/article',
  },
};

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => {
    const labels: Record<string, string> = {
      collapseSidebar: 'Collapse sidebar',
      expandSidebar: 'Expand sidebar',
      openCommentsSidebar: 'Comment',
      closeCommentsSidebar: 'Collapse comments sidebar',
      articleCommentsHeading: 'Comments',
    };
    return labels[key] || key;
  },
}));

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => false,
}));

vi.mock('../../src/ui/app/routes/Settings', () => ({
  default: () => createElement('div', null, 'settings'),
}));

vi.mock('../../src/ui/app/conversations/CapturedListSidebar', () => ({
  CapturedListSidebar: () => createElement('div', null, 'sidebar'),
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  ConversationsProvider: ({ children }: { children: React.ReactNode }) => children,
  useConversationsApp: () => currentState,
}));

vi.mock('../../src/ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: ({
    onTriggerCommentsSidebar,
    commentsSidebarOpen,
  }: {
    onTriggerCommentsSidebar?: (quoteText: string) => void;
    commentsSidebarOpen?: boolean;
  }) =>
    createElement(
      'div',
      null,
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => onTriggerCommentsSidebar?.('Selected quote'),
          'aria-label': 'Comment',
          'aria-pressed': commentsSidebarOpen ? 'true' : 'false',
        },
        'open-comments',
      ),
      createElement('div', null, 'detail-pane'),
    ),
}));

vi.mock('../../src/ui/conversations/ArticleCommentsSection', () => ({
  ArticleCommentsSection: ({
    onRequestClose,
    sidebarSession,
    quoteText,
    focusComposerSignal,
  }: {
    onRequestClose: () => void;
    sidebarSession?: { getSnapshot?: () => { quoteText?: string; focusComposerSignal?: number } };
    quoteText?: string;
    focusComposerSignal?: number;
  }) => {
    const snapshot = sidebarSession?.getSnapshot?.() ?? null;
    const resolvedQuoteText = snapshot ? String(snapshot.quoteText || '') : quoteText || '';
    const resolvedFocusSignal = snapshot ? Number(snapshot.focusComposerSignal || 0) : Number(focusComposerSignal || 0);
    return createElement(
      'aside',
      {
        'aria-label': 'Comments sidebar',
        'data-quote-text': resolvedQuoteText,
        'data-focus-signal': String(resolvedFocusSignal),
      },
      createElement(
        'button',
        { type: 'button', onClick: onRequestClose, 'aria-label': 'mock-close-sidebar' },
        'close-sidebar',
      ),
      createElement('div', null, 'comments-sidebar'),
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

describe('AppShell comments sidebar', () => {
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

  it('opens the docked comments sidebar from the detail view trigger and closes from the sidebar collapse button', () => {
    act(() => {
      root!.render(createElement(AppShell));
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Comments sidebar"]')).toBeTruthy();
    expect(document.querySelector('aside')).toBeTruthy();
    expect(document.querySelector('[aria-label="Comments sidebar"]')?.getAttribute('data-quote-text')).toBe(
      'Selected quote',
    );
    expect(document.querySelector('[aria-label="Comments sidebar"]')?.getAttribute('data-focus-signal')).toBe('1');

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Comments sidebar"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Comments sidebar"]')?.getAttribute('data-focus-signal')).toBe('2');

    const closeBtn = document.querySelector('[aria-label="mock-close-sidebar"]') as HTMLButtonElement | null;
    expect(closeBtn).toBeTruthy();

    act(() => {
      closeBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[aria-label="Comments sidebar"]')).toBeFalsy();
  });
});
