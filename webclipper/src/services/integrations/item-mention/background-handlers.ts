import { ITEM_MENTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { searchConversationMentionCandidates } from '@services/conversations/data/storage';
import { normalizeMentionSearchLimit } from '@services/integrations/item-mention/mention-contract';
import { searchMentionCandidates } from '@services/integrations/item-mention/mention-search';

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

  router.register(ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, async (_msg) => {
    return router.err('item mention insert not implemented');
  });
}
