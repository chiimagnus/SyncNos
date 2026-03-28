import { ITEM_MENTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import type { MentionSearchResult } from '@services/integrations/item-mention/mention-contract';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function ensureOk(res: any, fallback: string) {
  if (res && res.ok === true) return res.data;
  const message = String(res?.error?.message || fallback);
  const error = new Error(message);
  (error as any).extra = res?.error?.extra ?? null;
  throw error;
}

export async function searchMentionCandidates(
  runtime: RuntimeClient | null,
  input: { query: string; limit?: number | null },
): Promise<MentionSearchResult> {
  if (!runtime || typeof runtime.send !== 'function') throw new Error('runtime client unavailable');
  const res = await runtime.send(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, {
    query: input.query,
    limit: input.limit ?? null,
  });
  return ensureOk(res, 'searchMentionCandidates failed') as MentionSearchResult;
}

export async function buildMentionInsertText(
  runtime: RuntimeClient | null,
  input: { conversationId: number },
): Promise<{ conversationId: number; markdown: string }> {
  if (!runtime || typeof runtime.send !== 'function') throw new Error('runtime client unavailable');
  const res = await runtime.send(ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, {
    conversationId: input.conversationId,
  });
  return ensureOk(res, 'buildMentionInsertText failed') as { conversationId: number; markdown: string };
}
