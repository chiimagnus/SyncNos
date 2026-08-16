import { connectNative, type NativeHostRequest } from '@platform/local-data/native-client';
import { LocalDataContractError, type HostConversationReference } from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type {
  ArticleUrlOperation,
  ArticleUrlOperationInput,
  ArticleUrlOperationResult,
} from '@services/conversations/data/article-url-operation';
import type { ResolvedConversationReference } from '@services/conversations/data/storage-native';

function protocolFailure(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
}

function hostReference(reference: ResolvedConversationReference): HostConversationReference {
  const source = String(reference?.source || '').trim();
  const conversationKey = String(reference?.conversationKey || '').trim();
  const backendConversationId = Number(reference?.conversationId);
  if (!source || !conversationKey || !Number.isSafeInteger(backendConversationId) || backendConversationId <= 0) {
    throw new LocalDataContractError('STALE_REFERENCE');
  }
  return { source, conversationKey, backendConversationId };
}

function result(value: unknown): ArticleUrlOperationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolFailure();
  const row = value as Record<string, unknown>;
  const conversationId = Number(row.conversationId);
  const source = String(row.conversationSource || '').trim();
  const conversationKey = String(row.conversationKey || '').trim();
  const commentsUpdated = Number(row.commentsUpdated);
  const removedConversationId = row.removedConversationId === undefined ? undefined : Number(row.removedConversationId);
  if (
    !Number.isSafeInteger(conversationId) ||
    conversationId <= 0 ||
    !source ||
    !conversationKey ||
    !Number.isSafeInteger(commentsUpdated) ||
    commentsUpdated < 0 ||
    typeof row.merged !== 'boolean' ||
    (removedConversationId !== undefined &&
      (!Number.isSafeInteger(removedConversationId) || removedConversationId <= 0))
  ) {
    protocolFailure();
  }
  return Object.freeze({
    commentsUpdated,
    conversation: { source, conversationKey, conversationId },
    merged: row.merged,
    ...(removedConversationId === undefined ? {} : { removedConversationId }),
  });
}

export function createNativeArticleUrlOperation(lease: FactsOperationLease): ArticleUrlOperation {
  return Object.freeze({
    async update(input: ArticleUrlOperationInput) {
      assertFactsOperationLease(lease);
      const response = await connectNative({
        command: 'UPDATE_ARTICLE_URL',
        payload: {
          conversation: hostReference(input.conversation),
          ...(input.confirmedConflict ? { confirmedConflict: hostReference(input.confirmedConflict) } : {}),
          fromCanonicalUrl: input.fromCanonicalUrl,
          toCanonicalUrl: input.toCanonicalUrl,
        },
      } as NativeHostRequest<'UPDATE_ARTICLE_URL'>);
      assertFactsOperationLease(lease);
      return result(response);
    },
  });
}
