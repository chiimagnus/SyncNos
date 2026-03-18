import type { Conversation } from '../domain/models';
import { syncConversationMessages, syncConversationMessagesAppendOnly, upsertConversation } from './storage';

export async function writeConversationSnapshot(payload: any): Promise<Conversation> {
  return upsertConversation(payload);
}

export async function writeConversationMessagesSnapshot(
  conversationId: number,
  messages: any[],
  options?: { mode?: 'snapshot' | 'incremental' | 'append'; diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null },
): Promise<{ upserted: number; deleted: number }> {
  if (options?.mode === 'append') {
    return syncConversationMessagesAppendOnly(conversationId, messages, options?.diff || null);
  }
  return syncConversationMessages(conversationId, messages, options);
}
