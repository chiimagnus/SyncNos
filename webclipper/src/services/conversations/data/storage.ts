import * as idb from '@services/conversations/data/storage-idb';

export async function listConversations() {
  return await idb.getConversations();
}

export async function getConversationBySourceConversationKey(source: string, conversationKey: string) {
  return await idb.getConversationBySourceConversationKey(source, conversationKey);
}

export async function getConversationDetail(conversationId: number) {
  const messages = await idb.getMessagesByConversationId(conversationId);
  return { conversationId, messages };
}

export async function upsertConversation(payload: any) {
  return await idb.upsertConversation(payload);
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
