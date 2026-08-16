import { createArticleCommentsRepository } from '@services/comments/data/storage';
import { createImageStorage, type ImageAsset } from '@services/conversations/data/image-storage';
import {
  openConversationReadRepository,
  type ConversationMappingRead,
  type ResolvedConversationReference,
} from '@services/conversations/data/storage';
import type { Conversation } from '@services/conversations/domain/models';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import {
  LocalDataContractError,
  type JsonObject,
  type StableConversationReference,
} from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type { SyncProvider } from '@services/sync/models';

export type BackgroundStorage = Readonly<{
  resolveConversation: (reference: StableConversationReference) => Promise<ResolvedConversationReference | null>;
  getConversationByReference: (reference: StableConversationReference) => Promise<Conversation | null>;
  getMessagesByConversation: (conversation: ResolvedConversationReference) => Promise<unknown[]>;
  getSyncMappingByConversation: (
    conversation: ResolvedConversationReference,
  ) => Promise<ConversationMappingRead | null>;
  patchSyncMapping: (conversation: ResolvedConversationReference, patch: JsonObject) => Promise<true>;
  setConversationNotionPageId: (
    conversation: ResolvedConversationReference,
    notionPageId: string,
    meta?: Readonly<{ notionPageUrl?: string; notionWorkspaceSlug?: string }>,
  ) => Promise<true>;
  setSyncCursor: (conversation: ResolvedConversationReference, cursor: JsonObject) => Promise<true>;
  clearSyncCursor: (conversation: ResolvedConversationReference) => Promise<true>;
  getArticleCommentsByConversation: (conversation: ResolvedConversationReference) => Promise<unknown[]>;
  attachOrphanArticleCommentsToConversation: (
    canonicalUrl: string,
    conversation: ResolvedConversationReference,
  ) => Promise<number>;
  getImageAsset: (conversation: ResolvedConversationReference, assetId: number) => Promise<ImageAsset | null>;
}>;

function normalizeReference(value: unknown): StableConversationReference | null {
  const source = String((value as any)?.source || '').trim();
  const conversationKey = String((value as any)?.conversationKey || '').trim();
  return source && conversationKey ? { source, conversationKey } : null;
}

/** One provider operation owns one backend-selected capability for its complete remote + local boundary. */
export async function createBackgroundStorage(
  lease: FactsOperationLease,
  input: Readonly<{ provider: SyncProvider; expectedFactsEpoch?: unknown }>,
): Promise<BackgroundStorage> {
  assertFactsOperationLease(lease);
  const bound = await openConversationReadRepository(lease, input.expectedFactsEpoch);
  assertFactsOperationLease(lease);
  const repository = bound.repository;
  const comments = createArticleCommentsRepository({ lease, mode: bound.mode });
  const images = createImageStorage({ lease, mode: bound.mode });

  const resolveConversation = async (
    reference: StableConversationReference,
  ): Promise<ResolvedConversationReference | null> => {
    assertFactsOperationLease(lease);
    const normalized = normalizeReference(reference);
    if (!normalized) throw new LocalDataContractError('INVALID_ARGUMENT');
    const conversation = await repository.getConversationByReference(normalized);
    if (!conversation) return null;
    const current = normalizeReference(conversation);
    const conversationId = Number(conversation.id);
    if (
      !current ||
      current.source !== normalized.source ||
      current.conversationKey !== normalized.conversationKey ||
      !Number.isSafeInteger(conversationId) ||
      conversationId <= 0
    ) {
      throw new LocalDataContractError('STALE_REFERENCE');
    }
    return { ...current, conversationId };
  };

  const requireCurrent = async (
    conversation: ResolvedConversationReference,
  ): Promise<ResolvedConversationReference> => {
    const resolved = await resolveConversation(conversation);
    if (!resolved || resolved.conversationId !== conversation.conversationId) {
      throw new LocalDataContractError('STALE_REFERENCE');
    }
    return resolved;
  };

  const getCanonicalContext = async (conversation: ResolvedConversationReference, override?: string) => {
    const current = await requireCurrent(conversation);
    const row = await repository.getConversationByReference(current);
    if (!row) throw new LocalDataContractError('STALE_REFERENCE');
    const canonicalUrl = canonicalizeArticleUrl(String(override || row.url || ''));
    if (!canonicalUrl) throw new LocalDataContractError('INVALID_ARGUMENT');
    return { canonicalUrl, conversation: current } as const;
  };

  return Object.freeze({
    resolveConversation,
    async getConversationByReference(reference) {
      assertFactsOperationLease(lease);
      const resolved = await resolveConversation(reference);
      return resolved ? await repository.getConversationByReference(resolved) : null;
    },
    async getMessagesByConversation(conversation) {
      const current = await requireCurrent(conversation);
      const detail = await repository.getConversationDetail(current);
      return Array.isArray(detail.messages) ? detail.messages : [];
    },
    async getSyncMappingByConversation(conversation) {
      return await repository.getSyncMapping(await requireCurrent(conversation), input.provider);
    },
    async patchSyncMapping(conversation, patch) {
      return await repository.patchSyncMapping(await requireCurrent(conversation), input.provider, patch);
    },
    async setConversationNotionPageId(conversation, notionPageId, meta) {
      return await repository.setConversationNotionPageId(await requireCurrent(conversation), notionPageId, meta);
    },
    async setSyncCursor(conversation, cursor) {
      return await repository.setSyncCursor(await requireCurrent(conversation), cursor);
    },
    async clearSyncCursor(conversation) {
      return await repository.clearSyncMapping(await requireCurrent(conversation), input.provider);
    },
    async getArticleCommentsByConversation(conversation) {
      const context = await getCanonicalContext(conversation);
      return await comments.list({ context, fallbackPolicy: 'include-orphan-url' });
    },
    async attachOrphanArticleCommentsToConversation(canonicalUrl, conversation) {
      const context = await getCanonicalContext(conversation, canonicalUrl);
      return (await comments.ensureContext({ context })).updated;
    },
    async getImageAsset(conversation, assetId) {
      return await images.getAsset(await requireCurrent(conversation), assetId);
    },
  });
}
