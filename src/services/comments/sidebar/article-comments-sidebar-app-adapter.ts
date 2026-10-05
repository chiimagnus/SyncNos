import {
  addArticleComment,
  deleteArticleCommentById,
  listArticleCommentsByCanonicalUrl,
  listArticleCommentsByConversationId,
  migrateArticleCommentsCanonicalUrl,
} from '@services/comments/client/repo';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import {
  ArticleCommentsSidebarAdapterError,
  filterArticleCommentsForListIdentity,
  mergeArticleCommentsByIdentity,
  normalizeArticleCommentsSidebarListInput,
} from '@services/comments/sidebar/article-comments-sidebar-adapter';

import type { ArticleCommentsSidebarAdapter } from '@services/comments/sidebar/article-comments-sidebar-adapter';

export function createArticleCommentsSidebarAppAdapter(): ArticleCommentsSidebarAdapter {
  return {
    async list(input) {
      const query = normalizeArticleCommentsSidebarListInput(input);
      try {
        const byConversation = query.conversationId
          ? await listArticleCommentsByConversationId(query.conversationId)
          : [];
        const byCanonicalUrl = query.canonicalUrl
          ? filterArticleCommentsForListIdentity(await listArticleCommentsByCanonicalUrl(query.canonicalUrl), query)
          : [];
        return mergeArticleCommentsByIdentity(byConversation, byCanonicalUrl);
      } catch (error) {
        if (error instanceof ArticleCommentsSidebarAdapterError) throw error;
        throw new ArticleCommentsSidebarAdapterError('request_failed', 'failed to list article comments', {
          cause: error,
        });
      }
    },
    async addRoot({ canonicalUrl, conversationId, quoteText, commentText, locator }) {
      const normalized = canonicalizeArticleUrl(canonicalUrl);
      if (!normalized) throw new Error('missing canonicalUrl');
      const comment = await addArticleComment({
        canonicalUrl: normalized,
        conversationId,
        parentId: null,
        quoteText,
        commentText,
        locator: locator ?? null,
      });
      const id = Number(comment?.id);
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error('failed to add article comment');
      }
      return { id };
    },
    async addReply({ canonicalUrl, conversationId, parentId, commentText }) {
      const normalized = canonicalizeArticleUrl(canonicalUrl);
      if (!normalized) throw new Error('missing canonicalUrl');
      await addArticleComment({
        canonicalUrl: normalized,
        conversationId,
        parentId,
        quoteText: '',
        commentText,
      });
    },
    async delete({ id }) {
      const ok = await deleteArticleCommentById(id);
      if (!ok) throw new Error('failed to delete article comment');
    },
    async migrateCanonicalUrl({ fromCanonicalUrl, toCanonicalUrl, conversationId }) {
      const from = canonicalizeArticleUrl(fromCanonicalUrl);
      const to = canonicalizeArticleUrl(toCanonicalUrl);
      if (!from || !to || from === to) return;
      await migrateArticleCommentsCanonicalUrl({
        fromCanonicalUrl: from,
        toCanonicalUrl: to,
        conversationId,
      });
    },
  };
}
