import { beforeEach, describe, expect, it, vi } from 'vitest';

const revisionMocks = vi.hoisted(() => ({
  subscribeDataRevisionChanges: vi.fn(),
  whenDataRevisionObserverReady: vi.fn(),
  requestDataRevisionRetry: vi.fn(),
}));

let revisionListener: ((scopes: readonly string[]) => void) | null = null;

vi.mock('@services/data-revisions/observer', () => ({
  subscribeDataRevisionChanges: (listener: (scopes: readonly string[]) => void) =>
    revisionMocks.subscribeDataRevisionChanges(listener),
  whenDataRevisionObserverReady: () => revisionMocks.whenDataRevisionObserverReady(),
  requestDataRevisionRetry: (scopes: readonly string[]) => revisionMocks.requestDataRevisionRetry(scopes),
}));

import { createArticleCommentsSidebarController } from '../../src/services/comments/sidebar/article-comments-sidebar-controller';
import { createCommentSidebarSession } from '../../src/services/comments/sidebar/comment-sidebar-session';

function createMockPanel() {
  let snapshot = {
    open: false,
    busy: false,
    composerAttachment: { displayQuote: '', locator: null, selectionRevision: 0 },
    comments: [] as any[],
    focusComposerSignal: 0,
    lastOpenSource: null as string | null,
  };
  let actions: any = {};
  let unsubscribe: (() => void) | null = null;

  const api = {
    attachHost(host: any) {
      unsubscribe?.();
      actions = host.actions;
      const sync = () => {
        snapshot = host.getSnapshot();
      };
      unsubscribe = host.subscribe(sync);
      sync();
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          unsubscribe?.();
          unsubscribe = null;
          actions = {};
        },
      };
    },
  };

  const handlers = () => ({
    onSave: actions.save,
    onReply: actions.reply,
    onDelete: actions.delete,
    onClose: actions.close,
    onComposerSelectionRequest: actions.requestComposerSelection,
    onComposerQuoteClearRequest: actions.clearComposerAttachment,
  });

  return {
    api,
    getState: () => ({
      open: snapshot.open,
      busy: snapshot.busy,
      quoteText: snapshot.composerAttachment.displayQuote,
      comments: snapshot.comments,
      handlers: handlers(),
      focusCount: snapshot.focusComposerSignal,
    }),
  };
}

