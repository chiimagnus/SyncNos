import type { Conversation } from '../domain/models';
import { syncConversationMessages, upsertConversation } from './storage';

export async function writeConversationSnapshot(payload: any): Promise<Conversation> {
  return upsertConversation(payload);
}

export async function writeConversationMessagesSnapshot(
  conversationId: number,
  messages: any[],
  options?: { mode?: 'snapshot' | 'incremental'; diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null },
): Promise<{ upserted: number; deleted: number }> {
  return syncConversationMessages(conversationId, messages, options);
}
