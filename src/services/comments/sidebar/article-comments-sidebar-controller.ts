import type {
  CommentSidebarComposerSelectionRequest,
  CommentSidebarHostActionCallbacks,
  CommentSidebarLoadError,
  CommentSidebarLoadStatus,
  CommentSidebarSession,
} from '@services/comments/sidebar/comment-sidebar-contract';
import { normalizeCommentSidebarQuoteText } from '@services/comments/sidebar/comment-sidebar-session';
import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
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

export type ArticleCommentsSidebarControllerOpenInput = {
  selectionText?: string | null;
  locator?: unknown;
  focusComposer?: boolean;
  source?: string;
  ensureContext?: boolean;
  ensureContextInput?: ArticleCommentsSidebarEnsureContextInput;
};

export type ArticleCommentsSidebarControllerComposerSelectionPayload = {
  selectionText?: string | null;
  locator?: unknown;
};

export type ArticleCommentsSidebarLoadStatus = CommentSidebarLoadStatus;
export type ArticleCommentsSidebarLoadError = CommentSidebarLoadError;

export type ArticleCommentsSidebarLoadSnapshot = {
  status: ArticleCommentsSidebarLoadStatus;
  error: ArticleCommentsSidebarLoadError | null;
  generation: number;
  contextKey: string;
};

export type ArticleCommentsSidebarController = {
  open: (input?: ArticleCommentsSidebarControllerOpenInput) => Promise<void>;
  refresh: () => Promise<void>;
  getContext: () => ArticleCommentsSidebarContext | null;
  setContext: (context: ArticleCommentsSidebarContext | null) => void;
  getLoadSnapshot: () => ArticleCommentsSidebarLoadSnapshot;
  subscribeLoadState: (listener: () => void) => () => void;
  dispose: () => void;
};

type ControllerOperation = {
  generation: number;
  abortController: AbortController;
};

class ControllerOperationAbortedError extends Error {
  constructor() {
    super('article comments controller operation aborted');
    this.name = 'ControllerOperationAbortedError';
  }
}

function safeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeContext(
  next: ArticleCommentsSidebarContext | null | undefined,
): ArticleCommentsSidebarContext | null {
  return normalizeCommentContextIdentity(next);
}

