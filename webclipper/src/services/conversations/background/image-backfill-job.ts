import { getMessagesByConversationId, syncConversationMessages } from '@services/conversations/data/storage-idb';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';

export type BackfillConversationImagesResult = {
  scannedMessages: number;
  updatedMessages: number;
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
};

export async function backfillConversationImages(input: {
  conversationId: number;
  conversationUrl?: string;
}): Promise<BackfillConversationImagesResult> {
  const conversationId = Number(input.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    throw new Error('invalid conversationId');
  }

  const messages = await getMessagesByConversationId(conversationId);
  const beforeMarkdown = new Map<string, string>();
  for (const msg of messages) {
    const key = msg && (msg as any).messageKey ? String((msg as any).messageKey) : '';
    if (!key) continue;
    beforeMarkdown.set(key, String((msg as any).contentMarkdown || ''));
  }

  const inlined = await inlineChatImagesInMessages({
    conversationId,
    conversationUrl: input.conversationUrl,
    messages: messages as any,
  });

  const updatedKeys: string[] = [];
  for (const msg of inlined.messages) {
    const key = msg && msg.messageKey ? String(msg.messageKey) : '';
    if (!key) continue;
    const before = beforeMarkdown.get(key) ?? '';
    const after = String(msg.contentMarkdown || '');
    if (after && after !== before) updatedKeys.push(key);
  }

  if (updatedKeys.length) {
    await syncConversationMessages(conversationId, inlined.messages, {
      mode: 'incremental',
      diff: { added: [], updated: updatedKeys, removed: [] },
    });
  }

  return {
    scannedMessages: messages.length,
    updatedMessages: updatedKeys.length,
    inlinedCount: inlined.inlinedCount,
    fromCacheCount: inlined.fromCacheCount,
    downloadedCount: inlined.downloadedCount,
    inlinedBytes: inlined.inlinedBytes,
    warningFlags: inlined.warningFlags,
  };
}
