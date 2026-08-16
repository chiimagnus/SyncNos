import {
  LOCAL_DATA_STREAM_MESSAGE_TYPES,
  CORE_MESSAGE_TYPES,
  UI_PORT_NAMES,
} from '@platform/messaging/message-contracts';
import {
  RuntimeStreamReceiver,
  RuntimeStreamSender,
  parseRuntimeStreamMessage,
  type RuntimeStreamPort,
} from '@platform/messaging/stream-port';
import { connectPort } from '@platform/runtime/ports';
import { send } from '@platform/runtime/runtime';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
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
  LOCAL_DATA_STREAM_OPERATIONS,
  MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES,
  parseConversationCaptureSnapshot,
  parseFactsEpoch,
  parseStreamDescriptor,
  type ConversationCaptureSnapshot,
  type FactsEpoch,
  type StreamDescriptor,
} from '@services/local-data/contracts';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

type RuntimePortListener = (message?: unknown) => void;
type LocalDataStreamPort = RuntimeStreamPort &
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

export type ConversationCaptureSnapshotResult = Readonly<{
  conversationId: number;
  isNew: boolean;
}>;

type ConversationCaptureSnapshotStreamPreflight = Readonly<{
  kind: 'stream';
  requestId: string;
  stream: StreamDescriptor;
}>;

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

type ConversationMutationReference = Readonly<{
  conversationKey: string;
  factsEpoch: FactsEpoch;
  source: string;
}>;

function mutationReference(value: ConversationFactsReference): ConversationMutationReference {
  return {
    source: text(value?.source, true),
    conversationKey: text(value?.conversationKey, true),
    factsEpoch: parseFactsEpoch(value?.factsEpoch),
  };
}

function mutationReferences(values: readonly ConversationFactsReference[]): readonly ConversationMutationReference[] {
  if (!Array.isArray(values) || !values.length) return [];
  const references = values.map(mutationReference);
  const [first] = references;
  if (!first || references.some((reference) => reference.factsEpoch !== first.factsEpoch)) protocolFailure();
  return references;
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

function parseCaptureSnapshotPreflight(value: unknown): ConversationCaptureSnapshotStreamPreflight | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = record(value);
  if (input.kind !== 'stream') return null;
  exactKeys(input, ['kind', 'requestId', 'stream']);
  const opened = parseRuntimeStreamMessage({
    type: LOCAL_DATA_STREAM_MESSAGE_TYPES.OPEN,
    requestId: input.requestId,
    direction: 'upload',
    stream: input.stream,
  });
  if (opened.type !== 'open' || opened.direction !== 'upload') protocolFailure();
  return {
    kind: 'stream',
    requestId: opened.requestId,
    stream: parseStreamDescriptor(input.stream, ['capture-snapshot']),
  };
}

function asCaptureSnapshotResult(value: unknown): ConversationCaptureSnapshotResult {
  const input = record(value);
  exactKeys(input, ['conversationId', 'isNew']);
  if (typeof input.isNew !== 'boolean') protocolFailure();
  return { conversationId: positiveId(input.conversationId), isNew: input.isNew };
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

function asLocalDataStreamPort(value: unknown): LocalDataStreamPort {
  if (!value || typeof value !== 'object') protocolFailure();
  const port = value as LocalDataStreamPort;
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

/** Receives one authenticated P3-T2 download without interpreting its bytes. */
export async function receiveLocalDataDownloadStream(
  input: Readonly<{ requestId: string; stream: StreamDescriptor }>,
): Promise<Uint8Array> {
  const opened = parseRuntimeStreamMessage({
    type: LOCAL_DATA_STREAM_MESSAGE_TYPES.OPEN,
    requestId: input.requestId,
    direction: 'download',
    operation: input.stream?.operation,
  });
  if (opened.type !== 'open' || opened.direction !== 'download') protocolFailure();
  const stream = parseStreamDescriptor(input.stream, LOCAL_DATA_STREAM_OPERATIONS);
  const port = asLocalDataStreamPort(connectPort(UI_PORT_NAMES.LOCAL_DATA_STREAM));
  const receiver = new RuntimeStreamReceiver(opened.requestId, stream);

  return await new Promise<Uint8Array>((resolve, reject) => {
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
    const complete = (value: Uint8Array) => {
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
      if (message.requestId !== opened.requestId) protocolFailure();
      if (message.type === 'error') throw new LocalDataContractError(message.error.code, message.error.diagnostics);
      if (message.type === 'header') {
        if (headerReceived || !sameDescriptor(message.stream, stream)) protocolFailure();
        headerReceived = true;
        return;
      }
      if (!headerReceived || message.type !== 'frame') protocolFailure();
      const event = await receiver.accept(message);
      if (event?.kind === 'ack') {
        port.postMessage({
          type: LOCAL_DATA_STREAM_MESSAGE_TYPES.ACK,
          requestId: opened.requestId,
          acknowledgedSequence: event.acknowledgedSequence,
        });
        return;
      }
      if (event?.kind === 'complete') {
        complete(event.bytes);
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
        requestId: opened.requestId,
        direction: 'download',
        operation: stream.operation,
      });
    } catch (error) {
      fail(error);
    }
  });
}

async function receiveConversationReadStream(preflight: ConversationReadStreamPreflight): Promise<unknown> {
  const bytes = await receiveLocalDataDownloadStream(preflight);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return protocolFailure();
  }
}

