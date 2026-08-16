import { createIdbArticleCommentsRepository } from '@services/comments/data/storage-idb';
import { createNativeArticleCommentsRepository } from '@services/comments/data/storage-native';
import type { ArticleComment, ArticleCommentLocator } from '@services/comments/domain/models';
import type { FactsBackendMode } from '@services/local-data/facts-backend';
import type { FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type { ResolvedConversationReference } from '@services/conversations/data/storage-native';

export type ResolvedArticleCommentContext = Readonly<{
  canonicalUrl: string;
  conversation: ResolvedConversationReference | null;
}>;

export type ArticleCommentsListFallbackPolicy = 'none' | 'include-orphan-url';

export type ArticleCommentsListInput = Readonly<{
  context: ResolvedArticleCommentContext;
  fallbackPolicy: ArticleCommentsListFallbackPolicy;
}>;

export type ArticleCommentsAddRootInput = Readonly<{
  authorName: string;
  commentText: string;
  context: ResolvedArticleCommentContext;
  locator?: ArticleCommentLocator | null;
  quoteText: string;
}>;

export type ArticleCommentsAddReplyInput = Readonly<{
  authorName: string;
  commentText: string;
  context: ResolvedArticleCommentContext;
  parentId: number;
}>;

export type ArticleCommentsDeleteInput = Readonly<{
  commentId: number;
  context: ResolvedArticleCommentContext;
}>;

export type ArticleCommentsMigrateInput = Readonly<{
  context: ResolvedArticleCommentContext;
  fromCanonicalUrl: string;
  toCanonicalUrl: string;
}>;

export type ArticleCommentsEnsureContextInput = Readonly<{
  context: ResolvedArticleCommentContext;
}>;

export type ArticleCommentsRepository = Readonly<{
  addReply: (input: ArticleCommentsAddReplyInput) => Promise<ArticleComment>;
  addRoot: (input: ArticleCommentsAddRootInput) => Promise<ArticleComment>;
  delete: (input: ArticleCommentsDeleteInput) => Promise<boolean>;
  ensureContext: (input: ArticleCommentsEnsureContextInput) => Promise<{ updated: number }>;
  list: (input: ArticleCommentsListInput) => Promise<ArticleComment[]>;
  migrateCanonicalUrl: (input: ArticleCommentsMigrateInput) => Promise<{ updated: number }>;
}>;

export type ArticleCommentsFactsRepository = ArticleCommentsRepository;

/** Selects only the facts adapter admitted by the caller's already-held operation lease. */
export function createArticleCommentsRepository(
  input: Readonly<{
    lease: FactsOperationLease;
    mode: FactsBackendMode;
  }>,
): ArticleCommentsRepository {
  const repository: ArticleCommentsFactsRepository =
    input.mode === 'native'
      ? createNativeArticleCommentsRepository(input.lease)
      : createIdbArticleCommentsRepository(input.lease);
  return repository;
}
