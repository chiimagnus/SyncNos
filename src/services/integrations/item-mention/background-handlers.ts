import { ITEM_MENTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  getConversationById,
  getConversationDetail,
  readConversationMentionCandidatePool,
} from '@services/conversations/data/storage';
import { readDataRevision } from '@services/data-revisions/storage-idb';
import {
  normalizeMentionQuery,
  normalizeMentionSearchLimit,
} from '@services/integrations/item-mention/mention-contract';
import { searchMentionCandidates } from '@services/integrations/item-mention/mention-search';
import { formatConversationMarkdownForExternalOutput } from '@services/conversations/external-markdown';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

export function registerItemMentionHandlers(router: AnyRouter) {
  type MentionCandidatePool = Awaited<ReturnType<typeof readConversationMentionCandidatePool>>;

  let mentionCandidatePoolCache: MentionCandidatePool | null = null;
  let mentionCandidatePoolLoadInFlight: Promise<MentionCandidatePool> | null = null;

  const loadMentionCandidatePoolSingleFlight = (): Promise<MentionCandidatePool> => {
    if (mentionCandidatePoolLoadInFlight) return mentionCandidatePoolLoadInFlight;

    const load = readConversationMentionCandidatePool({ maxScan: 2000, maxDurationMs: 300 })
      .then((pool) => {
        mentionCandidatePoolCache = pool;
        return pool;
      })
      .finally(() => {
        mentionCandidatePoolLoadInFlight = null;
      });
    mentionCandidatePoolLoadInFlight = load;
    return load;
  };

  const respondWithPool = (pool: MentionCandidatePool, query: string, limit: number) =>
    router.ok(searchMentionCandidates({ query, candidates: pool.candidates, limit }));

  router.register(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, async (msg) => {
    const mentionQuery = normalizeMentionQuery(msg?.query ?? '');
    const limit = normalizeMentionSearchLimit(msg?.limit, { defaultLimit: 20, maxLimit: 50 });

    if (mentionQuery.empty) {
      const recentPool = await readConversationMentionCandidatePool({ maxScan: limit, maxDurationMs: 300 });
      return respondWithPool(recentPool, mentionQuery.raw, limit);
    }

    const observedRevision = await readDataRevision('conversations');
    if (mentionCandidatePoolCache?.revision === observedRevision) {
      return respondWithPool(mentionCandidatePoolCache, mentionQuery.raw, limit);
    }

    let pool = await loadMentionCandidatePoolSingleFlight();
    if (pool.revision !== observedRevision) {
      const currentRevision = await readDataRevision('conversations');
      if (pool.revision !== currentRevision) pool = await loadMentionCandidatePoolSingleFlight();
    }

    return respondWithPool(pool, mentionQuery.raw, limit);
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
