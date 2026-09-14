import { CHATGPT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { resolveChatgptImageUrlsForStoredConversation } from '@services/integrations/chatgpt/conversation-image-assets';

const IMAGE_URL_RESOLVE_TIMEOUT_MS = 15_000;

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

export function registerChatgptImageHandlers(router: AnyRouter): void {
  router.register(CHATGPT_MESSAGE_TYPES.RESOLVE_IMAGE_URLS, async (msg) => {
    const conversationId = Number(msg?.conversationId);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return router.err('invalid conversationId');

    const fileIds = Array.isArray(msg?.fileIds) ? msg.fileIds : [];
    if (!fileIds.length) return router.ok([]);

    return router.ok(
      await resolveChatgptImageUrlsForStoredConversation({
        conversationId,
        fileIds,
        concurrency: 4,
        timeoutMs: IMAGE_URL_RESOLVE_TIMEOUT_MS,
      }),
    );
  });
}
