import { ARTICLE_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import {
  fetchActiveTabArticle,
  resolveOrCaptureActiveTabArticle,
  type ArticleCapturePersistence,
} from '@collectors/web/article-fetch';
import { DISCOURSE_OP_NOT_FOUND_ERROR, isDiscourseOpNotFoundErrorMessage } from '@collectors/web/article-fetch-errors';
import { saveConversationCaptureSnapshotInLease } from '@services/conversations/background/handlers';
import { type ConversationReadRunner } from '@services/conversations/data/storage';
import { type AutoSyncConversationChangedReason } from '@services/sync/auto-sync/auto-sync-keys';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
  eventsHub?: { broadcast: (type: string, payload: unknown) => void };
};

type WebArticleHandlersDeps = Readonly<{
  conversationReadRunner: ConversationReadRunner;
  onConversationChanged: (conversationId: number, reason: AutoSyncConversationChangedReason) => void | Promise<void>;
}>;

function normalizeArticleFetchError(error: unknown, fallback: string): string {
  const raw =
    (error as any)?.message != null ? String((error as any).message) : String(error != null ? error : fallback || '');
  const message = raw.trim();
  if (isDiscourseOpNotFoundErrorMessage(message)) return DISCOURSE_OP_NOT_FOUND_ERROR;
  return message || fallback;
}

export function registerWebArticleHandlers(router: AnyRouter, deps: WebArticleHandlersDeps) {
  const run = async (
    tabId: unknown,
    operation: (input: Readonly<{ persistence: ArticleCapturePersistence; tabId?: number }>) => Promise<unknown>,
  ) => {
    let saved = false;
    const data = await deps.conversationReadRunner.run({
      kind: 'article-fetch',
      read: async ({ mode, repository }) => {
        const persistence: ArticleCapturePersistence = {
          findConversation: async (reference) => await repository.getConversationByReference(reference),
          saveSnapshot: async (input) => {
            saved = true;
            return await saveConversationCaptureSnapshotInLease({
              mode,
              repository,
              snapshot: input.snapshot,
              ...(input.forceHttpImageCache ? { forceHttpImageCache: true } : {}),
              onConversationChanged: deps.onConversationChanged,
            });
          },
        };
        return await operation({
          persistence,
          ...(Number.isFinite(Number(tabId)) ? { tabId: Number(tabId) } : {}),
        });
      },
    });
    return { data, saved };
  };

  router.register(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB, async (msg) => {
    try {
      const { data } = await run(msg?.tabId, fetchActiveTabArticle);

      const conversationId = Number((data as any)?.conversationId);
      if (Number.isFinite(conversationId) && conversationId > 0) {
        router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
          reason: 'articleFetch',
          conversationId,
        });
      }

      return router.ok(data);
    } catch (e) {
      return router.err(normalizeArticleFetchError(e, 'article fetch failed'));
    }
  });

  router.register(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, async (msg) => {
    try {
      const { data, saved } = await run(msg?.tabId, resolveOrCaptureActiveTabArticle);

      const conversationId = Number((data as any)?.conversationId);
      if (saved && Number.isFinite(conversationId) && conversationId > 0) {
        router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
          reason: 'articleFetch',
          conversationId,
        });
      }

      return router.ok(data);
    } catch (e) {
      return router.err(normalizeArticleFetchError(e, 'article resolve failed'));
    }
  });
}
