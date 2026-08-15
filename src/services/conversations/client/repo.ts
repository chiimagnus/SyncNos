import {
  LOCAL_DATA_STREAM_MESSAGE_TYPES,
  CORE_MESSAGE_TYPES,
  UI_PORT_NAMES,
} from '@platform/messaging/message-contracts';
import {
  RuntimeStreamReceiver,
  parseRuntimeStreamMessage,
  type RuntimeStreamPort,
} from '@platform/messaging/stream-port';
import { connectPort } from '@platform/runtime/ports';
import { send } from '@platform/runtime/runtime';
import type {
  Conversation,
  ConversationDetail,
  ConversationDetailReadResponse,
  ConversationDetailResponse,
  ConversationFactsReference,
  ConversationListCursor,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListQueryInput,
  ConversationReadStreamPreflight,
  ConversationTailWindow,
  ConversationTailWindowReadResponse,
  ConversationTailWindowResponse,
} from '@services/conversations/domain/models';
import {
  LocalDataContractError,
  parseFactsEpoch,
  parseStreamDescriptor,
  type FactsEpoch,
  type StreamDescriptor,
} from '@services/local-data/contracts';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

type RuntimePortListener = (message?: unknown) => void;
type ConversationReadStreamPort = RuntimeStreamPort &
  Readonly<{
    onDisconnect?: Readonly<{
      addListener?: (listener: RuntimePortListener) => void;
      removeListener?: (listener: RuntimePortListener) => void;
    }>;
    onMessage?: Readonly<{
      addListener?: (listener: RuntimePortListener) => void;
      removeListener?: (listener: RuntimePortListener) => void;
    }>;
  }>;

const STREAM_TIMEOUT_MS = 60_000;

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

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

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) protocolFailure();
}

function parseReadPreflight(value: unknown): ConversationReadStreamPreflight | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = record(value);
  if (input.kind !== 'stream') return null;
  exactKeys(input, ['kind', 'requestId', 'stream']);
  const requestId = text(input.requestId, true);
  const opened = parseRuntimeStreamMessage({
    type: LOCAL_DATA_STREAM_MESSAGE_TYPES.OPEN,
    requestId,
    direction: 'download',
    operation: 'conversation-detail',
  });
  if (opened.type !== 'open' || opened.direction !== 'download') protocolFailure();
  const stream = parseStreamDescriptor(input.stream, ['conversation-detail']);
  return { kind: 'stream', requestId: opened.requestId, stream };
}

function asConversationDetail(value: unknown): ConversationDetailResponse {
  const input = record(value);
  if (!Array.isArray(input.messages)) protocolFailure();
  return {
    ...(input as ConversationDetail),
    conversationId: positiveId(input.conversationId),
    source: text(input.source, true),
    conversationKey: text(input.conversationKey, true),
    factsEpoch: parseFactsEpoch(input.factsEpoch),
    messages: input.messages as ConversationDetail['messages'],
  };
}

function asConversationTailWindow(value: unknown): ConversationTailWindowResponse {
  const input = record(value);
  if (!Array.isArray(input.messages)) protocolFailure();
  const conversationId = input.conversationId;
  if (conversationId !== null && conversationId !== undefined) positiveId(conversationId);
  return {
    conversationId: conversationId == null ? null : Number(conversationId),
    source: text(input.source, true),
    conversationKey: text(input.conversationKey, true),
    factsEpoch: parseFactsEpoch(input.factsEpoch),
    messages: input.messages as ConversationTailWindow['messages'],
  };
}

function asConversationReadStreamPort(value: unknown): ConversationReadStreamPort {
  if (!value || typeof value !== 'object') protocolFailure();
  const port = value as ConversationReadStreamPort;
  if (
    typeof port.postMessage !== 'function' ||
    typeof port.onMessage?.addListener !== 'function' ||
    typeof port.onDisconnect?.addListener !== 'function'
  ) {
    protocolFailure();
  }
  return port;
}

