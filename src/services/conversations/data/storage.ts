import * as idb from '@services/conversations/data/storage-idb';
import { FactsBackend, type BoundFactsRepository } from '@services/local-data/facts-backend';
import {
  LocalDataContractError,
  type ConversationCaptureSnapshot,
  type JsonObject,
  type JsonValue,
  type StableConversationReference,
} from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type {
  ConversationDetail,
  ConversationListCursor,
  ConversationListQueryInput,
  ConversationTailWindow,
} from '@services/conversations/domain/models';
import {
  createNativeConversationReadRepository,
  type ConversationFactsRepository,
  type ConversationMappingRead,
  type ConversationMessageSyncOptions,
  type ResolvedConversationReference,
} from '@services/conversations/data/storage-native';

export type {
  ConversationFactsRepository,
  ConversationMappingRead,
  ConversationMessageSyncOptions,
  ConversationMutationRepository,
  ConversationReadRepository,
  ResolvedConversationReference,
} from '@services/conversations/data/storage-native';

function assertReference(reference: StableConversationReference): StableConversationReference {
  const source = String(reference?.source || '').trim();
  const conversationKey = String(reference?.conversationKey || '').trim();
  if (!source || !conversationKey) throw new LocalDataContractError('INVALID_ARGUMENT');
  return { source, conversationKey };
}

function assertResolvedReference(reference: ResolvedConversationReference): ResolvedConversationReference {
  const normalized = assertReference(reference);
  const conversationId = Number(reference?.conversationId);
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
    throw new LocalDataContractError('STALE_REFERENCE');
  }
  return { ...normalized, conversationId };
}

function createIdbConversationReadRepository(lease: FactsOperationLease): ConversationFactsRepository {
  const assertLease = () => assertFactsOperationLease(lease);
  return Object.freeze({
    async getFactsRevision() {
      assertLease();
      return null;
    },
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
    async getInsightStats(input) {
      assertLease();
      return await idb.getInsightStats(input);
    },
    async searchConversationMentionCandidates(input) {
      assertLease();
      return await idb.searchConversationMentionCandidates(input);
    },
    async upsertConversation(payload: JsonObject) {
      assertLease();
      return await idb.upsertConversation(payload);
    },
    async saveConversationSnapshot(snapshot: ConversationCaptureSnapshot) {
      assertLease();
      const isNew = !(await idb.hasConversation(snapshot.conversation));
      const conversation = await idb.upsertConversation(snapshot.conversation);
      const conversationId = Number(conversation.id);
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
        throw new LocalDataContractError('PROTOCOL_MISMATCH');
      }
      const result = await idb.syncConversationMessages(conversationId, [...snapshot.messages], {
        ...(snapshot.mode === undefined ? {} : { mode: snapshot.mode }),
        ...(snapshot.diff === undefined ? {} : { diff: snapshot.diff }),
      });
      return { conversation, isNew, ...result };
    },
    async deleteConversations(references) {
      assertLease();
      const resolved = references.map(assertResolvedReference);
      if (!resolved.length) throw new LocalDataContractError('INVALID_ARGUMENT');
      return await idb.deleteConversationsByIds(resolved.map((reference) => reference.conversationId));
    },
    async syncConversationMessages(reference, messages: JsonValue, options?: ConversationMessageSyncOptions) {
      assertLease();
      const resolved = assertResolvedReference(reference);
      if (!Array.isArray(messages)) throw new LocalDataContractError('INVALID_ARGUMENT');
      return await idb.syncConversationMessages(resolved.conversationId, messages, options);
    },
    async getSyncMapping(reference, _provider): Promise<ConversationMappingRead | null> {
      assertLease();
      const resolved = assertResolvedReference(reference);
      return (await idb.getSyncMappingByConversation(resolved.conversationId)) as ConversationMappingRead | null;
    },
    async patchSyncMapping(reference, _provider, patch) {
      assertLease();
      const resolved = assertResolvedReference(reference);
      return await idb.patchSyncMapping(resolved.conversationId, patch);
    },
    async setSyncCursor(reference, cursor) {
      assertLease();
      const resolved = assertResolvedReference(reference);
      return await idb.setSyncCursor(resolved.conversationId, cursor);
    },
    async setConversationNotionPageId(reference, notionPageId, meta) {
      assertLease();
      const resolved = assertResolvedReference(reference);
      return await idb.setConversationNotionPageId(resolved.conversationId, notionPageId, meta);
    },
    async clearSyncMapping(reference, _provider) {
      assertLease();
      const resolved = assertResolvedReference(reference);
      return await idb.clearSyncCursor(resolved.conversationId);
    },
  });
}

const conversationFactsBackend = new FactsBackend<ConversationFactsRepository>({
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
      read: (
        backend: BoundFactsRepository<ConversationFactsRepository> & Readonly<{ lease: FactsOperationLease }>,
      ) => Promise<T> | T;
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
      await gate.runFactsOperation(
        kind,
        async (lease) => await read({ ...(await openRepository(lease, expectedFactsEpoch)), lease }),
      ),
  });
}
