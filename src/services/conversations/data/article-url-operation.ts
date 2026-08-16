import { createIdbArticleUrlOperation } from './article-url-operation-idb';
import { createNativeArticleUrlOperation } from './article-url-operation-native';

import type { FactsBackendMode } from '@services/local-data/facts-backend';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type { ResolvedConversationReference } from '@services/conversations/data/storage-native';

export type ArticleUrlOperationInput = Readonly<{
  confirmedConflict?: ResolvedConversationReference;
  conversation: ResolvedConversationReference;
  fromCanonicalUrl: string;
  toCanonicalUrl: string;
}>;

export type ArticleUrlOperationResult = Readonly<{
  commentsUpdated: number;
  conversation: ResolvedConversationReference;
  merged: boolean;
  removedConversationId?: number;
}>;

export type ArticleUrlOperation = Readonly<{
  update: (input: ArticleUrlOperationInput) => Promise<ArticleUrlOperationResult>;
}>;

/** One lease-bound compound article URL capability; backend selection happens only here. */
export function createArticleUrlOperation(
  input: Readonly<{ lease: FactsOperationLease; mode: FactsBackendMode }>,
): ArticleUrlOperation {
  assertFactsOperationLease(input.lease);
  return input.mode === 'idb'
    ? createIdbArticleUrlOperation(input.lease)
    : createNativeArticleUrlOperation(input.lease);
}
