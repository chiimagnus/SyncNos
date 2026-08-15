import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { LocalDataContractError } from '@services/local-data/contracts';

const storageMocks = vi.hoisted(() => ({
  deleteConversationsByIds: vi.fn(),
  hasConversation: vi.fn(),
  mergeConversationsByIds: vi.fn(),
}));

const readMocks = vi.hoisted(() => ({
  findConversationById: vi.fn(),
  findConversationBySourceAndKey: vi.fn(),
  getConversationByReference: vi.fn(),
  getConversationDetail: vi.fn(),
  getConversationListBootstrap: vi.fn(),
  getConversationListPage: vi.fn(),
  getConversationTailWindow: vi.fn(),
  searchConversationMentionCandidates: vi.fn(),
}));

const streamRouterMocks = vi.hoisted(() => ({ register: vi.fn() }));

const writeMocks = vi.hoisted(() => ({
  writeConversationMessagesSnapshot: vi.fn(),
  writeConversationSnapshot: vi.fn(),
}));

vi.mock('@services/conversations/data/storage', () => ({
  deleteConversationsByIds: storageMocks.deleteConversationsByIds,
  hasConversation: storageMocks.hasConversation,
  mergeConversationsByIds: storageMocks.mergeConversationsByIds,
}));

vi.mock('@services/conversations/data/write', () => ({
  writeConversationMessagesSnapshot: writeMocks.writeConversationMessagesSnapshot,
  writeConversationSnapshot: writeMocks.writeConversationSnapshot,
}));

function createRouter() {
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
        if (expectedFactsEpoch !== undefined && expectedFactsEpoch !== 'epoch-idb') {
          throw new LocalDataContractError('STALE_BACKEND_EPOCH');
        }
        return await read({ factsEpoch: 'epoch-idb', mode: 'idb', repository: readMocks });
      },
    },
    onConversationChanged: async () => {},
    streamRouter: streamRouterMocks,
  });
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.deleteConversationsByIds.mockReset();
  storageMocks.hasConversation.mockReset();
  storageMocks.mergeConversationsByIds.mockReset();
  readMocks.findConversationById.mockReset();
  readMocks.findConversationBySourceAndKey.mockReset();
  readMocks.getConversationByReference.mockReset();
  readMocks.getConversationDetail.mockReset();
  readMocks.getConversationListBootstrap.mockReset();
  readMocks.getConversationListPage.mockReset();
  readMocks.getConversationTailWindow.mockReset();
  readMocks.searchConversationMentionCandidates.mockReset();
  streamRouterMocks.register.mockReset();
  writeMocks.writeConversationMessagesSnapshot.mockReset();
  writeMocks.writeConversationSnapshot.mockReset();
});

