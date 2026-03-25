import type {
  CommentSidebarHandlers,
  CommentSidebarSession,
} from '@services/comments/sidebar/comment-sidebar-contract';
import { normalizeCommentSidebarQuoteText } from '@services/comments/sidebar/comment-sidebar-session';

import type {
  ArticleCommentsSidebarAdapter,
  ArticleCommentsSidebarContext,
  ArticleCommentsSidebarEnsureContextInput,
} from '@services/comments/sidebar/article-comments-sidebar-adapter';

export type ArticleCommentsSidebarControllerOpenInput = {
  selectionText?: string | null;
  locator?: any;
  focusComposer?: boolean;
  source?: string;
  ensureContext?: boolean;
  ensureContextInput?: ArticleCommentsSidebarEnsureContextInput;
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

function normalizeHttpUrl(raw: unknown): string {
  const text = safeString(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = safeString(url.protocol).toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function normalizeConversationId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function normalizeContext(next: ArticleCommentsSidebarContext): ArticleCommentsSidebarContext {
  return {
    canonicalUrl: normalizeHttpUrl(next.canonicalUrl),
    conversationId: normalizeConversationId(next.conversationId),
  };
}

export function createArticleCommentsSidebarController(input: {
  session: CommentSidebarSession;
  adapter: ArticleCommentsSidebarAdapter;
  onClose?: () => void;
}): ArticleCommentsSidebarController {
  const session = input.session;
  const adapter = input.adapter;
  const onClose = input.onClose;

  let activeContext: ArticleCommentsSidebarContext | null = null;
  let lastEnsureContextInput: ArticleCommentsSidebarEnsureContextInput | undefined;
  let pendingRootLocator: any | null = null;

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

  const getCanonicalUrl = () => normalizeHttpUrl(activeContext?.canonicalUrl);

  const refresh = async (options?: { manageBusy?: boolean }) => {
    const manageBusy = options?.manageBusy !== false;
    const canonicalUrl = getCanonicalUrl();
    if (!canonicalUrl) {
      session.setComments([]);
      return;
    }
    if (manageBusy) session.setBusy(true);
    try {
      const items = await adapter.list({ canonicalUrl });
      session.setComments(Array.isArray(items) ? items : []);
    } catch (_e) {
      session.setComments([]);
    } finally {
      if (manageBusy) session.setBusy(false);
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
        const canonicalUrl = normalizeHttpUrl(ctx?.canonicalUrl);
        if (!canonicalUrl) throw new Error('missing canonicalUrl for article comment save');

        const quoteText = normalizeCommentSidebarQuoteText(session.getSnapshot().quoteText);
        await adapter.addRoot({
          canonicalUrl,
          conversationId: normalizeConversationId(ctx?.conversationId),
          quoteText,
          commentText: value,
          locator: quoteText && pendingRootLocator ? pendingRootLocator : null,
        });
        pendingRootLocator = null;
        await refresh();
        return true;
      },
      onReply: async (parentId, text) => {
        const value = safeString(text);
        if (!value) return;
        const id = Number(parentId);
        if (!Number.isFinite(id) || id <= 0) return;

        const ctx = await ensureContextForAction();
        const canonicalUrl = normalizeHttpUrl(ctx?.canonicalUrl);
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
    };

    session.setHandlers(handlers);
  };

  installHandlers();

  const open = async (openInput?: ArticleCommentsSidebarControllerOpenInput) => {
    const selectionText = openInput?.selectionText;
    if (selectionText != null) session.setQuoteText(normalizeCommentSidebarQuoteText(selectionText));
    if (selectionText != null) pendingRootLocator = openInput?.locator ?? null;
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
    activeContext = next ? normalizeContext(next) : null;
  };

  return {
    open,
    refresh: () => refresh(),
    getContext,
    setContext,
  };
}
