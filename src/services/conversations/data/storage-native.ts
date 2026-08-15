import { connectNative, type NativeHostRequest } from '@platform/local-data/native-client';
import {
  LocalDataContractError,
  serializedJsonUtf8ByteLength,
  type ConversationCaptureSnapshot,
  type ConversationMessageSyncMode,
  type HostConversationReference,
  type HostFactsCommand,
  type JsonObject,
  type JsonValue,
  type StableConversationReference,
} from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type {
  Conversation,
  ConversationDetail,
  ConversationListCursor,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListQueryInput,
  ConversationMentionCandidate,
  ConversationTailWindow,
} from '@services/conversations/domain/models';

type NativeConnectedCommand = Extract<
  HostFactsCommand,
  | 'CONVERSATION_BOOTSTRAP'
  | 'CONVERSATION_LOAD_MORE'
  | 'CONVERSATION_LOOKUP'
  | 'CONVERSATION_DETAIL'
  | 'CONVERSATION_TAIL'
  | 'SAVE_CONVERSATION_SNAPSHOT'
  | 'UPSERT_CONVERSATION'
  | 'DELETE_CONVERSATIONS'
  | 'MERGE_CONVERSATIONS'
  | 'SYNC_CONVERSATION_MESSAGES'
  | 'GET_SYNC_MAPPING'
  | 'PATCH_SYNC_MAPPING'
  | 'SET_SYNC_CURSOR'
  | 'SET_CONVERSATION_NOTION_PAGE_ID'
  | 'CLEAR_SYNC_MAPPING'
>;

type NativeConnect = <TData>(input: NativeHostRequest<NativeConnectedCommand>) => Promise<TData>;

export type ConversationReadRepository = Readonly<{
  findConversationById?: (conversationId: number) => Promise<ConversationListOpenTarget | null>;
  findConversationBySourceAndKey: (
    source: string,
    conversationKey: string,
  ) => Promise<ConversationListOpenTarget | null>;
  getConversationByReference: (reference: StableConversationReference) => Promise<Conversation | null>;
  getConversationDetail: (reference: StableConversationReference) => Promise<ConversationDetail>;
  getConversationListBootstrap: (
    queryInput?: ConversationListQueryInput | null,
    limit?: number | null,
  ) => Promise<ConversationListPage<Conversation>>;
  getConversationListPage: (
    queryInput: ConversationListQueryInput | null | undefined,
    cursor: ConversationListCursor,
    limit?: number | null,
  ) => Promise<ConversationListPage<Conversation>>;
  getConversationTailWindow: (reference: StableConversationReference, limit: number) => Promise<ConversationTailWindow>;
  searchConversationMentionCandidates: (input?: {
    limit?: unknown;
    maxDurationMs?: number;
    maxScan?: number;
    query?: unknown;
  }) => Promise<{
    candidates: ConversationMentionCandidate[];
    scannedCount: number;
    truncatedByScanLimit: boolean;
  }>;
}>;

export type ResolvedConversationReference = StableConversationReference &
  Readonly<{
    conversationId: number;
  }>;

export type ConversationMessageSyncOptions = Readonly<{
  diff?: { added?: readonly string[]; removed?: readonly string[]; updated?: readonly string[] } | null;
  mode?: ConversationMessageSyncMode;
}>;

export type ConversationCaptureSnapshotPersistenceResult = Readonly<{
  conversation: Conversation;
  deleted: number;
  isNew: boolean;
  upserted: number;
}>;

export type ConversationMappingRead = Readonly<{
  conversation: Conversation;
  mapping: Record<string, unknown> | null;
}>;

export type ConversationMutationRepository = Readonly<{
  clearSyncMapping: (reference: ResolvedConversationReference, provider: string) => Promise<true>;
  deleteConversations: (references: readonly ResolvedConversationReference[]) => Promise<{
    deletedConversations: number;
    deletedImageCache: number;
    deletedMappings: number;
    deletedMessages: number;
  }>;
  getSyncMapping: (
    reference: ResolvedConversationReference,
    provider: string,
  ) => Promise<ConversationMappingRead | null>;
  mergeConversations: (
    input: Readonly<{
      keep: ResolvedConversationReference;
      remove: ResolvedConversationReference;
    }>,
  ) => Promise<{
    keptConversationId: number;
    merged: boolean;
    movedImageCache: number;
    movedMessages: number;
    removedConversationId: number;
  }>;
  patchSyncMapping: (reference: ResolvedConversationReference, provider: string, patch: JsonObject) => Promise<true>;
  saveConversationSnapshot: (
    snapshot: ConversationCaptureSnapshot,
  ) => Promise<ConversationCaptureSnapshotPersistenceResult>;
  setConversationNotionPageId: (
    reference: ResolvedConversationReference,
    notionPageId: string,
    meta?: Readonly<{ notionPageUrl?: string; notionWorkspaceSlug?: string }>,
  ) => Promise<true>;
  setSyncCursor: (reference: ResolvedConversationReference, cursor: JsonObject) => Promise<true>;
  syncConversationMessages: (
    reference: ResolvedConversationReference,
    messages: JsonValue,
    options?: ConversationMessageSyncOptions,
  ) => Promise<{ deleted: number; upserted: number }>;
  upsertConversation: (payload: JsonObject) => Promise<Conversation>;
}>;

