import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import {
  createNativeConversationReadRepository,
  type ConversationFactsRepository,
} from '@services/conversations/data/storage-native';
import { FactsBackend } from '@services/local-data/facts-backend';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import { LocalDataContractError, serializedJsonUtf8ByteLength } from '@services/local-data/contracts';
import type { MigrationJournalSnapshot } from '@platform/local-data/migration-journal';

const backfillMocks = vi.hoisted(() => ({ backfillConversationImages: vi.fn() }));

vi.mock('@services/conversations/background/image-backfill-job', () => ({
  backfillConversationImages: backfillMocks.backfillConversationImages,
}));

const nativeEpoch = 'native:550e8400-e29b-41d4-a716-446655440000' as const;
const activeJournal = {
  mode: 'active',
  journal: {
    migrationId: '550e8400-e29b-41d4-a716-446655440000',
    stage: 'active',
  },
  factsEpoch: nativeEpoch,
  error: null,
} as unknown as MigrationJournalSnapshot;

const conversation = {
  id: 8,
  source: 'chatgpt',
  conversationKey: 'thread-8',
  sourceType: 'chat',
  title: 'Thread 8',
  url: 'https://chatgpt.com/c/thread-8',
  lastCapturedAt: 42,
};

const resolvedReference = {
  source: conversation.source,
  conversationKey: conversation.conversationKey,
  conversationId: conversation.id,
};

afterEach(() => {
  vi.restoreAllMocks();
  backfillMocks.backfillConversationImages.mockReset();
});

describe('native conversation mutation repository', () => {
  it('routes typed writes with only a re-resolved Host reference', async () => {
    const calls: Array<{ command: string; payload: any }> = [];
    const connectNative = vi.fn(async ({ command, payload }: any) => {
      calls.push({ command, payload });
      switch (command) {
        case 'UPSERT_CONVERSATION':
          return conversation;
        case 'DELETE_CONVERSATIONS':
          return { deletedConversations: 1, deletedMessages: 2, deletedMappings: 1, deletedImageCache: 3 };
        case 'MERGE_CONVERSATIONS':
          return {
            keptConversationId: 8,
            removedConversationId: 9,
            movedMessages: 2,
            movedImageCache: 1,
            merged: true,
          };
        case 'SYNC_CONVERSATION_MESSAGES':
          return { upserted: 1, deleted: 0 };
        case 'GET_SYNC_MAPPING':
          return {
            conversation,
            mapping: { source: conversation.source, conversationKey: conversation.conversationKey },
          };
        case 'PATCH_SYNC_MAPPING':
        case 'SET_SYNC_CURSOR':
        case 'SET_CONVERSATION_NOTION_PAGE_ID':
        case 'CLEAR_SYNC_MAPPING':
          return true;
        default:
          throw new Error(`unexpected ${command}`);
      }
    });
    const gate = new FactsOperationGate({
      readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
    });
    await gate.initializeFromJournal();

    await gate.runFactsOperation('native-write-routing', async (lease) => {
      const repository = createNativeConversationReadRepository(lease, {
        connectNative,
      }) as ConversationFactsRepository;
      const payload = { source: conversation.source, conversationKey: conversation.conversationKey, title: 'Updated' };
      await repository.upsertConversation(payload);
      await repository.deleteConversations([resolvedReference]);
      await repository.mergeConversations({
        keep: resolvedReference,
        remove: { ...resolvedReference, conversationId: 9 },
      });
      await repository.syncConversationMessages(
        resolvedReference,
        [{ messageKey: 'm-1', role: 'user', contentText: 'hello' }],
        { mode: 'append', diff: { added: ['m-1'], updated: [], removed: [] } },
      );
      await repository.getSyncMapping(resolvedReference, 'notion');
      await repository.patchSyncMapping(resolvedReference, 'notion', { feishuDocId: 'doc-1' });
      await repository.setSyncCursor(resolvedReference, { lastSyncedAt: 42 });
      await repository.setConversationNotionPageId(resolvedReference, 'page-1', {
        notionPageUrl: 'https://notion.so/page-1',
      });
      await repository.clearSyncMapping(resolvedReference, 'notion');
    });

    expect(calls.map((call) => call.command)).toEqual([
      'UPSERT_CONVERSATION',
      'DELETE_CONVERSATIONS',
      'MERGE_CONVERSATIONS',
      'SYNC_CONVERSATION_MESSAGES',
      'GET_SYNC_MAPPING',
      'PATCH_SYNC_MAPPING',
      'SET_SYNC_CURSOR',
      'SET_CONVERSATION_NOTION_PAGE_ID',
      'CLEAR_SYNC_MAPPING',
    ]);
    expect(calls[0].payload).toEqual({
      source: conversation.source,
      conversationKey: conversation.conversationKey,
      title: 'Updated',
    });
    expect(calls[1].payload).toEqual({
      conversations: [
        {
          source: conversation.source,
          conversationKey: conversation.conversationKey,
          backendConversationId: conversation.id,
        },
      ],
    });
    expect(calls[2].payload).toEqual({
      source: { source: conversation.source, conversationKey: conversation.conversationKey, backendConversationId: 9 },
      target: { source: conversation.source, conversationKey: conversation.conversationKey, backendConversationId: 8 },
    });
    expect(calls[3].payload).toMatchObject({
      conversation: {
        source: conversation.source,
        conversationKey: conversation.conversationKey,
        backendConversationId: 8,
      },
      transfer: { operation: 'capture-snapshot' },
    });
    expect(calls[3].payload.transfer.declaredTotalBytes).toBe(serializedJsonUtf8ByteLength(calls[3].payload.messages));
    for (const call of calls) expect(JSON.stringify(call.payload)).not.toContain('factsEpoch');
  });
});

