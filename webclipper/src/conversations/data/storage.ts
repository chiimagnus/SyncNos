import * as idb from './storage-idb';

export async function listConversations() {
  return await idb.getConversations();
}

export async function getConversationDetail(conversationId: number) {
  const messages = await idb.getMessagesByConversationId(conversationId);
  return { conversationId, messages };
}

export async function upsertConversation(payload: any) {
  return await idb.upsertConversation(payload);
}

export async function syncConversationMessages(conversationId: number, messages: any[]) {
  return await idb.syncConversationMessages(conversationId, messages);
}

export async function deleteConversationsByIds(conversationIds: any[]) {
  return await idb.deleteConversationsByIds(conversationIds);
}
