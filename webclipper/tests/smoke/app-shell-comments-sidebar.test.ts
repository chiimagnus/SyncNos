import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';

const { commentsByUrl, listArticleCommentsByCanonicalUrlMock, responsiveTierState, detailPaneMockState } = vi.hoisted(
  () => {
    const commentsByUrl = new Map<string, Array<{ id: number; parentId: number | null; commentText: string }>>();
    const listArticleCommentsByCanonicalUrlMock = vi.fn(async (canonicalUrl: string) => {
      return commentsByUrl.get(String(canonicalUrl || '')) || [];
    });
    const responsiveTierState = { value: 'wide' as 'narrow' | 'medium' | 'wide' };
    const detailPaneMockState = { provideLocatorRoot: true };
    return { commentsByUrl, listArticleCommentsByCanonicalUrlMock, responsiveTierState, detailPaneMockState };
  },
);

const COMMENTS_SIDEBAR_COLLAPSED_KEY = 'webclipper_app_comments_sidebar_collapsed';

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
  ConversationsScene: (props: { wideDetail?: ReactNode; wideHideList?: boolean }) =>
    createElement(
      'div',
      null,
      props.wideHideList ? null : createElement('aside', null, 'list'),
      props.wideDetail ?? null,
    ),
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
    onCommentsLocatorRootChange,
  }: {
    onTriggerCommentsSidebar?: (input: any) => void;
    commentsSidebarOpen?: boolean;
    onCommentsLocatorRootChange?: (root: Element | null) => void;
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
          'data-can-trigger': onTriggerCommentsSidebar ? '1' : '0',
        },
        'open-comments',
      ),
      createElement(
        'div',
        {
          ref: (el: HTMLDivElement | null) => {
            if (!detailPaneMockState.provideLocatorRoot) {
              onCommentsLocatorRootChange?.(null);
              return;
            }
            onCommentsLocatorRootChange?.(el);
          },
          'data-mock-locator-root': '1',
        },
        'Selectable quote from mock detail pane',
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
  Object.defineProperty(globalThis, 'getSelection', {
    configurable: true,
    value: dom.window.getSelection.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  (dom.window.HTMLElement.prototype as any).attachEvent ||= () => {};
  (dom.window.HTMLElement.prototype as any).detachEvent ||= () => {};
}

function cleanupDom() {
  // Keep the JSDOM globals around: React may schedule async work that still
  // references `window` after the test has completed. The next `setupDom()`
  // call will overwrite them.
}

function mockSelectionInElement(el: HTMLElement, needle: string): (() => void) | null {
  const walker = document.createTreeWalker(el, window.NodeFilter.SHOW_TEXT);
  let textNode: Text | null = null;
  let start = -1;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = String(node.textContent || '');
    const index = text.indexOf(needle);
    if (index >= 0) {
      textNode = node;
      start = index;
      break;
    }
  }
  if (!textNode || start < 0) return null;

  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + needle.length);

  const selectionMock = {
    rangeCount: 1,
    anchorNode: textNode,
    focusNode: textNode,
    toString: () => needle,
    getRangeAt: () => range,
    removeAllRanges: () => {},
    addRange: () => {},
  } as any;

  const spy = vi.spyOn(globalThis, 'getSelection').mockImplementation(() => selectionMock as Selection);
  return () => spy.mockRestore();
}

