import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getMessagesByConversationId: vi.fn(),
  getConversationMessagesByKeys: vi.fn(),
  patchConversationMessageMarkdownBatch: vi.fn(),
  getConversationById: vi.fn(),
}));
const imageInlineMocks = vi.hoisted(() => ({
  inlineChatImagesInMessages: vi.fn(),
}));
const localSettingsMocks = vi.hoisted(() => ({ get: vi.fn() }));
const antiHotlinkMocks = vi.hoisted(() => ({ detect: vi.fn() }));
const chatgptImageMocks = vi.hoisted(() => ({
  downloadChatgptImagesForStoredConversation: vi.fn(),
}));

vi.mock('@services/conversations/data/storage-idb', () => storageMocks);
vi.mock('@services/conversations/data/image-inline', () => imageInlineMocks);
vi.mock('@services/integrations/chatgpt/conversation-image-assets', () => chatgptImageMocks);
vi.mock('@services/shared/storage', () => ({ storageGet: (...args: any[]) => localSettingsMocks.get(...args) }));
vi.mock('@platform/webext/anti-hotlink-rules-store', () => ({
  getAntiHotlinkRulesSnapshot: () => Promise.resolve([]),
  includesAnyAntiHotlinkDomain: (...args: any[]) => antiHotlinkMocks.detect(...args),
}));

import { backfillConversationImages } from '@services/conversations/background/image-backfill-job';

function inlineResult(messages: any[]) {
  return {
    messages,
    inlinedCount: 2,
    fromCacheCount: 1,
    downloadedCount: 1,
    inlinedBytes: 12,
    warningFlags: [],
  };
}