function sameDescriptor(actual: StreamDescriptor, expected: StreamDescriptor): boolean {
  return actual.operation === expected.operation && actual.declaredTotalBytes === expected.declaredTotalBytes;
}

async function receiveConversationReadStream(preflight: ConversationReadStreamPreflight): Promise<unknown> {
  const port = asConversationReadStreamPort(connectPort(UI_PORT_NAMES.LOCAL_DATA_STREAM));
  const receiver = new RuntimeStreamReceiver(preflight.requestId, preflight.stream);

  return await new Promise<unknown>((resolve, reject) => {
    let closed = false;
    let headerReceived = false;
    let queue = Promise.resolve();
    const timeout = globalThis.setTimeout(
      () => fail(new LocalDataContractError('HOST_UNAVAILABLE')),
      STREAM_TIMEOUT_MS,
    );

    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      receiver.dispose();
      port.onMessage?.removeListener?.(onMessage);
      port.onDisconnect?.removeListener?.(onDisconnect);
      try {
        port.disconnect?.();
      } catch {
        // A disconnected Port cannot be reused.
      }
    };
    const complete = (value: unknown) => {
      if (closed) return;
      closed = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (closed) return;
      closed = true;
      cleanup();
      reject(error);
    };
    const accept = async (raw: unknown) => {
      const message = parseRuntimeStreamMessage(raw);
      if (message.requestId !== preflight.requestId) protocolFailure();
      if (message.type === 'error') throw new LocalDataContractError(message.error.code, message.error.diagnostics);
      if (message.type === 'header') {
        if (headerReceived || !sameDescriptor(message.stream, preflight.stream)) protocolFailure();
        headerReceived = true;
        return;
      }
      if (!headerReceived || message.type !== 'frame') protocolFailure();
      const event = await receiver.accept(message);
      if (event?.kind === 'ack') {
        port.postMessage({
          type: LOCAL_DATA_STREAM_MESSAGE_TYPES.ACK,
          requestId: preflight.requestId,
          acknowledgedSequence: event.acknowledgedSequence,
        });
        return;
      }
      if (event?.kind === 'complete') {
        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(event.bytes));
        } catch {
          protocolFailure();
        }
        complete(payload);
        return;
      }
      if (event?.kind === 'cancelled' || event?.kind === 'failed') {
        throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      }
    };
    const onMessage: RuntimePortListener = (raw) => {
      queue = queue.then(() => accept(raw)).catch(fail);
    };
    const onDisconnect: RuntimePortListener = () => fail(new LocalDataContractError('HOST_UNAVAILABLE'));

    try {
      port.onMessage?.addListener?.(onMessage);
      port.onDisconnect?.addListener?.(onDisconnect);
      port.postMessage({
        type: LOCAL_DATA_STREAM_MESSAGE_TYPES.OPEN,
        requestId: preflight.requestId,
        direction: 'download',
        operation: 'conversation-detail',
      });
    } catch (error) {
      fail(error);
    }
  });
}

export async function resolveConversationDetailResponse(
  response: ConversationDetailReadResponse,
): Promise<ConversationDetailResponse> {
  const preflight = parseReadPreflight(response);
  return asConversationDetail(preflight ? await receiveConversationReadStream(preflight) : response);
}

export async function resolveConversationTailWindowResponse(
  response: ConversationTailWindowReadResponse,
): Promise<ConversationTailWindowResponse> {
  const preflight = parseReadPreflight(response);
  return asConversationTailWindow(preflight ? await receiveConversationReadStream(preflight) : response);
}

export async function getConversationListBootstrap(
  queryInput?: ConversationListQueryInput | null,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  const res = await send<ApiResponse<ConversationListPage<Conversation>>>(
    CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_BOOTSTRAP,
    {
      query: queryInput || {},
      limit: Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : undefined,
    },
  );
  return unwrap(res);
}

