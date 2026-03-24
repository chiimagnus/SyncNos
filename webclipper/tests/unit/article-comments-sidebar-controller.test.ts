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
    });
    expect(adapter.list).toHaveBeenCalled();
    expect(session.getSnapshot().quoteText).toBe('');
  });
});
