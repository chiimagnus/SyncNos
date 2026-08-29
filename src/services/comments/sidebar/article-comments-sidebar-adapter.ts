import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import type { ArticleCommentLocator } from '@services/comments/domain/models';
import { normalizePositiveInt } from '@services/shared/numbers';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

export type ArticleCommentsSidebarContext = {
  canonicalUrl: string;
  conversationId: number | null;
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
  canonicalUrl: string;
  conversationId: number | null;
  fallbackPolicy: ArticleCommentsSidebarListFallbackPolicy;
  signal?: AbortSignal;
};

export type ArticleCommentsSidebarFindExistingContextInput = {
  canonicalUrl: string;
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

export type NormalizedArticleCommentsSidebarListInput = {
  canonicalUrl: string;
  conversationId: number | null;
  fallbackPolicy: ArticleCommentsSidebarListFallbackPolicy;
};

export function normalizeArticleCommentsSidebarListInput(
  input: ArticleCommentsSidebarListInput,
): NormalizedArticleCommentsSidebarListInput {
  const canonicalUrl = canonicalizeArticleUrl(input?.canonicalUrl);
  const conversationId = normalizePositiveInt(input?.conversationId);
  if (!canonicalUrl && !conversationId) {
    throw new ArticleCommentsSidebarAdapterError(
      'invalid_query',
      'article comments list requires canonicalUrl or conversationId',
    );
  }
  return {
    canonicalUrl,
    conversationId,
    fallbackPolicy: input?.fallbackPolicy === 'include-orphan-url' ? 'include-orphan-url' : 'none',
  };
}

export function filterArticleCommentsForListIdentity(
  items: CommentSidebarItem[],
  input: Pick<NormalizedArticleCommentsSidebarListInput, 'conversationId'>,
): CommentSidebarItem[] {
  const conversationId = normalizePositiveInt(input.conversationId);
  return items.filter((item) => {
    const itemConversationId = normalizePositiveInt(item?.conversationId);
    return conversationId
      ? itemConversationId == null || itemConversationId === conversationId
      : itemConversationId == null;
  });
}

export function mergeArticleCommentsByIdentity(...groups: CommentSidebarItem[][]): CommentSidebarItem[] {
  const byId = new Map<number, CommentSidebarItem>();
  for (const group of groups) {
    for (const item of group) {
      const id = normalizePositiveInt(item?.id);
      if (!id || byId.has(id)) continue;
      byId.set(id, item);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const createdDelta = Number(left.createdAt || 0) - Number(right.createdAt || 0);
    return createdDelta || Number(left.id || 0) - Number(right.id || 0);
  });
}

export type ArticleCommentsSidebarAdapter = {
  list: (input: ArticleCommentsSidebarListInput) => Promise<CommentSidebarItem[]>;
  addRoot: (input: {
    canonicalUrl: string;
    conversationId: number | null;
    quoteText: string;
    commentText: string;
    locator?: ArticleCommentLocator | null;
  }) => Promise<ArticleCommentsSidebarAddRootResult>;
  addReply: (input: {
    canonicalUrl: string;
    conversationId: number | null;
    parentId: number;
    commentText: string;
  }) => Promise<void>;
  delete: (input: { id: number }) => Promise<void>;
  findExistingContext?: (
    input: ArticleCommentsSidebarFindExistingContextInput,
  ) => Promise<ArticleCommentsSidebarContext>;
  migrateCanonicalUrl?: (input: {
    fromCanonicalUrl: string;
    toCanonicalUrl: string;
    conversationId: number | null;
    signal?: AbortSignal;
  }) => Promise<void | { updated: number }>;
  ensureContext?: (input?: ArticleCommentsSidebarEnsureContextInput) => Promise<ArticleCommentsSidebarContext>;
};
