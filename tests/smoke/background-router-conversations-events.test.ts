import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { LocalDataContractError } from '@services/local-data/contracts';

const localStorageMocks = vi.hoisted(() => ({ storageGet: vi.fn() }));
const imageInlineMocks = vi.hoisted(() => ({ inlineChatImagesInMessages: vi.fn() }));
const backfillJobMocks = vi.hoisted(() => ({ backfillConversationImages: vi.fn() }));

vi.mock('@platform/storage/local', () => ({ storageGet: localStorageMocks.storageGet }));
vi.mock('@services/conversations/data/image-inline', () => ({
  inlineChatImagesInMessages: imageInlineMocks.inlineChatImagesInMessages,
}));
vi.mock('@services/conversations/background/image-backfill-job', () => ({
  backfillConversationImages: backfillJobMocks.backfillConversationImages,
}));

const conversation = {
  id: 123,
  source: 'chatgpt',
  conversationKey: 'thread-123',
  sourceType: 'chat',
  title: 'Thread',
};

function createRepository() {
  return {
    getConversationByReference: vi.fn(async ({ source, conversationKey }: any) => {
      if (source !== conversation.source) return null;
      if (conversationKey === conversation.conversationKey) return conversation;
      if (conversationKey === 'thread-124') return { ...conversation, id: 124, conversationKey };
      return null;
    }),
    syncConversationMessages: vi.fn(async () => ({ upserted: 1, deleted: 0 })),
    deleteConversations: vi.fn(async () => ({
      deletedConversations: 1,
      deletedMessages: 0,
      deletedMappings: 0,
      deletedImageCache: 0,
    })),
    mergeConversations: vi.fn(async () => ({
      keptConversationId: 123,
      removedConversationId: 124,
      movedMessages: 0,
      movedImageCache: 0,
      merged: true,
    })),
    upsertConversation: vi.fn(async () => conversation),
  };
}

function createRouter(repository = createRepository(), onConversationChanged = vi.fn(async () => {})) {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerConversationHandlers(router as any, {
    conversationReadRunner: {
      run: async ({ expectedFactsEpoch, read }: any) => {
        if (expectedFactsEpoch !== undefined && expectedFactsEpoch !== 'idb-v1') {
          throw new LocalDataContractError('STALE_BACKEND_EPOCH');
        }
        return await read({ factsEpoch: 'idb-v1', mode: 'idb', repository });
      },
    },
    onConversationChanged,
    streamRouter: { register: () => {} },
  });
  return router;
}

beforeEach(() => {
  localStorageMocks.storageGet.mockResolvedValue({});
  imageInlineMocks.inlineChatImagesInMessages.mockImplementation(async (input: any) => ({
    messages: Array.isArray(input?.messages) ? input.messages : [],
    inlinedCount: 0,
    fromCacheCount: 0,
    downloadedCount: 0,
    inlinedBytes: 0,
    warningFlags: [],
  }));
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
  localStorageMocks.storageGet.mockReset();
  imageInlineMocks.inlineChatImagesInMessages.mockReset();
  backfillJobMocks.backfillConversationImages.mockReset();
});