describe('conversations pagination handlers', () => {
  it('routes bootstrap query to storage with normalized payload', async () => {
    readMocks.getConversationListBootstrap.mockResolvedValue({
      items: [],
      cursor: null,
      hasMore: false,
      summary: { totalCount: 0, todayCount: 0 },
      facets: { sources: [], sites: [] },
    });
    const router = createRouter();

    const res = await router.__handleMessageForTests({
      type: 'getConversationListBootstrap',
      query: { sourceKey: 'WEB', siteKey: 'DOMAIN:example.com' },
      limit: 25,
    });

    expect(res.ok).toBe(true);
    expect(readMocks.getConversationListBootstrap).toHaveBeenCalledWith(
      { sourceKey: 'web', siteKey: 'domain:example.com', limit: 25 },
      25,
    );
  });

  it('rejects page requests with invalid cursor shape', async () => {
    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: 'getConversationListPage',
      query: { sourceKey: 'all', siteKey: 'all', limit: 20 },
      cursor: { lastCapturedAt: 'bad', id: 1 },
    });

    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe('invalid cursor');
    expect((res.error?.extra as any)?.code).toBe('INVALID_ARGUMENT');
    expect((res.error?.extra as any)?.field).toBe('cursor');
  });

  it('rejects by-loc lookup when source/conversationKey is invalid', async () => {
    const router = createRouter();
    const noSource = await router.__handleMessageForTests({
      type: 'findConversationBySourceAndKey',
      source: '',
      conversationKey: 'abc',
    });
    expect(noSource.ok).toBe(false);
    expect(noSource.error?.message).toBe('invalid source');
    expect((noSource.error?.extra as any)?.field).toBe('source');

    const noKey = await router.__handleMessageForTests({
      type: 'findConversationBySourceAndKey',
      source: 'chatgpt',
      conversationKey: '',
    });
    expect(noKey.ok).toBe(false);
    expect(noKey.error?.message).toBe('invalid conversationKey');
    expect((noKey.error?.extra as any)?.field).toBe('conversationKey');
  });

  it('returns open target on by-id lookup', async () => {
    readMocks.findConversationById.mockResolvedValue({
      id: 99,
      source: 'chatgpt',
      conversationKey: 'k-99',
      lastCapturedAt: 123,
    });
    const router = createRouter();

    const res = await router.__handleMessageForTests({
      type: 'findConversationById',
      conversationId: 99,
    });

    expect(res.ok).toBe(true);
    expect(readMocks.findConversationById).toHaveBeenCalledWith(99);
    expect(res.data).toMatchObject({ id: 99, conversationKey: 'k-99', factsEpoch: 'epoch-idb' });
  });

  it('rejects tail window lookup when source/conversationKey/limit are invalid', async () => {
    const router = createRouter();

    const noSource = await router.__handleMessageForTests({
      type: 'getConversationTailWindowBySourceAndKey',
      source: '',
      conversationKey: 'abc',
    });
    expect(noSource.ok).toBe(false);
    expect(noSource.error?.message).toBe('invalid source');
    expect((noSource.error?.extra as any)?.field).toBe('source');

    const noKey = await router.__handleMessageForTests({
      type: 'getConversationTailWindowBySourceAndKey',
      source: 'chatgpt',
      conversationKey: '',
    });
    expect(noKey.ok).toBe(false);
    expect(noKey.error?.message).toBe('invalid conversationKey');
    expect((noKey.error?.extra as any)?.field).toBe('conversationKey');

    const invalidLimit = await router.__handleMessageForTests({
      type: 'getConversationTailWindowBySourceAndKey',
      source: 'chatgpt',
      conversationKey: 'abc',
      limit: 0,
    });
    expect(invalidLimit.ok).toBe(false);
    expect(invalidLimit.error?.message).toBe('invalid limit');
    expect((invalidLimit.error?.extra as any)?.field).toBe('limit');
    expect((invalidLimit.error?.extra as any)?.code).toBe('INVALID_ARGUMENT');
  });

  it('returns normalized tail window payload from storage', async () => {
    readMocks.getConversationTailWindow.mockResolvedValueOnce({
      conversationId: 9,
      messages: [{ messageKey: 'm1' }],
    });
    readMocks.getConversationTailWindow.mockResolvedValueOnce({
      conversationId: 10,
      messages: [],
    });
    const router = createRouter();

    const withLimit = await router.__handleMessageForTests({
      type: 'getConversationTailWindowBySourceAndKey',
      source: 'chatgpt',
      conversationKey: 'k1',
      limit: 1000,
    });
    expect(withLimit.ok).toBe(true);
    expect(withLimit.data).toEqual({
      conversationId: 9,
      messages: [{ messageKey: 'm1' }],
      source: 'chatgpt',
      conversationKey: 'k1',
      factsEpoch: 'epoch-idb',
    });
    expect(readMocks.getConversationTailWindow).toHaveBeenNthCalledWith(
      1,
      { source: 'chatgpt', conversationKey: 'k1' },
      200,
    );

    const withoutLimit = await router.__handleMessageForTests({
      type: 'getConversationTailWindowBySourceAndKey',
      source: 'chatgpt',
      conversationKey: 'k2',
    });
    expect(withoutLimit.ok).toBe(true);
    expect(withoutLimit.data).toEqual({
      conversationId: 10,
      messages: [],
      source: 'chatgpt',
      conversationKey: 'k2',
      factsEpoch: 'epoch-idb',
    });
    expect(readMocks.getConversationTailWindow).toHaveBeenNthCalledWith(
      2,
      { source: 'chatgpt', conversationKey: 'k2' },
      200,
    );
  });

  it('rejects an old list epoch before it reaches the selected backend', async () => {
    const router = createRouter();
    const res = await router.__handleMessageForTests({
      type: 'getConversationListPage',
      query: { sourceKey: 'all', siteKey: 'all' },
      cursor: { lastCapturedAt: 1, id: 1 },
      factsEpoch: 'epoch-before-migration',
    });

    expect(res.ok).toBe(false);
    expect((res.error?.extra as any)?.code).toBe('STALE_BACKEND_EPOCH');
    expect(readMocks.getConversationListPage).not.toHaveBeenCalled();
  });
});
