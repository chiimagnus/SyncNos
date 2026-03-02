import type { Conversation } from './models';
import { syncConversationMessages, upsertConversation } from './storage';

export async function writeConversationSnapshot(payload: any): Promise<Conversation> {
  return upsertConversation(payload);
}

export async function writeConversationMessagesSnapshot(
  conversationId: number,
  messages: any[],
): Promise<{ upserted: number; deleted: number }> {
  return syncConversationMessages(conversationId, messages);
}

