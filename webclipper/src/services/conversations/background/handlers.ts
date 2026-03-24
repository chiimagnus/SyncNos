import { CORE_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { storageGet } from '@platform/storage/local';
import {
  deleteConversationsByIds,
  getConversationDetail,
  hasConversation,
  listConversations,
  mergeConversationsByIds,
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

export function registerConversationHandlers(router: AnyRouter) {
  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATIONS, async () => {
    const items = await listConversations();
    return router.ok(items);
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, async (msg) => {
    const conversationId = Number(msg.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const detail = await getConversationDetail(conversationId);
    return router.ok(detail);
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
      if (sourceType !== 'article') {
        const local = await storageGet(['ai_chat_cache_images_enabled']);
        const enabled = local?.ai_chat_cache_images_enabled === true;
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
    const res = await backfillConversationImages({ conversationId, conversationUrl });
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
