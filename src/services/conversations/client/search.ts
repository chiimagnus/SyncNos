import { CORE_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { createRuntimeClient } from '@services/shared/runtime-client';
import {
  LOCAL_DATA_ERROR_CODES,
  LocalDataContractError,
  parseLocalDataSearchPage,
  type LocalDataErrorCode,
  type LocalDataSearchPage,
  type LocalDataSearchSort,
  type SearchCursorBinding,
} from '@services/local-data/contracts';
import { findConversationBySourceAndKey, getConversationDetail } from '@services/conversations/client/repo';
import type { ConversationDetailResponse } from '@services/conversations/domain/models';

export type ConversationSearchRequest = Readonly<{
  cursor?: SearchCursorBinding;
  limit?: number;
  query: string;
  requestId: string;
  siteKey?: string;
  sort?: LocalDataSearchSort;
  sourceKey?: string;
}>;

export type ConversationSearchResponse = Readonly<{
  page: LocalDataSearchPage;
  requestId: string;
}>;

export type LocalSearchCapability = Readonly<{ searchable: boolean }>;

type SearchRuntimeClient = Readonly<{
  send: (type: string, payload?: Record<string, unknown>) => Promise<unknown>;
}>;

type ApiResponse = Readonly<{
  data?: unknown;
  error?: { message?: unknown; extra?: unknown } | null;
  ok?: unknown;
}>;

function validRequestId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new LocalDataContractError('INVALID_ARGUMENT');
  }
  return value;
}

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  const response = value as ApiResponse;
  if (response.ok === true) return response.data;
  if (response.ok !== false) throw new LocalDataContractError('PROTOCOL_MISMATCH');
  const extra = response.error?.extra;
  const code =
    extra &&
    typeof extra === 'object' &&
    !Array.isArray(extra) &&
    typeof (extra as Record<string, unknown>).code === 'string'
      ? ((extra as Record<string, unknown>).code as string)
      : '';
  if ((LOCAL_DATA_ERROR_CODES as readonly string[]).includes(code))
    throw new LocalDataContractError(code as LocalDataErrorCode);
  throw new Error(typeof response.error?.message === 'string' ? response.error.message : 'local search failed');
}

function parseCapability(value: unknown): LocalSearchCapability {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.searchable !== 'boolean') {
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  }
  return Object.freeze({ searchable: input.searchable });
}

function parseSearchResponse(value: unknown, expectedRequestId: string): ConversationSearchResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'page,requestId') throw new LocalDataContractError('PROTOCOL_MISMATCH');
  const requestId = validRequestId(input.requestId);
  if (requestId !== expectedRequestId) throw new LocalDataContractError('PROTOCOL_MISMATCH');
  return Object.freeze({ requestId, page: parseLocalDataSearchPage(input.page) });
}

export function createConversationSearchClient(runtime: SearchRuntimeClient = createRuntimeClient()): Readonly<{
  getCapability: () => Promise<LocalSearchCapability>;
  preview: (reference: Readonly<{ source: string; conversationKey: string }>) => Promise<ConversationDetailResponse>;
  search: (request: ConversationSearchRequest) => Promise<ConversationSearchResponse>;
}> {
  return Object.freeze({
    getCapability: async () =>
      parseCapability(unwrap(await runtime.send(CORE_MESSAGE_TYPES.GET_LOCAL_SEARCH_CAPABILITY))),
    search: async (request) => {
      const requestId = validRequestId(request.requestId);
      const payload: Record<string, unknown> = {
        requestId,
        query: request.query,
        ...(request.cursor ? { cursor: request.cursor } : {}),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.siteKey === undefined ? {} : { siteKey: request.siteKey }),
        ...(request.sort === undefined ? {} : { sort: request.sort }),
        ...(request.sourceKey === undefined ? {} : { sourceKey: request.sourceKey }),
      };
      return parseSearchResponse(
        unwrap(await runtime.send(CORE_MESSAGE_TYPES.SEARCH_CONVERSATIONS, payload)),
        requestId,
      );
    },
    preview: async (reference) => {
      const source = String(reference.source || '').trim();
      const conversationKey = String(reference.conversationKey || '').trim();
      if (!source || !conversationKey) throw new LocalDataContractError('INVALID_ARGUMENT');
      const target = await findConversationBySourceAndKey(source, conversationKey);
      if (!target?.factsEpoch) throw new LocalDataContractError('STALE_REFERENCE');
      return await getConversationDetail({
        source: target.source,
        conversationKey: target.conversationKey,
        factsEpoch: target.factsEpoch,
      });
    },
  });
}
