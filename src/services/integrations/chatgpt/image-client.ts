import { CHATGPT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { send } from '@platform/runtime/runtime';
import { normalizeChatgptFileId } from '@services/shared/chatgpt-image-identity';

const RESOLVE_BATCH_SIZE = 8;

export async function resolveChatgptImageUrlsForConversation(input: {
  conversationId: number;
  fileIds: Iterable<unknown>;
}): Promise<Map<string, string>> {
  const conversationId = Number(input.conversationId);
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return new Map();
  const fileIds = Array.from(new Set(Array.from(input.fileIds, normalizeChatgptFileId).filter(Boolean)));
  if (!fileIds.length) return new Map();

  const urls = new Map<string, string>();
  for (let offset = 0; offset < fileIds.length; offset += RESOLVE_BATCH_SIZE) {
    let response: { ok: boolean; data: unknown } | null = null;
    try {
      response = await send<{ ok: boolean; data: unknown }>(CHATGPT_MESSAGE_TYPES.RESOLVE_IMAGE_URLS, {
        conversationId,
        fileIds: fileIds.slice(offset, offset + RESOLVE_BATCH_SIZE),
      });
    } catch (_error) {
      continue;
    }
    if (!response?.ok || !Array.isArray(response.data)) continue;
    for (const item of response.data) {
      if (!item?.ok) continue;
      const fileId = normalizeChatgptFileId(item.fileId);
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (fileId && /^https:\/\//i.test(url)) urls.set(fileId, url);
    }
  }
  return urls;
}
