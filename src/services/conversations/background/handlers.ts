import { CORE_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { storageGet } from '@platform/storage/local';
import {
  deleteConversationsByIds,
  hasConversation,
  mergeConversationsByIds,
  type ConversationReadRunner,
} from '@services/conversations/data/storage';
import { writeConversationMessagesSnapshot, writeConversationSnapshot } from '@services/conversations/data/write';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import { backfillConversationImages } from '@services/conversations/background/image-backfill-job';
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
  MAX_DETAIL_PREVIEW_BYTES,
  MAX_ORDINARY_FACTS_RESPONSE_BYTES,
  parseStreamDescriptor,
  type FactsEpoch,
} from '@services/local-data/contracts';
import type {
  Conversation,
  ConversationDetailReadResponse,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationReadStreamPreflight,
  ConversationTailWindowReadResponse,
} from '@services/conversations/domain/models';

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
  register: (
    operation: 'conversation-detail',
    handler: Readonly<{
      download: (input: Readonly<{ requestId: string; send: (bytes: Uint8Array) => Promise<void> }>) => Promise<void>;
    }>,
  ) => void;
}>;

const PENDING_READ_STREAM_TTL_MS = 60_000;

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

function fireAndForget(task: void | Promise<void>) {
  Promise.resolve(task).catch(() => {});
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

function stableReference(msg: any): { source: string; conversationKey: string } | null {
  const source = String(msg?.source || '').trim();
  const conversationKey = String(msg?.conversationKey || '').trim();
  return source && conversationKey ? { source, conversationKey } : null;
}

function requireFactsEpoch(msg: any): FactsEpoch | null {
  return typeof msg?.factsEpoch === 'string' && msg.factsEpoch ? (msg.factsEpoch as FactsEpoch) : null;
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
  deps.streamRouter.register('conversation-detail', {
    download: async ({ requestId, send }) => {
      await send(readStreams.take(requestId));
    },
  });

  const invalidArgument = (field: string, message: string, received: unknown) => {
    return router.err(message, {
      code: 'INVALID_ARGUMENT',
      field,
      received,
    });
  };

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
    const payload = msg.payload || {};
    if (!payload.source) return router.err('missing conversation source');
    if (!payload.conversationKey) return router.err('missing conversationKey');
    let existed = false;
    try {
      existed = await hasConversation(payload);
    } catch (_e) {
      existed = false;
    }
    const convo = await writeConversationSnapshot(payload);
    const conversationId = Number((convo as any)?.id);
    if (Number.isFinite(conversationId) && conversationId > 0) {
      router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
        reason: existed ? 'upsertConversation' : 'createConversation',
        conversationId,
      });
      fireAndForget(
        deps.onConversationChanged(
          conversationId,
          existed
            ? AUTO_SYNC_CONVERSATION_CHANGED_REASONS.upsertConversation
            : AUTO_SYNC_CONVERSATION_CHANGED_REASONS.createConversation,
        ),
      );
    }
    return router.ok({ ...(convo as any), __isNew: !existed });
  });

  router.register(CORE_MESSAGE_TYPES.MERGE_CONVERSATIONS, async (msg) => {
    const keepConversationId = Number(msg?.keepConversationId);
    const removeConversationId = Number(msg?.removeConversationId);
    if (!Number.isFinite(keepConversationId) || keepConversationId <= 0)
      return router.err('invalid keepConversationId');
    if (!Number.isFinite(removeConversationId) || removeConversationId <= 0)
      return router.err('invalid removeConversationId');
    if (keepConversationId === removeConversationId) {
      return router.ok({
        keptConversationId: keepConversationId,
        removedConversationId: removeConversationId,
        movedMessages: 0,
        movedImageCache: 0,
        merged: false,
      });
    }

    const res = await mergeConversationsByIds({ keepConversationId, removeConversationId });
    router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'mergeConversations',
      conversationId: keepConversationId,
      removedConversationId: removeConversationId,
    });
    return router.ok(res);
  });

  router.register(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, async (msg) => {
    const conversationId = Number(msg.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const rawMode = String(msg?.mode || '')
      .trim()
      .toLowerCase();
    if (rawMode && rawMode !== 'snapshot' && rawMode !== 'incremental' && rawMode !== 'append') {
      return router.err('invalid mode');
    }
    const mode = rawMode === 'incremental' ? 'incremental' : rawMode === 'append' ? 'append' : 'snapshot';
    const diff = msg?.diff && typeof msg.diff === 'object' ? msg.diff : null;

    let messages = Array.isArray(msg.messages) ? msg.messages : [];
    try {
      const local = await storageGet([ABOUT_YOU_USER_NAME_STORAGE_KEY]);
      const aboutYouUserName =
        normalizeUserName(local?.[ABOUT_YOU_USER_NAME_STORAGE_KEY]) || DEFAULT_ABOUT_YOU_USER_NAME;

      messages = messages.map((m: any) => {
        if (!m || typeof m !== 'object') return m;
        const role = String((m as any).role || '')
          .trim()
          .toLowerCase();
        if (role !== 'user') return m;
        const currentAuthor = String((m as any).authorName || '').trim();
        if (currentAuthor) return m;
        return { ...(m as any), authorName: aboutYouUserName };
      });
    } catch (_e) {
      // ignore: authorName is optional and will fallback during rendering
    }
    try {
      const sourceType =
        String(msg?.conversationSourceType || '')
          .trim()
          .toLowerCase() || 'chat';
      const local = await storageGet(['ai_chat_cache_images_enabled', 'web_article_cache_images_enabled']);
      const enabled =
        sourceType === 'article'
          ? local?.web_article_cache_images_enabled === true
          : local?.ai_chat_cache_images_enabled === true;
      const keys =
        (mode === 'incremental' || mode === 'append') && diff
          ? new Set(
              [...(Array.isArray(diff.added) ? diff.added : []), ...(Array.isArray(diff.updated) ? diff.updated : [])]
                .map((x) => String(x || '').trim())
                .filter(Boolean),
            )
          : null;
      const inlined = await inlineChatImagesInMessages({
        conversationId,
        conversationUrl: String(msg?.conversationUrl || ''),
        messages,
        onlyMessageKeys: keys,
        enableHttpImages: enabled,
      });
      messages = inlined.messages;
      if (
        inlined.inlinedCount > 0 ||
        inlined.downloadedCount > 0 ||
        inlined.fromCacheCount > 0 ||
        (Array.isArray(inlined.warningFlags) && inlined.warningFlags.length)
      ) {
        console.info('[ImageInline]', {
          conversationId,
          mode,
          inlinedCount: inlined.inlinedCount,
          downloadedCount: inlined.downloadedCount,
          fromCacheCount: inlined.fromCacheCount,
          inlinedBytes: inlined.inlinedBytes,
          warningFlags: inlined.warningFlags,
        });
      }
    } catch (error) {
      console.warn('[ImageInline] failed but capture continues', {
        conversationId,
        mode,
        error: error instanceof Error ? error.message : String(error || ''),
      });
    }

    const res = await writeConversationMessagesSnapshot(conversationId, messages, { mode, diff });
    router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'upsert',
      conversationId,
    });
    fireAndForget(
      deps.onConversationChanged(conversationId, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.syncConversationMessages),
    );
    return router.ok(res);
  });

  router.register(CORE_MESSAGE_TYPES.BACKFILL_CONVERSATION_IMAGES, async (msg) => {
    const conversationId = Number(msg.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const conversationUrl = String(msg?.conversationUrl || '').trim();
    let progressEnqueued = false;
    const res = await backfillConversationImages({
      conversationId,
      conversationUrl,
      onProgress: async (progress) => {
        const updatedMessages = Number(progress?.updatedMessages) || 0;
        if (updatedMessages <= 0) return;
        router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
          reason: 'upsert',
          conversationId,
        });
        if (progressEnqueued) return;
        progressEnqueued = true;
        fireAndForget(
          deps.onConversationChanged(conversationId, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.backfillImages),
        );
      },
    });
    router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'upsert',
      conversationId,
    });
    fireAndForget(deps.onConversationChanged(conversationId, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.backfillImages));
    return router.ok(res);
  });

  router.register(CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, async (msg) => {
    const ids = Array.isArray(msg.conversationIds) ? msg.conversationIds : [];
    const res = await deleteConversationsByIds(ids);
    const normalizedIds = Array.isArray(ids)
      ? ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x) && x > 0)
      : [];
    router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'delete',
      conversationIds: normalizedIds,
    });
    return router.ok(res);
  });
}
