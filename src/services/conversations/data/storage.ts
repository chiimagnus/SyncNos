import * as idb from '@services/conversations/data/storage-idb';
import type {
  Conversation,
  ConversationListCursor,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListQueryInput,
} from '@services/conversations/domain/models';

export function getConversationListBootstrap(
  queryInput?: ConversationListQueryInput | null,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  return idb.getConversationListBootstrap(queryInput, limit);
}

export function getConversationListPage(
  queryInput: ConversationListQueryInput | null | undefined,
  cursor: ConversationListCursor,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  return idb.getConversationListPage(queryInput, cursor, limit);
}

export function findConversationBySourceAndKey(
  source: string,
  conversationKey: string,
): Promise<ConversationListOpenTarget | null> {
  return idb.findConversationBySourceAndKey(source, conversationKey);
}

export function getConversationById(conversationId: number): Promise<Conversation | null> {
  return idb.getConversationById(conversationId);
}

export function getConversationBySourceConversationKey(source: string, conversationKey: string) {
  return idb.getConversationBySourceConversationKey(source, conversationKey);
}

export function getConversationTailWindowBySourceAndKey(source: string, conversationKey: string, limit: number) {
  return idb.getConversationTailWindowBySourceAndKey(source, conversationKey, limit);
}

export async function getConversationDetail(conversationId: number) {
  const messages = await idb.getMessagesByConversationId(conversationId);
  return { conversationId, messages };
}

export function searchConversations(input: idb.ConversationSearchInput): Promise<idb.ConversationSearchResult[]> {
  return idb.searchConversations(input);
}

export function readRecentConversationMentionCandidates(input: { maxScan: number; maxDurationMs: number }) {
  return idb.readRecentConversationMentionCandidates(input);
}

export function readConversationMentionCandidatePool(input: { maxScan: number; maxDurationMs: number }) {
  return idb.readConversationMentionCandidatePool(input);
}

export function upsertConversation(payload: any) {
  return idb.upsertConversation(payload);
}

export function syncConversationMessages(
  conversationId: number,
  messages: any[],
  options?: {
    mode?: 'snapshot' | 'incremental' | 'append';
    diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null;
    activityAt?: number;
  },
) {
  return idb.syncConversationMessages(conversationId, messages, options);
}

export function deleteConversationsByIds(conversationIds: any[]) {
  return idb.deleteConversationsByIds(conversationIds);
}

export function mergeConversationsByIds(input: { keepConversationId: number; removeConversationId: number }) {
  return idb.mergeConversationsByIds(input);
}

export function updateConversationUrlById(input: { conversationId: number; url: string; mergeExisting?: boolean }) {
  return idb.updateConversationUrlById(input);
}