describe('image-backfill-job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.patchConversationMessageMarkdownBatch.mockResolvedValue({ updated: 0, conflicts: 0 });
    storageMocks.getConversationById.mockResolvedValue({ id: 42, sourceType: 'chat', source: 'chatgpt' });
    localSettingsMocks.get.mockResolvedValue({
      ai_chat_cache_images_enabled: true,
      web_article_cache_images_enabled: false,
    });
    antiHotlinkMocks.detect.mockReturnValue(false);
    chatgptImageMocks.downloadChatgptImagesForStoredConversation.mockResolvedValue([]);
  });

  it('uses the article cache preference independently of disabled AI image caching', async () => {
    storageMocks.getConversationById.mockResolvedValue({ id: 42, sourceType: 'article', source: 'web' });
    localSettingsMocks.get.mockResolvedValue({
      ai_chat_cache_images_enabled: false,
      web_article_cache_images_enabled: true,
    });
    const messages = [{ messageKey: 'article_body', contentMarkdown: '![image](https://example.com/a.png)' }];
    storageMocks.getMessagesByConversationId.mockResolvedValue(messages);
    imageInlineMocks.inlineChatImagesInMessages.mockResolvedValue(inlineResult(messages));

    await backfillConversationImages({ conversationId: 42 });

    expect(imageInlineMocks.inlineChatImagesInMessages).toHaveBeenCalledWith({
      conversationId: 42,
      messages,
      enableHttpImages: true,
      enableChatgptImages: false,
    });
    expect(chatgptImageMocks.downloadChatgptImagesForStoredConversation).not.toHaveBeenCalled();
  });

  it('keeps forced anti-hotlink article caching even with both preferences disabled', async () => {
    storageMocks.getConversationById.mockResolvedValue({ id: 42, sourceType: 'article', source: 'web' });
    localSettingsMocks.get.mockResolvedValue({
      ai_chat_cache_images_enabled: false,
      web_article_cache_images_enabled: false,
    });
    antiHotlinkMocks.detect.mockReturnValue(true);
    const messages = [{ messageKey: 'article_body', contentMarkdown: '![image](https://example.com/a.png)' }];
    storageMocks.getMessagesByConversationId.mockResolvedValue(messages);
    imageInlineMocks.inlineChatImagesInMessages.mockResolvedValue(inlineResult(messages));

    await backfillConversationImages({ conversationId: 42 });
    expect(imageInlineMocks.inlineChatImagesInMessages).toHaveBeenCalledWith({
      conversationId: 42,
      messages,
      enableHttpImages: true,
      enableChatgptImages: false,
    });
  });

  it('does not download chat image URLs with caching disabled, but can still inline local data images', async () => {
    localSettingsMocks.get.mockResolvedValue({
      ai_chat_cache_images_enabled: false,
      web_article_cache_images_enabled: false,
    });
    const messages = [{ messageKey: 'm1', contentMarkdown: '![data](data:image/png;base64,AQID)' }];
    storageMocks.getMessagesByConversationId.mockResolvedValue(messages);
    imageInlineMocks.inlineChatImagesInMessages.mockResolvedValue(inlineResult(messages));
    await backfillConversationImages({ conversationId: 42 });
    expect(imageInlineMocks.inlineChatImagesInMessages).toHaveBeenCalledWith({
      conversationId: 42,
      messages,
      enableHttpImages: false,
      enableChatgptImages: false,
    });
  });

  it('allows explicit manual image caching independent of per-site preferences', async () => {
    localSettingsMocks.get.mockResolvedValue({
      ai_chat_cache_images_enabled: false,
      web_article_cache_images_enabled: false,
    });
    const messages = [{ messageKey: 'm1', contentMarkdown: '![remote](https://example.com/a.png)' }];
    storageMocks.getMessagesByConversationId.mockResolvedValue(messages);
    imageInlineMocks.inlineChatImagesInMessages.mockResolvedValue(inlineResult(messages));
    await backfillConversationImages({ conversationId: 42, force: true });
    expect(imageInlineMocks.inlineChatImagesInMessages).toHaveBeenCalledWith({
      conversationId: 42,
      messages,
      enableHttpImages: true,
      enableChatgptImages: true,
      downloadChatgptImages: expect.any(Function),
    });
  });

  it('builds one conditional Markdown batch and reports only durably patched rows', async () => {
    storageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', contentMarkdown: 'before one', updatedAt: 10 },
      { messageKey: 'm2', contentMarkdown: 'before two', updatedAt: 20 },
    ]);
    imageInlineMocks.inlineChatImagesInMessages.mockImplementation(async (input: any) =>
      inlineResult([
        { ...input.messages[0], contentMarkdown: 'after one' },
        { ...input.messages[1], contentMarkdown: '' },
      ]),
    );
    storageMocks.patchConversationMessageMarkdownBatch.mockResolvedValue({ updated: 1, conflicts: 1 });

    const result = await backfillConversationImages({ conversationId: 42 });

    expect(imageInlineMocks.inlineChatImagesInMessages).toHaveBeenCalledWith({
      conversationId: 42,
      messages: expect.any(Array),
      enableHttpImages: true,
      enableChatgptImages: true,
      downloadChatgptImages: expect.any(Function),
    });
    expect(storageMocks.patchConversationMessageMarkdownBatch).toHaveBeenCalledTimes(1);
    expect(storageMocks.patchConversationMessageMarkdownBatch).toHaveBeenCalledWith(42, [
      { messageKey: 'm1', beforeMarkdown: 'before one', afterMarkdown: 'after one' },
      { messageKey: 'm2', beforeMarkdown: 'before two', afterMarkdown: '' },
    ]);
    expect(result).toMatchObject({
      scannedMessages: 2,
      updatedMessages: 1,
      inlinedCount: 2,
      fromCacheCount: 1,
      downloadedCount: 1,
      inlinedBytes: 12,
    });
  });

  it('does not call the patch mutation when inlining leaves Markdown unchanged', async () => {
    const messages = [
      { messageKey: 'm1', contentMarkdown: 'same' },
      { messageKey: 'm2', contentMarkdown: '' },
    ];
    storageMocks.getMessagesByConversationId.mockResolvedValue(messages);
    imageInlineMocks.inlineChatImagesInMessages.mockResolvedValue(inlineResult(messages));

    const result = await backfillConversationImages({ conversationId: 42 });

    expect(storageMocks.patchConversationMessageMarkdownBatch).not.toHaveBeenCalled();
    expect(result.updatedMessages).toBe(0);
  });

  it('delegates ChatGPT file downloads through the stored-conversation resolver', async () => {
    storageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', contentMarkdown: '![](chatgpt-file://file_image_1)' },
    ]);
    imageInlineMocks.inlineChatImagesInMessages.mockImplementation(async (input: any) => {
      await input.downloadChatgptImages(['file_image_1']);
      return inlineResult(input.messages);
    });

    await backfillConversationImages({ conversationId: 42 });

    expect(chatgptImageMocks.downloadChatgptImagesForStoredConversation).toHaveBeenCalledWith({
      conversationId: 42,
      fileIds: ['file_image_1'],
      concurrency: 4,
    });
  });

  it('repairs only specified message keys without scanning the historical conversation', async () => {
    storageMocks.getConversationMessagesByKeys.mockResolvedValue([
      { messageKey: 'new-image', contentMarkdown: '![](chatgpt-file://file_new)' },
    ]);
    imageInlineMocks.inlineChatImagesInMessages.mockImplementation(async (input: any) =>
      inlineResult([{ ...input.messages[0], contentMarkdown: '![](syncnos-asset://123)' }]),
    );
    const result = await backfillConversationImages({ conversationId: 42, messageKeys: ['new-image'] });
    expect(storageMocks.getConversationMessagesByKeys).toHaveBeenCalledWith(42, ['new-image']);
    expect(storageMocks.getMessagesByConversationId).not.toHaveBeenCalled();
    expect(storageMocks.patchConversationMessageMarkdownBatch).toHaveBeenCalledWith(42, [
      {
        messageKey: 'new-image',
        beforeMarkdown: '![](chatgpt-file://file_new)',
        afterMarkdown: '![](syncnos-asset://123)',
      },
    ]);
    expect(result.scannedMessages).toBe(1);
  });

  it('does not count conflict-only candidates as updated messages', async () => {
    storageMocks.getMessagesByConversationId.mockResolvedValue([{ messageKey: 'm1', contentMarkdown: 'before' }]);
    imageInlineMocks.inlineChatImagesInMessages.mockResolvedValue(
      inlineResult([{ messageKey: 'm1', contentMarkdown: 'after' }]),
    );
    storageMocks.patchConversationMessageMarkdownBatch.mockResolvedValue({ updated: 0, conflicts: 1 });

    const result = await backfillConversationImages({ conversationId: 42 });

    expect(storageMocks.patchConversationMessageMarkdownBatch).toHaveBeenCalledTimes(1);
    expect(result.updatedMessages).toBe(0);
    expect(result.conflicts).toBe(1);
  });

  it('drops a queued image task when its owning conversation has been deleted', async () => {
    storageMocks.getMessagesByConversationId.mockResolvedValue([]);
    storageMocks.getConversationById.mockResolvedValue(null);
    const result = await backfillConversationImages({ conversationId: 42 });
    expect(result).toMatchObject({ scannedMessages: 0, updatedMessages: 0, conflicts: 0 });
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
    expect(storageMocks.patchConversationMessageMarkdownBatch).not.toHaveBeenCalled();
  });
});
