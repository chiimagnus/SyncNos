import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';

const storageMocks = vi.hoisted(() => ({
  deleteConversationsByIds: vi.fn(),
  getConversationListBootstrap: vi.fn(),
  getConversationListPage: vi.fn(),
  findConversationBySourceAndKey: vi.fn(),
  findConversationById: vi.fn(),
  getConversationDetail: vi.fn(),
  mergeConversationsByIds: vi.fn(),
  syncConversationMessages: vi.fn(),
  upsertConversation: vi.fn(),
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

vi.mock('@services/conversations/data/storage', () => ({
  deleteConversationsByIds: storageMocks.deleteConversationsByIds,
  getConversationListBootstrap: storageMocks.getConversationListBootstrap,
  getConversationListPage: storageMocks.getConversationListPage,
  findConversationBySourceAndKey: storageMocks.findConversationBySourceAndKey,
  findConversationById: storageMocks.findConversationById,
  getConversationDetail: storageMocks.getConversationDetail,
  mergeConversationsByIds: storageMocks.mergeConversationsByIds,
  syncConversationMessages: storageMocks.syncConversationMessages,
  upsertConversation: storageMocks.upsertConversation,
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
  storageMocks.syncConversationMessages.mockReset();
  storageMocks.upsertConversation.mockReset();
  storageMocks.deleteConversationsByIds.mockReset();
  storageMocks.getConversationListBootstrap.mockReset();
  storageMocks.getConversationListPage.mockReset();
  storageMocks.findConversationBySourceAndKey.mockReset();
  storageMocks.findConversationById.mockReset();
  storageMocks.getConversationDetail.mockReset();
  storageMocks.mergeConversationsByIds.mockReset();
  localStorageMocks.storageGet.mockReset();
  imageInlineMocks.inlineChatImagesInMessages.mockReset();
  backfillJobMocks.backfillConversationImages.mockReset();
});

describe('background-router conversations', () => {
  it.each([
    [true, 'createConversation'],
    [false, 'upsertConversation'],
  ])('uses mutation __isNew=%s for the UPSERT response and auto-sync reason', async (__isNew, expectedReason) => {
    const onConversationChanged = vi.fn(async () => {});
    storageMocks.upsertConversation.mockResolvedValue({
      id: 321,
      source: 'chatgpt',
      conversationKey: 'k-321',
      __isNew,
    });
    const router = createRouter({ onConversationChanged });

    const res = await router.__handleMessageForTests({
      type: 'upsertConversation',
      payload: { source: 'chatgpt', conversationKey: 'k-321', title: 'Title' },
    });

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ id: 321, __isNew });
    expect(storageMocks.upsertConversation).toHaveBeenCalledTimes(1);
    expect(storageMocks.upsertConversation).toHaveBeenCalledWith({
      source: 'chatgpt',
      conversationKey: 'k-321',
      title: 'Title',
    });
    await Promise.resolve();
    expect(onConversationChanged).toHaveBeenCalledWith(321, expectedReason);
  });

  it('persists syncConversationMessages and emits the durable auto-sync change signal', async () => {
    const onConversationChanged = vi.fn(async () => {});
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });

    const router = createRouter({ onConversationChanged });

    const res = await router.__handleMessageForTests({
      type: 'syncConversationMessages',
      conversationId: 123,
      messages: [],
    });

    expect(res.ok).toBe(true);
    expect(storageMocks.syncConversationMessages).toHaveBeenCalledWith(123, [], {
      mode: 'snapshot',
      diff: null,
    });
    await Promise.resolve();
    expect(onConversationChanged).toHaveBeenCalledWith(123, 'syncConversationMessages');
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
    expect(storageMocks.syncConversationMessages).not.toHaveBeenCalled();
  });

  it('uses ai_chat_cache_images_enabled for chat source auto-save', async () => {
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
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
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
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
    expect(storageMocks.syncConversationMessages).toHaveBeenCalledWith(
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
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
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

  it('emits exactly one backfillImages signal after durable backfill changes', async () => {
    const onConversationChanged = vi.fn(async () => {});
    backfillJobMocks.backfillConversationImages.mockResolvedValue({
      scannedMessages: 2,
      updatedMessages: 2,
      inlinedCount: 2,
      fromCacheCount: 1,
      downloadedCount: 1,
      inlinedBytes: 2048,
      warningFlags: [],
    });

    const router = createRouter({ onConversationChanged });
    const res = await router.__handleMessageForTests({
      type: 'backfillConversationImages',
      conversationId: 888,
      conversationUrl: 'https://example.com/a',
    });

    expect(res.ok).toBe(true);
    expect(backfillJobMocks.backfillConversationImages).toHaveBeenCalledWith({
      conversationId: 888,
      conversationUrl: 'https://example.com/a',
    });
    await Promise.resolve();
    expect(onConversationChanged).toHaveBeenCalledTimes(1);
    expect(onConversationChanged).toHaveBeenCalledWith(888, 'backfillImages');
  });

  it('does not emit backfillImages for no-op or conflict-only durable results', async () => {
    const onConversationChanged = vi.fn(async () => {});
    backfillJobMocks.backfillConversationImages.mockResolvedValue({
      scannedMessages: 2,
      updatedMessages: 0,
      inlinedCount: 2,
      fromCacheCount: 1,
      downloadedCount: 1,
      inlinedBytes: 2048,
      warningFlags: [],
    });

    const router = createRouter({ onConversationChanged });
    const res = await router.__handleMessageForTests({
      type: 'backfillConversationImages',
      conversationId: 889,
      conversationUrl: 'https://example.com/b',
    });

    expect(res.ok).toBe(true);
    await Promise.resolve();
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('does not emit backfillImages when the backfill job fails', async () => {
    const onConversationChanged = vi.fn(async () => {});
    backfillJobMocks.backfillConversationImages.mockRejectedValue(new Error('conditional patch failed'));

    const router = createRouter({ onConversationChanged });
    const res = await router.__handleMessageForTests({
      type: 'backfillConversationImages',
      conversationId: 890,
      conversationUrl: 'https://example.com/c',
    });

    expect(res).toMatchObject({ ok: false, error: { message: 'conditional patch failed' } });
    await Promise.resolve();
    expect(onConversationChanged).not.toHaveBeenCalled();
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

  it('wakes durable remote cleanup after delete without enqueueing deleted ids', async () => {
    const onConversationChanged = vi.fn(async () => {});
    const onRemoteCleanupPending = vi.fn(async () => {});
    storageMocks.deleteConversationsByIds.mockResolvedValue({
      deletedConversations: 2,
      deletedMessages: 0,
      deletedMappings: 1,
    });

    const router = createRouter({ onConversationChanged, onRemoteCleanupPending });

    const res = await router.__handleMessageForTests({
      type: 'deleteConversations',
      conversationIds: [1, '2', 'bad', -1],
    });
    await Promise.resolve();

    expect(res.ok).toBe(true);
    expect(storageMocks.deleteConversationsByIds).toHaveBeenCalledWith([1, '2', 'bad', -1]);
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
