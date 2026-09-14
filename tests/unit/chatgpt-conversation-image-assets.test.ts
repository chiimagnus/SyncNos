import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({ getConversationById: vi.fn() }));
const assetMocks = vi.hoisted(() => ({
  resolveChatgptImageUrls: vi.fn(),
  downloadChatgptImages: vi.fn(),
}));

vi.mock('@services/conversations/data/storage-idb', () => storageMocks);
vi.mock('@services/integrations/chatgpt/api-image-assets', () => assetMocks);

import {
  downloadChatgptImagesForStoredConversation,
  resolveChatgptImageUrlsForStoredConversation,
} from '@services/integrations/chatgpt/conversation-image-assets';

describe('stored ChatGPT conversation image assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.getConversationById.mockResolvedValue({
      id: 7,
      source: 'chatgpt',
      conversationKey: 'conversation-7',
    });
    assetMocks.resolveChatgptImageUrls.mockResolvedValue([]);
    assetMocks.downloadChatgptImages.mockResolvedValue([]);
  });

  it('scopes resolver calls to the stored ChatGPT conversation key', async () => {
    await resolveChatgptImageUrlsForStoredConversation({
      conversationId: 7,
      fileIds: ['file_image_1'],
      concurrency: 4,
      timeoutMs: 15_000,
    });

    expect(storageMocks.getConversationById).toHaveBeenCalledWith(7);
    expect(assetMocks.resolveChatgptImageUrls).toHaveBeenCalledWith({
      conversationKey: 'conversation-7',
      fileIds: ['file_image_1'],
      concurrency: 4,
      timeoutMs: 15_000,
    });
  });

  it('scopes download calls to the stored ChatGPT conversation key', async () => {
    await downloadChatgptImagesForStoredConversation({
      conversationId: 7,
      fileIds: ['file_image_1'],
      concurrency: 3,
    });

    expect(assetMocks.downloadChatgptImages).toHaveBeenCalledWith({
      conversationKey: 'conversation-7',
      fileIds: ['file_image_1'],
      concurrency: 3,
    });
  });

  it('fails closed for invalid, missing, non-ChatGPT, or keyless stored conversations', async () => {
    await expect(
      resolveChatgptImageUrlsForStoredConversation({ conversationId: 0, fileIds: ['file_image_1'] }),
    ).resolves.toEqual([]);
    expect(storageMocks.getConversationById).not.toHaveBeenCalled();

    for (const conversation of [
      null,
      { id: 7, source: 'gemini', conversationKey: 'conversation-7' },
      { id: 7, source: 'chatgpt', conversationKey: '' },
    ]) {
      vi.clearAllMocks();
      storageMocks.getConversationById.mockResolvedValue(conversation);
      await expect(
        downloadChatgptImagesForStoredConversation({ conversationId: 7, fileIds: ['file_image_1'] }),
      ).resolves.toEqual([]);
      expect(assetMocks.downloadChatgptImages).not.toHaveBeenCalled();
    }
  });
});