describe('conversation mutation handlers', () => {
  function createRepository() {
    return {
      getConversationByReference: vi.fn(async ({ source, conversationKey }: any) =>
        source === conversation.source && conversationKey === conversation.conversationKey ? conversation : null,
      ),
      deleteConversations: vi.fn(async () => ({
        deletedConversations: 1,
        deletedMessages: 0,
        deletedMappings: 0,
        deletedImageCache: 0,
      })),
      mergeConversations: vi.fn(async () => ({
        keptConversationId: 8,
        removedConversationId: 9,
        movedMessages: 0,
        movedImageCache: 0,
        merged: true,
      })),
    };
  }

  function createRouter(repository = createRepository()) {
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerConversationHandlers(router as any, {
      conversationReadRunner: {
        run: async ({ expectedFactsEpoch, read }: any) => {
          if (expectedFactsEpoch !== undefined && expectedFactsEpoch !== nativeEpoch) {
            throw new LocalDataContractError('STALE_BACKEND_EPOCH');
          }
          return await read({ factsEpoch: nativeEpoch, mode: 'idb', repository });
        },
      },
      onConversationChanged: async () => {},
      streamRouter: { register: () => {} },
    });
    return router;
  }

  it('rejects stale epoch delete, merge, and backfill before any identity or facts side effect', async () => {
    const repository = createRepository();
    const router = createRouter(repository);
    const broadcast = vi.fn();
    router.eventsHub.broadcast = broadcast;

    for (const message of [
      {
        type: 'deleteConversations',
        factsEpoch: 'idb-v1',
        conversations: [{ source: conversation.source, conversationKey: conversation.conversationKey }],
      },
      {
        type: 'mergeConversations',
        factsEpoch: 'idb-v1',
        keep: { source: conversation.source, conversationKey: conversation.conversationKey },
        remove: { source: conversation.source, conversationKey: conversation.conversationKey },
      },
      {
        type: 'backfillConversationImages',
        factsEpoch: 'idb-v1',
        source: conversation.source,
        conversationKey: conversation.conversationKey,
      },
    ]) {
      await expect(router.__handleMessageForTests(message)).resolves.toMatchObject({
        ok: false,
        error: { extra: { code: 'STALE_BACKEND_EPOCH' } },
      });
    }

    expect(repository.getConversationByReference).not.toHaveBeenCalled();
    expect(repository.deleteConversations).not.toHaveBeenCalled();
    expect(repository.mergeConversations).not.toHaveBeenCalled();
    expect(backfillMocks.backfillConversationImages).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects stale mapping epochs before opening a facade and reaches the mapping only after refresh', async () => {
    const patchMapping = vi.fn(async () => true);
    const createNativeRepository = vi.fn(() => ({ patchSyncMapping: patchMapping }));
    const backend = new FactsBackend<any>({
      createIdbRepository: () => ({ patchSyncMapping }),
      createNativeRepository,
      readJournal: async () => activeJournal,
    });
    const gate = new FactsOperationGate({ readJournal: async () => activeJournal });
    await gate.initializeFromJournal();

    await gate.runFactsOperation('mapping-stale', async (lease) => {
      await expect(backend.open(lease, 'idb-v1')).rejects.toMatchObject({ code: 'STALE_BACKEND_EPOCH' });
      expect(createNativeRepository).not.toHaveBeenCalled();
      expect(patchMapping).not.toHaveBeenCalled();

      const { repository } = await backend.open(lease, nativeEpoch);
      await repository.patchSyncMapping();
    });

    expect(createNativeRepository).toHaveBeenCalledTimes(1);
    expect(patchMapping).toHaveBeenCalledTimes(1);
  });

  it('re-resolves the current identity before a refreshed delete', async () => {
    const repository = createRepository();
    const router = createRouter(repository);

    const response = await router.__handleMessageForTests({
      type: 'deleteConversations',
      factsEpoch: nativeEpoch,
      conversations: [{ source: conversation.source, conversationKey: conversation.conversationKey }],
    });

    expect(response.ok).toBe(true);
    expect(repository.deleteConversations).toHaveBeenCalledWith([resolvedReference]);
  });

  it('rejects a mismatched re-resolution before deleting a different record', async () => {
    const repository = createRepository();
    repository.getConversationByReference.mockResolvedValue({ ...conversation, conversationKey: 'replaced-thread' });
    const router = createRouter(repository);
    const broadcast = vi.fn();
    router.eventsHub.broadcast = broadcast;

    await expect(
      router.__handleMessageForTests({
        type: 'deleteConversations',
        factsEpoch: nativeEpoch,
        conversations: [{ source: conversation.source, conversationKey: conversation.conversationKey }],
      }),
    ).resolves.toMatchObject({ ok: false, error: { extra: { code: 'STALE_REFERENCE' } } });

    expect(repository.deleteConversations).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
