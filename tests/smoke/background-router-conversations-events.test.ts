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

const backfillJobMocks = vi.hoisted(() => ({
  backfillConversationImages: vi.fn(),
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

vi.mock('@services/conversations/background/image-backfill-job', () => ({
  backfillConversationImages: backfillJobMocks.backfillConversationImages,
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

function createRouter(deps?: {
  onConversationChanged?: ReturnType<typeof vi.fn>;
  onRemoteCleanupPending?: ReturnType<typeof vi.fn>;
}) {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerConversationHandlers(router as any, {
    onConversationChanged: deps?.onConversationChanged ?? vi.fn(async () => {}),
    onRemoteCleanupPending: deps?.onRemoteCleanupPending ?? vi.fn(async () => {}),
  });
  return router;
}

beforeEach(() => {
  localStorageMocks.storageGet.mockResolvedValue({});
  imageInlineMocks.inlineChatImagesInMessages.mockImplementation(async (input: any) => {
    const messages = Array.isArray(input?.messages) ? input.messages : [];
    return makeInlineResult(messages);
  });
  backfillJobMocks.backfillConversationImages.mockResolvedValue({
    scannedMessages: 0,
    updatedMessages: 0,
    inlinedCount: 0,
    fromCacheCount: 0,
    downloadedCount: 0,
    inlinedBytes: 0,
    warningFlags: [],
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
  backfillJobMocks.backfillConversationImages.mockReset();
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
    expect(writeMocks.writeConversationMessagesSnapshot).toHaveBeenCalledWith(123, [], {
      mode: 'snapshot',
      diff: null,
    });
    expect(broadcast).toHaveBeenCalledWith('conversationsChanged', { reason: 'upsert', conversationId: 123 });
  });

  it('rejects an unknown non-empty persistence mode before image or storage work', async () => {
    const router = createRouter();

    const res = await router.__handleMessageForTests({
      type: 'syncConversationMessages',
      conversationId: 123,
      mode: 'snapshop',
      messages: [{ messageKey: 'm1', contentText: 'unsafe' }],
    });

    expect(res).toMatchObject({ ok: false, error: { message: 'invalid mode' } });
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
    expect(writeMocks.writeConversationMessagesSnapshot).not.toHaveBeenCalled();
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

  it('keeps transient protective policies through author normalization and image inlining', async () => {
    writeMocks.writeConversationMessagesSnapshot.mockResolvedValue({ upserted: 1, deleted: 0 });
    imageInlineMocks.inlineChatImagesInMessages.mockImplementation(async (input: any) =>
      makeInlineResult(
        input.messages.map((message: any) => ({
          ...message,
          contentMarkdown: 'fallback\n\n![](syncnos-asset://9)',
        })),
      ),
    );
    const router = createRouter();

    const res = await router.__handleMessageForTests({
      type: 'syncConversationMessages',
      conversationId: 2003,
      conversationSourceType: 'chat',
      conversationUrl: 'https://aistudio.google.com/app/1',
      mode: 'append',
      diff: { added: [], updated: ['m1'], removed: [] },
      messages: [
        {
          messageKey: 'm1',
          role: 'user',
          contentText: 'fallback',
          contentMarkdown: 'fallback\n\n![](data:image/png;base64,AQ==)',
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-markdown',
        },
      ],
    });

    expect(res.ok).toBe(true);
    expect(writeMocks.writeConversationMessagesSnapshot).toHaveBeenCalledWith(
      2003,
      [
        expect.objectContaining({
          messageKey: 'm1',
          authorName: 'You',
          contentMarkdown: 'fallback\n\n![](syncnos-asset://9)',
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-markdown',
        }),
      ],
      { mode: 'append', diff: { added: [], updated: ['m1'], removed: [] } },
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

  it('broadcasts incremental updates while backfillConversationImages is running', async () => {
    const broadcast = vi.fn();
    backfillJobMocks.backfillConversationImages.mockImplementation(async (input: any) => {
      await input?.onProgress?.({ updatedMessages: 1 });
      await input?.onProgress?.({ updatedMessages: 2 });
      return {
        scannedMessages: 2,
        updatedMessages: 2,
        inlinedCount: 2,
        fromCacheCount: 1,
        downloadedCount: 1,
        inlinedBytes: 2048,
        warningFlags: [],
      };
    });

    const router = createRouter();
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({
      type: 'backfillConversationImages',
      conversationId: 888,
      conversationUrl: 'https://example.com/a',
    });

    expect(res.ok).toBe(true);
    expect(backfillJobMocks.backfillConversationImages).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 888,
        conversationUrl: 'https://example.com/a',
      }),
    );
    expect(broadcast).toHaveBeenCalledTimes(3);
    expect(broadcast).toHaveBeenNthCalledWith(1, 'conversationsChanged', {
      reason: 'upsert',
      conversationId: 888,
    });
    expect(broadcast).toHaveBeenNthCalledWith(2, 'conversationsChanged', {
      reason: 'upsert',
      conversationId: 888,
    });
    expect(broadcast).toHaveBeenNthCalledWith(3, 'conversationsChanged', {
      reason: 'upsert',
      conversationId: 888,
    });
  });

  it('marks the kept conversation dirty and wakes remote cleanup after a real merge', async () => {
    const onConversationChanged = vi.fn(async () => {});
    const onRemoteCleanupPending = vi.fn(async () => {});
    storageMocks.mergeConversationsByIds.mockResolvedValue({
      keptConversationId: 10,
      removedConversationId: 11,
      movedMessages: 2,
      movedImageCache: 1,
      merged: true,
    });
    const router = createRouter({ onConversationChanged, onRemoteCleanupPending });

    const res = await router.__handleMessageForTests({
      type: 'mergeConversations',
      keepConversationId: 10,
      removeConversationId: 11,
    });
    await Promise.resolve();

    expect(res.ok).toBe(true);
    expect(onConversationChanged).toHaveBeenCalledWith(10, 'mergeConversation');
    expect(onRemoteCleanupPending).toHaveBeenCalledTimes(1);
    expect(onConversationChanged).not.toHaveBeenCalledWith(11, expect.anything());
  });

  it('does not emit dirty or cleanup signals when merge performs no local mutation', async () => {
    const onConversationChanged = vi.fn(async () => {});
    const onRemoteCleanupPending = vi.fn(async () => {});
    storageMocks.mergeConversationsByIds.mockResolvedValue({
      keptConversationId: 10,
      removedConversationId: 11,
      movedMessages: 0,
      movedImageCache: 0,
      merged: false,
    });
    const router = createRouter({ onConversationChanged, onRemoteCleanupPending });

    const res = await router.__handleMessageForTests({
      type: 'mergeConversations',
      keepConversationId: 10,
      removeConversationId: 11,
    });
    await Promise.resolve();

    expect(res.ok).toBe(true);
    expect(onConversationChanged).not.toHaveBeenCalled();
    expect(onRemoteCleanupPending).not.toHaveBeenCalled();
  });

  it('broadcasts delete and wakes durable remote cleanup without enqueueing deleted ids', async () => {
    const broadcast = vi.fn();
    const onConversationChanged = vi.fn(async () => {});
    const onRemoteCleanupPending = vi.fn(async () => {});
    storageMocks.deleteConversationsByIds.mockResolvedValue({
      deletedConversations: 2,
      deletedMessages: 0,
      deletedMappings: 1,
    });

    const router = createRouter({ onConversationChanged, onRemoteCleanupPending });
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({
      type: 'deleteConversations',
      conversationIds: [1, '2', 'bad', -1],
    });
    await Promise.resolve();

    expect(res.ok).toBe(true);
    expect(storageMocks.deleteConversationsByIds).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith('conversationsChanged', { reason: 'delete', conversationIds: [1, 2] });
    expect(onRemoteCleanupPending).toHaveBeenCalledTimes(1);
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('does not wake remote cleanup when delete removes no conversation', async () => {
    const onRemoteCleanupPending = vi.fn(async () => {});
    storageMocks.deleteConversationsByIds.mockResolvedValue({
      deletedConversations: 0,
      deletedMessages: 0,
      deletedMappings: 0,
    });
    const router = createRouter({ onRemoteCleanupPending });

    const res = await router.__handleMessageForTests({ type: 'deleteConversations', conversationIds: [999] });
    await Promise.resolve();

    expect(res.ok).toBe(true);
    expect(onRemoteCleanupPending).not.toHaveBeenCalled();
  });
});
