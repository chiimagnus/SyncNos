import { ARTICLE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { fetchActiveTabArticle, resolveOrCaptureActiveTabArticle } from '@collectors/web/article-fetch';
import { DISCOURSE_OP_NOT_FOUND_ERROR, isDiscourseOpNotFoundErrorMessage } from '@collectors/web/article-fetch-errors';
import {
  AUTO_SYNC_CONVERSATION_CHANGED_REASONS,
  type AutoSyncConversationChangedReason,
} from '@services/sync/auto-sync/auto-sync-keys';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type WebArticleHandlersDeps = {
  onConversationChanged: (conversationId: number, reason: AutoSyncConversationChangedReason) => void | Promise<void>;
};

function normalizeArticleFetchError(error: unknown, fallback: string): string {
  const raw =
    (error as any)?.message != null ? String((error as any).message) : String(error != null ? error : fallback || '');
  const message = raw.trim();
  if (isDiscourseOpNotFoundErrorMessage(message)) return DISCOURSE_OP_NOT_FOUND_ERROR;
  return message || fallback;
}

function fireAndForget(task: void | Promise<void>) {
  Promise.resolve(task).catch(() => {});
}

export function registerWebArticleHandlers(router: AnyRouter, deps: WebArticleHandlersDeps) {
  router.register(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB, async (msg) => {
    try {
      const data = await fetchActiveTabArticle({ tabId: msg?.tabId });

      fireAndForget(
        deps.onConversationChanged(
          data.conversationId,
          AUTO_SYNC_CONVERSATION_CHANGED_REASONS.syncConversationMessages,
        ),
      );

      return router.ok(data);
    } catch (e) {
      return router.err(normalizeArticleFetchError(e, 'article fetch failed'));
    }
  });

  router.register(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, async (msg) => {
    try {
      const data = await resolveOrCaptureActiveTabArticle({ tabId: msg?.tabId });

      if (data.isNew) {
        fireAndForget(
          deps.onConversationChanged(
            data.conversationId,
            AUTO_SYNC_CONVERSATION_CHANGED_REASONS.syncConversationMessages,
          ),
        );
      }

      return router.ok(data);
    } catch (e) {
      return router.err(normalizeArticleFetchError(e, 'article resolve failed'));
    }
  });
}
