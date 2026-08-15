import { ARTICLE_MESSAGE_TYPES, COMMENTS_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { parseArticleCommentDto, parseArticleCommentDtos } from '@services/comments/domain/comment-dto';
import {
  ArticleCommentsSidebarAdapterError,
  toArticleCommentsClientContext,
  type ArticleCommentsSidebarAdapter,
  type ArticleCommentsSidebarContext,
} from '@services/comments/sidebar/article-comments-sidebar-adapter';
import { parseFactsEpoch } from '@services/local-data/contracts';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function normalizeConversationId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function commentId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ArticleCommentsSidebarAdapterError('invalid_query', 'invalid article comment');
  }
  return id;
}

function getLocationHrefFallback(): string {
  try {
    return String(globalThis.location?.href || '');
  } catch (_error) {
    return '';
  }
}

export function createArticleCommentsSidebarInpageAdapter(
  runtime: RuntimeClient | null,
): ArticleCommentsSidebarAdapter {
  const request = async <T>(type: string, payload?: Record<string, unknown>): Promise<T> => {
    if (!runtime?.send) {
      throw new ArticleCommentsSidebarAdapterError(
        'runtime_unavailable',
        'runtime is unavailable for article comments',
      );
    }
    let response: any;
    try {
      response = await runtime.send(type, payload);
    } catch (error) {
      throw new ArticleCommentsSidebarAdapterError('request_failed', 'article comments request failed', {
        cause: error,
      });
    }
    if (!response || typeof response.ok !== 'boolean') {
      throw new ArticleCommentsSidebarAdapterError('invalid_response', 'invalid article comments runtime response');
    }
    if (!response.ok) {
      throw new ArticleCommentsSidebarAdapterError(
        'request_failed',
        String(response?.error?.message || 'article comments request failed'),
      );
    }
    return response.data as T;
  };

  const commandContext = (context: ArticleCommentsSidebarContext) => {
    const current = toArticleCommentsClientContext(context);
    return {
      context: {
        canonicalUrl: current.canonicalUrl,
        ...(current.conversation ? { conversation: current.conversation } : {}),
      },
      factsEpoch: current.factsEpoch,
    };
  };

  return {
    async list(input) {
      const data = await request<unknown>(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, {
        ...commandContext(input.context),
        fallbackPolicy: input.fallbackPolicy,
      });
      if (!Array.isArray(data)) {
        throw new ArticleCommentsSidebarAdapterError('invalid_response', 'invalid article comments payload');
      }
      return parseArticleCommentDtos(data);
    },
    async ensureContext(input) {
      const fallbackUrl =
        canonicalizeArticleUrl(input?.canonicalUrlFallback) || canonicalizeArticleUrl(getLocationHrefFallback());
      if (input?.ensureArticle === false || !runtime?.send) {
        return { canonicalUrl: fallbackUrl, conversationId: null };
      }
      const payload = input?.tabId == null ? undefined : { tabId: Number(input.tabId) };
      const data = await request<Record<string, unknown>>(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, payload);
      const canonicalUrl = canonicalizeArticleUrl(data.url) || fallbackUrl;
      const conversationId = normalizeConversationId(data.conversationId);
      const source = String(data.source || '').trim();
      const conversationKey = String(data.conversationKey || '').trim();
      let factsEpoch = null;
      try {
        factsEpoch = parseFactsEpoch(data.factsEpoch);
      } catch {
        // The capture response is unusable without a current facts epoch.
      }
      if (!canonicalUrl || !conversationId || !source || !conversationKey || !factsEpoch) {
        throw new ArticleCommentsSidebarAdapterError(
          'invalid_response',
          'article context is missing a current facts reference',
        );
      }
      const context: ArticleCommentsSidebarContext = {
        canonicalUrl,
        conversationId,
        conversation: { source, conversationKey },
        factsEpoch,
      };
      await request<{ updated: number }>(
        COMMENTS_MESSAGE_TYPES.ENSURE_ARTICLE_COMMENT_CONTEXT,
        commandContext(context),
      );
      return context;
    },
    async addRoot({ context, quoteText, commentText, locator }) {
      const normalizedLocator = normalizeArticleCommentLocator(locator);
      const data = await request<unknown>(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
        ...commandContext(context),
        quoteText,
        commentText,
        ...(normalizedLocator ? { locator: normalizedLocator } : {}),
      });
      const comment = parseArticleCommentDto(data);
      if (!comment) throw new ArticleCommentsSidebarAdapterError('invalid_response', 'invalid article comment payload');
      return { id: commentId(comment.id) };
    },
    async addReply({ context, parent, commentText }) {
      const data = await request<unknown>(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT_REPLY, {
        ...commandContext(context),
        parentId: commentId(parent?.id),
        commentText,
      });
      if (!parseArticleCommentDto(data)) {
        throw new ArticleCommentsSidebarAdapterError('invalid_response', 'invalid article comment payload');
      }
    },
    async delete({ context, comment }) {
      const data = await request<{ ok: boolean }>(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, {
        ...commandContext(context),
        commentId: commentId(comment?.id),
      });
      if (data?.ok !== true)
        throw new ArticleCommentsSidebarAdapterError('invalid_response', 'invalid delete response');
    },
    async ensureAttachedContext(context) {
      await request<{ updated: number }>(
        COMMENTS_MESSAGE_TYPES.ENSURE_ARTICLE_COMMENT_CONTEXT,
        commandContext(context),
      );
    },
    async migrateCanonicalUrl({ previous, next }) {
      const context = toArticleCommentsClientContext(next);
      const fromCanonicalUrl = canonicalizeArticleUrl(previous.canonicalUrl);
      const toCanonicalUrl = canonicalizeArticleUrl(next.canonicalUrl);
      if (!fromCanonicalUrl || !toCanonicalUrl || fromCanonicalUrl === toCanonicalUrl) return;
      if (!context.conversation) {
        throw new ArticleCommentsSidebarAdapterError(
          'invalid_query',
          'article comments require a conversation reference',
        );
      }
      await request<{ updated: number }>(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENT_URL, {
        conversation: context.conversation,
        factsEpoch: context.factsEpoch,
        fromCanonicalUrl,
        toCanonicalUrl,
      });
    },
  };
}