export async function getConversationListPage(
  queryInput: ConversationListQueryInput | null | undefined,
  cursor: ConversationListCursor,
  factsEpoch: FactsEpoch,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  const res = await send<ApiResponse<ConversationListPage<Conversation>>>(
    CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_PAGE,
    {
      query: queryInput || {},
      cursor,
      limit: Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : undefined,
      factsEpoch,
    },
  );
  return unwrap(res);
}

export async function findConversationBySourceAndKey(
  source: string,
  conversationKey: string,
  factsEpoch?: FactsEpoch,
): Promise<ConversationListOpenTarget | null> {
  const res = await send<ApiResponse<ConversationListOpenTarget | null>>(
    CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_SOURCE_AND_KEY,
    {
      source: String(source || '').trim(),
      conversationKey: String(conversationKey || '').trim(),
      factsEpoch,
    },
  );
  return unwrap(res);
}

export async function findConversationById(
  conversationId: number,
  factsEpoch?: FactsEpoch,
): Promise<ConversationListOpenTarget | null> {
  const id = Number(conversationId);
  const res = await send<ApiResponse<ConversationListOpenTarget | null>>(CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID, {
    conversationId: id,
    factsEpoch,
  });
  return unwrap(res);
}

export async function getConversationDetail(input: ConversationFactsReference): Promise<ConversationDetailResponse> {
  const res = await send<ApiResponse<ConversationDetailReadResponse>>(CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, {
    source: input.source,
    conversationKey: input.conversationKey,
    factsEpoch: input.factsEpoch,
  });
  return await resolveConversationDetailResponse(unwrap(res));
}

export async function getConversationTailWindowBySourceAndKey(input: {
  conversationKey: string;
  factsEpoch?: FactsEpoch;
  limit?: number;
  source: string;
}): Promise<ConversationTailWindowResponse> {
  const res = await send<ApiResponse<ConversationTailWindowReadResponse>>(
    CORE_MESSAGE_TYPES.GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY,
    {
      source: input.source,
      conversationKey: input.conversationKey,
      factsEpoch: input.factsEpoch,
      limit: input.limit,
    },
  );
  return await resolveConversationTailWindowResponse(unwrap(res));
}

export async function deleteConversations(conversationIds: number[]): Promise<unknown> {
  const ids = Array.isArray(conversationIds)
    ? conversationIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
    : [];
  if (!ids.length) return null;
  const res = await send<ApiResponse<unknown>>(CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, { conversationIds: ids });
  return unwrap(res);
}

export async function upsertConversation(
  payload: Partial<Conversation>,
): Promise<Conversation & { __isNew?: boolean }> {
  const res = await send<ApiResponse<Conversation & { __isNew?: boolean }>>(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
    payload: payload as any,
  });
  return unwrap(res);
}

export async function mergeConversations(input: { keepConversationId: number; removeConversationId: number }): Promise<{
  keptConversationId: number;
  removedConversationId: number;
  movedMessages: number;
  movedImageCache: number;
  merged: boolean;
}> {
  const keepConversationId = Number(input.keepConversationId);
  const removeConversationId = Number(input.removeConversationId);
  const res = await send<
    ApiResponse<{
      keptConversationId: number;
      removedConversationId: number;
      movedMessages: number;
      movedImageCache: number;
      merged: boolean;
    }>
  >(CORE_MESSAGE_TYPES.MERGE_CONVERSATIONS, { keepConversationId, removeConversationId });
  return unwrap(res);
}

export type BackfillConversationImagesResult = {
  scannedMessages: number;
  updatedMessages: number;
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
};

export async function backfillConversationImages(
  conversationId: number,
  conversationUrl?: string,
): Promise<BackfillConversationImagesResult> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid conversationId');
  const res = await send<ApiResponse<BackfillConversationImagesResult>>(
    CORE_MESSAGE_TYPES.BACKFILL_CONVERSATION_IMAGES,
    {
      conversationId: id,
      conversationUrl: String(conversationUrl || ''),
    },
  );
  return unwrap(res);
}
