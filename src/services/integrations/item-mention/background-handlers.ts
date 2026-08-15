import { ITEM_MENTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { type ConversationReadRunner } from '@services/conversations/data/storage';
import { LocalDataContractError, type FactsEpoch } from '@services/local-data/contracts';
import { normalizeMentionSearchLimit } from '@services/integrations/item-mention/mention-contract';
import { searchMentionCandidates } from '@services/integrations/item-mention/mention-search';
import { formatConversationMarkdownForExternalOutput } from '@services/integrations/chatwith/chatwith-settings';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type ItemMentionHandlersDeps = Readonly<{
  conversationReadRunner: ConversationReadRunner;
}>;

function stableReference(msg: any): { conversationKey: string; factsEpoch: FactsEpoch; source: string } | null {
  const source = String(msg?.source || '').trim();
  const conversationKey = String(msg?.conversationKey || '').trim();
  const factsEpoch = typeof msg?.factsEpoch === 'string' ? msg.factsEpoch : '';
  return source && conversationKey && factsEpoch
    ? { source, conversationKey, factsEpoch: factsEpoch as FactsEpoch }
    : null;
}

function factsError(router: AnyRouter, error: unknown) {
  if (error instanceof LocalDataContractError) {
    return router.err(error.message, { code: error.code, diagnostics: error.diagnostics ?? null });
  }
  return router.err(error instanceof Error ? error.message : String(error || 'mention facts read failed'));
}

export function registerItemMentionHandlers(router: AnyRouter, deps: ItemMentionHandlersDeps) {
  router.register(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, async (msg) => {
    const rawQuery = msg?.query ?? msg?.text ?? '';
    const query = String(rawQuery || '');
    const limit = normalizeMentionSearchLimit(msg?.limit, { defaultLimit: 20, maxLimit: 50 });

    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'mention-search',
        expectedFactsEpoch: msg?.factsEpoch,
        read: async ({ factsEpoch, repository }) => {
          const storageRes = await repository.searchConversationMentionCandidates({
            query,
            limit: 50,
            maxScan: 2000,
            maxDurationMs: 300,
          });
          const res = searchMentionCandidates({
            query,
            candidates: storageRes.candidates.map((candidate) => ({ ...candidate, factsEpoch })),
            limit,
          });
          return {
            ...res,
            factsEpoch,
            scannedCount: storageRes.scannedCount,
            truncatedByScanLimit: storageRes.truncatedByScanLimit,
          };
        },
      });
      return router.ok(result);
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, async (msg) => {
    const reference = stableReference(msg);
    if (!reference) {
      return router.err('stale mention reference', { code: 'STALE_BACKEND_EPOCH', field: 'factsEpoch' });
    }

    try {
      const result = await deps.conversationReadRunner.run({
        kind: 'mention-insert',
        expectedFactsEpoch: reference.factsEpoch,
        read: async ({ factsEpoch, repository }) => {
          const stableReference = { source: reference.source, conversationKey: reference.conversationKey };
          const conversation = await repository.getConversationByReference(stableReference);
          if (!conversation) throw new LocalDataContractError('STALE_REFERENCE');
          const detail = await repository.getConversationDetail(stableReference);
          const messages = Array.isArray(detail.messages) ? detail.messages : [];
          if (!messages.length) throw new Error('conversation detail empty');
          const markdown = await formatConversationMarkdownForExternalOutput(
            { ...conversation, factsEpoch },
            { ...detail, source: reference.source, conversationKey: reference.conversationKey, factsEpoch },
          );
          return {
            source: reference.source,
            conversationKey: reference.conversationKey,
            factsEpoch,
            markdown,
          };
        },
      });
      return router.ok(result);
    } catch (error) {
      return factsError(router, error);
    }
  });
}
