import * as idb from '@services/conversations/data/storage-idb';
import type {
  Conversation,
  ConversationListCursor,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListQueryInput,
} from '@services/conversations/domain/models';

export async function getConversationListBootstrap(
  queryInput?: ConversationListQueryInput | null,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  return await idb.getConversationListBootstrap(queryInput, limit);
}

export async function getConversationListPage(
  queryInput: ConversationListQueryInput | null | undefined,
  cursor: ConversationListCursor,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  return await idb.getConversationListPage(queryInput, cursor, limit);
}

export async function findConversationBySourceAndKey(
  source: string,
  conversationKey: string,
): Promise<ConversationListOpenTarget | null> {
  return await idb.findConversationBySourceAndKey(source, conversationKey);
}

export async function findConversationById(conversationId: number): Promise<ConversationListOpenTarget | null> {
  return await idb.findConversationById(conversationId);
}

export async function getConversationById(conversationId: number): Promise<Conversation | null> {
  return await idb.getConversationById(conversationId);
}

export async function getConversationBySourceConversationKey(source: string, conversationKey: string) {
  return await idb.getConversationBySourceConversationKey(source, conversationKey);
}

export async function getConversationTailWindowBySourceAndKey(source: string, conversationKey: string, limit: number) {
  return await idb.getConversationTailWindowBySourceAndKey(source, conversationKey, limit);
}

export async function getConversationDetail(conversationId: number) {
  const messages = await idb.getMessagesByConversationId(conversationId);
  return { conversationId, messages };
}

export async function searchConversationMentionCandidates(input?: {
  query?: unknown;
  limit?: unknown;
  maxScan?: number;
  maxDurationMs?: number;
}) {
  return await idb.searchConversationMentionCandidates(input);
}

export async function upsertConversation(payload: any) {
  return await idb.upsertConversation(payload);
}

export async function updateConversationTitle(input: {
  conversationId: number;
  mode: 'set' | 'reset';
  title?: string;
}) {
  return await idb.updateConversationTitle(input);
}

export async function hasConversation(payload: any) {
  return await idb.hasConversation(payload);
}

export async function syncConversationMessages(
  conversationId: number,
  messages: any[],
  options?: {
    mode?: 'snapshot' | 'incremental' | 'append';
    diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null;
  },
) {
  return await idb.syncConversationMessages(conversationId, messages, options);
}

export async function syncConversationMessagesAppendOnly(
  conversationId: number,
  messages: any[],
  diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null,
) {
  return await idb.syncConversationMessagesAppendOnly(conversationId, messages, diff || null);
}

export async function deleteConversationsByIds(conversationIds: any[]) {
  return await idb.deleteConversationsByIds(conversationIds);
}

export async function mergeConversationsByIds(input: { keepConversationId: number; removeConversationId: number }) {
  return await idb.mergeConversationsByIds(input);
}
