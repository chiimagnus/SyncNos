import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => {
    const labels: Record<string, string> = {
      articleCommentsHeading: 'Comments',
      closeCommentsSidebar: 'Collapse comments sidebar',
    };
    return labels[key] || key;
  },
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
  listArticleCommentsByCanonicalUrl: vi.fn(async () => []),
}));

vi.mock('../../src/platform/runtime/ports', () => ({
  connectPort: () => ({
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    disconnect: vi.fn(),
  }),
}));

import { ArticleCommentsSection } from '../../src/ui/conversations/ArticleCommentsSection';
import { createCommentSidebarSession } from '../../src/services/comments/sidebar/comment-sidebar-session';

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

describe('ArticleCommentsSection shared chrome', () => {
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

  it('renders the shared panel header in embedded mode', async () => {
    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          conversationId: 21,
          canonicalUrl: 'https://example.com/article',
        }),
      );
    });

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();

    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__header-title')?.textContent).toBe('Comments');
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__collapse')).toBeFalsy();
    expect(document.querySelector('section')).toBeTruthy();
  });

  it('renders the collapse control in sidebar mode', async () => {
    const session = createCommentSidebarSession();
    const resolveCommentChatWithActions = vi.fn(async () => []);
    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          sidebarSession: session,
          commentChatWith: {
            resolveActions: resolveCommentChatWithActions,
            resolveContext: async () => ({
              articleTitle: 'Example article',
              canonicalUrl: 'https://example.com/article',
            }),
          },
        }),
      );
    });

    await act(async () => {
      session.setComments([
        {
          id: 1,
          parentId: null,
          createdAt: Date.now(),
          commentText: 'Root comment',
        },
      ]);
    });

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();
    expect(host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__collapse')).toBeTruthy();
    expect(host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__comment-chatwith-trigger')).toBeTruthy();
  });

  it('keeps sidebar panel mounted when comment chatwith resolvers update', async () => {
    const session = createCommentSidebarSession();
    const firstResolveActions = vi.fn(async () => []);
    const secondResolveActions = vi.fn(async () => []);
    const secondResolveContext = vi.fn(async () => ({
      articleTitle: 'Updated article',
      canonicalUrl: 'https://example.com/article',
    }));

    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          sidebarSession: session,
          commentChatWith: {
            resolveActions: firstResolveActions,
            resolveContext: async () => ({
              articleTitle: 'Initial article',
              canonicalUrl: 'https://example.com/article',
            }),
          },
        }),
      );
    });

    await act(async () => {
      session.setComments([
        {
          id: 1,
          parentId: null,
          createdAt: Date.now(),
          commentText: 'Root comment',
        },
      ]);
    });

    const before = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(before).toBeTruthy();

    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          sidebarSession: session,
          commentChatWith: {
            resolveActions: secondResolveActions,
            resolveContext: secondResolveContext,
          },
        }),
      );
    });

    const after = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(after).toBe(before);

    const trigger = after?.shadowRoot?.querySelector(
      '.webclipper-inpage-comments-panel__comment-chatwith-trigger',
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(secondResolveContext).toHaveBeenCalledTimes(1);
      expect(secondResolveActions).toHaveBeenCalledTimes(1);
    });
  });

  it('uses provided locator root in sidebar mode locate flow', async () => {
    const session = createCommentSidebarSession();
    const customRoot = document.createElement('div');
    const getLocatorRoot = vi.fn(() => customRoot);

    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          sidebarSession: session,
          getLocatorRoot,
        }),
      );
    });

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();

    await act(async () => {
      session.setComments([
        {
          id: 1,
          parentId: null,
          createdAt: Date.now(),
          quoteText: 'Root quote',
          commentText: 'Root comment',
          locator: { env: 'app', quote: { exact: 'Root quote' }, position: { start: 1 } } as any,
        },
      ]);
    });

    const body = host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__comment-body') as HTMLElement | null;
    expect(body).toBeTruthy();
    await act(async () => {
      body!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(getLocatorRoot).toHaveBeenCalled();
  });
});
