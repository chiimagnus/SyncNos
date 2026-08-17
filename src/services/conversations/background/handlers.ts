import { CORE_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { storageGet } from '@platform/storage/local';
import {
  openConversationReadRepository,
  type ConversationFactsRepository,
  type ConversationReadRunner,
  type ConversationMessageSyncOptions,
  type ResolvedConversationReference,
} from '@services/conversations/data/storage';
import { createArticleUrlOperation } from '@services/conversations/data/article-url-operation';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import { createImageStorage, type ImageStorage } from '@services/conversations/data/image-storage';
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
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseBrowserRuntimeFactsRequest,
  parseConversationCaptureSnapshot,
  MAX_DETAIL_PREVIEW_BYTES,
  MAX_IMAGE_ASSET_BYTES,
  MAX_ORDINARY_FACTS_RESPONSE_BYTES,
  parseRuntimeCaptureSnapshotPayload,
  parseStreamDescriptor,
  type BrowserConversationReference,
  type BrowserRuntimeFactsCommand,
  type ConversationCaptureSnapshot,
  type JsonObject,
  type JsonValue,
  type FactsEpoch,
  type StableConversationReference,
} from '@services/local-data/contracts';
import type { FactsOperationLease } from '@services/local-data/facts-operation-gate';
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
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
  eventsHub?: { broadcast: (type: string, payload: unknown) => void };
};

type ConversationHandlersDeps = {
  conversationReadRunner: ConversationReadRunner;
  onConversationChanged: (
    reference: StableConversationReference,
    reason: AutoSyncConversationChangedReason,
    lease: FactsOperationLease,
  ) => void | Promise<void>;
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
  operation: 'conversation-detail' | 'image-asset';
};

type ImageAssetReadStreamPreflight = ConversationReadStreamPreflight &
  Readonly<{
    contentType: string;
  }>;

function createReadStreamRequestId(): string {
  const requestId = globalThis.crypto?.randomUUID?.();
  if (typeof requestId !== 'string' || !requestId) throw new LocalDataContractError('HOST_UNAVAILABLE');
  return requestId;
}

/** Holds bounded, already-authorized read bytes until their matching authenticated Port consumes them. */
class PendingFactsReadStreams {
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

