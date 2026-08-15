import { CORE_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { storageGet } from '@platform/storage/local';
import {
  openConversationReadRepository,
  type ConversationFactsRepository,
  type ConversationReadRunner,
  type ConversationMessageSyncOptions,
  type ResolvedConversationReference,
} from '@services/conversations/data/storage';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import { backfillConversationImages } from '@services/conversations/background/image-backfill-job';
import { decodeCanonicalJson } from '@services/local-data/facts-archive';
import {
  ABOUT_YOU_USER_NAME_STORAGE_KEY,
  DEFAULT_ABOUT_YOU_USER_NAME,
  normalizeUserName,
} from '@services/shared/user-profile';
import {
  AUTO_SYNC_CONVERSATION_CHANGED_REASONS,
  type AutoSyncConversationChangedReason,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  LocalDataContractError,
  parseConversationCaptureSnapshot,
  MAX_DETAIL_PREVIEW_BYTES,
  MAX_ORDINARY_FACTS_RESPONSE_BYTES,
  parseRuntimeCaptureSnapshotPayload,
  parseStreamDescriptor,
  type ConversationCaptureSnapshot,
  type JsonObject,
  type JsonValue,
  type FactsEpoch,
  type StableConversationReference,
} from '@services/local-data/contracts';
import type {
  Conversation,
  ConversationDetailReadResponse,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationReadStreamPreflight,
  ConversationTailWindowReadResponse,
} from '@services/conversations/domain/models';
import type { BackgroundStreamHandler } from '@services/local-data/background-stream-router';
import type { LocalDataStreamOperation, StreamDescriptor } from '@services/local-data/contracts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
  eventsHub?: { broadcast: (type: string, payload: unknown) => void };
};

type ConversationHandlersDeps = {
  conversationReadRunner: ConversationReadRunner;
  onConversationChanged: (conversationId: number, reason: AutoSyncConversationChangedReason) => void | Promise<void>;
  streamRouter: ConversationReadStreamRouter;
};

type ConversationReadStreamRouter = Readonly<{
  register: (operation: LocalDataStreamOperation, handler: BackgroundStreamHandler) => void;
}>;

const PENDING_READ_STREAM_TTL_MS = 60_000;
const PENDING_CAPTURE_STREAM_TTL_MS = 60_000;
const MAX_PENDING_CAPTURE_STREAMS = 8;

type PendingReadStream = {
  bytes: Uint8Array;
  expiresAt: number;
  expirationTimer: ReturnType<typeof globalThis.setTimeout>;
};

function createReadStreamRequestId(): string {
  const requestId = globalThis.crypto?.randomUUID?.();
  if (typeof requestId !== 'string' || !requestId) throw new LocalDataContractError('HOST_UNAVAILABLE');
  return requestId;
}

/** Holds one already-authorized response until its matching authenticated Port consumes it. */
class PendingConversationReadStreams {
  #bytes = 0;
  #pending = new Map<string, PendingReadStream>();

