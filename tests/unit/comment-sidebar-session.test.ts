import { describe, expect, it, vi } from 'vitest';

import {
  createCommentSidebarSession,
  normalizeCommentSidebarQuoteText,
} from '@services/comments/sidebar/comment-sidebar-session';
import type {
  CommentSidebarHost,
  CommentSidebarHostActionCallbacks,
  CommentSidebarHostSnapshot,
  CommentSidebarItem,
  CommentSidebarPanelApi,
} from '@services/comments/sidebar/comment-sidebar-contract';
import {
  createCommentSidebarHostActions,
  createCommentSidebarHostSnapshot,
} from '@services/comments/sidebar/comment-sidebar-state';

function createComment(id = 1): CommentSidebarItem {
  return {
    id,
    parentId: null,
    conversationId: 21,
    canonicalUrl: 'https://example.com/article',
    authorName: 'You',
    quoteText: 'quote',
    commentText: `comment-${id}`,
    locator: null,
    createdAt: 100 + id,
    updatedAt: 100 + id,
  };
}

function createPanelMock() {
  let activeHost: CommentSidebarHost | null = null;
  let activeSnapshot: CommentSidebarHostSnapshot | null = null;
  let unsubscribe: (() => void) | null = null;
  let leaseId = 0;
  const calls = {
    attach: 0,
    dispose: 0,
    snapshots: [] as CommentSidebarHostSnapshot[],
  };

  const capture = (host: CommentSidebarHost) => {
    activeSnapshot = host.getSnapshot();
    calls.snapshots.push(activeSnapshot);
  };

  const panel: CommentSidebarPanelApi = {
    attachHost(host) {
      calls.attach += 1;
      unsubscribe?.();
      activeHost = host;
      const id = ++leaseId;
      capture(host);
      unsubscribe = host.subscribe(() => capture(host));
      let released = false;
      return Object.freeze({
        dispose() {
          if (released) return;
          released = true;
          calls.dispose += 1;
          if (id !== leaseId) return;
          unsubscribe?.();
          unsubscribe = null;
          activeHost = null;
          activeSnapshot = null;
        },
      });
    },
  };

  return {
    panel,
    calls,
    getHost: () => activeHost,
    getSnapshot: () => activeSnapshot,
  };
}

describe('comment-sidebar-host-state', () => {
  it('detaches mutable host data once when it enters the session', () => {
    const session = createCommentSidebarSession();
    const locator = {
      v: 1 as const,
      env: 'app' as const,
      quote: { type: 'TextQuoteSelector' as const, exact: 'quoted text' },
      position: { type: 'TextPositionSelector' as const, start: 2, end: 13 },
    };
    const comment = { ...createComment(7), locator };
    const loadError = { code: 'read_failed', message: 'failed' };

    session.updateHost({ comments: [comment], loadError });
    session.setComposerAttachment({ displayQuote: 'first\r\nsecond', locator });

    comment.commentText = 'mutated';
    loadError.message = 'mutated';
    locator.quote.exact = 'mutated';

    const snapshot = session.getSnapshot();
    expect(snapshot.comments[0]).toMatchObject({
      commentText: 'comment-7',
      locator: { quote: { exact: 'quoted text' } },
    });
    expect(snapshot.loadError).toEqual({ code: 'read_failed', message: 'failed' });
    expect(snapshot.composerAttachment).toMatchObject({
      displayQuote: 'first\nsecond',
      locator: { quote: { exact: 'quoted text' } },
    });
  });

  it('keeps one stable action object while reading the latest callbacks', async () => {
    const firstSave = vi.fn(async () => ({ ok: true, createdRootId: 1 }));
    const secondSave = vi.fn(async () => ({ ok: true, createdRootId: 2 }));
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const firstRetry = vi.fn();
    const secondRetry = vi.fn();
    let callbacks: CommentSidebarHostActionCallbacks = {
      onSave: firstSave,
      onClose: firstClose,
      onRetry: firstRetry,
    };
    const actions = createCommentSidebarHostActions(() => callbacks);
    const stableIdentity = actions;

    await actions.save('first');
    actions.close();
    actions.retry();
    callbacks = { onSave: secondSave, onClose: secondClose, onRetry: secondRetry };
    await actions.save('second');
    actions.close();
    actions.retry();

    expect(actions).toBe(stableIdentity);
    expect(Object.isFrozen(actions)).toBe(true);
    expect(firstSave).toHaveBeenCalledWith('first');
    expect(secondSave).toHaveBeenCalledWith('second');
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);
    expect(firstRetry).toHaveBeenCalledTimes(1);
    expect(secondRetry).toHaveBeenCalledTimes(1);
  });
});

