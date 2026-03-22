import { COMMENTS_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import {
  addArticleComment,
  attachOrphanCommentsToConversation,
  deleteArticleCommentById,
  listArticleCommentsByCanonicalUrl,
  listArticleCommentsByConversationId,
} from '@services/comments/data/storage';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
  eventsHub?: { broadcast: (type: string, payload: unknown) => void };
};

function normalizeHttpUrl(raw: unknown): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

export function registerArticleCommentsHandlers(router: AnyRouter) {
  router.register(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, async (msg) => {
    const canonicalUrl = normalizeHttpUrl(msg?.canonicalUrl);
    const conversationId = Number(msg?.conversationId);

    if (canonicalUrl) {
      const items = await listArticleCommentsByCanonicalUrl(canonicalUrl);
      return router.ok(items);
    }

    if (Number.isFinite(conversationId) && conversationId > 0) {
      const items = await listArticleCommentsByConversationId(conversationId);
      return router.ok(items);
    }

    return router.err('missing canonicalUrl or conversationId');
  });

  router.register(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, async (msg) => {
    const canonicalUrl = normalizeHttpUrl(msg?.canonicalUrl);
    if (!canonicalUrl) return router.err('missing canonicalUrl');

    const comment = await addArticleComment({
      parentId: msg?.parentId != null ? Number(msg.parentId) : null,
      conversationId: msg?.conversationId ? Number(msg.conversationId) : null,
      canonicalUrl,
      quoteText: msg?.quoteText ?? '',
      commentText: String(msg?.commentText || ''),
    });

    if (comment.conversationId) {
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
        reason: 'articleCommentAdded',
        conversationId: comment.conversationId,
      });
    }

    return router.ok(comment);
  });

  router.register(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, async (msg) => {
    const id = Number(msg?.id);
    if (!Number.isFinite(id) || id <= 0) return router.err('invalid id');
    const ok = await deleteArticleCommentById(id);
    return router.ok({ ok });
  });

  router.register(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS, async (msg) => {
    const canonicalUrl = normalizeHttpUrl(msg?.canonicalUrl);
    const conversationId = Number(msg?.conversationId);
    if (!canonicalUrl) return router.err('missing canonicalUrl');
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const res = await attachOrphanCommentsToConversation(canonicalUrl, conversationId);
    router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'articleCommentAttached',
      conversationId,
    });
    return router.ok(res);
  });
}
