import {
  getMessagesByConversationId,
  getConversationById,
  getConversationMessagesByKeys,
  patchConversationMessageMarkdownBatch,
  type ConversationMessageMarkdownPatch,
} from '@services/conversations/data/storage-idb';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import { downloadChatgptImagesForStoredConversation } from '@services/integrations/chatgpt/conversation-image-assets';
import { storageGet } from '@services/shared/storage';
import { getAntiHotlinkRulesSnapshot, includesAnyAntiHotlinkDomain } from '@platform/webext/anti-hotlink-rules-store';

export type BackfillConversationImagesResult = {
  scannedMessages: number;
  updatedMessages: number;
  conflicts: number;
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
};

export async function backfillConversationImages(input: {
  conversationId: number;
  messageKeys?: string[];
  force?: boolean;
}): Promise<BackfillConversationImagesResult> {
  const conversationId = Number(input.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    throw new Error('invalid conversationId');
  }

  const messages = input.messageKeys?.length
    ? await getConversationMessagesByKeys(conversationId, input.messageKeys)
    : await getMessagesByConversationId(conversationId);
  const beforeMarkdown = new Map<string, string>();
  for (const msg of messages) {
    const key = msg && (msg as any).messageKey ? String((msg as any).messageKey) : '';
    if (!key) continue;
    beforeMarkdown.set(key, String((msg as any).contentMarkdown || ''));
  }

  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    return {
      scannedMessages: 0,
      updatedMessages: 0,
      conflicts: 0,
      inlinedCount: 0,
      fromCacheCount: 0,
      downloadedCount: 0,
      inlinedBytes: 0,
      warningFlags: [],
    };
  }
  const isArticle = String(conversation.sourceType || '').toLowerCase() === 'article';
  const isChat = String(conversation.sourceType || '').toLowerCase() === 'chat';
  const prefs = await storageGet(['web_article_cache_images_enabled', 'ai_chat_cache_images_enabled']);
  let articleNeedsHotlinkCache = false;
  if (isArticle && !prefs?.web_article_cache_images_enabled) {
    try {
      articleNeedsHotlinkCache = includesAnyAntiHotlinkDomain(
        messages.map((message) => String(message.contentMarkdown || '')).join('\n'),
        await getAntiHotlinkRulesSnapshot(),
      );
    } catch (_error) {
      // Preserve saved Markdown. A missing rules snapshot must not break post-save image processing.
    }
  }
  const enableHttpImages =
    input.force === true ||
    (isArticle
      ? prefs?.web_article_cache_images_enabled === true || articleNeedsHotlinkCache
      : isChat && prefs?.ai_chat_cache_images_enabled === true);
  const enableChatgptImages = isChat && (input.force === true || prefs?.ai_chat_cache_images_enabled === true);

  const inlined = await inlineChatImagesInMessages({
    conversationId,
    messages: messages as any,
    enableHttpImages,
    enableChatgptImages,
    ...(enableChatgptImages
      ? {
          downloadChatgptImages: async (fileIds: string[]) =>
            await downloadChatgptImagesForStoredConversation({ conversationId, fileIds, concurrency: 4 }),
        }
      : null),
  });

  const patches: ConversationMessageMarkdownPatch[] = [];
  for (const msg of inlined.messages) {
    const key = msg && msg.messageKey ? String(msg.messageKey) : '';
    if (!key || !beforeMarkdown.has(key)) continue;
    const before = beforeMarkdown.get(key) ?? '';
    const after = String(msg.contentMarkdown || '');
    if (after === before) continue;
    patches.push({ messageKey: key, beforeMarkdown: before, afterMarkdown: after });
  }

  const patchResult = patches.length
    ? await patchConversationMessageMarkdownBatch(conversationId, patches)
    : { updated: 0, conflicts: 0 };

  return {
    scannedMessages: messages.length,
    updatedMessages: patchResult.updated,
    conflicts: patchResult.conflicts,
    inlinedCount: inlined.inlinedCount,
    fromCacheCount: inlined.fromCacheCount,
    downloadedCount: inlined.downloadedCount,
    inlinedBytes: inlined.inlinedBytes,
    warningFlags: inlined.warningFlags,
  };
}
