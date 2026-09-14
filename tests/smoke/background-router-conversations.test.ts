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
  scheduleImageBackfill?: ReturnType<typeof vi.fn>;
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
    scheduleImageBackfill: deps?.scheduleImageBackfill ?? vi.fn(async () => {}),
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

    const res = await router.dispatch({
      type: 'upsertConversation',
      payload: { source: 'chatgpt', conversationKey: 'k-321', title: 'Title', lastActivityAt: 100 },
    });

    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ id: 321, __isNew });
    expect(storageMocks.upsertConversation).toHaveBeenCalledTimes(1);
    expect(storageMocks.upsertConversation).toHaveBeenCalledWith({
      source: 'chatgpt',
      conversationKey: 'k-321',
      title: 'Title',
      lastActivityAt: 100,
    });
    await Promise.resolve();
    expect(onConversationChanged).toHaveBeenCalledWith(321, expectedReason);
  });

  it('does not auto-sync a capture preparation UPSERT even when the stored row already has positive activity', async () => {
    const onConversationChanged = vi.fn(async () => {});
    storageMocks.upsertConversation.mockResolvedValue({
      id: 321,
      source: 'chatgpt',
      conversationKey: 'k-321',
      lastActivityAt: 999,
      __isNew: false,
    });
    const router = createRouter({ onConversationChanged });

    const res = await router.dispatch({
      type: 'upsertConversation',
      payload: { source: 'chatgpt', conversationKey: 'k-321', lastActivityAt: 0 },
    });

    expect(res.ok).toBe(true);
    await Promise.resolve();
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('passes explicit capture activity through message persistence before auto-sync', async () => {
    const onConversationChanged = vi.fn(async () => {});
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    const router = createRouter({ onConversationChanged });

    const res = await router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 123,
      messages: [],
      activityAt: 456,
    });

    expect(res.ok).toBe(true);
    expect(storageMocks.syncConversationMessages).toHaveBeenCalledWith(123, [], {
      mode: 'snapshot',
      diff: null,
      activityAt: 456,
    });
    await Promise.resolve();
    expect(onConversationChanged).toHaveBeenCalledWith(123, 'syncConversationMessages');
  });

  it('rejects invalid explicit activity before message persistence', async () => {
    const router = createRouter();
    const res = await router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 123,
      messages: [],
      activityAt: 0,
    });
    expect(res).toMatchObject({ ok: false, error: { message: 'invalid activityAt' } });
    expect(storageMocks.syncConversationMessages).not.toHaveBeenCalled();
  });

  it('persists syncConversationMessages and emits the durable auto-sync change signal', async () => {
    const onConversationChanged = vi.fn(async () => {});
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });

    const router = createRouter({ onConversationChanged });

    const res = await router.dispatch({
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

    const res = await router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 123,
      mode: 'snapshop',
      messages: [{ messageKey: 'm1', contentMarkdown: 'unsafe' }],
    });

    expect(res).toMatchObject({ ok: false, error: { message: 'invalid mode' } });
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
    expect(storageMocks.syncConversationMessages).not.toHaveBeenCalled();
  });

  it('does not schedule AI chat image backfill when the saved messages contain no image references', async () => {
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    const scheduleImageBackfill = vi.fn(async () => {});
    const messages = [{ messageKey: 'm-1', contentMarkdown: 'plain text', role: 'assistant' }];
    const router = createRouter({ scheduleImageBackfill });

    const res = await router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 2001,
      conversationSourceType: 'chat',
      messages,
    });

    expect(res.ok).toBe(true);
    expect(scheduleImageBackfill).not.toHaveBeenCalled();
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
    expect(storageMocks.syncConversationMessages).toHaveBeenCalledWith(2001, messages, {
      mode: 'snapshot',
      diff: null,
    });
  });

  it('persists AI chat messages before durably enqueueing image backfill and never downloads in the save request', async () => {
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    let releaseSchedule: (() => void) | null = null;
    const scheduleImageBackfill = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSchedule = resolve;
        }),
    );
    const router = createRouter({ scheduleImageBackfill });
    const messages = [{ messageKey: 'm1', role: 'assistant', contentMarkdown: '![](chatgpt-file://file_image_1)' }];

    const pending = router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 2002,
      conversationSourceType: 'chat',
      messages,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(storageMocks.syncConversationMessages).toHaveBeenCalledWith(2002, messages, {
      mode: 'snapshot',
      diff: null,
    });
    expect(scheduleImageBackfill).toHaveBeenCalledWith(2002);
    expect(storageMocks.syncConversationMessages.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleImageBackfill.mock.invocationCallOrder[0]!,
    );
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
    expect(backfillJobMocks.backfillConversationImages).not.toHaveBeenCalled();

    releaseSchedule?.();
    await expect(pending).resolves.toMatchObject({ ok: true, data: { upserted: 1, deleted: 0 } });
  });

  it('keeps a successful AI chat save successful when durable image-backfill enqueue fails', async () => {
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    const scheduleImageBackfill = vi.fn(async () => {
      throw new Error('queue unavailable');
    });
    const router = createRouter({ scheduleImageBackfill });
    const messages = [{ messageKey: 'm1', role: 'assistant', contentMarkdown: '![](chatgpt-file://file_image_1)' }];

    const res = await router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 2004,
      conversationSourceType: 'chat',
      messages,
    });

    expect(storageMocks.syncConversationMessages).toHaveBeenCalledWith(2004, messages, {
      mode: 'snapshot',
      diff: null,
    });
    expect(scheduleImageBackfill).toHaveBeenCalledWith(2004);
    expect(res).toMatchObject({ ok: true, data: { upserted: 1, deleted: 0 } });
  });

  it('skips chat/article image inlining for Video transcript messages', async () => {
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    const router = createRouter();
    const messages = [
      {
        messageKey: 'video_transcript',
        role: 'transcript',
        contentMarkdown: '[00:01] ![caption](https://example.com/not-an-image.png)',
      },
    ];

    const res = await router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 2004,
      conversationSourceType: 'video',
      messages,
    });

    expect(res.ok).toBe(true);
    expect(localStorageMocks.storageGet).not.toHaveBeenCalled();
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
    expect(storageMocks.syncConversationMessages).toHaveBeenCalledWith(2004, messages, {
      mode: 'snapshot',
      diff: null,
    });
  });

  it('keeps transient protective policies through author normalization without blocking on chat image caching', async () => {
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    localStorageMocks.storageGet.mockResolvedValue({ ai_chat_cache_images_enabled: false });
    const router = createRouter();

    const res = await router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 2003,
      conversationSourceType: 'chat',
      mode: 'append',
      diff: { added: [], updated: ['m1'], removed: [] },
      messages: [
        {
          messageKey: 'm1',
          role: 'user',
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
          contentMarkdown: 'fallback\n\n![](data:image/png;base64,AQ==)',
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-markdown',
        }),
      ],
      { mode: 'append', diff: { added: [], updated: ['m1'], removed: [] } },
    );
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
  });

  it('uses web_article_cache_images_enabled for article source auto-save', async () => {
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    localStorageMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: true });

    const router = createRouter();

    const res = await router.dispatch({
      type: 'syncConversationMessages',
      conversationId: 2002,
      conversationSourceType: 'article',
      messages: [{ messageKey: 'm-1', contentMarkdown: '![img](https://example.com/b.png)' }],
    });

    expect(res.ok).toBe(true);
    expect(localStorageMocks.storageGet).toHaveBeenCalledWith(['web_article_cache_images_enabled']);
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
    const res = await router.dispatch({
      type: 'backfillConversationImages',
      conversationId: 888,
    });

    expect(res.ok).toBe(true);
    expect(backfillJobMocks.backfillConversationImages).toHaveBeenCalledWith({ conversationId: 888 });
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
    const res = await router.dispatch({
      type: 'backfillConversationImages',
      conversationId: 889,
    });

    expect(res.ok).toBe(true);
    await Promise.resolve();
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('does not emit backfillImages when the backfill job fails', async () => {
    const onConversationChanged = vi.fn(async () => {});
    backfillJobMocks.backfillConversationImages.mockRejectedValue(new Error('conditional patch failed'));

    const router = createRouter({ onConversationChanged });
    const res = await router.dispatch({
      type: 'backfillConversationImages',
      conversationId: 890,
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

    const res = await router.dispatch({
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

    const res = await router.dispatch({
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

    const res = await router.dispatch({
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

    const res = await router.dispatch({ type: 'deleteConversations', conversationIds: [999] });
    await Promise.resolve();

    expect(res.ok).toBe(true);
    expect(onRemoteCleanupPending).not.toHaveBeenCalled();
  });
});
