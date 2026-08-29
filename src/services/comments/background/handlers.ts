import { COMMENTS_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  addArticleComment,
  attachOrphanCommentsToConversation,
  deleteArticleCommentById,
  getArticleCommentDeleteContextById,
  listArticleCommentsByCanonicalUrl,
  listArticleCommentsByConversationId,
  migrateArticleCommentsCanonicalUrl,
} from '@services/comments/data/storage';
import { ArticleCommentInvariantError } from '@services/comments/data/storage-idb';
import { storageGet } from '@services/shared/storage';
import {
  ABOUT_YOU_USER_NAME_STORAGE_KEY,
  DEFAULT_ABOUT_YOU_USER_NAME,
  normalizeUserName,
} from '@services/shared/user-profile';
import {
  AUTO_SYNC_CONVERSATION_CHANGED_REASONS,
  type AutoSyncConversationChangedReason,
} from '@services/sync/auto-sync/auto-sync-keys';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { parseArticleCommentAddRequest, serializeArticleCommentDto } from '@services/comments/domain/comment-dto';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type ArticleCommentsHandlersDeps = {
  onConversationChanged: (conversationId: number, reason: AutoSyncConversationChangedReason) => void | Promise<void>;
};

function fireAndForget(task: void | Promise<void>) {
  Promise.resolve(task).catch(() => {});
}

export function registerArticleCommentsHandlers(router: AnyRouter, deps: ArticleCommentsHandlersDeps) {
  router.register(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, async (msg) => {
    const canonicalUrl = canonicalizeArticleUrl(msg?.canonicalUrl);
    const conversationId = Number(msg?.conversationId);

    // Canonical URL is preferred. When unavailable, fall back to conversationId
    // so legacy contexts can still load comments.
    if (canonicalUrl) {
      const items = await listArticleCommentsByCanonicalUrl(canonicalUrl);
      return router.ok(items.map(serializeArticleCommentDto));
    }

    if (Number.isFinite(conversationId) && conversationId > 0) {
      const items = await listArticleCommentsByConversationId(conversationId);
      return router.ok(items.map(serializeArticleCommentDto));
    }

    return router.err('missing canonicalUrl or conversationId');
  });

  router.register(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, async (msg) => {
    const request = parseArticleCommentAddRequest(msg);
    if (!request) return router.err('invalid article comment payload');

    const local = await storageGet([ABOUT_YOU_USER_NAME_STORAGE_KEY]);
    const authorName = normalizeUserName(local?.[ABOUT_YOU_USER_NAME_STORAGE_KEY]) || DEFAULT_ABOUT_YOU_USER_NAME;

    let comment;
    try {
      comment = await addArticleComment({
        parentId: request.parentId,
        conversationId: request.conversationId,
        canonicalUrl: request.canonicalUrl,
        authorName,
        quoteText: request.quoteText,
        commentText: request.commentText,
        locator: request.locator,
      });
    } catch (error) {
      if (error instanceof ArticleCommentInvariantError) return router.err(error.code);
      throw error;
    }

    if (comment.conversationId) {
      fireAndForget(
        deps.onConversationChanged(
          Number(comment.conversationId),
          AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
        ),
      );
    }

    return router.ok(serializeArticleCommentDto(comment));
  });

  router.register(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, async (msg) => {
    const id = Number(msg?.id);
    if (!Number.isFinite(id) || id <= 0) return router.err('invalid id');
    const context = await getArticleCommentDeleteContextById(id);
    const ok = await deleteArticleCommentById(id);
    if (ok) {
      const conversationId = Number(context?.conversationId);
      if (Number.isFinite(conversationId) && conversationId > 0) {
        fireAndForget(
          deps.onConversationChanged(conversationId, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged),
        );
      }
    }
    return router.ok({ ok });
  });

  router.register(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS, async (msg) => {
    const canonicalUrl = canonicalizeArticleUrl(msg?.canonicalUrl);
    const conversationId = Number(msg?.conversationId);
    if (!canonicalUrl) return router.err('missing canonicalUrl');
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const res = await attachOrphanCommentsToConversation(canonicalUrl, conversationId);
    if (Number(res.updated) > 0) {
      fireAndForget(
        deps.onConversationChanged(conversationId, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged),
      );
    }
    return router.ok(res);
  });

  router.register(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL, async (msg) => {
    const fromCanonicalUrl = canonicalizeArticleUrl(msg?.fromCanonicalUrl);
    const toCanonicalUrl = canonicalizeArticleUrl(msg?.toCanonicalUrl);
    const conversationId = msg?.conversationId != null ? Number(msg.conversationId) : null;
    if (!fromCanonicalUrl) return router.err('missing fromCanonicalUrl');
    if (!toCanonicalUrl) return router.err('missing toCanonicalUrl');

    if (conversationId == null || !Number.isFinite(conversationId) || conversationId <= 0) {
      return router.err('invalid conversationId');
    }
    const res = await migrateArticleCommentsCanonicalUrl({ fromCanonicalUrl, toCanonicalUrl, conversationId });
    if (Number(res.updated) > 0) {
      fireAndForget(
        deps.onConversationChanged(conversationId, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged),
      );
    }
    return router.ok(res);
  });
}
