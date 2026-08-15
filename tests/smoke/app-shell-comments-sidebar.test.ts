import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { ReactNode } from 'react';
import { cleanupCommentsReactRoot, flushCommentsReactWork, waitForCommentsUi } from '../helpers/comments-test-harness';

const {
  commentsByUrl,
  listArticleCommentsMock,
  responsiveTierState,
  detailPaneMockState,
  addArticleCommentMock,
  addArticleCommentReplyMock,
  deleteArticleCommentMock,
  mutationState,
} = vi.hoisted(() => {
  const commentsByUrl = new Map<string, Array<{ id: number; parentId: number | null; commentText: string }>>();
  const listArticleCommentsMock = vi.fn(async (input: any) => {
    return commentsByUrl.get(String(input?.context?.canonicalUrl || '')) || [];
  });
  const responsiveTierState = { value: 'wide' as 'narrow' | 'medium' | 'wide' };
  const detailPaneMockState = { provideLocatorRoot: true };
  const mutationState = { nextId: 500 };
  const addArticleCommentMock = vi.fn(async (input: any) => {
    const id = mutationState.nextId++;
    const comment = {
      id,
      parentId: null,
      conversationId: null,
      canonicalUrl: String(input?.context?.canonicalUrl || ''),
      quoteText: String(input.quoteText || ''),
      commentText: String(input.commentText || ''),
      locator: input.locator ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const list = commentsByUrl.get(comment.canonicalUrl) || [];
    list.push(comment);
    commentsByUrl.set(comment.canonicalUrl, list);
    return comment;
  });
  const addArticleCommentReplyMock = vi.fn(async (input: any) => {
    const id = mutationState.nextId++;
    const comment = {
      id,
      parentId: Number(input.parentId),
      conversationId: null,
      canonicalUrl: String(input?.context?.canonicalUrl || ''),
      quoteText: '',
      commentText: String(input.commentText || ''),
      locator: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const list = commentsByUrl.get(comment.canonicalUrl) || [];
    list.push(comment);
    commentsByUrl.set(comment.canonicalUrl, list);
    return comment;
  });
  const deleteArticleCommentMock = vi.fn(async (input: any) => {
    const id = Number(input?.commentId);
    for (const [url, comments] of commentsByUrl) {
      commentsByUrl.set(
        url,
        comments.filter((comment) => Number(comment.id) !== Number(id)),
      );
    }
    return true;
  });
  return {
    commentsByUrl,
    listArticleCommentsMock,
    responsiveTierState,
    detailPaneMockState,
    addArticleCommentMock,
    addArticleCommentReplyMock,
    deleteArticleCommentMock,
    mutationState,
  };
});

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
    factsEpoch: 'idb-v1',
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

vi.mock('@ui/app/Settings', () => ({
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
  addArticleComment: addArticleCommentMock,
  addArticleCommentReply: addArticleCommentReplyMock,
  deleteArticleComment: deleteArticleCommentMock,
  ensureArticleCommentContext: vi.fn(async () => ({ updated: 0 })),
  listArticleComments: listArticleCommentsMock,
  migrateArticleCommentCanonicalUrl: vi.fn(async () => ({ updated: 0 })),
}));

vi.mock('../../src/ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: ({
    onTriggerCommentsSidebar,
    commentsSidebarOpen,
    onCommentsLocatorRootsChange,
  }: {
    onTriggerCommentsSidebar?: (input: any) => void;
    commentsSidebarOpen?: boolean;
    onCommentsLocatorRootsChange?: (roots: { sourceRoot: Element; scrollRoot: Element } | null) => void;
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
              onCommentsLocatorRootsChange?.(null);
              return;
            }
            onCommentsLocatorRootsChange?.({ sourceRoot: el, scrollRoot: el });
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

  const globalSelectionSpy = vi.spyOn(globalThis, 'getSelection').mockImplementation(() => selectionMock as Selection);
  const documentSelectionSpy = vi.spyOn(document, 'getSelection').mockImplementation(() => selectionMock as Selection);
  return () => {
    documentSelectionSpy.mockRestore();
    globalSelectionSpy.mockRestore();
  };
}

describe('AppShell comments sidebar', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    commentsByUrl.clear();
    listArticleCommentsMock.mockClear();
    responsiveTierState.value = 'wide';
    detailPaneMockState.provideLocatorRoot = true;
    mutationState.nextId = 500;
    addArticleCommentMock.mockClear();
    addArticleCommentReplyMock.mockClear();
    deleteArticleCommentMock.mockClear();
    currentState.selectedConversation = {
      id: 21,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-21',
      url: 'https://example.com/article',
      factsEpoch: 'idb-v1',
    };
    setupDom();
    window.localStorage.clear();
    window.localStorage.setItem(COMMENTS_SIDEBAR_COLLAPSED_KEY, '1');
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(async () => {
    await cleanupCommentsReactRoot(root);
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
    expect(host?.getAttribute('data-surface')).toBe('app-wide');

    const closeBtn = (await vi.waitFor(() => {
      const btn = (host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__collapse') ||
        null) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      return btn;
    })) as HTMLButtonElement;

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

    await waitForCommentsUi(() => {
      expect(document.querySelector('webclipper-threaded-comments-panel')).toBeTruthy();
    });

    const locatorRoot = document.querySelector('[data-mock-locator-root="1"]') as HTMLElement | null;
    expect(locatorRoot).toBeTruthy();
    const selectedText = 'quote from mock detail pane';
    const restoreSelection = mockSelectionInElement(locatorRoot!, selectedText);
    expect(restoreSelection).toBeTruthy();
    if (!restoreSelection) {
      throw new Error(`Failed to mock selection for text: "${selectedText}"`);
    }

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__attach-selection')).toBeFalsy();

    await waitForCommentsUi(() => {
      expect(shadow?.querySelector('.webclipper-inpage-comments-panel__reply-textarea')).toBeTruthy();
    });

    act(() => {
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
    });
    await flushCommentsReactWork();

    await waitForCommentsUi(() => {
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

    await waitForCommentsUi(() => {
      const quoteText = shadow?.querySelector('.webclipper-inpage-comments-panel__quote-text')?.textContent?.trim();
      expect(quoteText ?? '').toBe('');
    });

    act(() => {
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
    });

    await waitForCommentsUi(() => {
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

    const reply = (await waitForCommentsUi(() => {
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

  it('completes root save, thread activation, reply, and confirmed delete in App', async () => {
    commentsByUrl.set('https://example.com/article', [{ id: 101, parentId: null, commentText: 'Existing root' }]);

    act(() => {
      root!.render(createElement(AppShell));
    });
    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    const host = (await waitForCommentsUi(() => {
      const panel = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
      expect(panel?.shadowRoot).toBeTruthy();
      return panel;
    })) as HTMLElement;
    const shadow = host.shadowRoot!;
    const composer = (await waitForCommentsUi(() => {
      const textarea = shadow.querySelector(
        '.webclipper-inpage-comments-panel__composer-textarea',
      ) as HTMLTextAreaElement | null;
      expect(textarea).toBeTruthy();
      return textarea;
    })) as HTMLTextAreaElement;

    act(() => {
      composer.value = 'Created root';
      composer.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const rootSend = shadow.querySelector(
      '.webclipper-inpage-comments-panel__reply-composer.is-root .webclipper-inpage-comments-panel__send',
    ) as HTMLButtonElement | null;
    expect(rootSend?.disabled).toBe(false);
    act(() => {
      rootSend!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await waitForCommentsUi(() => {
      expect(
        Array.from(shadow.querySelectorAll('.webclipper-inpage-comments-panel__text')).some(
          (node) => node.textContent === 'Created root',
        ),
      ).toBe(true);
    });
    expect(addArticleCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commentText: 'Created root',
        context: expect.objectContaining({ factsEpoch: 'idb-v1' }),
      }),
    );

    const existingThread = shadow.querySelector('[data-thread-root-id="101"]') as HTMLElement | null;
    expect(existingThread).toBeTruthy();
    act(() => {
      existingThread!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const reply = (await waitForCommentsUi(() => {
      const textarea = shadow.querySelector(
        '.webclipper-inpage-comments-panel__reply-textarea',
      ) as HTMLTextAreaElement | null;
      expect(textarea).toBeTruthy();
      return textarea;
    })) as HTMLTextAreaElement;
    await waitForCommentsUi(() => {
      expect(document.activeElement === reply || shadow.activeElement === reply).toBe(true);
    });

    act(() => {
      reply.value = 'Created reply';
      reply.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const replySend = shadow.querySelector(
      '[data-reply-composer-root-id="101"] .webclipper-inpage-comments-panel__send',
    ) as HTMLButtonElement | null;
    act(() => {
      replySend!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await waitForCommentsUi(() => {
      expect(
        Array.from(shadow.querySelectorAll('.webclipper-inpage-comments-panel__text')).some(
          (node) => node.textContent === 'Created reply',
        ),
      ).toBe(true);
    });
    const replyCall = addArticleCommentReplyMock.mock.calls.find(([input]) => input.parentId === 101);
    expect(replyCall?.[0]).toEqual(expect.objectContaining({ parentId: 101, commentText: 'Created reply' }));
    const replyId = Number(
      (commentsByUrl.get('https://example.com/article') || []).find((item) => item.commentText === 'Created reply')?.id,
    );

    const replyItem = shadow.querySelector(`[data-reply-id="${replyId}"]`) as HTMLElement | null;
    const overflow = replyItem?.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement | null;
    act(() => overflow!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    let deleteAction = replyItem?.querySelector('[role="menuitem"]') as HTMLButtonElement | null;
    expect(deleteAction).toBeTruthy();
    act(() => deleteAction!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    deleteAction = replyItem?.querySelector('[role="menuitem"]') as HTMLButtonElement | null;
    act(() => deleteAction!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    await waitForCommentsUi(() => {
      expect(shadow.querySelector(`[data-reply-id="${replyId}"]`)).toBeFalsy();
    });
    expect(deleteArticleCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: replyId, context: expect.objectContaining({ factsEpoch: 'idb-v1' }) }),
    );
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
      factsEpoch: 'idb-v1',
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
      const body = host?.shadowRoot?.querySelector(
        '.webclipper-inpage-comments-panel__comment-main > .webclipper-inpage-comments-panel__text',
      );
      expect(body?.textContent).toBe('Comment A');
    });

    currentState.selectedConversation = {
      id: 22,
      title: 'Article B',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-b',
      url: 'https://example.com/b',
      factsEpoch: 'idb-v1',
    };

    act(() => {
      root!.render(createElement(AppShell));
    });

    await vi.waitFor(() => {
      const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
      const body = host?.shadowRoot?.querySelector(
        '.webclipper-inpage-comments-panel__comment-main > .webclipper-inpage-comments-panel__text',
      );
      expect(body?.textContent).toBe('Comment B');
    });

    expect(listArticleCommentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ canonicalUrl: 'https://example.com/a', factsEpoch: 'idb-v1' }),
      }),
    );
    expect(listArticleCommentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ canonicalUrl: 'https://example.com/b', factsEpoch: 'idb-v1' }),
      }),
    );
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
      factsEpoch: 'idb-v1',
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
      factsEpoch: 'idb-v1',
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

  it('does not wire comments trigger for video conversations', async () => {
    currentState.selectedConversation = {
      id: 41,
      title: 'Video',
      source: 'web',
      sourceType: 'video',
      conversationKey: 'video-41',
      url: 'https://example.com/video-41',
    };

    act(() => {
      root!.render(createElement(AppShell));
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    expect(openBtn?.getAttribute('data-can-trigger')).toBe('0');

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('webclipper-threaded-comments-panel')).toBeFalsy();
  });
});
