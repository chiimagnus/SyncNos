import {
  addArticleComment,
  deleteArticleCommentById,
  listArticleCommentsByCanonicalUrl,
} from '@services/comments/client/repo';

import type { ArticleCommentsSidebarAdapter } from '@services/comments/sidebar/article-comments-sidebar-adapter';

export function createArticleCommentsSidebarAppAdapter(): ArticleCommentsSidebarAdapter {
  return {
    async list({ canonicalUrl }) {
      const items = await listArticleCommentsByCanonicalUrl(canonicalUrl);
      return (Array.isArray(items) ? items : []).map((c: any) => ({
        id: Number(c?.id),
        parentId: c?.parentId != null ? Number(c.parentId) : null,
        authorName: c?.authorName != null ? String(c.authorName) : null,
        createdAt: Number(c?.createdAt) || null,
        quoteText: String(c?.quoteText || ''),
        commentText: String(c?.commentText || ''),
      }));
    },
    async addRoot({ canonicalUrl, conversationId, quoteText, commentText, locator }) {
      await addArticleComment({
        canonicalUrl,
        conversationId,
        parentId: null,
        quoteText,
        commentText,
        locator: locator ?? null,
      } as any);
      return true;
    },
    async addReply({ canonicalUrl, conversationId, parentId, commentText }) {
      await addArticleComment({
        canonicalUrl,
        conversationId,
        parentId,
        quoteText: '',
        commentText,
      } as any);
    },
    async delete({ id }) {
      const ok = await deleteArticleCommentById(id);
      if (!ok) throw new Error('failed to delete article comment');
    },
  };
}