  publish<T>(value: T): T | ConversationReadStreamPreflight {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new LocalDataContractError('PROTOCOL_MISMATCH');
    const bytes = new TextEncoder().encode(serialized);
    if (bytes.byteLength > MAX_DETAIL_PREVIEW_BYTES) {
      throw new LocalDataContractError('PAYLOAD_TOO_LARGE', {
        actualBytes: bytes.byteLength,
        limitBytes: MAX_DETAIL_PREVIEW_BYTES,
        operation: 'conversation-detail',
      });
    }
    if (bytes.byteLength <= MAX_ORDINARY_FACTS_RESPONSE_BYTES) return value;

    this.expire();
    // ponytail: one detail ceiling of pending data; add a bounded queue only if concurrent detail UX needs it.
    if (this.#bytes + bytes.byteLength > MAX_DETAIL_PREVIEW_BYTES) throw new LocalDataContractError('BUSY');

    const requestId = createReadStreamRequestId();
    if (this.#pending.has(requestId)) throw new LocalDataContractError('BUSY');
    const expiresAt = Date.now() + PENDING_READ_STREAM_TTL_MS;
    const expirationTimer = globalThis.setTimeout(() => this.drop(requestId), PENDING_READ_STREAM_TTL_MS);
    this.#pending.set(requestId, { bytes, expiresAt, expirationTimer });
    this.#bytes += bytes.byteLength;
    return {
      kind: 'stream',
      requestId,
      stream: parseStreamDescriptor({ operation: 'conversation-detail', declaredTotalBytes: bytes.byteLength }),
    };
  }

  take(requestId: string): Uint8Array {
    this.expire();
    const pending = this.#pending.get(requestId);
    if (!pending) throw new LocalDataContractError('STALE_REFERENCE');
    this.drop(requestId, pending);
    return pending.bytes;
  }

  private expire(now = Date.now()): void {
    for (const [requestId, pending] of this.#pending) {
      if (pending.expiresAt > now) continue;
      this.drop(requestId, pending);
    }
  }

  private drop(requestId: string, pending = this.#pending.get(requestId)): void {
    if (!pending) return;
    this.#pending.delete(requestId);
    globalThis.clearTimeout(pending.expirationTimer);
    this.#bytes = Math.max(0, this.#bytes - pending.bytes.byteLength);
  }
}

type PendingCaptureSnapshotStream = Readonly<{
  expiresAt: number;
  expirationTimer: ReturnType<typeof setTimeout>;
  stream: StreamDescriptor;
}>;

/** Keeps only a bounded stream descriptor; facts stay untouched until the authenticated Port reaches terminal. */
class PendingCaptureSnapshotStreams {
  #pending = new Map<string, PendingCaptureSnapshotStream>();

  publish(stream: StreamDescriptor): Readonly<{ kind: 'stream'; requestId: string; stream: StreamDescriptor }> {
    this.expire();
    if (this.#pending.size >= MAX_PENDING_CAPTURE_STREAMS) throw new LocalDataContractError('BUSY');
    const requestId = createReadStreamRequestId();
    if (this.#pending.has(requestId)) throw new LocalDataContractError('BUSY');
    const expiresAt = Date.now() + PENDING_CAPTURE_STREAM_TTL_MS;
    const expirationTimer = globalThis.setTimeout(() => this.drop(requestId), PENDING_CAPTURE_STREAM_TTL_MS);
    this.#pending.set(requestId, { stream, expiresAt, expirationTimer });
    return { kind: 'stream', requestId, stream };
  }

  take(requestId: string, stream: StreamDescriptor): void {
    this.expire();
    const pending = this.#pending.get(requestId);
    if (!pending) throw new LocalDataContractError('STALE_REFERENCE');
    this.drop(requestId, pending);
    if (
      pending.stream.operation !== stream.operation ||
      pending.stream.declaredTotalBytes !== stream.declaredTotalBytes
    ) {
      throw new LocalDataContractError('PROTOCOL_MISMATCH');
    }
  }

  private expire(now = Date.now()): void {
    for (const [requestId, pending] of this.#pending) {
      if (pending.expiresAt > now) continue;
      this.drop(requestId, pending);
    }
  }

  private drop(requestId: string, pending = this.#pending.get(requestId)): void {
    if (!pending) return;
    this.#pending.delete(requestId);
    globalThis.clearTimeout(pending.expirationTimer);
  }
}

function parseCaptureSnapshotBytes(bytes: Uint8Array): ConversationCaptureSnapshot {
  try {
    return parseConversationCaptureSnapshot(decodeCanonicalJson(bytes));
  } catch {
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  }
}

function parseRuntimeCaptureMessage(msg: unknown) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new LocalDataContractError('INVALID_ARGUMENT');
  const { type: _type, ...payload } = msg as Record<string, unknown>;
  return parseRuntimeCaptureSnapshotPayload(payload);
}

type ListQueryPayload = {
  sourceKey: string;
  siteKey: string;
  limit?: number;
};

function normalizeListFilterKey(value: unknown, fallback: string): string {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  return text || fallback;
}

function normalizeListLimit(value: unknown): number | null {
  if (value == null || value === '') return null;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return Math.min(Math.floor(limit), 200);
}

function normalizeTailWindowLimit(value: unknown): number | null {
  if (value == null || value === '') return 200;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return Math.min(Math.floor(limit), 200);
}

function parseListQueryPayload(msg: any): { query: ListQueryPayload; errorField?: string } {
  const rawQuery = msg?.query;
  if (rawQuery != null && typeof rawQuery !== 'object') {
    return {
      query: { sourceKey: 'all', siteKey: 'all' },
      errorField: 'query',
    };
  }
  const sourceKey = normalizeListFilterKey(rawQuery?.sourceKey, 'all');
  const siteKey = normalizeListFilterKey(rawQuery?.siteKey, 'all');
  const rawLimit = msg?.limit ?? rawQuery?.limit;
  const limit = normalizeListLimit(rawLimit);
  if (rawLimit != null && rawLimit !== '' && limit == null) {
    return {
      query: { sourceKey, siteKey },
      errorField: 'limit',
    };
  }
  return {
    query: limit == null ? { sourceKey, siteKey } : { sourceKey, siteKey, limit },
  };
}

function parseListCursorPayload(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  if (typeof (value as any).nativeCursor === 'string' && (value as any).nativeCursor.trim()) {
    return { nativeCursor: (value as any).nativeCursor.trim() };
  }
  const lastCapturedAt = Number((value as any).lastCapturedAt);
  const id = Number((value as any).id);
  if (!Number.isFinite(lastCapturedAt) || !Number.isFinite(id) || id <= 0) return null;
  return { lastCapturedAt, id };
}

function stableReference(value: unknown): StableConversationReference | null {
  const source = String((value as any)?.source || '').trim();
  const conversationKey = String((value as any)?.conversationKey || '').trim();
  return source && conversationKey ? { source, conversationKey } : null;
}

function requireFactsEpoch(msg: any): FactsEpoch | null {
  return typeof msg?.factsEpoch === 'string' && msg.factsEpoch ? (msg.factsEpoch as FactsEpoch) : null;
}

function sameReference(a: StableConversationReference, b: StableConversationReference): boolean {
  return a.source === b.source && a.conversationKey === b.conversationKey;
}

async function resolveConversationReference(
  repository: Readonly<{
    getConversationByReference: (reference: StableConversationReference) => Promise<Conversation | null>;
  }>,
  reference: StableConversationReference,
): Promise<ResolvedConversationReference> {
  const conversation = await repository.getConversationByReference(reference);
  if (!conversation) throw new LocalDataContractError('STALE_REFERENCE');
  const conversationId = Number(conversation.id);
  const source = String(conversation.source || '').trim();
  const conversationKey = String(conversation.conversationKey || '').trim();
  if (
    !Number.isSafeInteger(conversationId) ||
    conversationId <= 0 ||
    !source ||
    !conversationKey ||
    !sameReference(reference, { source, conversationKey })
  ) {
    throw new LocalDataContractError('STALE_REFERENCE');
  }
  return { source, conversationKey, conversationId };
}

function normalizeMessageSyncOptions(msg: any): ConversationMessageSyncOptions | null {
  const rawMode = String(msg?.mode || '')
    .trim()
    .toLowerCase();
  if (rawMode && rawMode !== 'snapshot' && rawMode !== 'incremental' && rawMode !== 'append') return null;
  const mode = rawMode === 'incremental' ? 'incremental' : rawMode === 'append' ? 'append' : 'snapshot';
  if (msg?.diff == null) return { mode, diff: null };
  if (typeof msg.diff !== 'object' || Array.isArray(msg.diff)) return null;
  const normalizeKeys = (value: unknown): string[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return null;
    const keys = value.map((item) => String(item || '').trim());
    return keys.every(Boolean) ? [...new Set(keys)] : null;
  };
  const added = normalizeKeys(msg.diff.added);
  const updated = normalizeKeys(msg.diff.updated);
  const removed = normalizeKeys(msg.diff.removed);
  if (!added || !updated || !removed) return null;
  return { mode, diff: { added, updated, removed } };
}

async function withCaptureAuthorNames(messages: readonly JsonObject[]): Promise<JsonObject[]> {
  let next = messages.map((message) => ({ ...message })) as JsonObject[];
  try {
    const local = await storageGet([ABOUT_YOU_USER_NAME_STORAGE_KEY]);
    const aboutYouUserName = normalizeUserName(local?.[ABOUT_YOU_USER_NAME_STORAGE_KEY]) || DEFAULT_ABOUT_YOU_USER_NAME;
    next = next.map((message) => {
      const role = String(message.role || '')
        .trim()
        .toLowerCase();
      if (role !== 'user' || String(message.authorName || '').trim()) return message;
      return { ...message, authorName: aboutYouUserName };
    });
  } catch {
    // Author names are optional and retain the renderer fallback.
  }
  return next;
}

async function inlineCaptureImages(input: {
  conversationId: number;
  conversationSourceType: string;
  conversationUrl: string;
  forceHttpImageCache?: boolean;
  messages: JsonObject[];
  options: ConversationMessageSyncOptions;
}): Promise<JsonObject[]> {
  try {
    const sourceType = String(input.conversationSourceType || '')
      .trim()
      .toLowerCase();
    const local = await storageGet(['ai_chat_cache_images_enabled', 'web_article_cache_images_enabled']);
    const enableHttpImages =
      input.forceHttpImageCache === true ||
      (sourceType === 'article'
        ? local?.web_article_cache_images_enabled === true
        : local?.ai_chat_cache_images_enabled === true);
    const keys =
      (input.options.mode === 'incremental' || input.options.mode === 'append') && input.options.diff
        ? new Set([...(input.options.diff.added || []), ...(input.options.diff.updated || [])])
        : null;
    const inlined = await inlineChatImagesInMessages({
      conversationId: input.conversationId,
      conversationUrl: input.conversationUrl,
      messages: input.messages,
      onlyMessageKeys: keys,
      enableHttpImages,
    });
    if (
      inlined.inlinedCount > 0 ||
      inlined.downloadedCount > 0 ||
      inlined.fromCacheCount > 0 ||
      inlined.warningFlags.length > 0
    ) {
      console.info('[ImageInline]', {
        conversationId: input.conversationId,
        mode: input.options.mode,
        inlinedCount: inlined.inlinedCount,
        downloadedCount: inlined.downloadedCount,
        fromCacheCount: inlined.fromCacheCount,
        inlinedBytes: inlined.inlinedBytes,
        warningFlags: inlined.warningFlags,
      });
    }
    return inlined.messages as JsonObject[];
  } catch (error) {
    console.warn('[ImageInline] failed but capture continues', {
      conversationId: input.conversationId,
      mode: input.options.mode,
      error: error instanceof Error ? error.message : String(error || ''),
    });
    return input.messages;
  }
}

export type ConversationCaptureSnapshotSaveResult = Readonly<{
  conversationId: number;
  isNew: boolean;
}>;

/** Persists one validated capture while its caller already owns the facts lease. */
export async function saveConversationCaptureSnapshotInLease(
  input: Readonly<{
    forceHttpImageCache?: boolean;
    mode: 'idb' | 'native';
    onConversationChanged: ConversationHandlersDeps['onConversationChanged'];
    repository: ConversationFactsRepository;
    snapshot: ConversationCaptureSnapshot;
  }>,
): Promise<ConversationCaptureSnapshotSaveResult> {
  const reference = stableReference(input.snapshot.conversation);
  if (!reference) throw new LocalDataContractError('INVALID_ARGUMENT');
  const options: ConversationMessageSyncOptions = {
    ...(input.snapshot.mode === undefined ? { mode: 'snapshot' } : { mode: input.snapshot.mode }),
    ...(input.snapshot.diff === undefined ? { diff: null } : { diff: input.snapshot.diff }),
  };
  const messages = await withCaptureAuthorNames(input.snapshot.messages);

  if (input.mode === 'native') {
    // ponytail: P3-T7 adds Native image capabilities; active capture must not fall back to image IDB meanwhile.
    const saved = await input.repository.saveConversationSnapshot({
      ...input.snapshot,
      messages,
      mode: options.mode,
      diff: options.diff,
    });
    const conversationId = Number(saved.conversation.id);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
      throw new LocalDataContractError('PROTOCOL_MISMATCH');
    }
    await input.onConversationChanged(
      conversationId,
      saved.isNew
        ? AUTO_SYNC_CONVERSATION_CHANGED_REASONS.createConversation
        : AUTO_SYNC_CONVERSATION_CHANGED_REASONS.syncConversationMessages,
    );
    return { conversationId, isNew: saved.isNew };
  }

  const existing = await input.repository.getConversationByReference(reference);
  const conversation = await input.repository.upsertConversation(input.snapshot.conversation);
  const resolved = await resolveConversationReference(input.repository, {
    source: String(conversation.source || '').trim(),
    conversationKey: String(conversation.conversationKey || '').trim(),
  });
  const inlinedMessages = await inlineCaptureImages({
    conversationId: resolved.conversationId,
    conversationSourceType: String(conversation.sourceType || input.snapshot.conversation.sourceType || ''),
    conversationUrl: String(conversation.url || input.snapshot.conversation.url || ''),
    forceHttpImageCache: input.forceHttpImageCache,
    messages,
    options,
  });
  await input.repository.syncConversationMessages(resolved, inlinedMessages, options);
  await input.onConversationChanged(
    resolved.conversationId,
    existing
      ? AUTO_SYNC_CONVERSATION_CHANGED_REASONS.syncConversationMessages
      : AUTO_SYNC_CONVERSATION_CHANGED_REASONS.createConversation,
  );
  return { conversationId: resolved.conversationId, isNew: !existing };
}

function factsError(router: AnyRouter, error: unknown) {
  if (error instanceof LocalDataContractError) {
    return router.err(error.message, { code: error.code, diagnostics: error.diagnostics ?? null });
  }
  return router.err(error instanceof Error ? error.message : String(error || 'facts read failed'));
}

function withFactsEpoch(conversation: Conversation, factsEpoch: FactsEpoch): Conversation {
  return { ...conversation, factsEpoch };
}

function withFactsEpochPage(
  page: ConversationListPage<Conversation>,
  factsEpoch: FactsEpoch,
): ConversationListPage<Conversation> {
  return {
    ...page,
    factsEpoch,
    items: (Array.isArray(page.items) ? page.items : []).map((conversation) =>
      withFactsEpoch(conversation, factsEpoch),
    ),
  };
}

function withFactsEpochTarget(target: ConversationListOpenTarget | null, factsEpoch: FactsEpoch) {
  return target ? { ...target, factsEpoch } : null;
}

export function registerConversationHandlers(router: AnyRouter, deps: ConversationHandlersDeps) {
  const readStreams = new PendingConversationReadStreams();
  const captureStreams = new PendingCaptureSnapshotStreams();
  deps.streamRouter.register('conversation-detail', {
    download: async ({ requestId, send }) => {
      await send(readStreams.take(requestId));
    },
  });
  deps.streamRouter.register('capture-snapshot', {
    authorizeUpload: ({ requestId, stream }) => captureStreams.take(requestId, stream),
    upload: async ({ bytes, lease }) => {
      const snapshot = parseCaptureSnapshotBytes(bytes);
      const backend = await openConversationReadRepository(lease);
      const result = await saveConversationCaptureSnapshotInLease({
        mode: backend.mode,
        repository: backend.repository,
        snapshot,
        onConversationChanged: deps.onConversationChanged,
      });
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
        reason: 'captureSnapshot',
        conversationId: result.conversationId,
      });
      return result;
    },
  });

