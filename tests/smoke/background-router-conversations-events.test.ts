import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { LocalDataContractError } from '@services/local-data/contracts';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

const localStorageMocks = vi.hoisted(() => ({ storageGet: vi.fn() }));
const imageInlineMocks = vi.hoisted(() => ({ inlineChatImagesInMessages: vi.fn() }));
const backfillJobMocks = vi.hoisted(() => ({ backfillConversationImages: vi.fn() }));
const articleUrlMocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('@platform/storage/local', () => ({ storageGet: localStorageMocks.storageGet }));
vi.mock('@services/conversations/data/image-inline', () => ({
  inlineChatImagesInMessages: imageInlineMocks.inlineChatImagesInMessages,
}));
vi.mock('@services/conversations/background/image-backfill-job', () => ({
  backfillConversationImages: backfillJobMocks.backfillConversationImages,
}));
vi.mock('@services/conversations/data/article-url-operation', () => ({
  createArticleUrlOperation: () => ({ update: articleUrlMocks.update }),
}));

const conversation = {
  id: 123,
  source: 'chatgpt',
  conversationKey: 'thread-123',
  sourceType: 'chat',
  title: 'Thread',
};

const articleConversation = {
  id: 201,
  source: 'web',
  conversationKey: 'article:https://example.com/from',
  sourceType: 'article',
  title: 'Article',
  url: 'https://example.com/from',
};

const articleConflict = {
  id: 202,
  source: 'web',
  conversationKey: 'article:https://example.com/to',
  sourceType: 'article',
  title: 'Target',
  url: 'https://example.com/to',
};

function createRepository() {
  return {
    getConversationByReference: vi.fn(async ({ source, conversationKey }: any) => {
      if (source === conversation.source && conversationKey === conversation.conversationKey) return conversation;
      if (source === articleConversation.source && conversationKey === articleConversation.conversationKey) {
        return articleConversation;
      }
      if (source === articleConflict.source && conversationKey === articleConflict.conversationKey)
        return articleConflict;
      return null;
    }),
    syncConversationMessages: vi.fn(async () => ({ upserted: 1, deleted: 0 })),
    deleteConversations: vi.fn(async () => ({
      deletedConversations: 1,
      deletedMessages: 0,
      deletedMappings: 0,
      deletedImageCache: 0,
    })),
    upsertConversation: vi.fn(async () => conversation),
  };
}

function createRouter(repository = createRepository(), onConversationChanged = vi.fn(async () => {})) {
  const gate = new FactsOperationGate({
    readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
  });
  const initialized = gate.initializeFromJournal();
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
        await initialized;
        if (expectedFactsEpoch !== undefined && expectedFactsEpoch !== 'idb-v1') {
          throw new LocalDataContractError('STALE_BACKEND_EPOCH');
        }
        return await gate.runFactsOperation(
          'background-router-events-test',
          async (lease) => await read({ factsEpoch: 'idb-v1', lease, mode: 'idb', repository }),
        );
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
    updatedMessageKeys: [],
    warningFlags: [],
  }));
  articleUrlMocks.update.mockResolvedValue({
    commentsUpdated: 0,
    conversation: {
      source: articleConversation.source,
      conversationKey: articleConflict.conversationKey,
      conversationId: articleConversation.id,
    },
    merged: false,
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
  localStorageMocks.storageGet.mockReset();
  imageInlineMocks.inlineChatImagesInMessages.mockReset();
  articleUrlMocks.update.mockReset();
  backfillJobMocks.backfillConversationImages.mockReset();
});

