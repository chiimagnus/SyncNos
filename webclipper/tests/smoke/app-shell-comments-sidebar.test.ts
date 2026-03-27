import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const { commentsByUrl, listArticleCommentsByCanonicalUrlMock } = vi.hoisted(() => {
  const commentsByUrl = new Map<string, Array<{ id: number; parentId: number | null; commentText: string }>>();
  const listArticleCommentsByCanonicalUrlMock = vi.fn(async (canonicalUrl: string) => {
    return commentsByUrl.get(String(canonicalUrl || '')) || [];
  });
  return { commentsByUrl, listArticleCommentsByCanonicalUrlMock };
});

const currentState = {
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
  useConversationsApp: () => currentState,
}));

vi.mock('@services/comments/client/repo', () => ({
  addArticleComment: vi.fn(async () => ({
    id: 1,
    parentId: null,
    conversationId: 21,
    canonicalUrl: 'https://example.com/article',
    quoteText: '',
    commentText: 'ok',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  deleteArticleCommentById: vi.fn(async () => true),
  listArticleCommentsByCanonicalUrl: listArticleCommentsByCanonicalUrlMock,
}));

vi.mock('../../src/ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: ({
    onTriggerCommentsSidebar,
    commentsSidebarOpen,
  }: {
    onTriggerCommentsSidebar?: (input: any) => void;
    commentsSidebarOpen?: boolean;
  }) =>
    createElement(
      'div',
      null,
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => onTriggerCommentsSidebar?.({ quoteText: 'Selected quote', locator: null } as any),
          'aria-label': 'Comment',
          'aria-pressed': commentsSidebarOpen ? 'true' : 'false',
        },
        'open-comments',
      ),
      createElement('div', null, 'detail-pane'),
    ),
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
  // Keep the JSDOM globals around: React may schedule async work that still
  // references `window` after the test has completed. The next `setupDom()`
  // call will overwrite them.
}

describe('AppShell comments sidebar', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    commentsByUrl.clear();
    listArticleCommentsByCanonicalUrlMock.mockClear();
    currentState.selectedConversation = {
      id: 21,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-21',
      url: 'https://example.com/article',
    };
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

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();
    expect(host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__quote-text')?.textContent).toBe(
      'Selected quote',
    );

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    const closeBtn = (host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__collapse') ||
      null) as HTMLButtonElement | null;
    expect(closeBtn).toBeTruthy();

    act(() => {
      closeBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('webclipper-threaded-comments-panel')).toBeFalsy();

    const reopenBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(reopenBtn).toBeTruthy();

    act(() => {
      reopenBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    const reopened = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(reopened).toBeTruthy();
  });

  it('refreshes comments when selected article switches while sidebar stays open', async () => {
    commentsByUrl.set('https://example.com/a', [{ id: 101, parentId: null, commentText: 'Comment A' }]);
    commentsByUrl.set('https://example.com/b', [{ id: 202, parentId: null, commentText: 'Comment B' }]);
    currentState.selectedConversation = {
      id: 21,
      title: 'Article A',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-a',
      url: 'https://example.com/a',
    };

    act(() => {
      root!.render(createElement(AppShell));
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
      const body = host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__comment-body');
      expect(body?.textContent).toBe('Comment A');
    });

    currentState.selectedConversation = {
      id: 22,
      title: 'Article B',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-b',
      url: 'https://example.com/b',
    };

    act(() => {
      root!.render(createElement(AppShell));
    });

    await vi.waitFor(() => {
      const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
      const body = host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__comment-body');
      expect(body?.textContent).toBe('Comment B');
    });

    expect(listArticleCommentsByCanonicalUrlMock).toHaveBeenCalledWith('https://example.com/a');
    expect(listArticleCommentsByCanonicalUrlMock).toHaveBeenCalledWith('https://example.com/b');
  });
});
