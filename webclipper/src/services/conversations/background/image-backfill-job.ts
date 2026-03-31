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

export type BackfillConversationImagesProgress = {
  scannedMessages: number;
  updatedMessages: number;
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
  latestMessageKey?: string;
};

export async function backfillConversationImages(input: {
  conversationId: number;
  conversationUrl?: string;
  onProgress?: (progress: BackfillConversationImagesProgress) => Promise<void> | void;
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

  const progressCallback = typeof input.onProgress === 'function' ? input.onProgress : null;
  const persistedUpdatedKeys = new Set<string>();

  const inlined = await inlineChatImagesInMessages({
    conversationId,
    conversationUrl: input.conversationUrl,
    messages: messages as any,
    onMessageUpdated: progressCallback
      ? async (update) => {
          const key = String(update?.messageKey || '').trim();
          if (!key) return;
          if (persistedUpdatedKeys.has(key)) return;

          await syncConversationMessages(conversationId, [update.message], {
            mode: 'incremental',
            diff: { added: [], updated: [key], removed: [] },
          });
          persistedUpdatedKeys.add(key);

          await progressCallback({
            scannedMessages: messages.length,
            updatedMessages: persistedUpdatedKeys.size,
            inlinedCount: Number(update?.inlinedCount) || 0,
            fromCacheCount: Number(update?.fromCacheCount) || 0,
            downloadedCount: Number(update?.downloadedCount) || 0,
            inlinedBytes: Number(update?.inlinedBytes) || 0,
            warningFlags: Array.isArray(update?.warningFlags) ? update.warningFlags : [],
            latestMessageKey: key,
          });
        }
      : undefined,
  });

  const updatedKeys: string[] = [];
  for (const msg of inlined.messages) {
    const key = msg && msg.messageKey ? String(msg.messageKey) : '';
    if (!key) continue;
    const before = beforeMarkdown.get(key) ?? '';
    const after = String(msg.contentMarkdown || '');
    if (after && after !== before) updatedKeys.push(key);
  }

  if (updatedKeys.length && !progressCallback) {
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
