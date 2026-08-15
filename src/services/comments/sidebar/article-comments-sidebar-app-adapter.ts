import {
  addArticleComment,
  addArticleCommentReply,
  deleteArticleComment,
  ensureArticleCommentContext,
  listArticleComments,
  migrateArticleCommentCanonicalUrl,
} from '@services/comments/client/repo';
import {
  ArticleCommentsSidebarAdapterError,
  toArticleCommentsClientContext,
  type ArticleCommentsSidebarAdapter,
} from '@services/comments/sidebar/article-comments-sidebar-adapter';

function commentId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new ArticleCommentsSidebarAdapterError('invalid_query', 'invalid comment');
  return id;
}

function requestError(message: string, error: unknown): never {
  if (error instanceof ArticleCommentsSidebarAdapterError) throw error;
  throw new ArticleCommentsSidebarAdapterError('request_failed', message, { cause: error });
}

export function createArticleCommentsSidebarAppAdapter(): ArticleCommentsSidebarAdapter {
  return {
    async list(input) {
      try {
        return await listArticleComments({
          context: toArticleCommentsClientContext(input.context),
          fallbackPolicy: input.fallbackPolicy,
        });
      } catch (error) {
        return requestError('failed to list article comments', error);
      }
    },
    async addRoot({ context, quoteText, commentText, locator }) {
      try {
        const comment = await addArticleComment({
          context: toArticleCommentsClientContext(context),
          quoteText,
          commentText,
          locator: locator ?? null,
        });
        return { id: commentId(comment.id) };
      } catch (error) {
        return requestError('failed to add article comment', error);
      }
    },
    async addReply({ context, parent, commentText }) {
      try {
        await addArticleCommentReply({
          context: toArticleCommentsClientContext(context),
          parentId: commentId(parent?.id),
          commentText,
        });
      } catch (error) {
        return requestError('failed to reply to article comment', error);
      }
    },
    async delete({ context, comment }) {
      try {
        const ok = await deleteArticleComment({
          context: toArticleCommentsClientContext(context),
          commentId: commentId(comment?.id),
        });
        if (!ok) throw new Error('failed to delete article comment');
      } catch (error) {
        return requestError('failed to delete article comment', error);
      }
    },
    async ensureAttachedContext(context) {
      try {
        await ensureArticleCommentContext({ context: toArticleCommentsClientContext(context) });
      } catch (error) {
        return requestError('failed to attach article comments', error);
      }
    },
    async migrateCanonicalUrl({ previous, next }) {
      try {
        const context = toArticleCommentsClientContext(next);
        if (!context.conversation) {
          throw new ArticleCommentsSidebarAdapterError(
            'invalid_query',
            'article comments require a conversation reference',
          );
        }
        await migrateArticleCommentCanonicalUrl({
          context: { ...context, conversation: context.conversation },
          fromCanonicalUrl: previous.canonicalUrl,
          toCanonicalUrl: next.canonicalUrl,
        });
      } catch (error) {
        return requestError('failed to migrate article comments', error);
      }
    },
  };
}
