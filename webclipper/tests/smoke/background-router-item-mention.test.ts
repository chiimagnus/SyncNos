import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { ITEM_MENTION_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';
import { registerItemMentionHandlers } from '@services/integrations/item-mention/background-handlers';

const storageMocks = vi.hoisted(() => ({
  searchConversationMentionCandidates: vi.fn(),
  getConversationById: vi.fn(),
  getConversationDetail: vi.fn(),
}));

const chatwithMocks = vi.hoisted(() => ({
  formatConversationMarkdownForExternalOutput: vi.fn(),
}));

vi.mock('@services/conversations/data/storage', () => ({
  searchConversationMentionCandidates: storageMocks.searchConversationMentionCandidates,
  getConversationById: storageMocks.getConversationById,
  getConversationDetail: storageMocks.getConversationDetail,
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
  registerItemMentionHandlers(router as any);
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.searchConversationMentionCandidates.mockReset();
  storageMocks.getConversationById.mockReset();
  storageMocks.getConversationDetail.mockReset();
  chatwithMocks.formatConversationMarkdownForExternalOutput.mockReset();
});

describe('background-router item mention', () => {
  it('searches candidates and returns sorted+limited results', async () => {
    storageMocks.searchConversationMentionCandidates.mockResolvedValue({
      candidates: [
        {
          conversationId: 1,
          title: 'b',
          source: 'chatgpt',
          url: 'https://b.com',
          domain: 'b.com',
          sourceType: 'chat',
          lastCapturedAt: 1,
        },
        {
          conversationId: 2,
          title: 'a',
          source: 'chatgpt',
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
  });

  it('builds insert markdown via shared formatter', async () => {
    storageMocks.getConversationById.mockResolvedValue({
      id: 123,
      source: 'chatgpt',
      conversationKey: 'k',
      title: 't',
      url: 'https://chatgpt.com/c/1',
      sourceType: 'chat',
      lastCapturedAt: Date.now(),
    });
    storageMocks.getConversationDetail.mockResolvedValue({
      conversationId: 123,
      messages: [{ id: 1, conversationId: 123, messageKey: 'm1', role: 'user', contentText: 'hi' }],
    });
    chatwithMocks.formatConversationMarkdownForExternalOutput.mockResolvedValue('MARKDOWN');

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 123,
    });

    expect(res.ok).toBe(true);
    expect(res.data?.markdown).toBe('MARKDOWN');
    expect(chatwithMocks.formatConversationMarkdownForExternalOutput).toHaveBeenCalled();
  });

  it('rejects invalid conversationId', async () => {
    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 'bad',
    });
    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('INVALID_ARGUMENT');
  });

  it('returns not found when conversation missing', async () => {
    storageMocks.getConversationById.mockResolvedValue(null);

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 999,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('NOT_FOUND');
  });

  it('returns empty detail error when messages missing', async () => {
    storageMocks.getConversationById.mockResolvedValue({
      id: 1,
      source: 'chatgpt',
      conversationKey: 'k',
      title: 't',
      url: 'https://chatgpt.com/c/1',
      sourceType: 'chat',
      lastCapturedAt: Date.now(),
    });
    storageMocks.getConversationDetail.mockResolvedValue({ conversationId: 1, messages: [] });

    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT,
      conversationId: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('EMPTY_DETAIL');
  });
});
