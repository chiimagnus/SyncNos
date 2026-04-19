import { CORE_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { storageGet } from '@platform/storage/local';
import {
  deleteConversationsByIds,
  findConversationById,
  findConversationBySourceAndKey,
  getConversationListBootstrap,
  getConversationListPage,
  getConversationDetail,
  getConversationTailWindowBySourceAndKey,
  hasConversation,
  mergeConversationsByIds,
  updateConversationTitle,
} from '@services/conversations/data/storage';
import { writeConversationMessagesSnapshot, writeConversationSnapshot } from '@services/conversations/data/write';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import { backfillConversationImages } from '@services/conversations/background/image-backfill-job';
import {
  ABOUT_YOU_USER_NAME_STORAGE_KEY,
  DEFAULT_ABOUT_YOU_USER_NAME,
  normalizeUserName,
} from '@services/shared/user-profile';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
  eventsHub?: { broadcast: (type: string, payload: unknown) => void };
};

type ListQueryPayload = {
  sourceKey: string;
  siteKey: string;
  limit?: number;
};

type ListCursorPayload = {
  lastCapturedAt: number;
  id: number;
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

function parseListCursorPayload(value: unknown): ListCursorPayload | null {
  if (!value || typeof value !== 'object') return null;
  const lastCapturedAt = Number((value as any).lastCapturedAt);
  const id = Number((value as any).id);
  if (!Number.isFinite(lastCapturedAt) || !Number.isFinite(id) || id <= 0) return null;
  return { lastCapturedAt, id };
}

export function registerConversationHandlers(router: AnyRouter) {
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
    const page = await getConversationListBootstrap(parsed.query, parsed.query.limit);
    return router.ok(page);
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_PAGE, async (msg) => {
    const parsed = parseListQueryPayload(msg);
    if (parsed.errorField === 'query') return invalidArgument('query', 'invalid query', msg?.query);
    if (parsed.errorField === 'limit')
      return invalidArgument('limit', 'invalid limit', msg?.limit ?? msg?.query?.limit);
    const cursor = parseListCursorPayload(msg?.cursor);
    if (!cursor) return invalidArgument('cursor', 'invalid cursor', msg?.cursor);
    const page = await getConversationListPage(parsed.query, cursor, parsed.query.limit);
    return router.ok(page);
  });

  router.register(CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_SOURCE_AND_KEY, async (msg) => {
    const source = String(msg?.source || '').trim();
    const conversationKey = String(msg?.conversationKey || '').trim();
    if (!source) return invalidArgument('source', 'invalid source', msg?.source);
    if (!conversationKey) return invalidArgument('conversationKey', 'invalid conversationKey', msg?.conversationKey);
    const target = await findConversationBySourceAndKey(source, conversationKey);
    return router.ok(target);
  });

  router.register(CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID, async (msg) => {
    const conversationId = Number(msg?.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return invalidArgument('conversationId', 'invalid conversationId', msg?.conversationId);
    }
    const target = await findConversationById(conversationId);
    return router.ok(target);
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, async (msg) => {
    const conversationId = Number(msg.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const detail = await getConversationDetail(conversationId);
    return router.ok(detail);
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY, async (msg) => {
    const source = String(msg?.source || '').trim();
    const conversationKey = String(msg?.conversationKey || '').trim();
    if (!source) return invalidArgument('source', 'invalid source', msg?.source);
    if (!conversationKey) return invalidArgument('conversationKey', 'invalid conversationKey', msg?.conversationKey);
    const limit = normalizeTailWindowLimit(msg?.limit);
    if (limit == null) return invalidArgument('limit', 'invalid limit', msg?.limit);

    const result = await getConversationTailWindowBySourceAndKey(source, conversationKey, limit);
    const conversationId = Number(result.conversation?.id);
    return router.ok({
      conversationId: Number.isFinite(conversationId) && conversationId > 0 ? conversationId : null,
      messages: Array.isArray(result.messages) ? result.messages : [],
    });
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
    }
    return router.ok({ ...(convo as any), __isNew: !existed });
  });

  router.register(CORE_MESSAGE_TYPES.UPDATE_CONVERSATION_TITLE, async (msg) => {
    const conversationId = Number(msg?.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return invalidArgument('conversationId', 'invalid conversationId', msg?.conversationId);
    }
    const mode = String(msg?.mode || '')
      .trim()
      .toLowerCase();
    if (mode !== 'set' && mode !== 'reset') {
      return invalidArgument('mode', 'invalid title update mode', msg?.mode);
    }
    const title = msg?.title == null ? '' : String(msg?.title);
    if (mode === 'set' && !title.trim()) {
      return invalidArgument('title', 'invalid title', msg?.title);
    }
    const conversation = await updateConversationTitle({
      conversationId,
      mode: mode as 'set' | 'reset',
      title,
    });
    router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'updateConversationTitle',
      conversationId,
    });
    return router.ok(conversation);
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
    return router.ok(res);
  });

  router.register(CORE_MESSAGE_TYPES.BACKFILL_CONVERSATION_IMAGES, async (msg) => {
    const conversationId = Number(msg.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const conversationUrl = String(msg?.conversationUrl || '').trim();
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
      },
    });
    router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'upsert',
      conversationId,
    });
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
