import type {
  CommentSidebarHandlers,
  CommentSidebarComposerSelectionRequest,
  CommentSidebarSession,
} from '@services/comments/sidebar/comment-sidebar-contract';
import { normalizeCommentSidebarQuoteText } from '@services/comments/sidebar/comment-sidebar-session';
import type { ArticleCommentLocator } from '@services/comments/domain/models';
import { normalizePositiveInt } from '@services/shared/numbers';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

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

export type ArticleCommentsSidebarController = {
  open: (input?: ArticleCommentsSidebarControllerOpenInput) => Promise<void>;
  refresh: () => Promise<void>;
  getContext: () => ArticleCommentsSidebarContext | null;
  setContext: (context: ArticleCommentsSidebarContext | null) => void;
};

function safeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeConversationId(value: unknown): number | null {
  return normalizePositiveInt(value);
}

function normalizeContext(next: ArticleCommentsSidebarContext): ArticleCommentsSidebarContext {
  return {
    canonicalUrl: canonicalizeArticleUrl(next.canonicalUrl),
    conversationId: normalizeConversationId(next.conversationId),
  };
}

function buildContextKey(context: ArticleCommentsSidebarContext | null): string {
  if (!context) return '';
  const canonicalUrl = canonicalizeArticleUrl(context.canonicalUrl);
  if (!canonicalUrl) return '';
  const conversationId = normalizeConversationId(context.conversationId);
  return `${canonicalUrl}#${conversationId ?? ''}`;
}

