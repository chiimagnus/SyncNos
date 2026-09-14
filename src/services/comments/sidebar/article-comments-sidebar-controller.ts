import type {
  CommentSidebarHostActionCallbacks,
  CommentSidebarLoadError,
  CommentSidebarLoadStatus,
  CommentSidebarSession,
} from '@services/comments/sidebar/comment-sidebar-contract';
import { hasValidArticleCommentContent } from '@services/comments/domain/comment-content';
import { normalizePositiveInt } from '@services/shared/numbers';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import {
  requestDataRevisionRetry,
  subscribeDataRevisionChanges,
  whenDataRevisionObserverReady,
} from '@services/data-revisions/observer';
import {
  buildCommentContextIdentityKey,
  classifyCommentContextTransition,
  normalizeCommentContextIdentity,
  type CommentContextTransition,
} from '@services/comments/sidebar/comment-context-transition';

import type {
  ArticleCommentsSidebarAdapter,
  ArticleCommentsSidebarContext,
  ArticleCommentsSidebarEnsureContextInput,
} from '@services/comments/sidebar/article-comments-sidebar-adapter';

type ArticleCommentsSidebarControllerOpenInput = {
  focusComposer?: boolean;
  source?: string;
  ensureContext?: boolean;
  ensureContextInput?: ArticleCommentsSidebarEnsureContextInput;
};

type ArticleCommentsSidebarControllerComposerSelectionPayload = {
  selectionText?: string | null;
  locator?: unknown;
};

export type ArticleCommentsSidebarController = {
  open: (input?: ArticleCommentsSidebarControllerOpenInput) => Promise<void>;
  refresh: () => Promise<void>;
  getContext: () => ArticleCommentsSidebarContext | null;
  setContext: (context: ArticleCommentsSidebarContext | null) => void;
  dispose: () => void;
};

type ControllerOperation = {
  generation: number;
  activationGeneration: number;
  abortController: AbortController;
};

type IdentityReconcileResult = 'changed' | 'unchanged' | 'failed' | 'stale';

class ControllerOperationAbortedError extends Error {
  constructor() {
    super('article comments controller operation aborted');
    this.name = 'ControllerOperationAbortedError';
  }
}

function safeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeConversationId(value: unknown): number | null {
  return normalizePositiveInt(value);
}

function normalizeContext(
  next: ArticleCommentsSidebarContext | null | undefined,
): ArticleCommentsSidebarContext | null {
  return normalizeCommentContextIdentity(next);
}

function toLoadError(error: unknown): CommentSidebarLoadError {
  const value = error as { code?: unknown; message?: unknown } | null;
  return {
    code: safeString(value?.code) || 'unknown',
    message: safeString(value?.message) || 'failed to load article comments',
  };
}

