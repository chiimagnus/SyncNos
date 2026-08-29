import { ARTICLE_MESSAGE_TYPES, COMMENTS_MESSAGE_TYPES, CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { parseArticleCommentDtos } from '@services/comments/domain/comment-dto';
import { buildCanonicalWebArticleIdentity } from '@services/conversations/domain/article-identity';
import {
  ArticleCommentsSidebarAdapterError,
  filterArticleCommentsForListIdentity,
  mergeArticleCommentsByIdentity,
  normalizeArticleCommentsSidebarListInput,
} from '@services/comments/sidebar/article-comments-sidebar-adapter';

import type { ArticleCommentsSidebarAdapter } from '@services/comments/sidebar/article-comments-sidebar-adapter';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function normalizeConversationId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function getLocationHrefFallback(): string {
  try {
    return String(globalThis.location?.href || '');
  } catch (_e) {
    return '';
  }
}

export function createArticleCommentsSidebarInpageAdapter(
  runtime: RuntimeClient | null,
): ArticleCommentsSidebarAdapter {
  const rt = runtime;

  const listFromRuntime = async (payload: { canonicalUrl?: string; conversationId?: number }) => {
    if (!rt?.send) {
      throw new ArticleCommentsSidebarAdapterError(
        'runtime_unavailable',
        'runtime is unavailable for article comments',
      );
    }
    let res: any;
    try {
      res = await rt.send(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, payload);
    } catch (error) {
      throw new ArticleCommentsSidebarAdapterError('request_failed', 'failed to list article comments', {
        cause: error,
      });
    }
    if (!res || typeof res.ok !== 'boolean') {
      throw new ArticleCommentsSidebarAdapterError('invalid_response', 'invalid article comments runtime response');
    }
    if (!res.ok) {
      throw new ArticleCommentsSidebarAdapterError(
        'request_failed',
        String(res?.error?.message || 'failed to list article comments'),
      );
    }
    if (!Array.isArray(res.data)) {
      throw new ArticleCommentsSidebarAdapterError('invalid_response', 'invalid article comments payload');
    }
    return parseArticleCommentDtos(res.data);
  };

  return {
    async list(input) {
      const query = normalizeArticleCommentsSidebarListInput(input);
      const byConversation = query.conversationId
        ? await listFromRuntime({ conversationId: query.conversationId })
        : [];
      const shouldReadUrl =
        !!query.canonicalUrl && (!query.conversationId || query.fallbackPolicy === 'include-orphan-url');
      const byCanonicalUrl = shouldReadUrl
        ? filterArticleCommentsForListIdentity(await listFromRuntime({ canonicalUrl: query.canonicalUrl }), query)
        : [];
      return mergeArticleCommentsByIdentity(byConversation, byCanonicalUrl);
    },
    async findExistingContext(input) {
      const identity = buildCanonicalWebArticleIdentity(input?.canonicalUrl);
      if (!identity) {
        throw new ArticleCommentsSidebarAdapterError('invalid_query', 'missing canonical article URL');
      }
      if (!rt?.send) {
        throw new ArticleCommentsSidebarAdapterError(
          'runtime_unavailable',
          'runtime is unavailable for article identity lookup',
        );
      }
      if (input?.signal?.aborted) {
        const error = new Error('article identity lookup aborted');
        error.name = 'AbortError';
        throw error;
      }

      let response: any;
      try {
        response = await rt.send(CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_SOURCE_AND_KEY, {
          source: identity.source,
          conversationKey: identity.conversationKey,
        });
      } catch (error) {
        if (input?.signal?.aborted) {
          const abortError = new Error('article identity lookup aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }
        throw new ArticleCommentsSidebarAdapterError('request_failed', 'failed to find existing article context', {
          cause: error,
        });
      }
      if (input?.signal?.aborted) {
        const error = new Error('article identity lookup aborted');
        error.name = 'AbortError';
        throw error;
      }
      if (!response || typeof response.ok !== 'boolean') {
        throw new ArticleCommentsSidebarAdapterError('invalid_response', 'invalid article identity runtime response');
      }
      if (!response.ok) {
        throw new ArticleCommentsSidebarAdapterError(
          'request_failed',
          String(response?.error?.message || 'failed to find existing article context'),
        );
      }

      return {
        canonicalUrl: identity.url,
        conversationId: normalizeConversationId(response?.data?.id),
      };
    },
    async ensureContext(input) {
      const ensureArticle = input?.ensureArticle !== false;
      const fallbackUrl =
        canonicalizeArticleUrl(input?.canonicalUrlFallback) || canonicalizeArticleUrl(getLocationHrefFallback());

      if (!rt?.send || !ensureArticle) {
        return { canonicalUrl: fallbackUrl, conversationId: null };
      }

      const payload = input?.tabId ? { tabId: Number(input.tabId) } : null;
      const res = await rt.send(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, payload ?? undefined);
      if (!res?.ok) {
        return { canonicalUrl: fallbackUrl, conversationId: null };
      }

      const canonicalUrl = canonicalizeArticleUrl(res?.data?.url) || fallbackUrl;
      const conversationId = normalizeConversationId(res?.data?.conversationId);
      if (canonicalUrl && conversationId) {
        try {
          await rt.send(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS, { canonicalUrl, conversationId });
        } catch (_e) {
          // ignore
        }
      }
      return { canonicalUrl, conversationId };
    },
    async addRoot({ canonicalUrl, conversationId, quoteText, commentText, locator }) {
      const normalized = canonicalizeArticleUrl(canonicalUrl);
      if (!normalized) throw new Error('missing canonicalUrl for adding article comment');
      if (!rt?.send) throw new Error('missing runtime for adding article comment');
      const res = await rt.send(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
        canonicalUrl: normalized,
        conversationId,
        quoteText,
        commentText,
        locator: locator ?? null,
      });
      if (!res?.ok) throw new Error('failed to add article comment');
      const id = Number(res?.data?.id);
      if (!Number.isFinite(id) || id <= 0) throw new Error('failed to add article comment');
      return { id };
    },
    async addReply({ canonicalUrl, conversationId, parentId, commentText }) {
      const normalized = canonicalizeArticleUrl(canonicalUrl);
      if (!normalized) throw new Error('missing canonicalUrl for replying article comment');
      if (!rt?.send) throw new Error('missing runtime for replying article comment');
      const res = await rt.send(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
        canonicalUrl: normalized,
        conversationId,
        parentId,
        quoteText: '',
        commentText,
      });
      if (!res?.ok) throw new Error('failed to reply article comment');
    },
    async delete({ id }) {
      if (!rt?.send) throw new Error('missing runtime for deleting article comment');
      const res = await rt.send(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, { id });
      if (!res?.ok || res?.data?.ok !== true) throw new Error('failed to delete article comment');
    },
    async migrateCanonicalUrl({ fromCanonicalUrl, toCanonicalUrl, conversationId }) {
      const from = canonicalizeArticleUrl(fromCanonicalUrl);
      const to = canonicalizeArticleUrl(toCanonicalUrl);
      if (!from || !to || from === to) return;
      if (!rt?.send) return;
      await rt.send(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL, {
        fromCanonicalUrl: from,
        toCanonicalUrl: to,
        conversationId,
      });
    },
  };
}