describe('AppShell comments sidebar', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    commentsByUrl.clear();
    listArticleCommentsByCanonicalUrlMock.mockClear();
    responsiveTierState.value = 'wide';
    detailPaneMockState.provideLocatorRoot = true;
    currentState.selectedConversation = {
      id: 21,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-21',
      url: 'https://example.com/article',
    };
    setupDom();
    window.localStorage.clear();
    window.localStorage.setItem(COMMENTS_SIDEBAR_COLLAPSED_KEY, '1');
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('opens the docked comments sidebar from the detail view trigger and closes from the sidebar collapse button', async () => {
    act(() => {
      root!.render(createElement(AppShell));
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(
      () => {
        expect(document.querySelector('webclipper-threaded-comments-panel')).toBeTruthy();
      },
      { timeout: 3000 },
    );
    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();

    const closeBtn = (host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__collapse') ||
      null) as HTMLButtonElement | null;
    expect(closeBtn).toBeTruthy();

    act(() => {
      closeBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(document.querySelector('webclipper-threaded-comments-panel')).toBeFalsy();
    });

    const reopenBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(reopenBtn).toBeTruthy();

    act(() => {
      reopenBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(document.querySelector('webclipper-threaded-comments-panel')).toBeTruthy();
    });
  });

  it('attaches selected text on pointerup commit and ignores reply interactions', async () => {
    commentsByUrl.set('https://example.com/article', [{ id: 101, parentId: null, commentText: 'Root comment' }]);

    act(() => {
      root!.render(createElement(AppShell));
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(document.querySelector('webclipper-threaded-comments-panel')).toBeTruthy();
    });

    const locatorRoot = document.querySelector('[data-mock-locator-root="1"]') as HTMLElement | null;
    expect(locatorRoot).toBeTruthy();
    const selectedText = 'quote from mock';
    const restoreSelection = mockSelectionInElement(locatorRoot!, selectedText);
    expect(restoreSelection).toBeTruthy();

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__attach-selection')).toBeFalsy();

    // Wait a tick so the panel can install the selectionchange listener.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));

    await vi.waitFor(() => {
      const quoteText = shadow?.querySelector('.webclipper-inpage-comments-panel__quote-text')?.textContent?.trim();
      expect(quoteText).toBe(selectedText);
    });

    const clearBtn = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__quote-clear',
    ) as HTMLButtonElement | null;
    expect(clearBtn).toBeTruthy();
    act(() => {
      clearBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      const quoteText = shadow?.querySelector('.webclipper-inpage-comments-panel__quote-text')?.textContent?.trim();
      expect(quoteText ?? '').toBe('');
    });

    act(() => {
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
    });

    await vi.waitFor(() => {
      const quoteText = shadow?.querySelector('.webclipper-inpage-comments-panel__quote-text')?.textContent?.trim();
      expect(quoteText).toBe(selectedText);
    });

    restoreSelection?.();

    const composer = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(composer).toBeTruthy();
    act(() => {
      composer!.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      composer!.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
    });

    const quoteAfterComposerClick = shadow
      ?.querySelector('.webclipper-inpage-comments-panel__quote-text')
      ?.textContent?.trim();
    expect(quoteAfterComposerClick).toBe(selectedText);

    act(() => {
      composer!.value = 'typing root';
      composer!.dispatchEvent(new window.Event('input', { bubbles: true }));
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
    });

    const quoteAfterComposerTyping = shadow
      ?.querySelector('.webclipper-inpage-comments-panel__quote-text')
      ?.textContent?.trim();
    expect(quoteAfterComposerTyping).toBe(selectedText);

    const reply = (await vi.waitFor(() => {
      const el = shadow?.querySelector(
        '.webclipper-inpage-comments-panel__reply-textarea',
      ) as HTMLTextAreaElement | null;
      expect(el).toBeTruthy();
      return el;
    })) as HTMLTextAreaElement;
    act(() => {
      reply.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      reply.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
    });

    const quoteAfterReply = shadow?.querySelector('.webclipper-inpage-comments-panel__quote-text')?.textContent?.trim();
    expect(quoteAfterReply).toBe(selectedText);

    act(() => {
      reply.value = 'typing reply';
      reply.dispatchEvent(new window.Event('input', { bubbles: true }));
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
    });

    const quoteAfterReplyTyping = shadow
      ?.querySelector('.webclipper-inpage-comments-panel__quote-text')
      ?.textContent?.trim();
    expect(quoteAfterReplyTyping).toBe(selectedText);
  });

  it('keeps quote empty when locator root is unavailable in app flow', async () => {
    detailPaneMockState.provideLocatorRoot = false;

    act(() => {
      root!.render(createElement(AppShell));
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    const host = (await vi.waitFor(() => {
      const panel = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
      expect(panel).toBeTruthy();
      return panel;
    })) as HTMLElement;
    const shadow = host.shadowRoot;
    expect(shadow).toBeTruthy();

    const initialQuoteText = shadow
      ?.querySelector('.webclipper-inpage-comments-panel__quote-text')
      ?.textContent?.trim();
    expect(initialQuoteText ?? '').toBe('');

    act(() => {
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
    });

    await vi.waitFor(() => {
      const quoteText = shadow?.querySelector('.webclipper-inpage-comments-panel__quote-text')?.textContent?.trim();
      expect(quoteText ?? '').toBe('');
    });
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

  it('keeps medium tier comments sidebar closed by default', () => {
    responsiveTierState.value = 'medium';
    window.localStorage.setItem(COMMENTS_SIDEBAR_COLLAPSED_KEY, '0');

    act(() => {
      root!.render(createElement(AppShell));
    });

    expect(document.querySelector('webclipper-threaded-comments-panel')).toBeFalsy();
  });

  it('respects wide tier collapsed storage key', async () => {
    responsiveTierState.value = 'wide';
    window.localStorage.setItem(COMMENTS_SIDEBAR_COLLAPSED_KEY, '1');

    act(() => {
      root!.render(createElement(AppShell));
    });
    expect(document.querySelector('webclipper-threaded-comments-panel')).toBeFalsy();

    act(() => {
      root?.unmount();
      root = ReactDOM.createRoot(document.getElementById('root')!);
    });

    window.localStorage.setItem(COMMENTS_SIDEBAR_COLLAPSED_KEY, '0');
    act(() => {
      root!.render(createElement(AppShell));
    });

    await vi.waitFor(() => {
      expect(document.querySelector('webclipper-threaded-comments-panel')).toBeTruthy();
    });
  });

  it('does not let medium open state override wide collapsed storage preference', async () => {
    responsiveTierState.value = 'medium';
    window.localStorage.setItem(COMMENTS_SIDEBAR_COLLAPSED_KEY, '1');
    currentState.selectedConversation = {
      id: 23,
      title: 'Article Medium',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-medium',
      url: 'https://example.com/medium-article',
    };

    act(() => {
      root!.render(createElement(AppShell));
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    expect(openBtn?.getAttribute('data-can-trigger')).toBe('1');
    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(window.localStorage.getItem(COMMENTS_SIDEBAR_COLLAPSED_KEY)).toBe('1');

    responsiveTierState.value = 'wide';
    act(() => {
      root!.render(createElement(AppShell));
    });

    expect(window.localStorage.getItem(COMMENTS_SIDEBAR_COLLAPSED_KEY)).toBe('1');
    await vi.waitFor(() => {
      const toggleBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
      expect(toggleBtn?.getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('hides the left sidebar when medium comments sidebar is open', async () => {
    responsiveTierState.value = 'medium';
    currentState.selectedConversation = {
      id: 31,
      title: 'Article Medium',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-medium-open',
      url: 'https://example.com/medium-open',
    };

    act(() => {
      root!.render(createElement(AppShell));
    });

    expect(document.querySelector('webclipper-threaded-comments-panel')).toBeFalsy();
    expect(document.querySelector('aside')).toBeTruthy();

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    expect(openBtn?.getAttribute('data-can-trigger')).toBe('1');

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      const pressedBtn = document.querySelector('[aria-label="Comment"][aria-pressed="true"]');
      expect(pressedBtn).toBeTruthy();
    });
    expect(document.querySelector('aside')).toBeFalsy();
  });
});
