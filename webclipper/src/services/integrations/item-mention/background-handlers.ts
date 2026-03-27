import { ITEM_MENTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { getConversationById, getConversationDetail, searchConversationMentionCandidates } from '@services/conversations/data/storage';
import { normalizeMentionSearchLimit } from '@services/integrations/item-mention/mention-contract';
import { searchMentionCandidates } from '@services/integrations/item-mention/mention-search';
import { formatConversationMarkdownForExternalOutput } from '@services/integrations/chatwith/chatwith-settings';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

export function registerItemMentionHandlers(router: AnyRouter) {
  router.register(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, async (msg) => {
    const rawQuery = msg?.query ?? msg?.text ?? '';
    const query = String(rawQuery || '');
    const limit = normalizeMentionSearchLimit(msg?.limit, { defaultLimit: 20, maxLimit: 50 });

    const storageRes = await searchConversationMentionCandidates({
      query,
      limit: 200,
      maxScan: 2000,
      maxDurationMs: 300,
    });

    const res = searchMentionCandidates({
      query,
      candidates: storageRes.candidates,
      limit,
    });
    return router.ok({
      ...res,
      scannedCount: storageRes.scannedCount,
      truncatedByScanLimit: storageRes.truncatedByScanLimit,
    });
  });

  router.register(ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, async (msg) => {
    const conversationId = Number(msg?.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return router.err('invalid conversationId', { code: 'INVALID_ARGUMENT', field: 'conversationId' });
    }

    const conversation = await getConversationById(conversationId);
    if (!conversation) return router.err('conversation not found', { code: 'NOT_FOUND' });

    const detail = await getConversationDetail(conversationId);
    const messages = Array.isArray((detail as any)?.messages) ? (detail as any).messages : [];
    if (!messages.length) {
      return router.err('conversation detail empty', { code: 'EMPTY_DETAIL' });
    }

    const markdown = await formatConversationMarkdownForExternalOutput(conversation as any, detail as any);
    return router.ok({ conversationId, markdown });
  });
}
