import type { ArticleCommentLocator } from '@services/comments/domain/models';
import type { ArticleCommentsClientContext } from '@services/comments/client/repo';
import type { FactsEpoch, StableConversationReference } from '@services/local-data/contracts';
import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

export type ArticleCommentsSidebarContext = {
  canonicalUrl: string;
  // Local rendering hint only. It is never sent back to the facts client.
  conversationId: number | null;
  conversation?: StableConversationReference | null;
  factsEpoch?: FactsEpoch | null;
};

export type ArticleCommentsSidebarEnsureContextInput = {
  tabId?: number | null;
  canonicalUrlFallback?: string;
  ensureArticle?: boolean;
};

export type ArticleCommentsSidebarAddRootResult = {
  id: number;
};

export type ArticleCommentsSidebarListFallbackPolicy = 'none' | 'include-orphan-url';

export type ArticleCommentsSidebarListInput = {
  context: ArticleCommentsSidebarContext;
  fallbackPolicy: ArticleCommentsSidebarListFallbackPolicy;
  signal?: AbortSignal;
};

export type ArticleCommentsSidebarAdapterErrorCode =
  | 'invalid_query'
  | 'runtime_unavailable'
  | 'request_failed'
  | 'invalid_response';

export class ArticleCommentsSidebarAdapterError extends Error {
  readonly code: ArticleCommentsSidebarAdapterErrorCode;
  readonly cause?: unknown;

  constructor(code: ArticleCommentsSidebarAdapterErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ArticleCommentsSidebarAdapterError';
    this.code = code;
    this.cause = options?.cause;
  }
}

export function toArticleCommentsClientContext(context: ArticleCommentsSidebarContext): ArticleCommentsClientContext {
  const canonicalUrl = canonicalizeArticleUrl(context?.canonicalUrl);
  if (!canonicalUrl || typeof context?.factsEpoch !== 'string' || !context.factsEpoch) {
    throw new ArticleCommentsSidebarAdapterError('invalid_query', 'article comments require a current facts context');
  }
  const source = String(context.conversation?.source || '').trim();
  const conversationKey = String(context.conversation?.conversationKey || '').trim();
  if ((source && !conversationKey) || (!source && conversationKey)) {
    throw new ArticleCommentsSidebarAdapterError(
      'invalid_query',
      'article comments require a complete conversation reference',
    );
  }
  if (context.conversationId != null && (!source || !conversationKey)) {
    throw new ArticleCommentsSidebarAdapterError(
      'invalid_query',
      'article comments cannot use a numeric conversation id',
    );
  }
  return {
    canonicalUrl,
    factsEpoch: context.factsEpoch,
    ...(source && conversationKey ? { conversation: { source, conversationKey } } : {}),
  };
}

export type ArticleCommentsSidebarAdapter = {
  list: (input: ArticleCommentsSidebarListInput) => Promise<CommentSidebarItem[]>;
  addRoot: (input: {
    context: ArticleCommentsSidebarContext;
    quoteText: string;
    commentText: string;
    locator?: ArticleCommentLocator | null;
  }) => Promise<ArticleCommentsSidebarAddRootResult>;
  addReply: (input: {
    context: ArticleCommentsSidebarContext;
    parent: CommentSidebarItem;
    commentText: string;
  }) => Promise<void>;
  delete: (input: { context: ArticleCommentsSidebarContext; comment: CommentSidebarItem }) => Promise<void>;
  ensureAttachedContext?: (context: ArticleCommentsSidebarContext) => Promise<void>;
  migrateCanonicalUrl?: (input: {
    previous: ArticleCommentsSidebarContext;
    next: ArticleCommentsSidebarContext;
    signal?: AbortSignal;
  }) => Promise<void | { updated: number }>;
  ensureContext?: (input?: ArticleCommentsSidebarEnsureContextInput) => Promise<ArticleCommentsSidebarContext>;
};
