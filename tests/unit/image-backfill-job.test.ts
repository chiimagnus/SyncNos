import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getMessagesByConversationId: vi.fn(),
  patchConversationMessageMarkdownBatch: vi.fn(),
}));
const imageInlineMocks = vi.hoisted(() => ({
  inlineChatImagesInMessages: vi.fn(),
}));
const chatgptImageMocks = vi.hoisted(() => ({
  downloadChatgptImagesForStoredConversation: vi.fn(),
}));

vi.mock('@services/conversations/data/storage-idb', () => storageMocks);
vi.mock('@services/conversations/data/image-inline', () => imageInlineMocks);
vi.mock('@services/integrations/chatgpt/conversation-image-assets', () => chatgptImageMocks);

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
    chatgptImageMocks.downloadChatgptImagesForStoredConversation.mockResolvedValue([]);
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

  it('does not count conflict-only candidates as updated messages', async () => {
    storageMocks.getMessagesByConversationId.mockResolvedValue([{ messageKey: 'm1', contentMarkdown: 'before' }]);
    imageInlineMocks.inlineChatImagesInMessages.mockResolvedValue(
      inlineResult([{ messageKey: 'm1', contentMarkdown: 'after' }]),
    );
    storageMocks.patchConversationMessageMarkdownBatch.mockResolvedValue({ updated: 0, conflicts: 1 });

    const result = await backfillConversationImages({ conversationId: 42 });

    expect(storageMocks.patchConversationMessageMarkdownBatch).toHaveBeenCalledTimes(1);
    expect(result.updatedMessages).toBe(0);
  });
});