describe('background-router conversations events', () => {
  it('resolves the stable capture identity before sync and broadcasts only after auto-sync is durable', async () => {
    const repository = createRepository();
    const events: string[] = [];
    const router = createRouter(repository, async () => {
      events.push('queue');
    });
    router.eventsHub.broadcast = () => events.push('broadcast');

    const res = await router.__handleMessageForTests({
      type: 'syncConversationMessages',
      source: conversation.source,
      conversationKey: conversation.conversationKey,
      messages: [{ messageKey: 'm-1', role: 'user', contentText: 'hello' }],
    });

    expect(res.ok).toBe(true);
    expect(repository.getConversationByReference).toHaveBeenCalledWith({
      source: conversation.source,
      conversationKey: conversation.conversationKey,
    });
    expect(repository.syncConversationMessages).toHaveBeenCalledWith(
      { source: conversation.source, conversationKey: conversation.conversationKey, conversationId: 123 },
      [expect.objectContaining({ messageKey: 'm-1', authorName: 'You' })],
      { mode: 'snapshot', diff: null },
    );
    expect(events).toEqual(['queue', 'broadcast']);
  });

  it('rejects an invalid sync mode before touching image or facts storage', async () => {
    const repository = createRepository();
    const router = createRouter(repository);

    const res = await router.__handleMessageForTests({
      type: 'syncConversationMessages',
      source: conversation.source,
      conversationKey: conversation.conversationKey,
      mode: 'snapshop',
      messages: [],
    });

    expect(res).toMatchObject({ ok: false, error: { extra: { code: 'INVALID_ARGUMENT' } } });
    expect(repository.getConversationByReference).not.toHaveBeenCalled();
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
    expect(repository.syncConversationMessages).not.toHaveBeenCalled();
  });

  it('uses stable references for delete and broadcasts the re-resolved local hint', async () => {
    const repository = createRepository();
    const broadcast = vi.fn();
    const router = createRouter(repository);
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({
      type: 'deleteConversations',
      factsEpoch: 'idb-v1',
      conversations: [{ source: conversation.source, conversationKey: conversation.conversationKey }],
    });

    expect(res.ok).toBe(true);
    expect(repository.deleteConversations).toHaveBeenCalledWith([
      { source: conversation.source, conversationKey: conversation.conversationKey, conversationId: 123 },
    ]);
    expect(broadcast).toHaveBeenCalledWith('conversationsChanged', { reason: 'delete', conversationIds: [123] });
  });

  it('queues the retained conversation before broadcasting a completed merge', async () => {
    const repository = createRepository();
    const events: string[] = [];
    const router = createRouter(repository, async (conversationId, reason) => {
      events.push(`queue:${conversationId}:${reason}`);
    });
    router.eventsHub.broadcast = () => events.push('broadcast');

    const res = await router.__handleMessageForTests({
      type: 'mergeConversations',
      factsEpoch: 'idb-v1',
      keep: { source: conversation.source, conversationKey: conversation.conversationKey },
      remove: { source: conversation.source, conversationKey: 'thread-124' },
    });

    expect(res.ok).toBe(true);
    expect(events).toEqual(['queue:123:upsertConversation', 'broadcast']);
  });

  it('does not enqueue or broadcast a no-op merge', async () => {
    const repository = createRepository();
    repository.mergeConversations.mockResolvedValue({
      keptConversationId: 123,
      removedConversationId: 123,
      movedMessages: 0,
      movedImageCache: 0,
      merged: false,
    });
    const events: string[] = [];
    const router = createRouter(repository, async () => events.push('queue'));
    router.eventsHub.broadcast = () => events.push('broadcast');

    const res = await router.__handleMessageForTests({
      type: 'mergeConversations',
      factsEpoch: 'idb-v1',
      keep: { source: conversation.source, conversationKey: conversation.conversationKey },
      remove: { source: conversation.source, conversationKey: conversation.conversationKey },
    });

    expect(res.ok).toBe(true);
    expect(events).toEqual([]);
  });

  it('does not emit backfill progress before the lease-bound job and queue complete', async () => {
    const repository = createRepository();
    const events: string[] = [];
    const router = createRouter(repository, async () => events.push('queue'));
    router.eventsHub.broadcast = () => events.push('broadcast');

    const res = await router.__handleMessageForTests({
      type: 'backfillConversationImages',
      factsEpoch: 'idb-v1',
      source: conversation.source,
      conversationKey: conversation.conversationKey,
      conversationUrl: 'https://chatgpt.com/c/thread-123',
    });

    expect(res.ok).toBe(true);
    expect(backfillJobMocks.backfillConversationImages).toHaveBeenCalledWith({
      conversationId: 123,
      conversationUrl: 'https://chatgpt.com/c/thread-123',
    });
    expect(events).toEqual(['queue', 'broadcast']);
  });
});
