import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoMocks = vi.hoisted(() => ({
  findConversationBySourceAndKey: vi.fn(),
  getConversationDetail: vi.fn(),
}));

vi.mock('@services/conversations/client/repo', () => repoMocks);

import { createConversationSearchClient } from '@services/conversations/client/search';

const page = {
  cursor: null,
  factsRevision: 9,
  facets: { sources: [], sites: [] },
  hasMore: false,
  items: [
    {
      backendConversationId: 999,
      source: 'chatgpt',
      conversationKey: 'stable-key',
      sourceType: 'chat',
      title: 'A result',
      url: '',
      siteKey: 'unknown',
      score: null,
      lastCapturedAt: 123,
      snippet: 'A😀B',
      highlights: [{ start: 1, end: 3 }],
    },
  ],
  truncatedByScanLimit: false,
};

beforeEach(() => {
  repoMocks.findConversationBySourceAndKey.mockReset();
  repoMocks.getConversationDetail.mockReset();
});

describe('conversation search client', () => {
  it('keeps the raw literal on the browser message and validates echoed request id plus structured page', async () => {
    const send = vi.fn(async (type: string, payload?: Record<string, unknown>) => {
      expect(type).toBe('searchConversations');
      expect(payload).toMatchObject({ requestId: 'req-1', query: ' Cafe\u0301 ', sort: 'best' });
      expect((payload as any).query).not.toHaveProperty?.('ftsPhrase');
      return { ok: true, data: { requestId: 'req-1', page }, error: null };
    });
    const client = createConversationSearchClient({ send });
    await expect(client.search({ requestId: 'req-1', query: ' Cafe\u0301 ', sort: 'best' })).resolves.toMatchObject({
      requestId: 'req-1',
      page: { factsRevision: 9, items: [{ source: 'chatgpt', conversationKey: 'stable-key' }] },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('surfaces retryable typed cursor failures instead of converting them to generic errors', async () => {
    const client = createConversationSearchClient({
      send: vi.fn(async () => ({
        ok: false,
        data: null,
        error: { message: 'changed', extra: { code: 'STALE_SEARCH_CURSOR' } },
      })),
    });
    await expect(client.search({ requestId: 'req-2', query: 'hello' })).rejects.toMatchObject({
      code: 'STALE_SEARCH_CURSOR',
    });
  });

  it('loads capability through the lightweight message', async () => {
    const send = vi.fn(async (type: string) => {
      expect(type).toBe('getLocalSearchCapability');
      return { ok: true, data: { searchable: false }, error: null };
    });
    await expect(createConversationSearchClient({ send }).getCapability()).resolves.toEqual({ searchable: false });
  });

  it('previews by stable source/key and ignores a stale numeric search id', async () => {
    repoMocks.findConversationBySourceAndKey.mockResolvedValue({
      id: 42,
      source: 'chatgpt',
      conversationKey: 'stable-key',
      factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
      lastCapturedAt: 1,
    });
    repoMocks.getConversationDetail.mockResolvedValue({
      conversationId: 42,
      source: 'chatgpt',
      conversationKey: 'stable-key',
      factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
      messages: [],
    });
    const client = createConversationSearchClient({ send: vi.fn() });
    await client.preview({ source: 'chatgpt', conversationKey: 'stable-key' });
    expect(repoMocks.findConversationBySourceAndKey).toHaveBeenCalledWith('chatgpt', 'stable-key');
    expect(repoMocks.getConversationDetail).toHaveBeenCalledWith({
      source: 'chatgpt',
      conversationKey: 'stable-key',
      factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
    });
  });
});