function waitForOperation<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ControllerOperationAbortedError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new ControllerOperationAbortedError()));
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function createArticleCommentsSidebarController(input: {
  session: CommentSidebarSession;
  adapter: ArticleCommentsSidebarAdapter;
  onClose?: () => void;
  resolveComposerSelection?: () => ArticleCommentsSidebarControllerComposerSelectionPayload | null | undefined;
}): ArticleCommentsSidebarController {
  const session = input.session;
  const adapter = input.adapter;
  const onClose = input.onClose;

  let activeContext: ArticleCommentsSidebarContext | null = null;
  let lastLoadedContext: ArticleCommentsSidebarContext | null = null;
  let lastEnsureContextInput: ArticleCommentsSidebarEnsureContextInput | undefined;
  let operationGeneration = 0;
  let mutationGeneration = 0;
  let activeOperation: ControllerOperation | null = null;
  let disposed = false;
  let sessionOpen = session.getSnapshot().open === true;
  let activationGeneration = 0;
  let activationReady = false;
  let activationReadyPromise: Promise<void> = Promise.resolve();
  let resolveActivationReady: (() => void) | null = null;
  let revisionUnsubscribe: (() => void) | null = null;
  let sessionUnsubscribe: (() => void) | null = null;
  let pendingRevisionScopes = new Set<'article_comments' | 'conversations'>();
  let revisionBatchDraining = false;
  let identityReconcileGeneration = 0;
  let identityAbortController: AbortController | null = null;
  let deferredArticleCommentsAfterIdentityFailure = false;
  let drainPendingRevisionBatch: () => void = () => {};
  const getCanonicalUrl = () => canonicalizeArticleUrl(activeContext?.canonicalUrl);
  const getContextKey = () => buildCommentContextIdentityKey(activeContext);

  const publishLoadState = (status: CommentSidebarLoadStatus, error: CommentSidebarLoadError | null = null) => {
    if (disposed) return;
    session.updateHost({
      busy: status === 'loading',
      loadStatus: status,
      loadError: error,
      contextKey: getContextKey(),
    });
  };

  const abortActiveOperation = () => {
    activeOperation?.abortController.abort();
    activeOperation = null;
  };

  const beginOperation = (): ControllerOperation => {
    abortActiveOperation();
    const operation = {
      generation: ++operationGeneration,
      activationGeneration,
      abortController: new AbortController(),
    };
    activeOperation = operation;
    publishLoadState('loading');
    return operation;
  };

  const isCurrentOperation = (operation: ControllerOperation) =>
    !disposed &&
    sessionOpen &&
    activeOperation === operation &&
    operation.generation === operationGeneration &&
    operation.activationGeneration === activationGeneration &&
    !operation.abortController.signal.aborted;

  const finishOperation = (
    operation: ControllerOperation,
    status: Exclude<CommentSidebarLoadStatus, 'loading'>,
    error: CommentSidebarLoadError | null = null,
  ) => {
    if (!isCurrentOperation(operation)) return;
    activeOperation = null;
    publishLoadState(status, error);
    void Promise.resolve().then(() => drainPendingRevisionBatch());
  };

  const applyComposerSelection = (payload?: ArticleCommentsSidebarControllerComposerSelectionPayload | null) => {
    if (disposed) return;
    const quoteText = String(payload?.selectionText ?? '');
    if (!quoteText) return;
    session.setComposerAttachment({ quoteText, locator: payload?.locator });
  };

  const assignContext = (
    next: ArticleCommentsSidebarContext | null | undefined,
    options?: { clearComposer?: boolean; invalidateMutations?: boolean },
  ): CommentContextTransition => {
    const transition = classifyCommentContextTransition(activeContext, next);
    if (transition.kind === 'same') return transition;

    if (options?.invalidateMutations !== false) mutationGeneration += 1;
    activeContext = transition.next;
    session.updateHost({ contextKey: getContextKey() });
    if (options?.clearComposer !== false) {
      session.clearComposerAttachment();
    }

    if (transition.kind === 'conversation-change' || transition.kind === 'invalid') {
      session.updateHost({ comments: [] });
    }
    return transition;
  };

  const loadComments = async (operation: ControllerOperation) => {
    const context = normalizeContext(activeContext);
    if (!context) {
      finishOperation(operation, 'idle');
      return;
    }

    try {
      const items = await waitForOperation(
        adapter.list({
          canonicalUrl: context.canonicalUrl,
          conversationId: context.conversationId,
          fallbackPolicy: 'include-orphan-url',
          signal: operation.abortController.signal,
        }),
        operation.abortController.signal,
      );
      if (!isCurrentOperation(operation)) return;
      session.updateHost({ comments: Array.isArray(items) ? items : [] });
      lastLoadedContext = context;
      finishOperation(operation, 'ready');
    } catch (error) {
      if (error instanceof ControllerOperationAbortedError || !isCurrentOperation(operation)) return;
      requestDataRevisionRetry(['article_comments']);
      finishOperation(operation, 'stale_error', toLoadError(error));
    }
  };

  const migrateThenLoad = async (operation: ControllerOperation, transition: CommentContextTransition) => {
    if (
      transition.kind === 'url-migrate' &&
      transition.previous &&
      transition.next &&
      typeof adapter.migrateCanonicalUrl === 'function'
    ) {
      try {
        await waitForOperation(
          adapter.migrateCanonicalUrl({
            fromCanonicalUrl: transition.previous.canonicalUrl,
            toCanonicalUrl: transition.next.canonicalUrl,
            conversationId: transition.next.conversationId,
            signal: operation.abortController.signal,
          }),
          operation.abortController.signal,
        );
      } catch (error) {
        if (error instanceof ControllerOperationAbortedError || !isCurrentOperation(operation)) return;
        finishOperation(operation, 'stale_error', toLoadError(error));
        return;
      }
    }
    await loadComments(operation);
  };

  const waitForCurrentActivationReadiness = async (): Promise<boolean> => {
    const generation = activationGeneration;
    const ready = activationReadyPromise;
    await ready;
    return !disposed && sessionOpen && activationReady && generation === activationGeneration;
  };

  const refresh = async () => {
    if (disposed || !sessionOpen) return;
    if (!(await waitForCurrentActivationReadiness())) return;
    if (!normalizeContext(activeContext)) {
      abortActiveOperation();
      publishLoadState('idle');
      return;
    }
    const operation = beginOperation();
    await loadComments(operation);
  };

  const invalidateIdentityReconcile = () => {
    identityReconcileGeneration += 1;
    identityAbortController?.abort();
    identityAbortController = null;
  };

  const reconcileExistingContext = async (): Promise<IdentityReconcileResult> => {
    if (typeof adapter.findExistingContext !== 'function') return 'unchanged';
    const canonicalUrl = getCanonicalUrl();
    if (!canonicalUrl) return 'unchanged';

    const generation = identityReconcileGeneration;
    const expectedActivationGeneration = activationGeneration;
    const expectedContextKey = getContextKey();
    const abortController = new AbortController();
    identityAbortController = abortController;

    try {
      const resolved = await adapter.findExistingContext({ canonicalUrl, signal: abortController.signal });
      if (
        disposed ||
        !sessionOpen ||
        !activationReady ||
        generation !== identityReconcileGeneration ||
        expectedActivationGeneration !== activationGeneration ||
        expectedContextKey !== getContextKey() ||
        abortController.signal.aborted
      ) {
        return 'stale';
      }

      const normalized = normalizeContext(resolved);
      if (!normalized || canonicalizeArticleUrl(normalized.canonicalUrl) !== canonicalUrl) {
        requestDataRevisionRetry(['conversations']);
        return 'failed';
      }
      if (buildCommentContextIdentityKey(normalized) === getContextKey()) return 'unchanged';

      assignContext(normalized);
      return 'changed';
    } catch (_error) {
      if (
        disposed ||
        !sessionOpen ||
        !activationReady ||
        generation !== identityReconcileGeneration ||
        expectedActivationGeneration !== activationGeneration ||
        expectedContextKey !== getContextKey() ||
        abortController.signal.aborted
      ) {
        return 'stale';
      }
      requestDataRevisionRetry(['conversations']);
      return 'failed';
    } finally {
      if (identityAbortController === abortController) identityAbortController = null;
    }
  };

  drainPendingRevisionBatch = () => {
    if (
      disposed ||
      !sessionOpen ||
      !activationReady ||
      !pendingRevisionScopes.size ||
      activeOperation ||
      revisionBatchDraining
    ) {
      return;
    }

    const batch = new Set(pendingRevisionScopes);
    pendingRevisionScopes.clear();
    revisionBatchDraining = true;
    void (async () => {
      let shouldRefreshComments = batch.has('article_comments');
      if (
        deferredArticleCommentsAfterIdentityFailure &&
        !batch.has('conversations') &&
        typeof adapter.findExistingContext === 'function'
      ) {
        return;
      }
      if (batch.has('conversations') && typeof adapter.findExistingContext === 'function') {
        const hadDeferredArticleComments = deferredArticleCommentsAfterIdentityFailure;
        const identityResult = await reconcileExistingContext();
        if (disposed || !sessionOpen || !activationReady) return;
        if (pendingRevisionScopes.has('conversations')) {
          if (shouldRefreshComments || hadDeferredArticleComments) {
            deferredArticleCommentsAfterIdentityFailure = true;
          }
          return;
        }
        if (identityResult === 'failed') {
          if (shouldRefreshComments || hadDeferredArticleComments || pendingRevisionScopes.has('article_comments')) {
            deferredArticleCommentsAfterIdentityFailure = true;
          }
          return;
        }
        if (identityResult === 'stale') return;

        if (pendingRevisionScopes.delete('article_comments')) shouldRefreshComments = true;
        deferredArticleCommentsAfterIdentityFailure = false;
        if (identityResult === 'changed' || hadDeferredArticleComments) shouldRefreshComments = true;
      }
      if (shouldRefreshComments) await refresh();
    })().finally(() => {
      revisionBatchDraining = false;
      drainPendingRevisionBatch();
    });
  };

  const scheduleRevisionBatch = (scopes: readonly ('article_comments' | 'conversations')[]) => {
    if (disposed || !sessionOpen) return;
    for (const scope of scopes) pendingRevisionScopes.add(scope);
    drainPendingRevisionBatch();
  };

  const deactivateRevisionActivation = () => {
    resolveActivationReady?.();
    resolveActivationReady = null;
    activationGeneration += 1;
    activationReady = false;
    revisionUnsubscribe?.();
    revisionUnsubscribe = null;
    pendingRevisionScopes.clear();
    deferredArticleCommentsAfterIdentityFailure = false;
    invalidateIdentityReconcile();
    operationGeneration += 1;
    mutationGeneration += 1;
    abortActiveOperation();
    publishLoadState('idle');
  };

  const activateRevisionActivation = () => {
    const generation = ++activationGeneration;
    activationReady = false;
    activationReadyPromise = new Promise<void>((resolve) => {
      resolveActivationReady = resolve;
    });
    revisionUnsubscribe = subscribeDataRevisionChanges((scopes) => {
      if (disposed || !sessionOpen || generation !== activationGeneration) return;
      const nextScopes: Array<'article_comments' | 'conversations'> = [];
      if (scopes.includes('article_comments')) nextScopes.push('article_comments');
      if (typeof adapter.findExistingContext === 'function' && scopes.includes('conversations')) {
        invalidateIdentityReconcile();
        nextScopes.push('conversations');
      }
      if (!nextScopes.length) return;
      scheduleRevisionBatch(nextScopes);
    });
    void whenDataRevisionObserverReady().then(() => {
      if (disposed || !sessionOpen || generation !== activationGeneration) return;
      activationReady = true;
      resolveActivationReady?.();
      resolveActivationReady = null;
      drainPendingRevisionBatch();
    });
  };

  const handleSessionOpenState = () => {
    const nextOpen = session.getSnapshot().open === true;
    if (nextOpen === sessionOpen) return;
    sessionOpen = nextOpen;
    if (sessionOpen) activateRevisionActivation();
    else deactivateRevisionActivation();
  };

  sessionUnsubscribe = session.subscribe(handleSessionOpenState);
  if (sessionOpen) activateRevisionActivation();

  const isMutationCurrent = (generation: number) => !disposed && generation === mutationGeneration;

  const ensureContextForAction = async (generation: number) => {
    if (!isMutationCurrent(generation)) return null;
    const canonicalUrl = getCanonicalUrl();
    if (canonicalUrl) return activeContext;
    if (typeof adapter.ensureContext !== 'function') return activeContext;
    const resolved = await adapter.ensureContext(lastEnsureContextInput);
    if (!isMutationCurrent(generation)) return null;
    assignContext(resolved, { clearComposer: false, invalidateMutations: false });
    return activeContext;
  };

  const installHandlers = () => {
    const actionCallbacks: CommentSidebarHostActionCallbacks = {
      onClose: () => {
        if (disposed) return;
        if (!session.getSnapshot().open) return;
        session.requestClose();
        try {
          onClose?.();
        } catch (_e) {
          // ignore
        }
      },
      onSave: async (text) => {
        const generation = mutationGeneration;
        if (!isMutationCurrent(generation)) return false;
        const value = safeString(text);

        const ctx = await ensureContextForAction(generation);
        if (!isMutationCurrent(generation)) return false;
        const canonicalUrl = canonicalizeArticleUrl(ctx?.canonicalUrl);
        if (!canonicalUrl) throw new Error('missing canonicalUrl for article comment save');

        const attachment = session.getSnapshot().composerAttachment;
        const quoteText = attachment.quoteText;
        const locator = quoteText ? attachment.locator : null;
        if (!hasValidArticleCommentContent({ parentId: null, quoteText, commentText: value, locator })) return false;
        const selectionRevision = attachment.selectionRevision;
        const created = await adapter.addRoot({
          canonicalUrl,
          conversationId: normalizeConversationId(ctx?.conversationId),
          quoteText,
          commentText: value,
          locator,
        });
        if (!isMutationCurrent(generation)) return false;
        session.clearComposerAttachment(selectionRevision);
        await refresh();
        if (!isMutationCurrent(generation)) return false;
        const createdRootId = Number(created?.id);
        return { ok: true, createdRootId: Number.isFinite(createdRootId) && createdRootId > 0 ? createdRootId : null };
      },
      onReply: async (parentId, text) => {
        const generation = mutationGeneration;
        if (!isMutationCurrent(generation)) return false;
        const value = safeString(text);
        if (!value) return false;
        const id = Number(parentId);
        if (!Number.isFinite(id) || id <= 0) return false;

        const ctx = await ensureContextForAction(generation);
        if (!isMutationCurrent(generation)) return false;
        const canonicalUrl = canonicalizeArticleUrl(ctx?.canonicalUrl);
        if (!canonicalUrl) throw new Error('missing canonicalUrl for article comment reply');

        await adapter.addReply({
          canonicalUrl,
          conversationId: normalizeConversationId(ctx?.conversationId),
          parentId: id,
          commentText: value,
        });
        if (!isMutationCurrent(generation)) return false;
        await refresh();
        if (!isMutationCurrent(generation)) return false;
        return true;
      },
      onDelete: async (id) => {
        const generation = mutationGeneration;
        if (!isMutationCurrent(generation)) return;
        const commentId = Number(id);
        if (!Number.isFinite(commentId) || commentId <= 0) return;
        await adapter.delete({ id: commentId });
        if (!isMutationCurrent(generation)) return;
        await refresh();
      },
      onComposerSelectionRequest: () => {
        if (disposed || typeof input.resolveComposerSelection !== 'function') return;
        try {
          applyComposerSelection(input.resolveComposerSelection());
        } catch (_error) {
          // Ignore a transient DOM selection read failure; no attachment is safer than a guessed one.
        }
      },
      onRetry: () => refresh(),
      onComposerQuoteClearRequest: () => {
        if (disposed) return;
        session.clearComposerAttachment();
      },
    };

    session.updateHost({ actionCallbacks });
  };

  installHandlers();

  const open = async (openInput?: ArticleCommentsSidebarControllerOpenInput) => {
    if (disposed) return;
    mutationGeneration += 1;
    session.requestOpen({ focusComposer: openInput?.focusComposer === true, source: openInput?.source });
    if (!(await waitForCurrentActivationReadiness())) return;

    const shouldEnsureContext = openInput?.ensureContext !== false;
    if (!shouldEnsureContext || typeof adapter.ensureContext !== 'function') {
      const context = normalizeContext(activeContext);
      if (!context) {
        publishLoadState('idle');
        return;
      }
      const operation = beginOperation();
      await migrateThenLoad(operation, classifyCommentContextTransition(lastLoadedContext, context));
      return;
    }

    if (openInput?.ensureContextInput) lastEnsureContextInput = openInput.ensureContextInput;
    const operation = beginOperation();
    try {
      const resolved = await waitForOperation(
        adapter.ensureContext(lastEnsureContextInput),
        operation.abortController.signal,
      );
      if (!isCurrentOperation(operation)) return;
      assignContext(resolved, { clearComposer: false, invalidateMutations: false });
      const context = normalizeContext(activeContext);
      if (!context) {
        finishOperation(operation, 'idle');
        return;
      }
      publishLoadState('loading');
      await migrateThenLoad(operation, classifyCommentContextTransition(lastLoadedContext, context));
    } catch (error) {
      if (error instanceof ControllerOperationAbortedError || !isCurrentOperation(operation)) return;
      finishOperation(operation, 'stale_error', toLoadError(error));
    }
  };

  const getContext = () => (activeContext ? { ...activeContext } : null);

  const setContext = (next: ArticleCommentsSidebarContext | null) => {
    if (disposed) return;
    invalidateIdentityReconcile();
    const transition = assignContext(next);
    if (transition.kind === 'same') return;

    operationGeneration += 1;
    abortActiveOperation();
    if (transition.kind === 'invalid') {
      if (sessionOpen) publishLoadState('idle');
      return;
    }
    if (!sessionOpen) return;

    const expectedContextKey = getContextKey();
    void (async () => {
      if (!(await waitForCurrentActivationReadiness())) return;
      if (getContextKey() !== expectedContextKey) return;
      const context = normalizeContext(activeContext);
      if (!context) return;
      const operation = beginOperation();
      await migrateThenLoad(operation, classifyCommentContextTransition(lastLoadedContext, context));
    })();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resolveActivationReady?.();
    resolveActivationReady = null;
    revisionUnsubscribe?.();
    revisionUnsubscribe = null;
    pendingRevisionScopes.clear();
    invalidateIdentityReconcile();
    sessionUnsubscribe?.();
    sessionUnsubscribe = null;
    session.updateHost({ busy: false, loadStatus: 'idle', loadError: null, contextKey: '', actionCallbacks: {} });
    mutationGeneration += 1;
    operationGeneration += 1;
    abortActiveOperation();
  };

  return {
    open,
    refresh,
    getContext,
    setContext,
    dispose,
  };
}
