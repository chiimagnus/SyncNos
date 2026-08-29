import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const { listArticleCommentsByCanonicalUrlMock, listArticleCommentsByConversationIdMock } = vi.hoisted(() => ({
  listArticleCommentsByCanonicalUrlMock: vi.fn(async () => []),
  listArticleCommentsByConversationIdMock: vi.fn(async () => []),
}));

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
  listArticleCommentsByCanonicalUrl: listArticleCommentsByCanonicalUrlMock,
  listArticleCommentsByConversationId: listArticleCommentsByConversationIdMock,
}));

import { ArticleCommentsSection } from '../../src/ui/conversations/ArticleCommentsSection';
import { createCommentSidebarSession } from '../../src/services/comments/sidebar/comment-sidebar-session';
import { createArticleCommentsSidebarAppAdapter } from '../../src/services/comments/sidebar/article-comments-sidebar-app-adapter';
import { createArticleCommentsSidebarInpageAdapter } from '../../src/services/comments/sidebar/article-comments-sidebar-inpage-adapter';
import { ArticleCommentsSidebarAdapterError } from '../../src/services/comments/sidebar/article-comments-sidebar-adapter';

function comment(input: { id: number; conversationId: number | null; canonicalUrl?: string; createdAt?: number }) {
  return {
    id: input.id,
    parentId: null,
    conversationId: input.conversationId,
    canonicalUrl: input.canonicalUrl ?? 'https://example.com/article',
    authorName: null,
    quoteText: '',
    commentText: `comment-${input.id}`,
    locator: null,
    createdAt: input.createdAt ?? input.id,
    updatedAt: input.createdAt ?? input.id,
  };
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

  it('renders the shared panel header in sidebar mode', async () => {
    const session = createCommentSidebarSession();
    const sourceRoot = document.createElement('article');
    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          sidebarSession: session,
          getLocatorSurfaceRoots: () => ({ sourceRoot, scrollRoot: sourceRoot }),
        }),
      );
    });

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();

    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__header-title')?.textContent).toBe('Comments');
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__attach-selection')).toBeFalsy();
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__collapse')).toBeTruthy();
    expect(document.querySelector('section')).toBeTruthy();
  });

  it('renders the collapse control in sidebar mode', async () => {
    const session = createCommentSidebarSession();
    const sourceRoot = document.createElement('article');
    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          sidebarSession: session,
          getLocatorSurfaceRoots: () => ({ sourceRoot, scrollRoot: sourceRoot }),
        }),
      );
    });

    await act(async () => {
      session.updateHost({
        comments: [
          {
            id: 1,
            parentId: null,
            createdAt: Date.now(),
            commentText: 'Root comment',
          },
        ],
      });
    });

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();
    expect(host?.shadowRoot?.querySelector('.webclipper-inpage-comments-panel__collapse')).toBeTruthy();
    expect(
      host?.shadowRoot?.querySelector('[data-thread-root-id="1"] .webclipper-inpage-comments-panel__overflow-trigger'),
    ).toBeTruthy();
  });

  it('defers the nested React root cleanup until the parent commit finishes', async () => {
    const session = createCommentSidebarSession();
    const sourceRoot = document.createElement('article');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          sidebarSession: session,
          getLocatorSurfaceRoots: () => ({ sourceRoot, scrollRoot: sourceRoot }),
        }),
      );
    });

    await act(async () => {
      root!.render(createElement('div'));
      await Promise.resolve();
    });
    await Promise.resolve();

    expect(
      errorSpy.mock.calls.some((args) =>
        args.some((value) => String(value).includes('synchronously unmount a root while React was already rendering')),
      ),
    ).toBe(false);
    errorSpy.mockRestore();
  });

  it('re-resolves markers after a stable locator getter publishes new root identity', async () => {
    const session = createCommentSidebarSession();
    const initialRoot = document.createElement('div');
    initialRoot.textContent = 'Root quote';
    const latestRoot = document.createElement('div');
    latestRoot.textContent = 'Root quote';
    document.body.append(initialRoot, latestRoot);
    let currentRoots = { sourceRoot: initialRoot, scrollRoot: initialRoot };
    const stableGetter = vi.fn(() => currentRoots);
    const listeners = new Set<() => void>();
    const subscribeLocatorSurfaceRoots = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });

    await act(async () => {
      root!.render(
        createElement(ArticleCommentsSection, {
          sidebarSession: session,
          getLocatorSurfaceRoots: stableGetter,
          subscribeLocatorSurfaceRoots,
        }),
      );
    });

    const host = document.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();

    await act(async () => {
      session.requestOpen();
      session.updateHost({
        comments: [
          {
            id: 1,
            parentId: null,
            createdAt: Date.now(),
            quoteText: 'Root quote',
            commentText: 'Root comment',
            locator: {
              v: 1,
              env: 'app',
              quote: { type: 'TextQuoteSelector', exact: 'Root quote' },
              position: { type: 'TextPositionSelector', start: 0, end: 10 },
            },
          },
        ],
      });
    });

    await vi.waitFor(() => expect(stableGetter).toHaveBeenCalled());
    stableGetter.mockClear();
    currentRoots = { sourceRoot: latestRoot, scrollRoot: latestRoot };

    await act(async () => {
      for (const listener of listeners) listener();
    });

    expect(document.querySelector('webclipper-threaded-comments-panel')).toBe(host);
    await vi.waitFor(() => expect(stableGetter).toHaveBeenCalled());
    expect(subscribeLocatorSurfaceRoots).toHaveBeenCalledTimes(1);
  });
});