async function activateSession(session: ReturnType<typeof createCommentSidebarSession>) {
  session.requestOpen();
  await Promise.resolve();
  await Promise.resolve();
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
  beforeEach(() => {
    revisionListener = null;
    revisionMocks.subscribeDataRevisionChanges.mockReset();
    revisionMocks.subscribeDataRevisionChanges.mockImplementation((listener) => {
      revisionListener = listener;
      return () => {
        if (revisionListener === listener) revisionListener = null;
      };
    });
    revisionMocks.whenDataRevisionObserverReady.mockReset();
    revisionMocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    revisionMocks.requestDataRevisionRetry.mockReset();
  });

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
    expect(snapshot.composerAttachment.displayQuote).toBe('Quoted');
    expect(snapshot.open).toBe(true);
    expect(snapshot.contextKey).toContain('/article');
    expect(adapter.ensureContext).toHaveBeenCalledTimes(1);
    expect(adapter.list).toHaveBeenCalledWith({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      fallbackPolicy: 'include-orphan-url',
      signal: expect.any(AbortSignal),
    });
    expect(panel.getState().focusCount).toBe(1);
    expect(panel.getState().comments.length).toBe(1);
  });

  it('save root: returns structured result, refreshes list, and clears composer quote', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 91 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/article', conversationId: 21 })),
    };

    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    adapter.list.mockClear();

    session.setComposerAttachment({ displayQuote: 'Quoted', locator: null });

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
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('');
  });

  it('updates quote and locator from composer selection requests', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);

    const locator = {
      v: 1 as const,
      env: 'inpage' as const,
      quote: { type: 'TextQuoteSelector' as const, exact: 'Quoted from page' },
      position: { type: 'TextPositionSelector' as const, start: 0, end: 16 },
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
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('Quoted from page');

    await handlers.onSave('root comment');
    expect(adapter.addRoot).toHaveBeenLastCalledWith({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      quoteText: 'Quoted from page',
      commentText: 'root comment',
      locator,
    });
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('');

    await handlers.onComposerSelectionRequest({ trigger: 'button' });
    expect(resolveComposerSelection).toHaveBeenNthCalledWith(2, { trigger: 'button' });
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('');
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
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('new quote');

    slow.resolve({ selectionText: 'old quote', locator: null });
    await oldRequest;
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('new quote');
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
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('Selection text only');

    await handlers.onSave('comment');
    expect(adapter.addRoot).toHaveBeenLastCalledWith({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      quoteText: 'Selection text only',
      commentText: 'comment',
      locator: null,
    });
  });

  it('does not clear a newer attachment after an older selection finishes saving', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const save = createDeferred<{ id: number }>();
    const firstLocator = {
      v: 1 as const,
      env: 'app' as const,
      quote: { type: 'TextQuoteSelector' as const, exact: 'first quote' },
      position: { type: 'TextPositionSelector' as const, start: 0, end: 11 },
    };
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(() => save.promise),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/article', conversationId: 21 })),
    };

    createArticleCommentsSidebarController({ session, adapter: adapter as any });
    const first = session.setComposerAttachment({ displayQuote: 'first quote', locator: firstLocator });
    const savePromise = panel.getState().handlers.onSave('comment');
    await vi.waitFor(() => {
      expect(adapter.addRoot).toHaveBeenCalledTimes(1);
    });
    const second = session.setComposerAttachment({ displayQuote: 'second quote', locator: null });

    save.resolve({ id: 7 });
    await savePromise;

    expect(adapter.addRoot).toHaveBeenCalledWith({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
      quoteText: 'first quote',
      commentText: 'comment',
      locator: firstLocator,
    });
    expect(first.selectionRevision).toBeLessThan(second.selectionRevision);
    expect(session.getSnapshot().composerAttachment).toEqual(second);
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
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('Quote A');

    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 2 });
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('');

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
    await activateSession(session);

    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    await vi.waitFor(() => {
      expect(panel.getState().comments[0]?.commentText).toBe('A');
    });

    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 2 });
    await vi.waitFor(() => {
      expect(panel.getState().comments[0]?.commentText).toBe('B');
    });

    expect(adapter.list).toHaveBeenNthCalledWith(1, {
      canonicalUrl: 'https://example.com/a',
      conversationId: 1,
      fallbackPolicy: 'include-orphan-url',
      signal: expect.any(AbortSignal),
    });
    expect(adapter.list).toHaveBeenNthCalledWith(2, {
      canonicalUrl: 'https://example.com/b',
      conversationId: 2,
      fallbackPolicy: 'include-orphan-url',
      signal: expect.any(AbortSignal),
    });
  });

  it('setContext: ignores stale refresh results from previous context', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const deferredA = createDeferred<any[]>();
    const deferredB = createDeferred<any[]>();

    const seenSignals: AbortSignal[] = [];
    const adapter = {
      list: vi.fn(({ canonicalUrl, signal }: { canonicalUrl: string; signal: AbortSignal }) => {
        seenSignals.push(signal);
        if (canonicalUrl.includes('/a')) return deferredA.promise;
        return deferredB.promise;
      }),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await activateSession(session);

    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(1));
    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 2 });

    expect(seenSignals[0]?.aborted).toBe(true);
    expect(controller.getLoadSnapshot().status).toBe('loading');

    deferredB.resolve([{ id: 2, parentId: null, commentText: 'B', quoteText: '', createdAt: 2 }]);
    await vi.waitFor(() => {
      expect(panel.getState().comments[0]?.commentText).toBe('B');
    });
    expect(controller.getLoadSnapshot()).toMatchObject({ status: 'ready', error: null });

    deferredA.resolve([{ id: 1, parentId: null, commentText: 'A', quoteText: '', createdAt: 1 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.getState().comments[0]?.commentText).toBe('B');
  });

  it('keeps the last ready snapshot and reports stale_error when refresh fails', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const failure = Object.assign(new Error('background unavailable'), { code: 'request_failed' });
    const adapter = {
      list: vi
        .fn()
        .mockResolvedValueOnce([{ id: 1, parentId: null, commentText: 'Ready', quoteText: '', createdAt: 1 }])
        .mockRejectedValueOnce(failure),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await activateSession(session);
    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });

    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot().status).toBe('ready');
    });
    expect(panel.getState().comments[0]?.commentText).toBe('Ready');

    await controller.refresh();

    expect(panel.getState().comments[0]?.commentText).toBe('Ready');
    expect(controller.getLoadSnapshot()).toMatchObject({
      status: 'stale_error',
      error: { code: 'request_failed', message: 'background unavailable' },
    });
    expect(panel.getState().busy).toBe(false);
  });

  it('waits for URL migration before loading and preserves the prior snapshot on migration failure', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const migration = createDeferred<void>();
    const adapter = {
      list: vi.fn(async ({ canonicalUrl }: { canonicalUrl: string }) => [
        { id: 1, parentId: null, commentText: canonicalUrl, quoteText: '', createdAt: 1 },
      ]),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      migrateCanonicalUrl: vi.fn(() => migration.promise),
    };

    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await activateSession(session);
    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 9 });
    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot().status).toBe('ready');
    });
    expect(adapter.list).toHaveBeenCalledTimes(1);

    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 9 });
    await vi.waitFor(() => expect(adapter.migrateCanonicalUrl).toHaveBeenCalledTimes(1));
    expect(controller.getLoadSnapshot().status).toBe('loading');
    expect(adapter.list).toHaveBeenCalledTimes(1);
    const migrationSignal = adapter.migrateCanonicalUrl.mock.calls[0]?.[0]?.signal as AbortSignal;
    expect(migrationSignal.aborted).toBe(false);

    migration.reject(Object.assign(new Error('migration failed'), { code: 'request_failed' }));
    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot().status).toBe('stale_error');
    });

    expect(panel.getState().comments[0]?.commentText).toBe('https://example.com/a');
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(controller.getLoadSnapshot().error).toEqual({
      code: 'request_failed',
      message: 'migration failed',
    });
  });

  it('aborts an obsolete URL migration before loading the next context', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const migrationToB = createDeferred<void>();
    const migrationToC = createDeferred<void>();
    const adapter = {
      list: vi.fn(async ({ canonicalUrl }: { canonicalUrl: string }) => [
        { id: 1, parentId: null, commentText: canonicalUrl, quoteText: '', createdAt: 1 },
      ]),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      migrateCanonicalUrl: vi.fn(({ toCanonicalUrl }: { toCanonicalUrl: string }) =>
        toCanonicalUrl.endsWith('/b') ? migrationToB.promise : migrationToC.promise,
      ),
    };

    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await activateSession(session);
    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 9 });
    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot().status).toBe('ready');
    });

    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 9 });
    await vi.waitFor(() => expect(adapter.migrateCanonicalUrl).toHaveBeenCalledTimes(1));
    const migrationToBSignal = adapter.migrateCanonicalUrl.mock.calls[0]?.[0]?.signal as AbortSignal;
    controller.setContext({ canonicalUrl: 'https://example.com/c', conversationId: 9 });
    await vi.waitFor(() => expect(adapter.migrateCanonicalUrl).toHaveBeenCalledTimes(2));

    expect(migrationToBSignal.aborted).toBe(true);

    migrationToB.resolve();
    await Promise.resolve();
    expect(adapter.list).toHaveBeenCalledTimes(1);

    migrationToC.resolve();
    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot().status).toBe('ready');
      expect(panel.getState().comments[0]?.commentText).toBe('https://example.com/c');
    });
    expect(adapter.list).toHaveBeenCalledTimes(2);
  });

  it('publishes idle/loading/ready state transitions to subscribers', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const deferred = createDeferred<any[]>();
    const adapter = {
      list: vi.fn(() => deferred.promise),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await activateSession(session);
    const states: string[] = [controller.getLoadSnapshot().status];
    const unsubscribe = controller.subscribeLoadState(() => {
      states.push(controller.getLoadSnapshot().status);
    });

    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    await vi.waitFor(() => expect(panel.getState().busy).toBe(true));
    deferred.resolve([]);
    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot().status).toBe('ready');
    });
    unsubscribe();

    expect(states).toEqual(['idle', 'loading', 'ready']);
    expect(panel.getState().busy).toBe(false);
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
    await activateSession(session);

    controller.setContext({ canonicalUrl: 'https://linux.do/t/topic-slug/123/20', conversationId: 9 });
    await vi.waitFor(() => {
      expect(panel.getState().comments[0]?.commentText).toBe('Topic');
    });
    expect(adapter.list).toHaveBeenCalledTimes(1);

    session.setComposerAttachment({ displayQuote: 'keep draft', locator: null });
    controller.setContext({ canonicalUrl: 'https://linux.do/t/topic-slug/123/1', conversationId: 9 });

    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('keep draft');
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();
  });

  it('dispose aborts the active load and ignores late results', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const deferred = createDeferred<any[]>();
    const adapter = {
      list: vi.fn(() => deferred.promise),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    const listener = vi.fn();
    controller.subscribeLoadState(listener);
    await activateSession(session);

    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(1));
    const signal = adapter.list.mock.calls[0]?.[0]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(panel.getState().busy).toBe(true);

    controller.dispose();
    controller.dispose();

    expect(signal.aborted).toBe(true);
    expect(panel.getState().busy).toBe(false);

    deferred.resolve([{ id: 1, parentId: null, commentText: 'late', quoteText: '', createdAt: 1 }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.getState().comments).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);

    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 2 });
    await controller.open({ focusComposer: true });
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().open).toBe(true);
  });

  it('dispose drops late save and composer-selection completions', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const addRoot = createDeferred<{ id: number }>();
    const remove = createDeferred<void>();
    const selection = createDeferred<{ selectionText: string; locator: unknown | null }>();
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(() => addRoot.promise),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(() => remove.promise),
    };
    const controller = createArticleCommentsSidebarController({
      session,
      adapter: adapter as any,
      resolveComposerSelection: () => selection.promise,
    });
    await activateSession(session);
    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot().status).toBe('ready');
    });
    session.setComposerAttachment({ displayQuote: 'keep after dispose', locator: null });
    const handlers = panel.getState().handlers;
    const savePromise = handlers.onSave('late save');
    const deletePromise = handlers.onDelete(7);
    await handlers.onComposerSelectionRequest({ trigger: 'button' });

    controller.dispose();
    addRoot.resolve({ id: 99 });
    remove.resolve();
    selection.resolve({ selectionText: 'late selection', locator: null });

    await expect(savePromise).resolves.toBe(false);
    await expect(deletePromise).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(session.getSnapshot().composerAttachment.displayQuote).toBe('keep after dispose');
    expect(adapter.list).toHaveBeenCalledTimes(1);
  });

  it('drops a mutation completion from an obsolete context generation', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const addRoot = createDeferred<{ id: number }>();
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(() => addRoot.promise),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await activateSession(session);
    controller.setContext({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot().status).toBe('ready');
    });

    const savePromise = panel.getState().handlers.onSave('obsolete save');
    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 2 });
    await vi.waitFor(() => {
      expect(controller.getLoadSnapshot()).toMatchObject({
        status: 'ready',
        contextKey: expect.stringContaining('/b'),
      });
    });

    addRoot.resolve({ id: 88 });
    await expect(savePromise).resolves.toBe(false);

    expect(adapter.list).toHaveBeenCalledTimes(2);
    expect(controller.getContext()).toEqual({ canonicalUrl: 'https://example.com/b', conversationId: 2 });
    expect(session.getSnapshot().contextKey).toContain('/b');
  });

  it('subscribes before the first open read and allows degraded readiness to proceed', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const readiness = createDeferred<{ baselineAvailable: boolean }>();
    revisionMocks.whenDataRevisionObserverReady.mockReturnValue(readiness.promise);
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });

    const opening = controller.open({ ensureContext: true });
    expect(revisionMocks.subscribeDataRevisionChanges).toHaveBeenCalledTimes(1);
    expect(adapter.ensureContext).not.toHaveBeenCalled();
    expect(adapter.list).not.toHaveBeenCalled();

    readiness.resolve({ baselineAvailable: false });
    await opening;

    expect(adapter.ensureContext).toHaveBeenCalledTimes(1);
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(controller.getLoadSnapshot().status).toBe('ready');
  });

  it('keeps closed setContext side-effect free and defers A-to-B migration until reopen', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const adapter = {
      list: vi.fn(async ({ canonicalUrl }: { canonicalUrl: string }) => [
        { id: 1, parentId: null, commentText: canonicalUrl, quoteText: '', createdAt: 1 },
      ]),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 9 })),
      migrateCanonicalUrl: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    expect(adapter.list).toHaveBeenCalledTimes(1);

    session.requestClose();
    expect(revisionListener).toBeNull();
    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 9 });
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();

    await controller.open({ ensureContext: false });
    expect(adapter.migrateCanonicalUrl).toHaveBeenCalledWith({
      fromCanonicalUrl: 'https://example.com/a',
      toCanonicalUrl: 'https://example.com/b',
      conversationId: 9,
      signal: expect.any(AbortSignal),
    });
    expect(adapter.list).toHaveBeenCalledTimes(2);
    expect(controller.getContext()).toEqual({ canonicalUrl: 'https://example.com/b', conversationId: 9 });
  });

  it('refreshes only comments on article_comments revisions and coalesces in-flight diffs to one trailing read', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const firstRevisionRead = createDeferred<any[]>();
    const adapter = {
      list: vi
        .fn()
        .mockResolvedValueOnce([{ id: 1, parentId: null, commentText: 'initial', quoteText: '', createdAt: 1 }])
        .mockImplementationOnce(() => firstRevisionRead.promise)
        .mockResolvedValueOnce([{ id: 2, parentId: null, commentText: 'latest', quoteText: '', createdAt: 2 }]),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 9 })),
      migrateCanonicalUrl: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    adapter.migrateCanonicalUrl.mockClear();

    revisionListener?.(['article_comments']);
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(2));
    revisionListener?.(['article_comments']);
    revisionListener?.(['article_comments']);
    await Promise.resolve();
    expect(adapter.list).toHaveBeenCalledTimes(2);

    firstRevisionRead.resolve([{ id: 10, parentId: null, commentText: 'intermediate', quoteText: '', createdAt: 10 }]);
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(panel.getState().comments[0]?.commentText).toBe('latest'));
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();
  });

  it('preserves last-good comments on list reject, requests retry, and accepts authoritative empty on replay', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const failure = Object.assign(new Error('temporary read failure'), { code: 'request_failed' });
    const adapter = {
      list: vi
        .fn()
        .mockResolvedValueOnce([{ id: 1, parentId: null, commentText: 'ready', quoteText: '', createdAt: 1 }])
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce([]),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    revisionMocks.requestDataRevisionRetry.mockClear();

    revisionListener?.(['article_comments']);
    await vi.waitFor(() => expect(controller.getLoadSnapshot().status).toBe('stale_error'));
    expect(panel.getState().comments[0]?.commentText).toBe('ready');
    expect(revisionMocks.requestDataRevisionRetry).toHaveBeenCalledWith(['article_comments']);

    revisionMocks.requestDataRevisionRetry.mockClear();
    revisionListener?.(['article_comments']);
    await vi.waitFor(() => expect(controller.getLoadSnapshot().status).toBe('ready'));
    expect(panel.getState().comments).toEqual([]);
    expect(revisionMocks.requestDataRevisionRetry).not.toHaveBeenCalled();
  });

  it('cancels pending readiness and late read failures on close without retrying or committing', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const readiness = createDeferred<{ baselineAvailable: boolean }>();
    revisionMocks.whenDataRevisionObserverReady.mockReturnValueOnce(readiness.promise);
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });

    const opening = controller.open({ ensureContext: true });
    session.requestClose();
    readiness.resolve({ baselineAvailable: true });
    await opening;
    expect(adapter.ensureContext).not.toHaveBeenCalled();
    expect(adapter.list).not.toHaveBeenCalled();
    expect(revisionMocks.requestDataRevisionRetry).not.toHaveBeenCalled();

    revisionMocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    const lateRead = createDeferred<any[]>();
    adapter.ensureContext.mockResolvedValue({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    adapter.list.mockImplementationOnce(() => lateRead.promise);
    const reopened = controller.open({ ensureContext: true });
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(1));
    session.requestClose();
    lateRead.reject(new Error('late read failure'));
    await reopened;
    await Promise.resolve();
    expect(revisionMocks.requestDataRevisionRetry).not.toHaveBeenCalled();
    expect(controller.getLoadSnapshot().status).toBe('idle');
  });

  it('ignores conversations revisions for adapters without a readonly identity lookup', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    adapter.list.mockClear();

    revisionListener?.(['conversations']);
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.list).not.toHaveBeenCalled();
    expect(revisionMocks.requestDataRevisionRetry).not.toHaveBeenCalled();
  });

  it('does a readonly conversations reconcile and skips refresh when identity is unchanged', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
      findExistingContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
      migrateCanonicalUrl: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    adapter.list.mockClear();
    adapter.migrateCanonicalUrl.mockClear();

    revisionListener?.(['conversations']);
    await vi.waitFor(() => expect(adapter.findExistingContext).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(adapter.findExistingContext).toHaveBeenCalledWith({
      canonicalUrl: 'https://example.com/a',
      signal: expect.any(AbortSignal),
    });
    expect(adapter.list).not.toHaveBeenCalled();
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();
    expect(controller.getContext()).toEqual({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
  });

  it('applies found and missing readonly identities and refreshes without migrating comments', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const adapter = {
      list: vi.fn(async ({ conversationId }: { conversationId: number | null }) => [
        { id: conversationId ?? 99, parentId: null, commentText: String(conversationId), quoteText: '', createdAt: 1 },
      ]),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
      findExistingContext: vi
        .fn()
        .mockResolvedValueOnce({ canonicalUrl: 'https://example.com/a', conversationId: 2 })
        .mockResolvedValueOnce({ canonicalUrl: 'https://example.com/a', conversationId: null }),
      migrateCanonicalUrl: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    adapter.list.mockClear();
    adapter.migrateCanonicalUrl.mockClear();

    revisionListener?.(['conversations']);
    await vi.waitFor(() => expect(controller.getContext()?.conversationId).toBe(2));
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(1));
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();

    revisionListener?.(['conversations']);
    await vi.waitFor(() => expect(controller.getContext()?.conversationId).toBeNull());
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(2));
    expect(controller.getContext()?.canonicalUrl).toBe('https://example.com/a');
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();
  });

  it('retries a current FIND rejection without refreshing, then converges on same-revision replay', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
      findExistingContext: vi
        .fn()
        .mockRejectedValueOnce(new Error('find unavailable'))
        .mockResolvedValueOnce({ canonicalUrl: 'https://example.com/a', conversationId: 2 }),
      migrateCanonicalUrl: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    adapter.list.mockClear();
    revisionMocks.requestDataRevisionRetry.mockClear();

    revisionListener?.(['conversations']);
    await vi.waitFor(() => expect(revisionMocks.requestDataRevisionRetry).toHaveBeenCalledWith(['conversations']));
    expect(controller.getContext()).toEqual({ canonicalUrl: 'https://example.com/a', conversationId: 1 });
    expect(adapter.list).not.toHaveBeenCalled();
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();

    revisionMocks.requestDataRevisionRetry.mockClear();
    revisionListener?.(['conversations']);
    await vi.waitFor(() => expect(controller.getContext()?.conversationId).toBe(2));
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(1));
    expect(revisionMocks.requestDataRevisionRetry).not.toHaveBeenCalled();
  });

  it('orders combined conversations and article_comments batches as FIND then one comments refresh', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const order: string[] = [];
    const adapter = {
      list: vi.fn(async () => {
        order.push('list');
        return [];
      }),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
      findExistingContext: vi.fn(async () => {
        order.push('find');
        return { canonicalUrl: 'https://example.com/a', conversationId: 1 };
      }),
      migrateCanonicalUrl: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    order.length = 0;
    adapter.list.mockClear();

    revisionListener?.(['article_comments', 'conversations']);
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledTimes(1));

    expect(order).toEqual(['find', 'list']);
    expect(adapter.findExistingContext).toHaveBeenCalledTimes(1);
    expect(adapter.migrateCanonicalUrl).not.toHaveBeenCalled();
  });

  it('drops old-context and closed-activation FIND completions without retry or state changes', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const oldFind = createDeferred<{ canonicalUrl: string; conversationId: number | null }>();
    const closedFind = createDeferred<{ canonicalUrl: string; conversationId: number | null }>();
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      ensureContext: vi.fn(async () => ({ canonicalUrl: 'https://example.com/a', conversationId: 1 })),
      findExistingContext: vi.fn().mockImplementationOnce(() => oldFind.promise).mockImplementationOnce(() => closedFind.promise),
      migrateCanonicalUrl: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any });
    await controller.open({ ensureContext: true });
    adapter.list.mockClear();
    revisionMocks.requestDataRevisionRetry.mockClear();

    revisionListener?.(['conversations']);
    await vi.waitFor(() => expect(adapter.findExistingContext).toHaveBeenCalledTimes(1));
    controller.setContext({ canonicalUrl: 'https://example.com/b', conversationId: 7 });
    oldFind.resolve({ canonicalUrl: 'https://example.com/a', conversationId: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getContext()).toEqual({ canonicalUrl: 'https://example.com/b', conversationId: 7 });
    expect(revisionMocks.requestDataRevisionRetry).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(controller.getLoadSnapshot().status).toBe('ready'));
    adapter.list.mockClear();
    revisionListener?.(['conversations']);
    await vi.waitFor(() => expect(adapter.findExistingContext).toHaveBeenCalledTimes(2));
    session.requestClose();
    closedFind.reject(new Error('late find failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getContext()).toEqual({ canonicalUrl: 'https://example.com/b', conversationId: 7 });
    expect(adapter.list).not.toHaveBeenCalled();
    expect(revisionMocks.requestDataRevisionRetry).not.toHaveBeenCalled();
  });

  it('close is idempotent and does not notify after the first transition', async () => {
    const panel = createMockPanel();
    const session = createCommentSidebarSession(panel.api as any);
    const onClose = vi.fn();
    const adapter = {
      list: vi.fn(async () => []),
      addRoot: vi.fn(async () => ({ id: 1 })),
      addReply: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const controller = createArticleCommentsSidebarController({ session, adapter: adapter as any, onClose });

    await controller.open({ ensureContext: false });
    expect(session.getSnapshot().open).toBe(true);

    const close = panel.getState().handlers.onClose;
    close();
    close();

    expect(session.getSnapshot().open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
