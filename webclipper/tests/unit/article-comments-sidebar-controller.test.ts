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
      addRoot: vi.fn(async () => ({ id: 1 })),
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

  it('save root: returns structured result, refreshes list, and keeps quote until explicit clear', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 91 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/article', conversationId: 21 })),
    };

    createArticleCommentsSidebarController({ session, adapter: adapter as any });

    session.setQuoteText('Quoted');

    const handlers = panel.getState().handlers;
    expect(typeof handlers.onSave).toBe('function');

    const res = await handlers.onSave('Hello');
    expect(res).toEqual({ ok: true, createdRootId: 91 });
    expect(adapter.addRoot).toHaveBeenCalledWith({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      quoteText: 'Quoted',
      commentText: 'Hello',
      locator: null,
    });
    expect(adapter.list).toHaveBeenCalled();
    expect(session.getSnapshot().quoteText).toBe('Quoted');
  });

  it('updates quote and locator from composer selection requests', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const locator = {
      env: 'inpage',
      quote: { exact: 'Quoted from page' },
      position: { start: 0, end: 16 },
    };

    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 51 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/article', conversationId: 21 })),
    };

    const resolveComposerSelection = vi
      .fn()
      .mockResolvedValueOnce({ selectionText: 'Quoted from page', locator })
      .mockResolvedValueOnce({ selectionText: '', locator: null });

    createArticleCommentsSidebarController({
      session,
      adapter: adapter as any,
      resolveComposerSelection,
    });

    const handlers = panel.getState().handlers;
    expect(typeof handlers.onComposerSelectionRequest).toBe('function');

    await handlers.onComposerSelectionRequest({ trigger: 'button' });
    expect(resolveComposerSelection).toHaveBeenNthCalledWith(1, { trigger: 'button' });
    expect(session.getSnapshot().quoteText).toBe('Quoted from page');

    await handlers.onSave('root comment');
    expect(adapter.addRoot).toHaveBeenLastCalledWith({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      quoteText: 'Quoted from page',
      commentText: 'root comment',
      locator,
    });

    await handlers.onComposerSelectionRequest({ trigger: 'button' });
    expect(resolveComposerSelection).toHaveBeenNthCalledWith(2, { trigger: 'button' });
    expect(session.getSnapshot().quoteText).toBe('Quoted from page');
  });

  it('ignores stale composer selection responses and keeps latest result', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/article', conversationId: 1 })),
    };

    const slow = createDeferred<{ selectionText: string; locator: unknown | null }>();
    const fast = createDeferred<{ selectionText: string; locator: unknown | null }>();

    const resolveComposerSelection = vi
      .fn()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => fast.promise);

    createArticleCommentsSidebarController({
      session,
      adapter: adapter as any,
      resolveComposerSelection,
    });

    const handlers = panel.getState().handlers;
    const oldRequest = handlers.onComposerSelectionRequest({ trigger: 'button' });
    const newRequest = handlers.onComposerSelectionRequest({ trigger: 'button' });

    fast.resolve({ selectionText: 'new quote', locator: null });
    await newRequest;
    expect(session.getSnapshot().quoteText).toBe('new quote');

    slow.resolve({ selectionText: 'old quote', locator: null });
    await oldRequest;
    expect(session.getSnapshot().quoteText).toBe('new quote');
  });

  it('preserves quote text when locator is missing and saves with null locator', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 77 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/article', conversationId: 21 })),
    };

    const resolveComposerSelection = vi.fn().mockResolvedValue({
      selectionText: 'Selection text only',
      locator: null,
    });

    createArticleCommentsSidebarController({
      session,
      adapter: adapter as any,
      resolveComposerSelection,
    });

    const handlers = panel.getState().handlers;
    await handlers.onComposerSelectionRequest({ trigger: 'button' });
    expect(session.getSnapshot().quoteText).toBe('Selection text only');

    await handlers.onSave('comment');
    expect(adapter.addRoot).toHaveBeenLastCalledWith({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      quoteText: 'Selection text only',
      commentText: 'comment',
      locator: null,
    });
  });

  it('clears pending locator when context switches before save', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 66 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const locatorFromA = {
      env: 'inpage',
      quote: { exact: 'Quote A' },
      position: { start: 0, end: 6 },
    };

    const resolveComposerSelection = vi.fn().mockResolvedValue({
      selectionText: 'Quote A',
      locator: locatorFromA,
    });

    const controller = createArticleCommentsSidebarController({
      session,
      adapter: adapter as any,
      resolveComposerSelection,
    });

    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });

    const handlers = panel.getState().handlers;
    await handlers.onComposerSelectionRequest({ trigger: 'button' });
    expect(session.getSnapshot().quoteText).toBe('Quote A');

    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 2 });
    expect(session.getSnapshot().quoteText).toBe('');

    await handlers.onSave('comment in b');
    expect(adapter.addRoot).toHaveBeenLastCalledWith({
      canonicalUrl: 'https://example.com/b',
      conversationId: 2,
      quoteText: '',
      commentText: 'comment in b',
      locator: null,
    });
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
      addRoot: vi.fn(async () => ({ id: 1 })),
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
      addRoot: vi.fn(async () => ({ id: 1 })),
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

  it('setContext: keeps context stable for same discourse topic across different floors', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async () => [{ id: 1, parentId: null, commentText: 'Topic', quoteText: '', createdAt: 1 }]),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      migrateCanonicalUrl: vi.fn(async () => {}),
    };

    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });

    controller.setContext({ canonicalUrl: 'https://linux.do/t/topic-slug/123/20', conversationId: 9 });
    await vi.waitFor(() => {
      expect(panel.getState().comments[0]?.commentText).toBe('Topic');
    });
    expect(adapter.list).toHaveBeenCalledTimes(1);

    session.setQuoteText('keep draft');
    controller.setContext({ canonicalUrl: 'https://linux.do/t/topic-slug/123/1', conversationId: 9 });

    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().quoteText).toBe('keep draft');
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();
  });
});