export type ConversationFactsRepository = ConversationReadRepository & ConversationMutationRepository;

export type NativeConversationReadDependencies = Readonly<{
  connectNative?: NativeConnect;
}>;

function protocolFailure(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolFailure();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) protocolFailure();
  return value as Record<string, unknown>;
}

function text(value: unknown, required = false): string {
  if (typeof value !== 'string') {
    if (required) protocolFailure();
    return '';
  }
  const normalized = value.trim();
  if (required && !normalized) protocolFailure();
  return normalized;
}

function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) protocolFailure();
  return Number(value);
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) protocolFailure();
  return Number(value);
}

function finiteTimestamp(value: unknown): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value);
}

function hostReference(
  reference: StableConversationReference & Readonly<{ conversationId?: unknown }>,
): HostConversationReference {
  const source = text(reference?.source, true);
  const conversationKey = text(reference?.conversationKey, true);
  const conversationId = reference?.conversationId;
  return {
    source,
    conversationKey,
    ...(conversationId === undefined ? {} : { backendConversationId: positiveId(conversationId) }),
  };
}

function asConversation(value: unknown): Conversation {
  const input = record(value);
  return {
    ...(input as Conversation),
    id: positiveId(input.id),
    source: text(input.source, true),
    conversationKey: text(input.conversationKey, true),
  };
}

function asMessages(value: unknown): ConversationDetail['messages'] {
  if (!Array.isArray(value)) protocolFailure();
  return value.map((message) => {
    const input = record(message);
    return {
      ...(input as ConversationDetail['messages'][number]),
      id: positiveId(input.id),
      conversationId: positiveId(input.conversationId),
      messageKey: text(input.messageKey, true),
      role: text(input.role, true),
    };
  });
}

function asPage(value: unknown): ConversationListPage<Conversation> {
  const input = record(value);
  if (!Array.isArray(input.items) || typeof input.hasMore !== 'boolean') protocolFailure();
  const cursor = input.cursor;
  if (cursor !== null && typeof cursor !== 'string') protocolFailure();
  const summary = record(input.summary);
  const facets = record(input.facets);
  if (!Array.isArray(facets.sources) || !Array.isArray(facets.sites)) protocolFailure();
  if (
    !Number.isFinite(summary.totalCount) ||
    !Number.isFinite(summary.todayCount) ||
    Number(summary.totalCount) < 0 ||
    Number(summary.todayCount) < 0
  ) {
    protocolFailure();
  }
  const parseFacet = (facet: unknown) => {
    const input = record(facet);
    const count = Number(input.count);
    if (!Number.isFinite(count) || count < 0) protocolFailure();
    return {
      key: text(input.key, true),
      label: text(input.label),
      count,
    };
  };
  const nativeCursor = cursor === null ? null : text(cursor, true);
  if (input.hasMore && !nativeCursor) protocolFailure();
  return {
    items: input.items.map(asConversation),
    cursor: nativeCursor ? { nativeCursor } : null,
    hasMore: input.hasMore,
    summary: { totalCount: Number(summary.totalCount), todayCount: Number(summary.todayCount) },
    facets: {
      sources: facets.sources.map(parseFacet),
      sites: facets.sites.map(parseFacet),
    },
  };
}

function asOpenTarget(conversation: Conversation): ConversationListOpenTarget {
  return {
    id: conversation.id,
    source: conversation.source,
    conversationKey: conversation.conversationKey,
    title: text(conversation.title),
    url: text(conversation.url),
    sourceType: text(conversation.sourceType),
    lastCapturedAt: finiteTimestamp(conversation.lastCapturedAt),
  };
}

function asDetail(value: unknown, reference: StableConversationReference): ConversationDetail {
  const input = record(value);
  return {
    conversationId: positiveId(input.conversationId),
    source: reference.source,
    conversationKey: reference.conversationKey,
    messages: asMessages(input.messages),
  };
}

function asTail(value: unknown): ConversationTailWindow {
  const input = record(value);
  return {
    conversationId: positiveId(input.conversationId),
    messages: asMessages(input.messages),
  };
}