describe('article comments sidebar adapters', () => {
  beforeEach(() => {
    listArticleCommentsByCanonicalUrlMock.mockReset();
    listArticleCommentsByConversationIdMock.mockReset();
    listArticleCommentsByCanonicalUrlMock.mockResolvedValue([]);
    listArticleCommentsByConversationIdMock.mockResolvedValue([]);
  });

  it('merges conversation comments with same-context orphans and deduplicates by comment identity', async () => {
    listArticleCommentsByConversationIdMock.mockResolvedValue([
      comment({ id: 2, conversationId: 21, createdAt: 2 }),
      comment({ id: 1, conversationId: 21, createdAt: 1 }),
    ]);
    listArticleCommentsByCanonicalUrlMock.mockResolvedValue([
      comment({ id: 2, conversationId: 21, createdAt: 2 }),
      comment({ id: 3, conversationId: null, createdAt: 3 }),
      comment({ id: 4, conversationId: 99, createdAt: 4 }),
    ]);

    const result = await createArticleCommentsSidebarAppAdapter().list({
      canonicalUrl: 'https://example.com/article#fragment',
      conversationId: 21,
      fallbackPolicy: 'include-orphan-url',
    });

    expect(listArticleCommentsByConversationIdMock).toHaveBeenCalledWith(21);
    expect(listArticleCommentsByCanonicalUrlMock).toHaveBeenCalledWith('https://example.com/article');
    expect(result.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('uses URL identity only for orphan comments when no conversation exists', async () => {
    listArticleCommentsByCanonicalUrlMock.mockResolvedValue([
      comment({ id: 1, conversationId: null }),
      comment({ id: 2, conversationId: 21 }),
    ]);

    const result = await createArticleCommentsSidebarAppAdapter().list({
      canonicalUrl: 'https://example.com/article',
      conversationId: null,
      fallbackPolicy: 'include-orphan-url',
    });

    expect(listArticleCommentsByConversationIdMock).not.toHaveBeenCalled();
    expect(result.map((item) => item.id)).toEqual([1]);
  });

  it('sends explicit ID and URL runtime queries and merges only matching identities', async () => {
    const send = vi.fn(async (_type: string, payload?: Record<string, unknown>) => {
      if (payload?.conversationId === 21) {
        return { ok: true, data: [comment({ id: 1, conversationId: 21 })] };
      }
      return {
        ok: true,
        data: [
          comment({ id: 1, conversationId: 21 }),
          comment({ id: 2, conversationId: null }),
          comment({ id: 3, conversationId: 99 }),
        ],
      };
    });

    const result = await createArticleCommentsSidebarInpageAdapter({ send }).list({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      fallbackPolicy: 'include-orphan-url',
    });

    expect(send).toHaveBeenNthCalledWith(1, 'listArticleComments', { conversationId: 21 });
    expect(send).toHaveBeenNthCalledWith(2, 'listArticleComments', {
      canonicalUrl: 'https://example.com/article',
    });
    expect(result.map((item) => item.id)).toEqual([1, 2]);
  });

  it('treats a successful runtime envelope with data.ok=false as a failed delete', async () => {
    const adapter = createArticleCommentsSidebarInpageAdapter({
      send: vi.fn(async () => ({ ok: true, data: { ok: false } })),
    });

    await expect(adapter.delete({ id: 42 })).rejects.toThrow('failed to delete article comment');
  });

  it('throws typed errors instead of treating runtime failures as empty comments', async () => {
    const unavailable = createArticleCommentsSidebarInpageAdapter(null);
    await expect(
      unavailable.list({
        canonicalUrl: 'https://example.com/article',
        conversationId: null,
        fallbackPolicy: 'none',
      }),
    ).rejects.toMatchObject<ArticleCommentsSidebarAdapterError>({
      name: 'ArticleCommentsSidebarAdapterError',
      code: 'runtime_unavailable',
    });

    const failed = createArticleCommentsSidebarInpageAdapter({
      send: vi.fn(async () => ({ ok: false, error: { message: 'background unavailable' } })),
    });
    await expect(
      failed.list({
        canonicalUrl: 'https://example.com/article',
        conversationId: null,
        fallbackPolicy: 'none',
      }),
    ).rejects.toMatchObject<ArticleCommentsSidebarAdapterError>({
      code: 'request_failed',
      message: 'background unavailable',
    });
  });
});
