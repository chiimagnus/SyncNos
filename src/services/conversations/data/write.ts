import type { Conversation } from '@services/conversations/domain/models';
import { syncConversationMessages, upsertConversation } from '@services/conversations/data/storage';

// ponytail: P3-T5 replaces article-fetch's last direct IDB writes with one lease-bound snapshot operation.
export async function writeConversationSnapshot(payload: any): Promise<Conversation> {
  return upsertConversation(payload);
}

export async function writeConversationMessagesSnapshot(
  conversationId: number,
  messages: any[],
  options?: {
    mode?: 'snapshot' | 'incremental' | 'append';
    diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null;
  },
): Promise<{ upserted: number; deleted: number }> {
  return syncConversationMessages(conversationId, messages, options);
}
