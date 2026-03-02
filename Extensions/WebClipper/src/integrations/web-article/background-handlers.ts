import { ARTICLE_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';
import { fetchActiveTabArticle } from './article-fetch';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

export function registerWebArticleHandlers(router: AnyRouter) {
  router.register(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB, async (msg) => {
    try {
      const data = await fetchActiveTabArticle({ tabId: msg?.tabId });

      try {
        const NS: any = (globalThis as any).WebClipper || {};
        const hub = NS.backgroundEventsHub;
        const eventType =
          NS.messageContracts?.UI_EVENT_TYPES?.CONVERSATIONS_CHANGED ??
          'conversationsChanged';
        const conversationId = Number((data as any)?.conversationId);
        if (hub?.broadcast && Number.isFinite(conversationId) && conversationId > 0) {
          hub.broadcast(eventType, { reason: 'articleFetch', conversationId });
        }
      } catch (_e) {
        // ignore
      }

      return router.ok(data);
    } catch (e) {
      return router.err((e as any)?.message ?? String(e ?? 'article fetch failed'));
    }
  });
}

