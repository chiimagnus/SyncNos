import { describe, expect, it, vi } from 'vitest';

import { createArticleCommentsSidebarController } from '../../src/services/comments/sidebar/article-comments-sidebar-controller';
import { createCommentSidebarSession } from '../../src/services/comments/sidebar/comment-sidebar-session';

function createMockPanel() {
  let open = false;
  let busy = false;
  let quoteText = '';
  let comments: any[] = [];
  let handlers: any = {};
  let focusCount = 0;

  const api = {
    open: (input?: { focusComposer?: boolean }) => {
      open = true;
      if (input?.focusComposer) focusCount += 1;
    },
    close: () => {
      open = false;
      try {
        handlers?.onClose?.();
      } catch (_e) {
        // ignore
      }
    },
    isOpen: () => open,
    setBusy: (next: boolean) => {
      busy = !!next;
    },
    setQuoteText: (next: string) => {
      quoteText = String(next || '');
    },
    setComments: (items: any[]) => {
      comments = Array.isArray(items) ? items : [];
    },
    setHandlers: (next: any) => {
      handlers = next || {};
    },
  };

  return {
    api,
    getState: () => ({ open, busy, quoteText, comments, handlers, focusCount }),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('article-comments-sidebar-controller', () => {
  it('opens: sets quote, requests open, ensures context, and refreshes comments', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async () => [{ id: 1, parentId: null, commentText: 'hi', quoteText: '', createdAt: 1 }]),
      addRoot: vi.fn(async () => true),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/article', conversationId: 21 })),
    };

    const controller = createArticleCommentsSidebarController({
      session,
      adapter: adapter as any,
    });

    await controller.open({
      selectionText: 'Quoted',
      focusComposer: true,
      source: 'test',
      ensureContext: true,
      ensureContextInput: { canonicalUrlFallback: 'https://example.com/fallback', ensureArticle: true },
    });

    const snapshot = session.getSnapshot();
    expect(snapshot.quoteText).toBe('Quoted');
    expect(snapshot.isOpen).toBe(true);
    expect(adapter.ensureContext).toHaveBeenCalledTimes(1);
    expect(adapter.list).toHaveBeenCalledWith({ canonicalUrl: 'https://example.com/article' });
    expect(panel.getState().focusCount).toBe(1);
    expect(panel.getState().comments.length).toBe(1);
  });

  it('save root: returns true, refreshes list, and clears quote via session wrapper', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => true),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/article', conversationId: 21 })),
    };

    createArticleCommentsSidebarController({ session, adapter: adapter as any });

    session.setQuoteText('Quoted');

    const handlers = panel.getState().handlers;
    expect(typeof handlers.onSave).toBe('function');

    const res = await handlers.onSave('Hello');
    expect(res).toBe(true);
    expect(adapter.addRoot).toHaveBeenCalledWith({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      quoteText: 'Quoted',
      commentText: 'Hello',
      locator: null,
    });
    expect(adapter.list).toHaveBeenCalled();
    expect(session.getSnapshot().quoteText).toBe('');
  });

  it('setContext: refreshes comments when canonicalUrl switches', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async ({ canonicalUrl }: { canonicalUrl: string }) => {
        if (canonicalUrl.includes('/a')) {
          return [{ id: 1, parentId: null, commentText: 'A', quoteText: '', createdAt: 1 }];
        }
        return [{ id: 2, parentId: null, commentText: 'B', quoteText: '', createdAt: 2 }];
      }),
      addRoot: vi.fn(async () => true),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });

    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    await vi.waitFor(() => {
      expect(panel.getState().comments[0]?.commentText).toBe('A');
    });

    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 2 });
    await vi.waitFor(() => {
      expect(panel.getState().comments[0]?.commentText).toBe('B');
    });

    expect(adapter.list).toHaveBeenNthCalledWith(1, { canonicalUrl: 'https://example.com/a' });
    expect(adapter.list).toHaveBeenNthCalledWith(2, { canonicalUrl: 'https://example.com/b' });
  });

  it('setContext: ignores stale refresh results from previous context', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const deferredA = createDeferred<any[]>();
    const deferredB = createDeferred<any[]>();

    const adapter = {
      list: vi.fn(({ canonicalUrl }: { canonicalUrl: string }) => {
        if (canonicalUrl.includes('/a')) return deferredA.promise;
        return deferredB.promise;
      }),
      addRoot: vi.fn(async () => true),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });

    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 2 });

    deferredB.resolve([{ id: 2, parentId: null, commentText: 'B', quoteText: '', createdAt: 2 }]);
    await vi.waitFor(() => {
      expect(panel.getState().comments[0]?.commentText).toBe('B');
    });

    deferredA.resolve([{ id: 1, parentId: null, commentText: 'A', quoteText: '', createdAt: 1 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.getState().comments[0]?.commentText).toBe('B');
  });
});