describe('comment-sidebar-session', () => {
  it('normalizes quote text without destroying line breaks', () => {
    expect(normalizeCommentSidebarQuoteText(null)).toBe('');
    expect(normalizeCommentSidebarQuoteText('hello\r\nworld')).toBe('hello\nworld');
  });

  it('publishes one atomic snapshot before and after a panel attaches', () => {
    const session = createCommentSidebarSession();
    const panel = createPanelMock();
    const onClose = vi.fn();
    const comment = createComment();

    const attachment = session.setComposerAttachment({
      displayQuote: ' first\r\nsecond ',
      locator: {
        v: 1,
        env: 'inpage',
        quote: { type: 'TextQuoteSelector', exact: 'first\nsecond' },
        position: { type: 'TextPositionSelector', start: 0, end: 12 },
      },
    });
    session.updateHost({ busy: true, comments: [comment], actionCallbacks: { onClose } });
    session.requestOpen({ focusComposer: true, source: 'inpage' });

    expect(session.getSnapshot()).toEqual({
      open: true,
      busy: true,
      composerAttachment: attachment,
      comments: [comment],
      focusComposerSignal: 1,
      lastOpenSource: 'inpage',
      contextKey: '',
      loadStatus: 'idle',
      loadError: null,
    });

    const lease = session.attachPanel(panel.panel);
    expect(panel.calls.attach).toBe(1);
    expect(panel.getSnapshot()).toEqual(session.getSnapshot());
    expect(panel.getHost()?.actions).toBe(session.actions);

    panel.getHost()?.actions.close();
    expect(onClose).toHaveBeenCalledTimes(1);

    session.updateHost({ busy: false, comments: [createComment(2)] });
    expect(panel.getSnapshot()).toEqual(session.getSnapshot());
    expect(panel.getSnapshot()).toMatchObject({ busy: false, comments: [{ id: 2 }] });

    lease.dispose();
    expect(panel.calls.dispose).toBe(1);
    expect(panel.getHost()).toBeNull();
  });

  it('sets and clears quote + locator atomically with a guarded selection revision', () => {
    const session = createCommentSidebarSession();
    const first = session.setComposerAttachment({
      displayQuote: 'first quote',
      locator: {
        v: 1,
        env: 'app',
        quote: { type: 'TextQuoteSelector', exact: 'first quote' },
        position: { type: 'TextPositionSelector', start: 3, end: 14 },
      },
    });
    const second = session.setComposerAttachment({
      displayQuote: 'second quote',
      locator: null,
    });

    expect(first.selectionRevision).toBe(1);
    expect(second.selectionRevision).toBe(2);
    expect(session.clearComposerAttachment(first.selectionRevision)).toBe(false);
    expect(session.getSnapshot().composerAttachment).toEqual(second);

    expect(session.clearComposerAttachment(second.selectionRevision)).toBe(true);
    expect(session.getSnapshot().composerAttachment).toEqual({
      displayQuote: '',
      locator: null,
      selectionRevision: 3,
    });
  });

  it('uses open as direct host state and keeps the focus signal monotonic', () => {
    const session = createCommentSidebarSession();
    session.updateHost({ busy: true });
    session.requestOpen({ focusComposer: true, source: 'app' });

    expect(session.getSnapshot()).toMatchObject({
      open: true,
      busy: true,
      focusComposerSignal: 1,
      lastOpenSource: 'app',
    });

    session.requestClose();
    session.updateHost({ busy: false });
    expect(session.getSnapshot()).toMatchObject({
      open: false,
      busy: false,
      focusComposerSignal: 1,
      lastOpenSource: null,
    });
  });

  it('keeps a newer panel attached when an older session lease disposes', () => {
    const session = createCommentSidebarSession();
    const first = createPanelMock();
    const second = createPanelMock();
    const firstLease = session.attachPanel(first.panel);
    const secondLease = session.attachPanel(second.panel);

    expect(first.calls.dispose).toBe(1);
    expect(second.getSnapshot()).toEqual(session.getSnapshot());

    firstLease.dispose();
    session.requestOpen({ focusComposer: true, source: 'replacement' });
    expect(second.getSnapshot()).toMatchObject({ open: true, focusComposerSignal: 1 });
    expect(second.calls.dispose).toBe(0);

    secondLease.dispose();
    expect(second.calls.dispose).toBe(1);
  });

  it('updates callbacks without changing the stable actions identity', async () => {
    const session = createCommentSidebarSession();
    const actions = session.actions;
    const firstSave = vi.fn(async () => ({ ok: true, createdRootId: 1 }));
    const secondSave = vi.fn(async () => ({ ok: true, createdRootId: 2 }));

    session.updateHost({ actionCallbacks: { onSave: firstSave } });
    await actions.save('first');
    session.updateHost({ actionCallbacks: { onSave: secondSave } });
    await actions.save('second');

    expect(session.actions).toBe(actions);
    expect(firstSave).toHaveBeenCalledWith('first');
    expect(secondSave).toHaveBeenCalledWith('second');
  });

  it('disposes the panel, subscribers, and every captured action', async () => {
    const session = createCommentSidebarSession();
    const panel = createPanelMock();
    const onSave = vi.fn(async () => ({ ok: true }));
    const listener = vi.fn();
    session.updateHost({ actionCallbacks: { onSave } });
    const lease = session.attachPanel(panel.panel);
    const actions = session.actions;
    session.subscribe(listener);

    session.updateHost({ busy: true });
    expect(listener).toHaveBeenCalledTimes(1);
    session.dispose();
    await actions.save('after dispose');
    session.updateHost({ busy: false });
    session.requestOpen({ focusComposer: true });
    lease.dispose();

    expect(onSave).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toEqual(createCommentSidebarHostSnapshot());
    expect(panel.calls.dispose).toBe(1);
  });

  it('forwards selection and clear actions without clearing the attachment on save', async () => {
    const session = createCommentSidebarSession();
    const onComposerSelectionRequest = vi.fn(async () => {});
    const onComposerQuoteClearRequest = vi.fn(async () => {
      session.clearComposerAttachment();
    });
    const onSave = vi.fn(async () => ({ ok: true }));

    session.setComposerAttachment({ displayQuote: 'quoted text', locator: null });
    session.updateHost({
      actionCallbacks: { onSave, onComposerSelectionRequest, onComposerQuoteClearRequest },
    });

    await session.actions.requestComposerSelection({ trigger: 'button' });
    expect(onComposerSelectionRequest).toHaveBeenCalledWith({ trigger: 'button' });

    await session.actions.save('hello');
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('quoted text');

    await session.actions.clearComposerAttachment();
    expect(onComposerQuoteClearRequest).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('');
  });
});
