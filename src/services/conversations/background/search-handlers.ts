import { CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import type { ConversationReadRunner } from '@services/conversations/data/storage';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  MAX_ORDINARY_FACTS_RESPONSE_BYTES,
  LocalDataContractError,
  parseBrowserRuntimeFactsRequest,
  type SearchRequestPayload,
} from '@services/local-data/contracts';
import type { MigrationJournalSnapshot } from '@platform/local-data/migration-journal';

export type LocalSearchCapability = Readonly<{ searchable: boolean }>;

type SearchRouter = Readonly<{
  err: (message: string, extra?: unknown) => unknown;
  ok: (data: unknown) => unknown;
  register: (type: string, handler: (message: any) => Promise<unknown> | unknown) => void;
}>;

type SearchGateView = Readonly<{
  journalSnapshot: MigrationJournalSnapshot | null;
}>;

export type ConversationSearchHandlersDependencies = Readonly<{
  conversationReadRunner: ConversationReadRunner;
  factsGate: SearchGateView;
}>;

function errorResponse(router: SearchRouter, error: unknown): unknown {
  if (error instanceof LocalDataContractError) {
    return router.err(error.message, { code: error.code, diagnostics: error.diagnostics ?? null });
  }
  return router.err(error instanceof Error ? error.message : String(error || 'local search failed'));
}

function parseSearchMessage(message: unknown) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new LocalDataContractError('INVALID_ARGUMENT');
  }
  const { type: _type, requestId, ...payload } = message as Record<string, unknown>;
  const request = parseBrowserRuntimeFactsRequest({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId,
    command: 'SEARCH_CONVERSATIONS',
    payload,
  });
  if (request.command !== 'SEARCH_CONVERSATIONS') throw new LocalDataContractError('INVALID_ARGUMENT');
  return Object.freeze({ requestId: request.requestId, payload: request.payload as SearchRequestPayload });
}

export function registerConversationSearchHandlers(
  router: SearchRouter,
  dependencies: ConversationSearchHandlersDependencies,
): void {
  router.register(CORE_MESSAGE_TYPES.GET_LOCAL_SEARCH_CAPABILITY, () => {
    const capability: LocalSearchCapability = Object.freeze({
      searchable: dependencies.factsGate.journalSnapshot?.mode === 'active',
    });
    return router.ok(capability);
  });

  router.register(CORE_MESSAGE_TYPES.SEARCH_CONVERSATIONS, async (message) => {
    try {
      const request = parseSearchMessage(message);
      const page = await dependencies.conversationReadRunner.run({
        kind: 'conversation-search',
        read: async ({ mode, repository }) => {
          if (mode !== 'native' || typeof repository.searchConversations !== 'function') {
            throw new LocalDataContractError('DATABASE_NOT_INITIALIZED');
          }
          return await repository.searchConversations(request.payload);
        },
      });
      const response = Object.freeze({ requestId: request.requestId, page });
      const serialized = JSON.stringify(response);
      if (typeof serialized !== 'string') throw new LocalDataContractError('PROTOCOL_MISMATCH');
      const actualBytes = new TextEncoder().encode(serialized).byteLength;
      if (actualBytes > MAX_ORDINARY_FACTS_RESPONSE_BYTES) {
        throw new LocalDataContractError('PAYLOAD_TOO_LARGE', {
          actualBytes,
          limitBytes: MAX_ORDINARY_FACTS_RESPONSE_BYTES,
        });
      }
      return router.ok(response);
    } catch (error) {
      return errorResponse(router, error);
    }
  });
}
