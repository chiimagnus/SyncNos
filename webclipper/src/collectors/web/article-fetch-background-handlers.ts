import { ARTICLE_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { fetchActiveTabArticle, resolveOrCaptureActiveTabArticle } from '@collectors/web/article-fetch';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
  eventsHub?: { broadcast: (type: string, payload: unknown) => void };
};

export function registerWebArticleHandlers(router: AnyRouter) {
  router.register(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB, async (msg) => {
    try {
      const data = await fetchActiveTabArticle({ tabId: msg?.tabId });

      const conversationId = Number((data as any)?.conversationId);
      if (Number.isFinite(conversationId) && conversationId > 0) {
        router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
          reason: 'articleFetch',
          conversationId,
        });
      }

      return router.ok(data);
    } catch (e) {
      return router.err((e as any)?.message ?? String(e ?? 'article fetch failed'));
    }
  });

  router.register(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, async (msg) => {
    try {
      const data = await resolveOrCaptureActiveTabArticle({ tabId: msg?.tabId });

      const conversationId = Number((data as any)?.conversationId);
      const isNew = (data as any)?.isNew === true;
      if (isNew && Number.isFinite(conversationId) && conversationId > 0) {
        router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
          reason: 'articleFetch',
          conversationId,
        });
      }

      return router.ok(data);
    } catch (e) {
      return router.err((e as any)?.message ?? String(e ?? 'article resolve failed'));
    }
  });
}
