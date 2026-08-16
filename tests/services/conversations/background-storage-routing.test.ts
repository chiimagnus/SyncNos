import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openConversationReadRepository: vi.fn(),
  createArticleCommentsRepository: vi.fn(),
  createImageStorage: vi.fn(),
}));

vi.mock('@services/conversations/data/storage', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, openConversationReadRepository: mocks.openConversationReadRepository };
});
vi.mock('@services/comments/data/storage', () => ({
  createArticleCommentsRepository: mocks.createArticleCommentsRepository,
}));
vi.mock('@services/conversations/data/image-storage', () => ({
  createImageStorage: mocks.createImageStorage,
}));

import { createBackgroundStorage } from '@services/conversations/background/storage';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

const reference = { source: 'chatgpt', conversationKey: 'thread-1' } as const;
const resolved = { ...reference, conversationId: 44 } as const;

function repository() {
  return {
    getConversationByReference: vi.fn(async ({ source, conversationKey }: any) =>
      source === reference.source && conversationKey === reference.conversationKey
        ? {
            id: resolved.conversationId,
            source: resolved.source,
            conversationKey: resolved.conversationKey,
            title: 'Thread',
          }
        : null,
    ),
    getConversationDetail: vi.fn(async () => ({ conversationId: 44, messages: [{ messageKey: 'm1' }] })),
    getSyncMapping: vi.fn(async () => ({ conversation: { ...resolved }, mapping: { notionPageId: 'page-1' } })),
    patchSyncMapping: vi.fn(async () => true),
    setConversationNotionPageId: vi.fn(async () => true),
    setSyncCursor: vi.fn(async () => true),
    clearSyncMapping: vi.fn(async () => true),
  };
}

describe('background provider storage routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createArticleCommentsRepository.mockReturnValue({
      list: vi.fn(async () => []),
      ensureContext: vi.fn(async () => ({ updated: 0 })),
    });
    mocks.createImageStorage.mockReturnValue({ getAsset: vi.fn(async () => null) });
  });

  it('binds provider facts, comments and images to the backend selected inside one lease', async () => {
    const repo = repository();
    mocks.openConversationReadRepository.mockResolvedValue({
      factsEpoch: 'native:epoch-1',
      mode: 'native',
      repository: repo,
    });
    const gate = new FactsOperationGate();
    gate.reopenForJournalState({
      mode: 'active',
      factsEpoch: 'native:epoch-1',
      journal: { stage: 'active' },
      error: null,
    } as any);

    await gate.runFactsOperation('provider-storage', async (lease) => {
      const storage = await createBackgroundStorage(lease, {
        provider: 'notion',
        expectedFactsEpoch: 'native:epoch-1',
      });
      await expect(storage.resolveConversation(reference)).resolves.toEqual(resolved);
      await expect(storage.getMessagesByConversation(resolved)).resolves.toEqual([{ messageKey: 'm1' }]);
      await storage.getSyncMappingByConversation(resolved);
    });

    expect(mocks.openConversationReadRepository).toHaveBeenCalledWith(expect.any(Object), 'native:epoch-1');
    expect(mocks.createArticleCommentsRepository).toHaveBeenCalledWith(expect.objectContaining({ mode: 'native' }));
    expect(mocks.createImageStorage).toHaveBeenCalledWith(expect.objectContaining({ mode: 'native' }));
    expect(repo.getSyncMapping).toHaveBeenCalledWith(resolved, 'notion');
  });

  it('rejects a persisted numeric hint after the same stable identity resolves to a replacement row', async () => {
    const repo = repository();
    mocks.openConversationReadRepository.mockResolvedValue({ factsEpoch: 'idb-v1', mode: 'idb', repository: repo });
    const gate = new FactsOperationGate();
    gate.reopenForJournalState({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null });

    await gate.runFactsOperation('replacement-row', async (lease) => {
      const storage = await createBackgroundStorage(lease, { provider: 'obsidian', expectedFactsEpoch: 'idb-v1' });
      await expect(storage.getMessagesByConversation({ ...reference, conversationId: 7 })).rejects.toMatchObject({
        code: 'STALE_REFERENCE',
      });
    });

    expect(repo.getConversationDetail).not.toHaveBeenCalled();
  });
});