function asDeleteResult(value: unknown): Awaited<ReturnType<ConversationMutationRepository['deleteConversations']>> {
  const input = record(value);
  return {
    deletedConversations: nonNegativeInteger(input.deletedConversations),
    deletedImageCache: nonNegativeInteger(input.deletedImageCache),
    deletedMappings: nonNegativeInteger(input.deletedMappings),
    deletedMessages: nonNegativeInteger(input.deletedMessages),
  };
}

function asMergeResult(value: unknown): Awaited<ReturnType<ConversationMutationRepository['mergeConversations']>> {
  const input = record(value);
  if (typeof input.merged !== 'boolean') protocolFailure();
  return {
    keptConversationId: positiveId(input.keptConversationId),
    merged: input.merged,
    movedImageCache: nonNegativeInteger(input.movedImageCache),
    movedMessages: nonNegativeInteger(input.movedMessages),
    removedConversationId: positiveId(input.removedConversationId),
  };
}

function asMessageSyncResult(
  value: unknown,
): Awaited<ReturnType<ConversationMutationRepository['syncConversationMessages']>> {
  const input = record(value);
  return {
    deleted: nonNegativeInteger(input.deleted),
    upserted: nonNegativeInteger(input.upserted),
  };
}

function asCaptureSnapshotResult(value: unknown): ConversationCaptureSnapshotPersistenceResult {
  const input = record(value);
  if (typeof input.isNew !== 'boolean') protocolFailure();
  return {
    conversation: asConversation(input.conversation),
    deleted: nonNegativeInteger(input.deleted),
    isNew: input.isNew,
    upserted: nonNegativeInteger(input.upserted),
  };
}

function asMappingRead(value: unknown): ConversationMappingRead | null {
  if (value == null) return null;
  const input = record(value);
  const mapping = input.mapping;
  if (mapping !== null && (typeof mapping !== 'object' || Array.isArray(mapping))) protocolFailure();
  return {
    conversation: asConversation(input.conversation),
    mapping: mapping === null ? null : record(mapping),
  };
}

function asTrue(value: unknown): true {
  if (value !== true) protocolFailure();
  return true;
}

