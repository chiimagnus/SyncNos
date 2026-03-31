import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';

const writeMocks = vi.hoisted(() => ({
  writeConversationMessagesSnapshot: vi.fn(),
  writeConversationSnapshot: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  deleteConversationsByIds: vi.fn(),
  getConversationListBootstrap: vi.fn(),
  getConversationListPage: vi.fn(),
  findConversationBySourceAndKey: vi.fn(),
  findConversationById: vi.fn(),
  getConversationDetail: vi.fn(),
  hasConversation: vi.fn(),
  mergeConversationsByIds: vi.fn(),
}));

const localStorageMocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
}));

const imageInlineMocks = vi.hoisted(() => ({
  inlineChatImagesInMessages: vi.fn(),
}));

vi.mock('@services/conversations/data/write', () => ({
  writeConversationMessagesSnapshot: writeMocks.writeConversationMessagesSnapshot,
  writeConversationSnapshot: writeMocks.writeConversationSnapshot,
}));

vi.mock('@services/conversations/data/storage', () => ({
  deleteConversationsByIds: storageMocks.deleteConversationsByIds,
  getConversationListBootstrap: storageMocks.getConversationListBootstrap,
  getConversationListPage: storageMocks.getConversationListPage,
  findConversationBySourceAndKey: storageMocks.findConversationBySourceAndKey,
  findConversationById: storageMocks.findConversationById,
  getConversationDetail: storageMocks.getConversationDetail,
  hasConversation: storageMocks.hasConversation,
  mergeConversationsByIds: storageMocks.mergeConversationsByIds,
}));

vi.mock('@platform/storage/local', () => ({
  storageGet: localStorageMocks.storageGet,
}));

vi.mock('@services/conversations/data/image-inline', () => ({
  inlineChatImagesInMessages: imageInlineMocks.inlineChatImagesInMessages,
}));

function makeInlineResult(messages: any[]) {
  return {
    messages,
    inlinedCount: 0,
    fromCacheCount: 0,
    downloadedCount: 0,
    inlinedBytes: 0,
    warningFlags: [],
  };
}

function createRouter() {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerConversationHandlers(router as any);
  return router;
}

beforeEach(() => {
  localStorageMocks.storageGet.mockResolvedValue({});
  imageInlineMocks.inlineChatImagesInMessages.mockImplementation(async (input: any) => {
    const messages = Array.isArray(input?.messages) ? input.messages : [];
    return makeInlineResult(messages);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  writeMocks.writeConversationMessagesSnapshot.mockReset();
  writeMocks.writeConversationSnapshot.mockReset();
  storageMocks.deleteConversationsByIds.mockReset();
  storageMocks.getConversationListBootstrap.mockReset();
  storageMocks.getConversationListPage.mockReset();
  storageMocks.findConversationBySourceAndKey.mockReset();
  storageMocks.findConversationById.mockReset();
  storageMocks.getConversationDetail.mockReset();
  storageMocks.hasConversation.mockReset();
  storageMocks.mergeConversationsByIds.mockReset();
  localStorageMocks.storageGet.mockReset();
  imageInlineMocks.inlineChatImagesInMessages.mockReset();
});

describe('background-router conversations events', () => {
  it('broadcasts conversationsChanged after syncConversationMessages', async () => {
    const broadcast = vi.fn();
    writeMocks.writeConversationMessagesSnapshot.mockResolvedValue({ upserted: 1, deleted: 0 });

    const router = createRouter();
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({
      type: 'syncConversationMessages',
      conversationId: 123,
      messages: [],
    });

    expect(res.ok).toBe(true);
    expect(writeMocks.writeConversationMessagesSnapshot).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith('conversationsChanged', { reason: 'upsert', conversationId: 123 });
  });

  it('uses ai_chat_cache_images_enabled for chat source auto-save', async () => {
    writeMocks.writeConversationMessagesSnapshot.mockResolvedValue({ upserted: 1, deleted: 0 });
    localStorageMocks.storageGet.mockImplementation(async (keys: string[]) => {
      if (Array.isArray(keys) && keys.includes('ai_chat_cache_images_enabled')) {
        return {
          ai_chat_cache_images_enabled: false,
          web_article_cache_images_enabled: true,
        };
      }
      return {};
    });

    const router = createRouter();

    const res = await router.__handleMessageForTests({
      type: 'syncConversationMessages',
      conversationId: 2001,
      conversationSourceType: 'chat',
      messages: [{ messageKey: 'm-1', contentMarkdown: '![img](https://example.com/a.png)' }],
    });

    expect(res.ok).toBe(true);
    expect(localStorageMocks.storageGet).toHaveBeenCalledWith([
      'ai_chat_cache_images_enabled',
      'web_article_cache_images_enabled',
    ]);
    expect(imageInlineMocks.inlineChatImagesInMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 2001,
        enableHttpImages: false,
      }),
    );
  });

  it('uses web_article_cache_images_enabled for article source auto-save', async () => {
    writeMocks.writeConversationMessagesSnapshot.mockResolvedValue({ upserted: 1, deleted: 0 });
    localStorageMocks.storageGet.mockImplementation(async (keys: string[]) => {
      if (Array.isArray(keys) && keys.includes('ai_chat_cache_images_enabled')) {
        return {
          ai_chat_cache_images_enabled: false,
          web_article_cache_images_enabled: true,
        };
      }
      return {};
    });

    const router = createRouter();

    const res = await router.__handleMessageForTests({
      type: 'syncConversationMessages',
      conversationId: 2002,
      conversationSourceType: 'article',
      messages: [{ messageKey: 'm-1', contentMarkdown: '![img](https://example.com/b.png)' }],
    });

    expect(res.ok).toBe(true);
    expect(localStorageMocks.storageGet).toHaveBeenCalledWith([
      'ai_chat_cache_images_enabled',
      'web_article_cache_images_enabled',
    ]);
    expect(imageInlineMocks.inlineChatImagesInMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 2002,
        enableHttpImages: true,
      }),
    );
  });

  it('broadcasts conversationsChanged after deleteConversations', async () => {
    const broadcast = vi.fn();
    storageMocks.deleteConversationsByIds.mockResolvedValue({
      deletedConversations: 2,
      deletedMessages: 0,
      deletedMappings: 0,
    });

    const router = createRouter();
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({
      type: 'deleteConversations',
      conversationIds: [1, '2', 'bad', -1],
    });

    expect(res.ok).toBe(true);
    expect(storageMocks.deleteConversationsByIds).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith('conversationsChanged', { reason: 'delete', conversationIds: [1, 2] });
  });
});
