import { CORE_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

export function registerConversationHandlers(router: AnyRouter) {
  const NS: any = (globalThis as any).WebClipper || {};

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATIONS, async () => {
    const storage = NS.backgroundStorage;
    if (!storage) return router.err('storage module missing');
    const items = await storage.getConversations();
    return router.ok(items);
  });

  router.register(CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, async (msg) => {
    const storage = NS.backgroundStorage;
    if (!storage) return router.err('storage module missing');
    const conversationId = Number(msg.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const messages = await storage.getMessagesByConversationId(conversationId);
    return router.ok({ conversationId, messages });
  });

  router.register(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, async (msg) => {
    const storage = NS.backgroundStorage;
    if (!storage) return router.err('storage module missing');
    const payload = msg.payload || {};
    if (!payload.source) return router.err('missing conversation source');
    if (!payload.conversationKey) return router.err('missing conversationKey');
    const convo = await storage.upsertConversation(payload);
    return router.ok(convo);
  });

  router.register(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, async (msg) => {
    const storage = NS.backgroundStorage;
    if (!storage) return router.err('storage module missing');
    const conversationId = Number(msg.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return router.err('invalid conversationId');
    const res = await storage.syncConversationMessages(conversationId, msg.messages);
    try {
      const hub = NS.backgroundEventsHub;
      const eventType = NS.messageContracts?.UI_EVENT_TYPES?.CONVERSATIONS_CHANGED ?? 'conversationsChanged';
      hub?.broadcast?.(eventType, { reason: 'upsert', conversationId });
    } catch (_e) {
      // ignore
    }
    return router.ok(res);
  });

  router.register(CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, async (msg) => {
    const storage = NS.backgroundStorage;
    if (!storage) return router.err('storage module missing');
    const ids = Array.isArray(msg.conversationIds) ? msg.conversationIds : [];
    const res = await storage.deleteConversationsByIds(ids);
    try {
      const hub = NS.backgroundEventsHub;
      const eventType = NS.messageContracts?.UI_EVENT_TYPES?.CONVERSATIONS_CHANGED ?? 'conversationsChanged';
      const normalizedIds = Array.isArray(ids)
        ? ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x) && x > 0)
        : [];
      hub?.broadcast?.(eventType, { reason: 'delete', conversationIds: normalizedIds });
    } catch (_e) {
      // ignore
    }
    return router.ok(res);
  });
}