function domainFromUrl(value: unknown): string {
  try {
    const url = new URL(text(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function mentionCandidate(conversation: Conversation): ConversationMentionCandidate {
  return {
    conversationId: conversation.id,
    source: conversation.source,
    conversationKey: conversation.conversationKey,
    title: text(conversation.title),
    url: text(conversation.url),
    domain: domainFromUrl(conversation.url),
    sourceType: text(conversation.sourceType) || 'chat',
    lastCapturedAt: finiteTimestamp(conversation.lastCapturedAt),
  };
}

function listPayload(queryInput?: ConversationListQueryInput | null, limit?: number | null, cursor?: string) {
  const query = queryInput || {};
  return {
    ...(cursor ? { cursor } : {}),
    ...(Number.isFinite(Number(limit)) && Number(limit) > 0 ? { limit: Number(limit) } : {}),
    ...(text(query.sourceKey) ? { sourceKey: text(query.sourceKey) } : {}),
    ...(text(query.siteKey) ? { siteKey: text(query.siteKey) } : {}),
  };
}

/** Maps the P3-T4 conversation facade to typed Host commands; selection and pagination stay in SQLite. */
export function createNativeConversationReadRepository(
  lease: FactsOperationLease,
  dependencies: NativeConversationReadDependencies = {},
): ConversationFactsRepository {
  const nativeConnect = (dependencies.connectNative ?? connectNative) as NativeConnect;
  const request = async <TData>(command: NativeConnectedCommand, payload: unknown): Promise<TData> => {
    assertFactsOperationLease(lease);
    const result = await nativeConnect<TData>({ command, payload } as NativeHostRequest<NativeConnectedCommand>);
    assertFactsOperationLease(lease);
    return result;
  };

  const repository: ConversationFactsRepository = {
    async getConversationListBootstrap(queryInput, limit) {
      return asPage(await request('CONVERSATION_BOOTSTRAP', listPayload(queryInput, limit)));
    },
    async getConversationListPage(queryInput, cursor, limit) {
      if (!cursor || !('nativeCursor' in cursor) || !text(cursor.nativeCursor)) {
        throw new LocalDataContractError('STALE_REFERENCE');
      }
      return asPage(await request('CONVERSATION_LOAD_MORE', listPayload(queryInput, limit, cursor.nativeCursor)));
    },
    async getConversationByReference(reference) {
      const value = await request('CONVERSATION_LOOKUP', hostReference(reference));
      return value == null ? null : asConversation(value);
    },
    async findConversationBySourceAndKey(source, conversationKey) {
      const conversation = await repository.getConversationByReference({ source, conversationKey });
      return conversation ? asOpenTarget(conversation) : null;
    },
    async getConversationDetail(reference) {
      return asDetail(await request('CONVERSATION_DETAIL', hostReference(reference)), reference);
    },
    async getConversationTailWindow(reference, limit) {
      return asTail(
        await request('CONVERSATION_TAIL', {
          conversation: hostReference(reference),
          ...(Number.isFinite(Number(limit)) && Number(limit) > 0 ? { limit: Number(limit) } : {}),
        }),
      );
    },
    async searchConversationMentionCandidates(input = {}) {
      const maxScan = Math.min(2000, Math.max(1, Math.floor(Number(input.maxScan) || 2000)));
      const maxDurationMs = Math.max(1, Math.floor(Number(input.maxDurationMs) || 300));
      const pageLimit = Math.min(200, maxScan);
      const startedAt = Date.now();
      const candidates: ConversationMentionCandidate[] = [];
      let page = await repository.getConversationListBootstrap({}, pageLimit);
      let scannedCount = 0;

      while (true) {
        for (const conversation of page.items) {
          candidates.push(mentionCandidate(conversation));
          scannedCount += 1;
          if (scannedCount >= maxScan || Date.now() - startedAt >= maxDurationMs) {
            return { candidates, scannedCount, truncatedByScanLimit: page.hasMore || scannedCount >= maxScan };
          }
        }
        if (!page.hasMore || !page.cursor) return { candidates, scannedCount, truncatedByScanLimit: false };
        page = await repository.getConversationListPage({}, page.cursor, Math.min(pageLimit, maxScan - scannedCount));
      }
    },
    async upsertConversation(payload) {
      return asConversation(await request('UPSERT_CONVERSATION', record(payload) as JsonObject));
    },
    async saveConversationSnapshot(snapshot) {
      return asCaptureSnapshotResult(
        await request('SAVE_CONVERSATION_SNAPSHOT', {
          snapshot,
          transfer: {
            operation: 'capture-snapshot',
            declaredTotalBytes: serializedJsonUtf8ByteLength(snapshot),
          },
        }),
      );
    },
    async deleteConversations(references) {
      if (!Array.isArray(references) || !references.length) throw new LocalDataContractError('INVALID_ARGUMENT');
      return asDeleteResult(
        await request('DELETE_CONVERSATIONS', {
          conversations: references.map(hostReference),
        }),
      );
    },
    async mergeConversations(input) {
      return asMergeResult(
        await request('MERGE_CONVERSATIONS', {
          source: hostReference(input.remove),
          target: hostReference(input.keep),
        }),
      );
    },
    async syncConversationMessages(reference, messages, options) {
      return asMessageSyncResult(
        await request('SYNC_CONVERSATION_MESSAGES', {
          conversation: hostReference(reference),
          messages,
          transfer: {
            operation: 'capture-snapshot',
            declaredTotalBytes: serializedJsonUtf8ByteLength(messages),
          },
          ...(options?.mode ? { mode: options.mode } : {}),
          ...(options?.diff !== undefined ? { diff: options.diff } : {}),
        }),
      );
    },
    async getSyncMapping(reference, provider) {
      return asMappingRead(
        await request('GET_SYNC_MAPPING', {
          conversation: hostReference(reference),
          provider: text(provider, true),
        }),
      );
    },
    async patchSyncMapping(reference, provider, patch) {
      return asTrue(
        await request('PATCH_SYNC_MAPPING', {
          conversation: hostReference(reference),
          provider: text(provider, true),
          patch: record(patch) as JsonObject,
        }),
      );
    },
    async setSyncCursor(reference, cursor) {
      return asTrue(
        await request('SET_SYNC_CURSOR', {
          conversation: hostReference(reference),
          cursor: record(cursor) as JsonObject,
        }),
      );
    },
    async setConversationNotionPageId(reference, notionPageId, meta) {
      return asTrue(
        await request('SET_CONVERSATION_NOTION_PAGE_ID', {
          conversation: hostReference(reference),
          notionPageId: text(notionPageId),
          ...(meta
            ? {
                meta: {
                  ...(text(meta.notionPageUrl) ? { notionPageUrl: text(meta.notionPageUrl) } : {}),
                  ...(text(meta.notionWorkspaceSlug) ? { notionWorkspaceSlug: text(meta.notionWorkspaceSlug) } : {}),
                },
              }
            : {}),
        }),
      );
    },
    async clearSyncMapping(reference, provider) {
      return asTrue(
        await request('CLEAR_SYNC_MAPPING', {
          conversation: hostReference(reference),
          provider: text(provider, true),
        }),
      );
    },
  };
  return Object.freeze(repository);
}
