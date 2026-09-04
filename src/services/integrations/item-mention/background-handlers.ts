import { ITEM_MENTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  getConversationById,
  getConversationDetail,
  readConversationMentionCandidatePool,
  readRecentConversationMentionCandidates,
} from '@services/conversations/data/storage';
import { readDataRevision } from '@services/data-revisions/storage-idb';
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
    const normalizedQuery = String(msg?.query ?? '').trim().toLowerCase();
    const rawLimit = msg?.limit;
    const parsedLimit = Number(rawLimit);
    const limit =
      rawLimit == null || rawLimit === '' || !Number.isFinite(parsedLimit) || parsedLimit <= 0
        ? 20
        : Math.max(1, Math.min(Math.floor(parsedLimit), 50));

    if (!normalizedQuery) {
      const candidates = await readRecentConversationMentionCandidates({ maxScan: limit, maxDurationMs: 300 });
      return router.ok(searchMentionCandidates({ query: normalizedQuery, candidates, limit }));
    }

    const observedRevision = await readDataRevision('conversations');
    if (mentionCandidatePoolCache?.revision === observedRevision) {
      return respondWithPool(mentionCandidatePoolCache, normalizedQuery, limit);
    }

    let pool = await loadMentionCandidatePoolSingleFlight();
    if (pool.revision !== observedRevision) {
      const currentRevision = await readDataRevision('conversations');
      if (pool.revision !== currentRevision) pool = await loadMentionCandidatePoolSingleFlight();
    }

    return respondWithPool(pool, normalizedQuery, limit);
  });

  router.register(ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, async (msg) => {
    const conversationId = Number(msg?.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return router.err('invalid conversationId', { code: 'INVALID_ARGUMENT', field: 'conversationId' });
    }

    const conversation = await getConversationById(conversationId);
    if (!conversation) return router.err('conversation not found', { code: 'NOT_FOUND' });

    const detail = await getConversationDetail(conversationId);
    if (!detail.messages.length) {
      return router.err('conversation detail empty', { code: 'EMPTY_DETAIL' });
    }

    const markdown = await formatConversationMarkdownForExternalOutput(conversation, detail);
    return router.ok({ conversationId, markdown });
  });
}
