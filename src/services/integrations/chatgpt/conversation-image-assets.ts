import { getConversationById } from '@services/conversations/data/storage-idb';
import {
  downloadChatgptImages,
  resolveChatgptImageUrls,
  type ChatgptImageDownloadResult,
  type ChatgptImageUrlResolution,
} from '@services/integrations/chatgpt/api-image-assets';

async function readChatgptConversationKey(conversationId: number): Promise<string> {
  const id = Number(conversationId);
  if (!Number.isSafeInteger(id) || id <= 0) return '';
  const conversation = await getConversationById(id);
  if (
    String((conversation as any)?.source || '')
      .trim()
      .toLowerCase() !== 'chatgpt'
  )
    return '';
  return String((conversation as any)?.conversationKey || '').trim();
}

export async function resolveChatgptImageUrlsForStoredConversation(input: {
  conversationId: number;
  fileIds: Iterable<unknown>;
  concurrency?: number;
  timeoutMs?: number;
}): Promise<ChatgptImageUrlResolution[]> {
  const conversationKey = await readChatgptConversationKey(input.conversationId);
  if (!conversationKey) return [];
  return await resolveChatgptImageUrls({
    conversationKey,
    fileIds: input.fileIds,
    concurrency: input.concurrency,
    ...(input.timeoutMs == null ? null : { timeoutMs: input.timeoutMs }),
  });
}

export async function downloadChatgptImagesForStoredConversation(input: {
  conversationId: number;
  fileIds: Iterable<unknown>;
  concurrency?: number;
}): Promise<ChatgptImageDownloadResult[]> {
  const conversationKey = await readChatgptConversationKey(input.conversationId);
  if (!conversationKey) return [];
  return await downloadChatgptImages({
    conversationKey,
    fileIds: input.fileIds,
    concurrency: input.concurrency,
  });
}
