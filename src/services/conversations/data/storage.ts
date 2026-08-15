import * as idb from '@services/conversations/data/storage-idb';
import { FactsBackend, type BoundFactsRepository } from '@services/local-data/facts-backend';
import { LocalDataContractError, type StableConversationReference } from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type {
  ConversationDetail,
  ConversationListCursor,
  ConversationListQueryInput,
  ConversationTailWindow,
} from '@services/conversations/domain/models';
import {
  createNativeConversationReadRepository,
  type ConversationReadRepository,
} from '@services/conversations/data/storage-native';

export type { ConversationReadRepository } from '@services/conversations/data/storage-native';

function assertReference(reference: StableConversationReference): StableConversationReference {
  const source = String(reference?.source || '').trim();
  const conversationKey = String(reference?.conversationKey || '').trim();
  if (!source || !conversationKey) throw new LocalDataContractError('INVALID_ARGUMENT');
  return { source, conversationKey };
}

function createIdbConversationReadRepository(lease: FactsOperationLease): ConversationReadRepository {
  const assertLease = () => assertFactsOperationLease(lease);
  return Object.freeze({
    async getConversationListBootstrap(queryInput?: ConversationListQueryInput | null, limit?: number | null) {
      assertLease();
      return await idb.getConversationListBootstrap(queryInput, limit);
    },
    async getConversationListPage(
      queryInput: ConversationListQueryInput | null | undefined,
      cursor: ConversationListCursor,
      limit?: number | null,
    ) {
      assertLease();
      if (!cursor || 'nativeCursor' in cursor) throw new LocalDataContractError('STALE_REFERENCE');
      return await idb.getConversationListPage(queryInput, cursor, limit);
    },
    async findConversationById(conversationId: number) {
      assertLease();
      return await idb.findConversationById(conversationId);
    },
    async findConversationBySourceAndKey(source: string, conversationKey: string) {
      assertLease();
      const reference = assertReference({ source, conversationKey });
      return await idb.findConversationBySourceAndKey(reference.source, reference.conversationKey);
    },
    async getConversationByReference(reference: StableConversationReference) {
      assertLease();
      const normalized = assertReference(reference);
      return await idb.getConversationBySourceConversationKey(normalized.source, normalized.conversationKey);
    },
    async getConversationDetail(reference: StableConversationReference): Promise<ConversationDetail> {
      assertLease();
      const normalized = assertReference(reference);
      const conversation = await idb.getConversationBySourceConversationKey(
        normalized.source,
        normalized.conversationKey,
      );
      if (!conversation) throw new LocalDataContractError('STALE_REFERENCE');
      assertLease();
      return {
        conversationId: Number(conversation.id),
        source: normalized.source,
        conversationKey: normalized.conversationKey,
        messages: await idb.getMessagesByConversationId(Number(conversation.id)),
      };
    },
    async getConversationTailWindow(
      reference: StableConversationReference,
      limit: number,
    ): Promise<ConversationTailWindow> {
      assertLease();
      const normalized = assertReference(reference);
      const result = await idb.getConversationTailWindowBySourceAndKey(
        normalized.source,
        normalized.conversationKey,
        limit,
      );
      if (!result.conversation) throw new LocalDataContractError('STALE_REFERENCE');
      const conversationId = Number(result.conversation?.id);
      return {
        conversationId: Number.isFinite(conversationId) && conversationId > 0 ? conversationId : null,
        messages: Array.isArray(result.messages) ? result.messages : [],
      };
    },
    async searchConversationMentionCandidates(input) {
      assertLease();
      return await idb.searchConversationMentionCandidates(input);
    },
  });
}

const conversationFactsBackend = new FactsBackend<ConversationReadRepository>({
  createIdbRepository: createIdbConversationReadRepository,
  createNativeRepository: createNativeConversationReadRepository,
});

export async function openConversationReadRepository(lease: FactsOperationLease, expectedFactsEpoch?: unknown) {
  return await conversationFactsBackend.open(lease, expectedFactsEpoch);
}

export type ConversationReadRunner = Readonly<{
  run: <T>(
    input: Readonly<{
      expectedFactsEpoch?: unknown;
      kind: string;
      read: (backend: BoundFactsRepository<ConversationReadRepository>) => Promise<T> | T;
    }>,
  ) => Promise<T>;
}>;

export function createConversationReadRunner(
  gate: Readonly<{
    runFactsOperation: <T>(kind: string, fn: (lease: FactsOperationLease) => Promise<T> | T) => Promise<T>;
  }>,
  openRepository: typeof openConversationReadRepository = openConversationReadRepository,
): ConversationReadRunner {
  return Object.freeze({
    run: async ({ kind, expectedFactsEpoch, read }) =>
      await gate.runFactsOperation(kind, async (lease) => await read(await openRepository(lease, expectedFactsEpoch))),
  });
}

// ponytail: P3-T5's article capture operation is the last production caller; remove with its lease-bound snapshot write.
export async function getConversationBySourceConversationKey(source: string, conversationKey: string) {
  return await idb.getConversationBySourceConversationKey(source, conversationKey);
}

export async function upsertConversation(payload: any) {
  return await idb.upsertConversation(payload);
}

export async function hasConversation(payload: any) {
  return await idb.hasConversation(payload);
}

export async function syncConversationMessages(
  conversationId: number,
  messages: any[],
  options?: {
    mode?: 'snapshot' | 'incremental' | 'append';
    diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null;
  },
) {
  return await idb.syncConversationMessages(conversationId, messages, options);
}

export async function deleteConversationsByIds(conversationIds: any[]) {
  return await idb.deleteConversationsByIds(conversationIds);
}

export async function mergeConversationsByIds(input: { keepConversationId: number; removeConversationId: number }) {
  return await idb.mergeConversationsByIds(input);
}
