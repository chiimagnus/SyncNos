import { describe, expect, it, vi } from 'vitest';

import {
  createCommentSidebarSession,
  normalizeCommentSidebarQuoteText,
} from '@services/comments/sidebar/comment-sidebar-session';
import type {
  CommentSidebarHandlers,
  CommentSidebarItem,
  CommentSidebarPanelApi,
} from '@services/comments/sidebar/comment-sidebar-contract';

function createPanelMock() {
  let open = false;
  const calls = {
    open: [] as Array<{ focusComposer?: boolean }>,
    close: 0,
    busy: [] as boolean[],
    quoteText: [] as string[],
    comments: [] as CommentSidebarItem[][],
    handlers: [] as CommentSidebarHandlers[],
  };

  const panel: CommentSidebarPanelApi = {
    open(input) {
      open = true;
      calls.open.push({ ...(input || {}) });
    },
    close() {
      open = false;
      calls.close += 1;
    },
    isOpen() {
      return open;
    },
    setBusy(busy) {
      calls.busy.push(!!busy);
    },
    setQuoteText(text) {
      calls.quoteText.push(String(text));
    },
    setComments(items) {
      calls.comments.push(items.map((item) => ({ ...item })));
    },
    setHandlers(handlers) {
      calls.handlers.push(handlers);
    },
  };

  return { panel, calls };
}

describe('comment-sidebar-session', () => {
  it('normalizes quote text without destroying line breaks', () => {
    expect(normalizeCommentSidebarQuoteText(null)).toBe('');
    expect(normalizeCommentSidebarQuoteText('hello\r\nworld')).toBe('hello\nworld');
  });

  it('replays queued open and syncs attached panel state', () => {
    const session = createCommentSidebarSession();
    const { panel, calls } = createPanelMock();
    const onClose = vi.fn();
    const comment: CommentSidebarItem = {
      id: 1,
      parentId: null,
      authorName: 'You',
      createdAt: 123,
      quoteText: 'quote',
      commentText: 'hello',
    };

    session.setQuoteText(' first\r\nsecond ');
    session.setComments([comment]);
    session.setHandlers({ onClose });
    session.setBusy(true);
    session.requestOpen({ focusComposer: true, source: 'inpage' });

    expect(session.getSnapshot()).toMatchObject({
      attached: false,
      busy: true,
      openRequested: true,
      focusRequested: true,
      focusComposerSignal: 1,
      quoteText: ' first\nsecond ',
      commentCount: 1,
      hasHandlers: true,
      lastOpenSource: 'inpage',
    });

    session.attachPanel(panel);

    expect(calls.quoteText).toEqual([' first\nsecond ']);
    expect(calls.comments).toHaveLength(1);
    expect(calls.comments[0]).toEqual([comment]);
    expect(calls.handlers[0]).toEqual({ onClose });
    expect(calls.busy).toEqual([true]);
    expect(calls.open).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({
      attached: true,
      isOpen: false,
      busy: true,
      openRequested: true,
      focusRequested: true,
      focusComposerSignal: 1,
      lastOpenSource: 'inpage',
    });

    session.setBusy(false);

    expect(calls.busy).toEqual([true, false]);
    expect(calls.open).toEqual([{ focusComposer: true }]);
    expect(session.getSnapshot()).toMatchObject({
      attached: true,
      isOpen: true,
      busy: false,
      openRequested: false,
      focusRequested: false,
      focusComposerSignal: 1,
      lastOpenSource: 'inpage',
    });
  });

  it('cancels queued open before close and does not reopen after busy clears', () => {
    const session = createCommentSidebarSession();
    const { panel, calls } = createPanelMock();
    session.attachPanel(panel);

    session.setBusy(true);
    session.requestOpen({ focusComposer: true, source: 'app' });
    session.requestClose();

    expect(calls.close).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      attached: true,
      isOpen: false,
      busy: true,
      openRequested: false,
      focusRequested: false,
      focusComposerSignal: 1,
      lastOpenSource: null,
    });

    session.setBusy(false);

    expect(calls.open).toEqual([]);
    expect(calls.busy).toEqual([false, true, false]);
    expect(session.getSnapshot()).toMatchObject({
      attached: true,
      isOpen: false,
      busy: false,
      openRequested: false,
      focusRequested: false,
      focusComposerSignal: 1,
      lastOpenSource: null,
    });
  });

  it('replays a pending open when a panel attaches later', () => {
    const session = createCommentSidebarSession();
    const { panel, calls } = createPanelMock();

    session.setBusy(true);
    session.requestOpen({ focusComposer: true, source: 'app' });
    session.detachPanel();

    expect(session.getSnapshot()).toMatchObject({
      attached: false,
      busy: true,
      openRequested: true,
      focusRequested: true,
      focusComposerSignal: 1,
      lastOpenSource: 'app',
    });

    session.attachPanel(panel);
    expect(calls.open).toEqual([]);

    session.setBusy(false);

    expect(calls.open).toEqual([{ focusComposer: true }]);
    expect(session.getSnapshot()).toMatchObject({
      attached: true,
      isOpen: true,
      busy: false,
      openRequested: false,
      focusRequested: false,
      focusComposerSignal: 1,
      lastOpenSource: 'app',
    });
  });
});