  const invalidArgument = (field: string, message: string, received: unknown) => {
    return router.err(message, {
      code: 'INVALID_ARGUMENT',
      field,
      received,
    });
  };

  router.register(CORE_MESSAGE_TYPES.SAVE_CONVERSATION_SNAPSHOT, async (msg) => {
    try {
      const payload = parseRuntimeCaptureMessage(msg);
      if (!('snapshot' in payload)) return router.ok(captureStreams.publish(payload.transfer));
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-capture-snapshot',
        read: async ({ mode, repository }) =>
          await saveConversationCaptureSnapshotInLease({
            mode,
            repository,
            snapshot: payload.snapshot,
            onConversationChanged: deps.onConversationChanged,
          }),
      });
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
        reason: 'captureSnapshot',
        conversationId: result.conversationId,
      });
      return router.ok(result);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_BOOTSTRAP, async (msg) => {
    const parsed = parseListQueryPayload(msg);
    if (parsed.errorField === 'query') return invalidArgument('query', 'invalid query', msg?.query);
    if (parsed.errorField === 'limit')
      return invalidArgument('limit', 'invalid limit', msg?.limit ?? msg?.query?.limit);
    try {
      const page = await deps.conversationReadRunner.run({
        kind: 'conversation-bootstrap',
        read: async ({ factsEpoch, repository }) =>
          withFactsEpochPage(
            await repository.getConversationListBootstrap(parsed.query, parsed.query.limit),
            factsEpoch,
          ),
      });
      return router.ok(page);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_PAGE, async (msg) => {
    const parsed = parseListQueryPayload(msg);
    if (parsed.errorField === 'query') return invalidArgument('query', 'invalid query', msg?.query);
    if (parsed.errorField === 'limit')
      return invalidArgument('limit', 'invalid limit', msg?.limit ?? msg?.query?.limit);
    const cursor = parseListCursorPayload(msg?.cursor);
    if (!cursor) return invalidArgument('cursor', 'invalid cursor', msg?.cursor);
    const factsEpoch = requireFactsEpoch(msg);
    if (!factsEpoch) return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    try {
      const page = await deps.conversationReadRunner.run({
        kind: 'conversation-load-more',
        expectedFactsEpoch: factsEpoch,
        read: async ({ factsEpoch: currentFactsEpoch, repository }) =>
          withFactsEpochPage(
            await repository.getConversationListPage(parsed.query, cursor, parsed.query.limit),
            currentFactsEpoch,
          ),
      });
      return router.ok(page);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_SOURCE_AND_KEY, async (msg) => {
    const source = String(msg?.source || '').trim();
    const conversationKey = String(msg?.conversationKey || '').trim();
    if (!source) return invalidArgument('source', 'invalid source', msg?.source);
    if (!conversationKey) return invalidArgument('conversationKey', 'invalid conversationKey', msg?.conversationKey);
    try {
      const target = await deps.conversationReadRunner.run({
        kind: 'conversation-find-by-source-key',
        expectedFactsEpoch: msg?.factsEpoch,
        read: async ({ factsEpoch, repository }) =>
          withFactsEpochTarget(await repository.findConversationBySourceAndKey(source, conversationKey), factsEpoch),
      });
      return router.ok(target);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID, async (msg) => {
    const conversationId = Number(msg?.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return invalidArgument('conversationId', 'invalid conversationId', msg?.conversationId);
    }
    try {
      const target = await deps.conversationReadRunner.run({
        kind: 'conversation-find-by-id',
        expectedFactsEpoch: msg?.factsEpoch,
        read: async ({ factsEpoch, repository }) => {
          if (!repository.findConversationById) throw new LocalDataContractError('STALE_REFERENCE');
          return withFactsEpochTarget(await repository.findConversationById(conversationId), factsEpoch);
        },
      });
      return router.ok(target);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, async (msg) => {
    const reference = stableReference(msg);
    if (!reference) return invalidArgument('reference', 'invalid conversation reference', msg);
    const factsEpoch = requireFactsEpoch(msg);
    if (!factsEpoch) return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    try {
      const detail = await deps.conversationReadRunner.run({
        kind: 'conversation-detail',
        expectedFactsEpoch: factsEpoch,
        read: async ({ factsEpoch: currentFactsEpoch, repository }) =>
          readStreams.publish({
            ...(await repository.getConversationDetail(reference)),
            source: reference.source,
            conversationKey: reference.conversationKey,
            factsEpoch: currentFactsEpoch,
          }),
      });
      return router.ok(detail as ConversationDetailReadResponse);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY, async (msg) => {
    const source = String(msg?.source || '').trim();
    const conversationKey = String(msg?.conversationKey || '').trim();
    if (!source) return invalidArgument('source', 'invalid source', msg?.source);
    if (!conversationKey) return invalidArgument('conversationKey', 'invalid conversationKey', msg?.conversationKey);
    const reference = { source, conversationKey };
    const limit = normalizeTailWindowLimit(msg?.limit);
    if (limit == null) return invalidArgument('limit', 'invalid limit', msg?.limit);
    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-tail',
        expectedFactsEpoch: msg?.factsEpoch,
        read: async ({ factsEpoch, repository }) =>
          readStreams.publish({
            ...(await repository.getConversationTailWindow(reference, limit)),
            source: reference.source,
            conversationKey: reference.conversationKey,
            factsEpoch,
          }),
      });
      return router.ok(result as ConversationTailWindowReadResponse);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, async (msg) => {
    const payload = msg?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return invalidArgument('payload', 'invalid conversation payload', payload);
    }
    const payloadReference = stableReference(payload);
    if (!payloadReference) return invalidArgument('payload', 'missing conversation reference', payload);
    const expectedFactsEpoch = msg?.factsEpoch === undefined ? undefined : requireFactsEpoch(msg);
    if (msg?.factsEpoch !== undefined && !expectedFactsEpoch) {
      return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    }
    const observedReference = msg?.reference === undefined ? null : stableReference(msg.reference);
    if (expectedFactsEpoch && (!observedReference || !sameReference(observedReference, payloadReference))) {
      return router.err('stale conversation reference', { code: 'STALE_REFERENCE' });
    }
    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-upsert',
        ...(expectedFactsEpoch ? { expectedFactsEpoch } : {}),
        read: async ({ repository }) => {
          const existing = await repository.getConversationByReference(payloadReference);
          if (expectedFactsEpoch && !existing) throw new LocalDataContractError('STALE_REFERENCE');
          const conversation = await repository.upsertConversation(payload as JsonObject);
          const conversationId = Number(conversation.id);
          if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
            throw new LocalDataContractError('PROTOCOL_MISMATCH');
          }
          const isNew = !existing;
          await deps.onConversationChanged(
            conversationId,
            isNew
              ? AUTO_SYNC_CONVERSATION_CHANGED_REASONS.createConversation
              : AUTO_SYNC_CONVERSATION_CHANGED_REASONS.upsertConversation,
          );
          return { conversation, conversationId, isNew };
        },
      });
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
        reason: result.isNew ? 'createConversation' : 'upsertConversation',
        conversationId: result.conversationId,
      });
      return router.ok({ ...result.conversation, __isNew: result.isNew });
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.MERGE_CONVERSATIONS, async (msg) => {
    const keep = stableReference(msg?.keep);
    const remove = stableReference(msg?.remove);
    if (!keep) return invalidArgument('keep', 'invalid keep conversation reference', msg?.keep);
    if (!remove) return invalidArgument('remove', 'invalid remove conversation reference', msg?.remove);
    const factsEpoch = requireFactsEpoch(msg);
    if (!factsEpoch) return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-merge',
        expectedFactsEpoch: factsEpoch,
        read: async ({ repository }) => {
          const resolvedKeep = await resolveConversationReference(repository, keep);
          const resolvedRemove = await resolveConversationReference(repository, remove);
          const response = await repository.mergeConversations({ keep: resolvedKeep, remove: resolvedRemove });
          if (response.merged) {
            await deps.onConversationChanged(
              response.keptConversationId,
              AUTO_SYNC_CONVERSATION_CHANGED_REASONS.upsertConversation,
            );
          }
          return { response };
        },
      });
      if (result.response.merged) {
        router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
          reason: 'mergeConversations',
          conversationId: result.response.keptConversationId,
          removedConversationId: result.response.removedConversationId,
        });
      }
      return router.ok(result.response);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, async (msg) => {
    const reference = stableReference(msg);
    if (!reference) return invalidArgument('reference', 'invalid conversation reference', msg);
    const expectedFactsEpoch = msg?.factsEpoch === undefined ? undefined : requireFactsEpoch(msg);
    if (msg?.factsEpoch !== undefined && !expectedFactsEpoch) {
      return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    }
    if (!Array.isArray(msg?.messages))
      return invalidArgument('messages', 'invalid conversation messages', msg?.messages);
    const options = normalizeMessageSyncOptions(msg);
    if (!options) return invalidArgument('mode', 'invalid message sync options', { mode: msg?.mode, diff: msg?.diff });
    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-sync-messages',
        ...(expectedFactsEpoch ? { expectedFactsEpoch } : {}),
        read: async ({ mode: backendMode, repository }) => {
          const resolved = await resolveConversationReference(repository, reference);
          let messages = msg.messages.slice();
          try {
            const local = await storageGet([ABOUT_YOU_USER_NAME_STORAGE_KEY]);
            const aboutYouUserName =
              normalizeUserName(local?.[ABOUT_YOU_USER_NAME_STORAGE_KEY]) || DEFAULT_ABOUT_YOU_USER_NAME;
            messages = messages.map((message: any) => {
              if (!message || typeof message !== 'object') return message;
              const role = String(message.role || '')
                .trim()
                .toLowerCase();
              if (role !== 'user' || String(message.authorName || '').trim()) return message;
              return { ...message, authorName: aboutYouUserName };
            });
          } catch {
            // Author names are optional and retain the renderer fallback.
          }

          if (backendMode === 'idb') {
            try {
              const sourceType =
                String(msg?.conversationSourceType || '')
                  .trim()
                  .toLowerCase() || 'chat';
              const local = await storageGet(['ai_chat_cache_images_enabled', 'web_article_cache_images_enabled']);
              const enableHttpImages =
                sourceType === 'article'
                  ? local?.web_article_cache_images_enabled === true
                  : local?.ai_chat_cache_images_enabled === true;
              const keys =
                (options.mode === 'incremental' || options.mode === 'append') && options.diff
                  ? new Set([...(options.diff.added || []), ...(options.diff.updated || [])])
                  : null;
              const inlined = await inlineChatImagesInMessages({
                conversationId: resolved.conversationId,
                conversationUrl: String(msg?.conversationUrl || ''),
                messages,
                onlyMessageKeys: keys,
                enableHttpImages,
              });
              messages = inlined.messages;
              if (
                inlined.inlinedCount > 0 ||
                inlined.downloadedCount > 0 ||
                inlined.fromCacheCount > 0 ||
                inlined.warningFlags.length > 0
              ) {
                console.info('[ImageInline]', {
                  conversationId: resolved.conversationId,
                  mode: options.mode,
                  inlinedCount: inlined.inlinedCount,
                  downloadedCount: inlined.downloadedCount,
                  fromCacheCount: inlined.fromCacheCount,
                  inlinedBytes: inlined.inlinedBytes,
                  warningFlags: inlined.warningFlags,
                });
              }
            } catch (error) {
              console.warn('[ImageInline] failed but capture continues', {
                conversationId: resolved.conversationId,
                mode: options.mode,
                error: error instanceof Error ? error.message : String(error || ''),
              });
            }
          }
          // ponytail: P3-T7 supplies the Native image capability; active message writes must not touch image IDB here.
          const response = await repository.syncConversationMessages(resolved, messages as JsonValue, options);
          await deps.onConversationChanged(
            resolved.conversationId,
            AUTO_SYNC_CONVERSATION_CHANGED_REASONS.syncConversationMessages,
          );
          return { response, conversationId: resolved.conversationId };
        },
      });
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
        reason: 'upsert',
        conversationId: result.conversationId,
      });
      return router.ok(result.response);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.BACKFILL_CONVERSATION_IMAGES, async (msg) => {
    const reference = stableReference(msg);
    if (!reference) return invalidArgument('reference', 'invalid conversation reference', msg);
    const factsEpoch = requireFactsEpoch(msg);
    if (!factsEpoch) return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    const conversationUrl = String(msg?.conversationUrl || '').trim();
    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-backfill-images',
        expectedFactsEpoch: factsEpoch,
        read: async ({ mode, repository }) => {
          const resolved = await resolveConversationReference(repository, reference);
          if (mode !== 'idb') {
            // ponytail: P3-T7 replaces this IDB-only image job with the typed Native image facade.
            throw new LocalDataContractError('PROTOCOL_MISMATCH');
          }
          const response = await backfillConversationImages({
            conversationId: resolved.conversationId,
            conversationUrl,
          });
          await deps.onConversationChanged(
            resolved.conversationId,
            AUTO_SYNC_CONVERSATION_CHANGED_REASONS.backfillImages,
          );
          return { response, conversationId: resolved.conversationId };
        },
      });
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
        reason: 'upsert',
        conversationId: result.conversationId,
      });
      return router.ok(result.response);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, async (msg) => {
    if (!Array.isArray(msg?.conversations) || !msg.conversations.length) {
      return invalidArgument('conversations', 'invalid conversation references', msg?.conversations);
    }
    const references: Array<StableConversationReference | null> = (msg.conversations as unknown[]).map((value) =>
      stableReference(value),
    );
    if (references.some((reference) => !reference)) {
      return invalidArgument('conversations', 'invalid conversation references', msg.conversations);
    }
    const factsEpoch = requireFactsEpoch(msg);
    if (!factsEpoch) return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-delete',
        expectedFactsEpoch: factsEpoch,
        read: async ({ repository }) => {
          const resolved = await Promise.all(
            (references as StableConversationReference[]).map((reference) =>
              resolveConversationReference(repository, reference),
            ),
          );
          return {
            response: await repository.deleteConversations(resolved),
            conversationIds: resolved.map((reference) => reference.conversationId),
          };
        },
      });
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
        reason: 'delete',
        conversationIds: result.conversationIds,
      });
      return router.ok(result.response);
    } catch (error) {
      return factsError(router, error);
    }
  });
}
