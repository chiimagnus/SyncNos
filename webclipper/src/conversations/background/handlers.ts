import { CORE_MESSAGE_TYPES, UI_EVENT_TYPES } from '../../platform/messaging/message-contracts';
import {
  deleteConversationsByIds,
  getConversationDetail,
  hasConversation,
  listConversations,
} from '../data/storage';
import {
  writeConversationMessagesSnapshot,
  writeConversationSnapshot,
} from '../data/write';

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
    return router.ok({ ...(convo as any), __isNew: !existed });
  });

  router.register(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, async (msg) => {
    const conversationId = Number(msg.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const res = await writeConversationMessagesSnapshot(conversationId, msg.messages);
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
