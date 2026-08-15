import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { ITEM_MENTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { registerItemMentionHandlers } from '@services/integrations/item-mention/background-handlers';
import { LocalDataContractError } from '@services/local-data/contracts';

const formatter = vi.hoisted(() => vi.fn());

vi.mock('@services/integrations/chatwith/chatwith-settings', () => ({
  formatConversationMarkdownForExternalOutput: formatter,
}));

const factsEpoch = 'native:550e8400-e29b-41d4-a716-446655440000';

function createRouter(repository: Record<string, unknown>) {
  const router = createBackgroundRouter({
    fallback: () => ({ ok: false, data: null, error: { message: 'unknown', extra: null } }),
  });
  registerItemMentionHandlers(router as any, {
    conversationReadRunner: {
      run: async ({ expectedFactsEpoch, read }: any) => {
        if (expectedFactsEpoch !== undefined && expectedFactsEpoch !== factsEpoch) {
          throw new LocalDataContractError('STALE_BACKEND_EPOCH');
        }
        return await read({ factsEpoch, mode: 'native', repository });
      },
    },
  });
  return router;
}

afterEach(() => {
  formatter.mockReset();
});

describe('item mention local-data routing', () => {
  it('returns candidates with the backend-issued epoch and inserts through a stable reference', async () => {
    const repository = {
      searchConversationMentionCandidates: vi.fn(async () => ({
        candidates: [
          {
            conversationId: 42,
            source: 'chatgpt',
            conversationKey: 'thread-42',
            title: 'Thread 42',
            url: 'https://chatgpt.com/c/thread-42',
            domain: 'chatgpt.com',
            sourceType: 'chat',
            lastCapturedAt: 42,
          },
        ],
        scannedCount: 1,
        truncatedByScanLimit: false,
      })),
      getConversationByReference: vi.fn(async () => ({
        id: 42,
        source: 'chatgpt',
        conversationKey: 'thread-42',
        title: 'Thread 42',
      })),
      getConversationDetail: vi.fn(async () => ({
        conversationId: 42,
        messages: [{ id: 1, conversationId: 42, messageKey: 'm1', role: 'user', contentText: 'hello' }],
      })),
    };
    formatter.mockResolvedValue('mention markdown');
    const router = createRouter(repository);

    const search = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES,
      query: 'thread',
    });
    expect(search).toMatchObject({
      ok: true,
      data: {
        factsEpoch,
        candidates: [
          {
            source: 'chatgpt',
            conversationKey: 'thread-42',
            factsEpoch,
          },
        ],
      },
    });

    const insert = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      source: 'chatgpt',
      conversationKey: 'thread-42',
      factsEpoch,
    });
    expect(insert).toMatchObject({
      ok: true,
      data: { source: 'chatgpt', conversationKey: 'thread-42', factsEpoch, markdown: 'mention markdown' },
    });
    expect(repository.getConversationByReference).toHaveBeenCalledWith({
      source: 'chatgpt',
      conversationKey: 'thread-42',
    });
    expect(repository.getConversationDetail).toHaveBeenCalledWith({ source: 'chatgpt', conversationKey: 'thread-42' });
  });

  it('rejects a stale candidate before resolving its current conversation', async () => {
    const repository = {
      getConversationByReference: vi.fn(),
      getConversationDetail: vi.fn(),
      searchConversationMentionCandidates: vi.fn(),
    };
    const router = createRouter(repository);

    const result = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      source: 'chatgpt',
      conversationKey: 'thread-42',
      factsEpoch: 'idb-v1',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.extra?.code).toBe('STALE_BACKEND_EPOCH');
    expect(repository.getConversationByReference).not.toHaveBeenCalled();
    expect(repository.getConversationDetail).not.toHaveBeenCalled();
  });
});
