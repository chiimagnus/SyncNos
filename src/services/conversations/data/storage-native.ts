import { connectNative, type NativeHostRequest } from '@platform/local-data/native-client';
import {
  LocalDataContractError,
  type HostConversationReference,
  type HostFactsCommand,
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

function finiteTimestamp(value: unknown): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value);
}

function hostReference(reference: StableConversationReference): HostConversationReference {
  const source = text(reference?.source, true);
  const conversationKey = text(reference?.conversationKey, true);
  return { source, conversationKey };
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

/** Maps only P1 typed reads to the Host; selection, sorting, and pagination remain in their existing repositories. */
export function createNativeConversationReadRepository(
  lease: FactsOperationLease,
  dependencies: NativeConversationReadDependencies = {},
): ConversationReadRepository {
  const nativeConnect = (dependencies.connectNative ?? connectNative) as NativeConnect;
  const request = async <TData>(command: NativeConnectedCommand, payload: unknown): Promise<TData> => {
    assertFactsOperationLease(lease);
    const result = await nativeConnect<TData>({ command, payload } as NativeHostRequest<NativeConnectedCommand>);
    assertFactsOperationLease(lease);
    return result;
  };

  const repository: ConversationReadRepository = {
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
  };
  return Object.freeze(repository);
}