function toLoadError(error: unknown): ArticleCommentsSidebarLoadError {
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
  resolveComposerSelection?: (
    request: CommentSidebarComposerSelectionRequest,
  ) =>
    | ArticleCommentsSidebarControllerComposerSelectionPayload
    | null
    | undefined
    | Promise<ArticleCommentsSidebarControllerComposerSelectionPayload | null | undefined>;
}): ArticleCommentsSidebarController {
  const session = input.session;
  const adapter = input.adapter;
  const onClose = input.onClose;

  let activeContext: ArticleCommentsSidebarContext | null = null;
  let lastEnsureContextInput: ArticleCommentsSidebarEnsureContextInput | undefined;
  let composerSelectionRequestSeq = 0;
  let operationGeneration = 0;
  let mutationGeneration = 0;
  let activeOperation: ControllerOperation | null = null;
  let disposed = false;
  const loadListeners = new Set<() => void>();
  let loadSnapshot: ArticleCommentsSidebarLoadSnapshot = {
    status: 'idle',
    error: null,
    generation: 0,
    contextKey: '',
  };

  const getCanonicalUrl = () => canonicalizeArticleUrl(activeContext?.canonicalUrl);
  const getContextKey = () => buildCommentContextIdentityKey(activeContext);

  const publishLoadState = (
    status: ArticleCommentsSidebarLoadStatus,
    operation: ControllerOperation | null,
    error: ArticleCommentsSidebarLoadError | null = null,
  ) => {
    if (disposed) return;
    const generation = operation?.generation ?? operationGeneration;
    loadSnapshot = {
      status,
      error,
      generation,
      contextKey: getContextKey(),
    };
    session.updateHost({
      busy: status === 'loading',
      loadStatus: status,
      loadError: error,
      contextKey: loadSnapshot.contextKey,
    });
    for (const listener of loadListeners) {
      try {
        listener();
      } catch (_error) {
        // A failed observer must not interrupt the controller state machine.
      }
    }
  };

  const abortActiveOperation = () => {
    activeOperation?.abortController.abort();
    activeOperation = null;
  };

  const beginOperation = (): ControllerOperation => {
    abortActiveOperation();
    const operation = {
      generation: ++operationGeneration,
      abortController: new AbortController(),
    };
    activeOperation = operation;
    publishLoadState('loading', operation);
    return operation;
  };

  const isCurrentOperation = (operation: ControllerOperation) =>
    !disposed &&
    activeOperation === operation &&
    operation.generation === operationGeneration &&
    !operation.abortController.signal.aborted;

  const finishOperation = (
    operation: ControllerOperation,
    status: Exclude<ArticleCommentsSidebarLoadStatus, 'loading'>,
    error: ArticleCommentsSidebarLoadError | null = null,
  ) => {
    if (!isCurrentOperation(operation)) return;
    activeOperation = null;
    publishLoadState(status, operation, error);
  };

  const applyComposerSelection = (payload?: ArticleCommentsSidebarControllerComposerSelectionPayload | null) => {
    if (disposed) return;
    const quoteText = normalizeCommentSidebarQuoteText(payload?.selectionText);
    if (!quoteText) return;
    session.setComposerAttachment({
      displayQuote: quoteText,
      locator: normalizeArticleCommentLocator(payload?.locator),
    });
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
          context,
          fallbackPolicy: 'include-orphan-url',
          signal: operation.abortController.signal,
        }),
        operation.abortController.signal,
      );
      if (!isCurrentOperation(operation)) return;
      session.updateHost({ comments: Array.isArray(items) ? items : [] });
      finishOperation(operation, 'ready');
    } catch (error) {
      if (error instanceof ControllerOperationAbortedError || !isCurrentOperation(operation)) return;
      finishOperation(operation, 'stale_error', toLoadError(error));
    }
  };

  const migrateThenLoad = async (operation: ControllerOperation, transition: CommentContextTransition) => {
    const migrate =
      transition.kind === 'url-migrate' &&
      transition.previous &&
      transition.next &&
      typeof adapter.migrateCanonicalUrl === 'function';
    const attach =
      transition.kind === 'attach-orphan' && transition.next && typeof adapter.ensureAttachedContext === 'function';
    if (migrate || attach) {
      try {
        await waitForOperation(
          migrate
            ? Promise.resolve(
                adapter.migrateCanonicalUrl!({
                  previous: transition.previous!,
                  next: transition.next!,
                  signal: operation.abortController.signal,
                }),
              )
            : Promise.resolve(adapter.ensureAttachedContext!(transition.next!)),
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

  const refresh = async () => {
    if (disposed) return;
    if (!normalizeContext(activeContext)) {
      abortActiveOperation();
      publishLoadState('idle', null);
      return;
    }
    const operation = beginOperation();
    await loadComments(operation);
  };

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
        if (!value) return false;

        const ctx = await ensureContextForAction(generation);
        if (!isMutationCurrent(generation)) return false;
        const canonicalUrl = canonicalizeArticleUrl(ctx?.canonicalUrl);
        if (!canonicalUrl) throw new Error('missing canonicalUrl for article comment save');

        const attachment = session.getSnapshot().composerAttachment;
        const quoteText = normalizeCommentSidebarQuoteText(attachment.displayQuote);
        const selectionRevision = attachment.selectionRevision;
        const created = await adapter.addRoot({
          context: { ...ctx!, canonicalUrl },
          quoteText,
          commentText: value,
          locator: quoteText ? normalizeArticleCommentLocator(attachment.locator) : null,
        });
        if (!isMutationCurrent(generation)) return false;
        composerSelectionRequestSeq += 1;
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
        const parent = session.getSnapshot().comments.find((comment) => Number(comment?.id) === id);
        if (!parent) return false;

        await adapter.addReply({
          context: { ...ctx!, canonicalUrl },
          parent,
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
        const ctx = await ensureContextForAction(generation);
        if (!isMutationCurrent(generation)) return;
        const canonicalUrl = canonicalizeArticleUrl(ctx?.canonicalUrl);
        if (!canonicalUrl) throw new Error('missing canonicalUrl for article comment delete');
        const comment = session.getSnapshot().comments.find((item) => Number(item?.id) === commentId);
        if (!comment) return;
        await adapter.delete({ context: { ...ctx!, canonicalUrl }, comment });
        if (!isMutationCurrent(generation)) return;
        await refresh();
      },
      onComposerSelectionRequest: async (request) => {
        if (disposed) return;
        const resolveComposerSelection = input.resolveComposerSelection;
        if (typeof resolveComposerSelection !== 'function') return;
        const requestSeq = ++composerSelectionRequestSeq;
        const applyIfLatest = (
          payload: ArticleCommentsSidebarControllerComposerSelectionPayload | null | undefined,
        ) => {
          if (disposed || requestSeq !== composerSelectionRequestSeq) return;
          applyComposerSelection(payload);
        };
        try {
          const resolved = resolveComposerSelection(request);
          if (resolved && typeof (resolved as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(resolved)
              .then((payload) => {
                applyIfLatest(payload as ArticleCommentsSidebarControllerComposerSelectionPayload | null | undefined);
              })
              .catch(() => {
                applyIfLatest(null);
              });
            return;
          }
          applyIfLatest(resolved as ArticleCommentsSidebarControllerComposerSelectionPayload | null | undefined);
        } catch (_error) {
          applyIfLatest(null);
        }
      },
      onRetry: () => refresh(),
      onComposerQuoteClearRequest: () => {
        if (disposed) return;
        composerSelectionRequestSeq += 1;
        session.clearComposerAttachment();
      },
    };

    session.updateHost({ actionCallbacks });
  };

  installHandlers();

  const open = async (openInput?: ArticleCommentsSidebarControllerOpenInput) => {
    if (disposed) return;
    mutationGeneration += 1;
    const selectionText = openInput?.selectionText;
    if (selectionText != null) {
      applyComposerSelection({ selectionText, locator: openInput?.locator });
    }
    session.requestOpen({ focusComposer: openInput?.focusComposer === true, source: openInput?.source });

    const shouldEnsureContext = openInput?.ensureContext !== false;
    if (!shouldEnsureContext || typeof adapter.ensureContext !== 'function') {
      await refresh();
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
      const transition = assignContext(resolved, { clearComposer: false });
      if (transition.kind === 'invalid') {
        finishOperation(operation, 'idle');
        return;
      }
      publishLoadState('loading', operation);
      await migrateThenLoad(operation, transition);
    } catch (error) {
      if (error instanceof ControllerOperationAbortedError || !isCurrentOperation(operation)) return;
      finishOperation(operation, 'stale_error', toLoadError(error));
    }
  };

  const getContext = () => (activeContext ? { ...activeContext } : null);

  const setContext = (next: ArticleCommentsSidebarContext | null) => {
    if (disposed) return;
    const transition = assignContext(next);
    if (transition.kind === 'same') return;

    if (transition.kind === 'invalid') {
      abortActiveOperation();
      publishLoadState('idle', null);
      return;
    }

    const operation = beginOperation();
    void migrateThenLoad(operation, transition);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    session.updateHost({ busy: false, loadStatus: 'idle', loadError: null, contextKey: '', actionCallbacks: {} });
    composerSelectionRequestSeq += 1;
    mutationGeneration += 1;
    operationGeneration += 1;
    abortActiveOperation();
    loadListeners.clear();
  };

  return {
    open,
    refresh,
    getContext,
    setContext,
    getLoadSnapshot: () => loadSnapshot,
    subscribeLoadState: (listener) => {
      if (disposed) return () => {};
      if (typeof listener !== 'function') return () => {};
      loadListeners.add(listener);
      return () => {
        loadListeners.delete(listener);
      };
    },
    dispose,
  };
}
