import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { ITEM_MENTION_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';
import { registerItemMentionHandlers } from '@services/integrations/item-mention/background-handlers';
import { LocalDataContractError } from '@services/local-data/contracts';

const readMocks = vi.hoisted(() => ({
  searchConversationMentionCandidates: vi.fn(),
  getConversationByReference: vi.fn(),
  getConversationDetail: vi.fn(),
}));

const chatwithMocks = vi.hoisted(() => ({
  formatConversationMarkdownForExternalOutput: vi.fn(),
}));

vi.mock('@services/integrations/chatwith/chatwith-settings', () => ({
  formatConversationMarkdownForExternalOutput: chatwithMocks.formatConversationMarkdownForExternalOutput,
}));

function createRouter() {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerItemMentionHandlers(router as any, {
    conversationReadRunner: {
      run: async ({ expectedFactsEpoch, read }: any) => {
        if (expectedFactsEpoch !== undefined && expectedFactsEpoch !== 'epoch-idb') {
          throw new LocalDataContractError('STALE_BACKEND_EPOCH');
        }
        return await read({ factsEpoch: 'epoch-idb', mode: 'idb', repository: readMocks });
      },
    },
  });
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  readMocks.searchConversationMentionCandidates.mockReset();
  readMocks.getConversationByReference.mockReset();
  readMocks.getConversationDetail.mockReset();
  chatwithMocks.formatConversationMarkdownForExternalOutput.mockReset();
});

describe('background-router item mention', () => {
  it('searches candidates and returns sorted+limited results', async () => {
    readMocks.searchConversationMentionCandidates.mockResolvedValue({
      candidates: [
        {
          conversationId: 1,
          title: 'b',
          source: 'chatgpt',
          conversationKey: 'b',
          url: 'https://b.com',
          domain: 'b.com',
          sourceType: 'chat',
          lastCapturedAt: 1,
        },
        {
          conversationId: 2,
          title: 'a',
          source: 'chatgpt',
          conversationKey: 'a',
          url: 'https://a.com',
          domain: 'a.com',
          sourceType: 'chat',
          lastCapturedAt: 2,
        },
      ],
      scannedCount: 2,
      truncatedByScanLimit: false,
    });

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES,
      query: '',
      limit: 1,
    });

    expect(res.ok).toBe(true);
    expect(res.data?.candidates?.length).toBe(1);
    expect(res.data?.scannedCount).toBe(2);
    expect(res.data?.candidates?.[0]).toMatchObject({ factsEpoch: 'epoch-idb', conversationKey: 'a' });
  });

  it('builds insert markdown via shared formatter', async () => {
    readMocks.getConversationByReference.mockResolvedValue({
      id: 123,
      source: 'chatgpt',
      conversationKey: 'k',
      title: 't',
      url: 'https://chatgpt.com/c/1',
      sourceType: 'chat',
      lastCapturedAt: Date.now(),
    });
    readMocks.getConversationDetail.mockResolvedValue({
      conversationId: 123,
      messages: [{ id: 1, conversationId: 123, messageKey: 'm1', role: 'user', contentText: 'hi' }],
    });
    chatwithMocks.formatConversationMarkdownForExternalOutput.mockResolvedValue('MARKDOWN');

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      source: 'chatgpt',
      conversationKey: 'k',
      factsEpoch: 'epoch-idb',
    });

    expect(res.ok).toBe(true);
    expect(res.data?.markdown).toBe('MARKDOWN');
    expect(res.data).toMatchObject({ source: 'chatgpt', conversationKey: 'k', factsEpoch: 'epoch-idb' });
    expect(chatwithMocks.formatConversationMarkdownForExternalOutput).toHaveBeenCalled();
  });

  it('rejects the removed numeric-only insert payload', async () => {
    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 'bad',
    });
    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('STALE_BACKEND_EPOCH');
  });

  it('rejects a missing current stable reference', async () => {
    readMocks.getConversationByReference.mockResolvedValue(null);

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      source: 'chatgpt',
      conversationKey: 'missing',
      factsEpoch: 'epoch-idb',
    });
    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('STALE_REFERENCE');
  });

  it('returns empty detail error when messages missing', async () => {
    readMocks.getConversationByReference.mockResolvedValue({
      id: 1,
      source: 'chatgpt',
      conversationKey: 'k',
      title: 't',
      url: 'https://chatgpt.com/c/1',
      sourceType: 'chat',
      lastCapturedAt: Date.now(),
    });
    readMocks.getConversationDetail.mockResolvedValue({ conversationId: 1, messages: [] });

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      source: 'chatgpt',
      conversationKey: 'k',
      factsEpoch: 'epoch-idb',
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe('conversation detail empty');
  });
});