function normalizeLocator(locator: unknown): ArticleCommentLocator | null {
  if (!locator || typeof locator !== 'object') return null;
  return locator as ArticleCommentLocator;
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
  let pendingRootLocator: ArticleCommentLocator | null = null;
  let refreshRunId = 0;
  let composerSelectionRequestSeq = 0;

  const applyComposerSelection = (payload?: ArticleCommentsSidebarControllerComposerSelectionPayload | null) => {
    const quoteText = normalizeCommentSidebarQuoteText(payload?.selectionText);
    session.setQuoteText(quoteText);
    pendingRootLocator = quoteText ? normalizeLocator(payload?.locator) : null;
  };

  const ensureContext = async (
    ensure: boolean,
    ensureInput?: ArticleCommentsSidebarEnsureContextInput,
  ): Promise<ArticleCommentsSidebarContext | null> => {
    if (ensureInput) lastEnsureContextInput = ensureInput;
    if (!ensure || typeof adapter.ensureContext !== 'function') return activeContext;
    const resolved = await adapter.ensureContext(lastEnsureContextInput);
    activeContext = normalizeContext(resolved);
    return activeContext;
  };

  const getCanonicalUrl = () => canonicalizeArticleUrl(activeContext?.canonicalUrl);
  const getContextKey = () => buildContextKey(activeContext);

  const refresh = async (options?: { manageBusy?: boolean }) => {
    const manageBusy = options?.manageBusy !== false;
    const runId = ++refreshRunId;
    const contextKeyAtStart = getContextKey();
    const canonicalUrl = getCanonicalUrl();
    if (!canonicalUrl) {
      session.setComments([]);
      return;
    }
    if (manageBusy) session.setBusy(true);
    try {
      const items = await adapter.list({ canonicalUrl });
      if (runId !== refreshRunId || contextKeyAtStart !== getContextKey()) return;
      session.setComments(Array.isArray(items) ? items : []);
    } catch (_e) {
      if (runId !== refreshRunId || contextKeyAtStart !== getContextKey()) return;
      session.setComments([]);
    } finally {
      if (manageBusy && runId === refreshRunId) session.setBusy(false);
    }
  };

  const ensureContextForAction = async () => {
    const canonicalUrl = getCanonicalUrl();
    if (canonicalUrl) return activeContext;
    await ensureContext(true);
    return activeContext;
  };

  const installHandlers = () => {
    const handlers: CommentSidebarHandlers = {
      onClose: () => {
        try {
          onClose?.();
        } catch (_e) {
          // ignore
        }
      },
      onSave: async (text) => {
        const value = safeString(text);
        if (!value) return false;

        const ctx = await ensureContextForAction();
        const canonicalUrl = canonicalizeArticleUrl(ctx?.canonicalUrl);
        if (!canonicalUrl) throw new Error('missing canonicalUrl for article comment save');

        const quoteText = normalizeCommentSidebarQuoteText(session.getSnapshot().quoteText);
        const created = await adapter.addRoot({
          canonicalUrl,
          conversationId: normalizeConversationId(ctx?.conversationId),
          quoteText,
          commentText: value,
          locator: quoteText && pendingRootLocator ? pendingRootLocator : null,
        });
        pendingRootLocator = null;
        await refresh();
        const createdRootId = Number(created?.id);
        return { ok: true, createdRootId: Number.isFinite(createdRootId) && createdRootId > 0 ? createdRootId : null };
      },
      onReply: async (parentId, text) => {
        const value = safeString(text);
        if (!value) return;
        const id = Number(parentId);
        if (!Number.isFinite(id) || id <= 0) return;

        const ctx = await ensureContextForAction();
        const canonicalUrl = canonicalizeArticleUrl(ctx?.canonicalUrl);
        if (!canonicalUrl) throw new Error('missing canonicalUrl for article comment reply');

        await adapter.addReply({
          canonicalUrl,
          conversationId: normalizeConversationId(ctx?.conversationId),
          parentId: id,
          commentText: value,
        });
        await refresh();
      },
      onDelete: async (id) => {
        const commentId = Number(id);
        if (!Number.isFinite(commentId) || commentId <= 0) return;
        await adapter.delete({ id: commentId });
        await refresh();
      },
      onComposerSelectionRequest: async (request) => {
        const resolveComposerSelection = input.resolveComposerSelection;
        if (typeof resolveComposerSelection !== 'function') return;
        const requestSeq = ++composerSelectionRequestSeq;
        let payload: ArticleCommentsSidebarControllerComposerSelectionPayload | null | undefined;
        try {
          payload = await resolveComposerSelection(request);
        } catch (_error) {
          payload = { selectionText: '', locator: null };
        }
        if (requestSeq !== composerSelectionRequestSeq) return;
        applyComposerSelection(payload ?? { selectionText: '', locator: null });
      },
    };

    session.setHandlers(handlers);
  };

  installHandlers();

  const open = async (openInput?: ArticleCommentsSidebarControllerOpenInput) => {
    const selectionText = openInput?.selectionText;
    if (selectionText != null) {
      applyComposerSelection({ selectionText, locator: openInput?.locator });
    }
    session.requestOpen({ focusComposer: openInput?.focusComposer === true, source: openInput?.source });

    const shouldEnsureContext = openInput?.ensureContext !== false;
    session.setBusy(true);
    try {
      await ensureContext(shouldEnsureContext, openInput?.ensureContextInput);
      await refresh({ manageBusy: false });
    } finally {
      session.setBusy(false);
    }
  };

  const getContext = () => (activeContext ? { ...activeContext } : null);

  const setContext = (next: ArticleCommentsSidebarContext | null) => {
    const normalized = next ? normalizeContext(next) : null;
    if (buildContextKey(activeContext) === buildContextKey(normalized)) return;

    const previousCanonicalUrl = canonicalizeArticleUrl(activeContext?.canonicalUrl);
    const previousConversationId = normalizeConversationId(activeContext?.conversationId);
    const nextCanonicalUrl = canonicalizeArticleUrl(normalized?.canonicalUrl);
    const nextConversationId = normalizeConversationId(normalized?.conversationId);

    if (
      previousCanonicalUrl &&
      nextCanonicalUrl &&
      previousCanonicalUrl !== nextCanonicalUrl &&
      previousConversationId &&
      nextConversationId &&
      previousConversationId === nextConversationId &&
      typeof adapter.migrateCanonicalUrl === 'function'
    ) {
      void adapter
        .migrateCanonicalUrl({
          fromCanonicalUrl: previousCanonicalUrl,
          toCanonicalUrl: nextCanonicalUrl,
          conversationId: nextConversationId,
        })
        .catch((error) => {
          console.warn('[CommentsSidebar] canonical migration failed', {
            fromCanonicalUrl: previousCanonicalUrl,
            toCanonicalUrl: nextCanonicalUrl,
            conversationId: nextConversationId,
            error: error instanceof Error ? error.message : String(error || ''),
          });
        });
    }

    activeContext = normalized;
    pendingRootLocator = null;
    session.setQuoteText('');
    refreshRunId += 1;

    const canonicalUrl = getCanonicalUrl();
    if (!canonicalUrl) {
      session.setBusy(false);
      session.setComments([]);
      return;
    }

    void refresh();
  };

  return {
    open,
    refresh: () => refresh(),
    getContext,
    setContext,
  };
}