async function uploadConversationCaptureSnapshot(
  preflight: ConversationCaptureSnapshotStreamPreflight,
  bytes: Uint8Array,
): Promise<ConversationCaptureSnapshotResult> {
  const port = asLocalDataStreamPort(connectPort(UI_PORT_NAMES.LOCAL_DATA_STREAM));
  const sender = new RuntimeStreamSender({ announceHeader: false, port, requestId: preflight.requestId });

  return await new Promise<ConversationCaptureSnapshotResult>((resolve, reject) => {
    let closed = false;
    let queue = Promise.resolve();
    const timeout = globalThis.setTimeout(
      () => fail(new LocalDataContractError('HOST_UNAVAILABLE')),
      STREAM_TIMEOUT_MS,
    );

    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      sender.dispose();
      port.onMessage?.removeListener?.(onMessage);
      port.onDisconnect?.removeListener?.(onDisconnect);
      try {
        port.disconnect?.();
      } catch {
        // A disconnected Port cannot be reused.
      }
    };
    const complete = (value: ConversationCaptureSnapshotResult) => {
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
    const accept = (raw: unknown) => {
      const message = parseRuntimeStreamMessage(raw);
      if (message.requestId !== preflight.requestId) protocolFailure();
      if (message.type === 'complete') {
        if (message.data === undefined) protocolFailure();
        complete(asCaptureSnapshotResult(message.data));
        return;
      }
      if (message.type === 'error') throw new LocalDataContractError(message.error.code, message.error.diagnostics);
      sender.accept(message);
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
        direction: 'upload',
        stream: preflight.stream,
      });
      void sender.send(bytes, preflight.stream).catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}

/** Sends one canonical capture snapshot, using the authenticated Port once it exceeds the ordinary runtime bound. */
export async function saveConversationSnapshot(
  sendRuntime: (type: string, payload?: Record<string, unknown>) => Promise<unknown>,
  rawSnapshot: ConversationCaptureSnapshot,
): Promise<ConversationCaptureSnapshotResult> {
  if (typeof sendRuntime !== 'function') throw new LocalDataContractError('HOST_UNAVAILABLE');
  const snapshot = parseConversationCaptureSnapshot(rawSnapshot);
  const bytes = encodeCanonicalJson(snapshot).bytes;
  const stream = parseStreamDescriptor({ operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength });

  if (bytes.byteLength <= MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES) {
    const response = await sendRuntime(CORE_MESSAGE_TYPES.SAVE_CONVERSATION_SNAPSHOT, { snapshot, transfer: stream });
    return asCaptureSnapshotResult(unwrap(response as ApiResponse<unknown>));
  }

  const response = await sendRuntime(CORE_MESSAGE_TYPES.SAVE_CONVERSATION_SNAPSHOT, { transfer: stream });
  const preflight = parseCaptureSnapshotPreflight(unwrap(response as ApiResponse<unknown>));
  if (!preflight || !sameDescriptor(preflight.stream, stream)) protocolFailure();
  return await uploadConversationCaptureSnapshot(preflight, bytes);
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

export async function getConversationSyncMapping(
  input: ConversationFactsReference,
): Promise<Record<string, unknown> | null> {
  const res = await send<ApiResponse<Record<string, unknown> | null>>(
    CORE_MESSAGE_TYPES.GET_CONVERSATION_SYNC_MAPPING,
    {
      source: input.source,
      conversationKey: input.conversationKey,
      factsEpoch: input.factsEpoch,
    },
  );
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

export async function deleteConversations(references: readonly ConversationFactsReference[]): Promise<unknown> {
  const normalized = mutationReferences(references);
  if (!normalized.length) return null;
  const res = await send<ApiResponse<unknown>>(CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, {
    factsEpoch: normalized[0].factsEpoch,
    conversations: normalized.map(({ source, conversationKey }) => ({ source, conversationKey })),
  });
  return unwrap(res);
}

export async function upsertConversation(
  input: Readonly<{ payload: Partial<Conversation>; reference: ConversationFactsReference }>,
): Promise<Conversation & { __isNew?: boolean }> {
  const reference = mutationReference(input.reference);
  const payloadReference = {
    source: text(input.payload?.source, true),
    conversationKey: text(input.payload?.conversationKey, true),
  };
  if (payloadReference.source !== reference.source || payloadReference.conversationKey !== reference.conversationKey) {
    protocolFailure();
  }
  const res = await send<ApiResponse<Conversation & { __isNew?: boolean }>>(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
    factsEpoch: reference.factsEpoch,
    reference: { source: reference.source, conversationKey: reference.conversationKey },
    payload: input.payload as any,
  });
  return unwrap(res);
}

export async function mergeConversations(input: {
  keep: ConversationFactsReference;
  remove: ConversationFactsReference;
}): Promise<{
  keptConversationId: number;
  removedConversationId: number;
  movedMessages: number;
  movedImageCache: number;
  merged: boolean;
}> {
  const [keep, remove] = mutationReferences([input.keep, input.remove]);
  if (!keep || !remove) protocolFailure();
  const res = await send<
    ApiResponse<{
      keptConversationId: number;
      removedConversationId: number;
      movedMessages: number;
      movedImageCache: number;
      merged: boolean;
    }>
  >(CORE_MESSAGE_TYPES.MERGE_CONVERSATIONS, {
    factsEpoch: keep.factsEpoch,
    keep: { source: keep.source, conversationKey: keep.conversationKey },
    remove: { source: remove.source, conversationKey: remove.conversationKey },
  });
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
  input: Readonly<{ conversationUrl?: string; reference: ConversationFactsReference }>,
): Promise<BackfillConversationImagesResult> {
  const reference = mutationReference(input.reference);
  const res = await send<ApiResponse<BackfillConversationImagesResult>>(
    CORE_MESSAGE_TYPES.BACKFILL_CONVERSATION_IMAGES,
    {
      factsEpoch: reference.factsEpoch,
      source: reference.source,
      conversationKey: reference.conversationKey,
      conversationUrl: String(input.conversationUrl || ''),
    },
  );
  return unwrap(res);
}