describe('background-router conversations events', () => {
  it('queues the updated stable article before broadcasting the compound URL commit', async () => {
    const repository = createRepository();
    const events: string[] = [];
    const router = createRouter(repository, async (reference, reason) => {
      events.push(`queue:${reference.source}:${reference.conversationKey}:${reason}`);
    });
    router.eventsHub.broadcast = () => events.push('broadcast');

    const res = await router.__handleMessageForTests({
      type: 'updateArticleUrl',
      factsEpoch: 'idb-v1',
      conversation: { source: articleConversation.source, conversationKey: articleConversation.conversationKey },
      fromCanonicalUrl: articleConversation.url,
      toCanonicalUrl: articleConflict.url,
    });

    expect(res.ok).toBe(true);
    expect(repository.getConversationByReference).toHaveBeenCalledWith({
      source: articleConversation.source,
      conversationKey: articleConversation.conversationKey,
    });
    expect(articleUrlMocks.update).toHaveBeenCalledWith({
      conversation: {
        source: articleConversation.source,
        conversationKey: articleConversation.conversationKey,
        conversationId: articleConversation.id,
      },
      fromCanonicalUrl: articleConversation.url,
      toCanonicalUrl: articleConflict.url,
    });
    expect(events).toEqual([
      `queue:${articleConversation.source}:${articleConflict.conversationKey}:upsertConversation`,
      'broadcast',
    ]);
  });

  it('does not queue or broadcast when the compound article URL operation rejects a stale conflict', async () => {
    const repository = createRepository();
    articleUrlMocks.update.mockRejectedValueOnce(new LocalDataContractError('STALE_REFERENCE'));
    const events: string[] = [];
    const router = createRouter(repository, async () => events.push('queue'));
    router.eventsHub.broadcast = () => events.push('broadcast');

    const res = await router.__handleMessageForTests({
      type: 'updateArticleUrl',
      factsEpoch: 'idb-v1',
      conversation: { source: articleConversation.source, conversationKey: articleConversation.conversationKey },
      fromCanonicalUrl: articleConversation.url,
      toCanonicalUrl: articleConflict.url,
    });

    expect(res).toMatchObject({ ok: false, error: { extra: { code: 'STALE_REFERENCE' } } });
    expect(events).toEqual([]);
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

  it('passes the confirmed stable conflict into the compound operation and broadcasts the retained target hint', async () => {
    const repository = createRepository();
    articleUrlMocks.update.mockResolvedValueOnce({
      commentsUpdated: 2,
      conversation: {
        source: articleConflict.source,
        conversationKey: articleConflict.conversationKey,
        conversationId: articleConflict.id,
      },
      merged: true,
      removedConversationId: articleConversation.id,
    });
    const events: string[] = [];
    const router = createRouter(repository, async (reference, reason) => {
      events.push(`queue:${reference.source}:${reference.conversationKey}:${reason}`);
    });
    const broadcast = vi.fn(() => events.push('broadcast'));
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({
      type: 'updateArticleUrl',
      factsEpoch: 'idb-v1',
      conversation: { source: articleConversation.source, conversationKey: articleConversation.conversationKey },
      confirmedConflict: { source: articleConflict.source, conversationKey: articleConflict.conversationKey },
      fromCanonicalUrl: articleConversation.url,
      toCanonicalUrl: articleConflict.url,
    });

    expect(res.ok).toBe(true);
    expect(articleUrlMocks.update).toHaveBeenCalledWith({
      conversation: {
        source: articleConversation.source,
        conversationKey: articleConversation.conversationKey,
        conversationId: articleConversation.id,
      },
      confirmedConflict: {
        source: articleConflict.source,
        conversationKey: articleConflict.conversationKey,
        conversationId: articleConflict.id,
      },
      fromCanonicalUrl: articleConversation.url,
      toCanonicalUrl: articleConflict.url,
    });
    expect(events).toEqual([
      `queue:${articleConflict.source}:${articleConflict.conversationKey}:upsertConversation`,
      'broadcast',
    ]);
    expect(broadcast).toHaveBeenCalledWith('conversationsChanged', {
      reason: 'articleUrlUpdated',
      conversationId: articleConflict.id,
      removedConversationId: articleConversation.id,
    });
  });

  it('does not enqueue or broadcast a canonical no-op URL update', async () => {
    const repository = createRepository();
    articleUrlMocks.update.mockResolvedValueOnce({
      commentsUpdated: 0,
      conversation: {
        source: articleConversation.source,
        conversationKey: articleConversation.conversationKey,
        conversationId: articleConversation.id,
      },
      merged: false,
    });
    const events: string[] = [];
    const router = createRouter(repository, async () => events.push('queue'));
    router.eventsHub.broadcast = () => events.push('broadcast');

    const res = await router.__handleMessageForTests({
      type: 'updateArticleUrl',
      factsEpoch: 'idb-v1',
      conversation: { source: articleConversation.source, conversationKey: articleConversation.conversationKey },
      fromCanonicalUrl: articleConversation.url,
      toCanonicalUrl: `${articleConversation.url}#fragment`,
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
    expect(backfillJobMocks.backfillConversationImages).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { source: conversation.source, conversationKey: conversation.conversationKey, conversationId: 123 },
        repository,
        imageStorage: expect.any(Object),
        conversationUrl: 'https://chatgpt.com/c/thread-123',
      }),
    );
    expect(events).toEqual(['queue', 'broadcast']);
  });
});