    return this.publishBytes(bytes, 'conversation-detail');
  }

  publishImage(input: Readonly<{ bytes: Uint8Array; contentType: string }>): ImageAssetReadStreamPreflight {
    const contentType = String(input.contentType || '')
      .trim()
      .toLowerCase();
    if (
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength <= 0 ||
      !/^image\/[a-z0-9.+-]+$/.test(contentType)
    ) {
      throw new LocalDataContractError('PROTOCOL_MISMATCH');
    }
    if (input.bytes.byteLength > MAX_IMAGE_ASSET_BYTES) {
      throw new LocalDataContractError('PAYLOAD_TOO_LARGE', {
        operation: 'image-asset',
        actualBytes: input.bytes.byteLength,
        limitBytes: MAX_IMAGE_ASSET_BYTES,
      });
    }
    return { ...this.publishBytes(input.bytes, 'image-asset'), contentType };
  }

  take(requestId: string, operation: PendingReadStream['operation']): Uint8Array {
    this.expire();
    const pending = this.#pending.get(requestId);
    if (!pending) throw new LocalDataContractError('STALE_REFERENCE');
    this.drop(requestId, pending);
    if (pending.operation !== operation) throw new LocalDataContractError('PROTOCOL_MISMATCH');
    return pending.bytes;
  }

  private publishBytes(bytes: Uint8Array, operation: PendingReadStream['operation']): ConversationReadStreamPreflight {
    this.expire();
    // ponytail: one shared 64 MiB pending-read ceiling; add a bounded queue only if concurrent detail/image UX needs it.
    if (this.#bytes + bytes.byteLength > MAX_DETAIL_PREVIEW_BYTES) throw new LocalDataContractError('BUSY');

    const requestId = createReadStreamRequestId();
    if (this.#pending.has(requestId)) throw new LocalDataContractError('BUSY');
    const expiresAt = Date.now() + PENDING_READ_STREAM_TTL_MS;
    const expirationTimer = globalThis.setTimeout(() => this.drop(requestId), PENDING_READ_STREAM_TTL_MS);
    this.#pending.set(requestId, { bytes, expiresAt, expirationTimer, operation });
    this.#bytes += bytes.byteLength;
    return {
      kind: 'stream',
      requestId,
      stream: parseStreamDescriptor({ operation, declaredTotalBytes: bytes.byteLength }),
    };
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

function browserStableReference(value: BrowserConversationReference): StableConversationReference {
  if (Object.hasOwn(value, 'conversationId')) throw new LocalDataContractError('INVALID_ARGUMENT');
  const reference = stableReference(value);
  if (!reference) throw new LocalDataContractError('INVALID_ARGUMENT');
  return reference;
}

function parseRuntimeConversationFactsRequest(msg: unknown, command: BrowserRuntimeFactsCommand) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new LocalDataContractError('INVALID_ARGUMENT');
  const row = msg as Record<string, unknown>;
  const { type: _type, factsEpoch, ...payload } = row;
  return parseBrowserRuntimeFactsRequest({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: 'conversations-runtime',
    command,
    payload,
    ...(Object.hasOwn(row, 'factsEpoch') ? { factsEpoch } : {}),
  });
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
  conversationSourceType: string;
  conversationUrl: string;
  forceHttpImageCache?: boolean;
  imageStorage: Pick<ImageStorage, 'findAssetByUrl' | 'putAsset'>;
  messages: JsonObject[];
  owner: ResolvedConversationReference;
  options: ConversationMessageSyncOptions;
}): Promise<Awaited<ReturnType<typeof inlineChatImagesInMessages>>> {
  try {
    const sourceType = String(input.conversationSourceType || '')
      .trim()
      .toLowerCase();
    let local: Record<string, unknown> = {};
    try {
      local = await storageGet(['ai_chat_cache_images_enabled', 'web_article_cache_images_enabled']);
    } catch {
      // Image preference lookup is optional; data: images still stay eligible below.
    }
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
      imageStorage: input.imageStorage,
      owner: input.owner,
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
        conversationId: input.owner.conversationId,
        mode: input.options.mode,
        inlinedCount: inlined.inlinedCount,
        downloadedCount: inlined.downloadedCount,
        fromCacheCount: inlined.fromCacheCount,
        inlinedBytes: inlined.inlinedBytes,
        warningFlags: inlined.warningFlags,
      });
    }
    return inlined;
  } catch (error) {
    console.warn('[ImageInline] failed but capture continues', {
      conversationId: input.owner.conversationId,
      mode: input.options.mode,
      error: error instanceof Error ? error.message : String(error || ''),
    });
    return {
      messages: input.messages,
      inlinedCount: 0,
      fromCacheCount: 0,
      downloadedCount: 0,
      inlinedBytes: 0,
      updatedMessageKeys: [],
      warningFlags: ['inline_images_download_failed'],
    };
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
    lease: FactsOperationLease;
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
  const imageStorage = createImageStorage({ lease: input.lease, mode: input.mode });

  if (input.mode === 'native') {
    const saved = await input.repository.saveConversationSnapshot({
      ...input.snapshot,
      messages,
      mode: options.mode,
      diff: options.diff,
    });
    const resolved = await resolveConversationReference(input.repository, reference);
    if (Number(saved.conversation.id) !== resolved.conversationId) {
      throw new LocalDataContractError('STALE_REFERENCE');
    }
    const inlined = await inlineCaptureImages({
      owner: resolved,
      imageStorage,
      conversationSourceType: String(saved.conversation.sourceType || input.snapshot.conversation.sourceType || ''),
      conversationUrl: String(saved.conversation.url || input.snapshot.conversation.url || ''),
      forceHttpImageCache: input.forceHttpImageCache,
      messages,
      options,
    });
    if (inlined.updatedMessageKeys.length) {
      await input.repository.syncConversationMessages(resolved, inlined.messages as JsonValue, options);
    }
    await input.onConversationChanged(
      resolved,
      saved.isNew
        ? AUTO_SYNC_CONVERSATION_CHANGED_REASONS.createConversation
        : AUTO_SYNC_CONVERSATION_CHANGED_REASONS.syncConversationMessages,
      input.lease,
    );
    return { conversationId: resolved.conversationId, isNew: saved.isNew };
  }

  const existing = await input.repository.getConversationByReference(reference);
  if (!input.repository.upsertConversation) throw new LocalDataContractError('PROTOCOL_MISMATCH');
  const conversation = await input.repository.upsertConversation(input.snapshot.conversation);
  const resolved = await resolveConversationReference(input.repository, {
    source: String(conversation.source || '').trim(),
    conversationKey: String(conversation.conversationKey || '').trim(),
  });
  const inlined = await inlineCaptureImages({
    owner: resolved,
    imageStorage,
    conversationSourceType: String(conversation.sourceType || input.snapshot.conversation.sourceType || ''),
    conversationUrl: String(conversation.url || input.snapshot.conversation.url || ''),
    forceHttpImageCache: input.forceHttpImageCache,
    messages,
    options,
  });
  await input.repository.syncConversationMessages(resolved, inlined.messages as JsonValue, options);
  await input.onConversationChanged(
    resolved,
    existing
      ? AUTO_SYNC_CONVERSATION_CHANGED_REASONS.syncConversationMessages
      : AUTO_SYNC_CONVERSATION_CHANGED_REASONS.createConversation,
    input.lease,
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
  const readStreams = new PendingFactsReadStreams();
  const captureStreams = new PendingCaptureSnapshotStreams();
  deps.streamRouter.register('conversation-detail', {
    download: async ({ requestId, send }) => {
      await send(readStreams.take(requestId, 'conversation-detail'));
    },
  });
  deps.streamRouter.register('image-asset', {
    download: async ({ requestId, send }) => {
      await send(readStreams.take(requestId, 'image-asset'));
    },
  });
  deps.streamRouter.register('capture-snapshot', {
    authorizeUpload: ({ requestId, stream }) => captureStreams.take(requestId, stream),
    upload: async ({ bytes, lease }) => {
      const snapshot = parseCaptureSnapshotBytes(bytes);
      const backend = await openConversationReadRepository(lease);
      const result = await saveConversationCaptureSnapshotInLease({
        lease,
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
        read: async ({ lease, mode, repository }) =>
          await saveConversationCaptureSnapshotInLease({
            lease,
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

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_LOCAL_DATA_REVISION, async () => {
    try {
      const snapshot = await deps.conversationReadRunner.run({
        kind: 'local-data-revision',
        read: async ({ factsEpoch, repository }) => ({
          factsEpoch,
          factsRevision: await repository.getFactsRevision(),
        }),
      });
      return router.ok(snapshot);
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

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_SYNC_MAPPING, async (msg) => {
    const reference = stableReference(msg);
    if (!reference) return invalidArgument('reference', 'invalid conversation reference', msg);
    const factsEpoch = requireFactsEpoch(msg);
    if (!factsEpoch) return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-sync-mapping',
        expectedFactsEpoch: factsEpoch,
        read: async ({ repository }) => {
          const resolved = await resolveConversationReference(repository, reference);
          const [notion, feishu] = await Promise.all([
            repository.getSyncMapping(resolved, 'notion'),
            repository.getSyncMapping(resolved, 'feishu'),
          ]);
          if (!notion?.mapping && !feishu?.mapping) return null;
          return { ...(notion?.mapping || {}), ...(feishu?.mapping || {}) };
        },
      });
      return router.ok(result);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_IMAGE_ASSET, async (msg) => {
    const reference = stableReference(msg);
    if (!reference) return invalidArgument('reference', 'invalid conversation reference', msg);
    const factsEpoch = requireFactsEpoch(msg);
    if (!factsEpoch) return router.err('stale facts epoch', { code: 'STALE_BACKEND_EPOCH' });
    const assetId = Number(msg?.assetId);
    if (!Number.isSafeInteger(assetId) || assetId <= 0) {
      return invalidArgument('assetId', 'invalid image asset id', msg?.assetId);
    }
    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-image-asset',
        expectedFactsEpoch: factsEpoch,
        read: async ({ lease, mode, repository }) => {
          const owner = await resolveConversationReference(repository, reference);
          const asset = await createImageStorage({ lease, mode }).getAsset(owner, assetId);
          if (!asset) return null;
          const bytes = new Uint8Array(await asset.blob.arrayBuffer());
          if (
            asset.id !== assetId ||
            asset.conversationId !== owner.conversationId ||
            bytes.byteLength !== asset.byteSize
          ) {
            throw new LocalDataContractError('PROTOCOL_MISMATCH');
          }
          return readStreams.publishImage({ bytes, contentType: asset.contentType });
        },
      });
      return router.ok(result);
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

  router.register(CORE_MESSAGE_TYPES.UPDATE_ARTICLE_URL, async (msg) => {
    try {
      const request = parseRuntimeConversationFactsRequest(msg, 'UPDATE_ARTICLE_URL');
      if (request.command !== 'UPDATE_ARTICLE_URL') throw new LocalDataContractError('INVALID_ARGUMENT');
      const factsEpoch = request.factsEpoch;
      if (!factsEpoch) throw new LocalDataContractError('STALE_BACKEND_EPOCH');
      const conversation = browserStableReference(request.payload.conversation);
      const confirmedConflict = request.payload.confirmedConflict
        ? browserStableReference(request.payload.confirmedConflict)
        : undefined;
      const fromCanonicalUrl = canonicalizeArticleUrl(request.payload.fromCanonicalUrl);
      const toCanonicalUrl = canonicalizeArticleUrl(request.payload.toCanonicalUrl);
      if (!fromCanonicalUrl || !toCanonicalUrl) throw new LocalDataContractError('INVALID_ARGUMENT');

      const result = await deps.conversationReadRunner.run({
        kind: 'conversation-update-article-url',
        expectedFactsEpoch: factsEpoch,
        read: async ({ lease, mode, repository }) => {
          const resolved = await resolveConversationReference(repository, conversation);
          const resolvedConflict = confirmedConflict
            ? await resolveConversationReference(repository, confirmedConflict)
            : undefined;
          const response = await createArticleUrlOperation({ lease, mode }).update({
            conversation: resolved,
            ...(resolvedConflict ? { confirmedConflict: resolvedConflict } : {}),
            fromCanonicalUrl,
            toCanonicalUrl,
          });
          if (fromCanonicalUrl !== toCanonicalUrl) {
            await deps.onConversationChanged(
              response.conversation,
              AUTO_SYNC_CONVERSATION_CHANGED_REASONS.upsertConversation,
              lease,
            );
          }
          return response;
        },
      });
      if (fromCanonicalUrl !== toCanonicalUrl) {
        router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
          reason: 'articleUrlUpdated',
          conversationId: result.conversation.conversationId,
          ...(result.removedConversationId ? { removedConversationId: result.removedConversationId } : {}),
        });
      }
      return router.ok({
        commentsUpdated: result.commentsUpdated,
        conversationId: result.conversation.conversationId,
        conversationKey: result.conversation.conversationKey,
        source: result.conversation.source,
        merged: result.merged,
        ...(result.removedConversationId ? { removedConversationId: result.removedConversationId } : {}),
      });
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
        read: async ({ lease, mode, repository }) => {
          const resolved = await resolveConversationReference(repository, reference);
          const response = await backfillConversationImages({
            imageStorage: createImageStorage({ lease, mode }),
            owner: resolved,
            repository,
            conversationUrl,
          });
          await deps.onConversationChanged(resolved, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.backfillImages, lease);
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
