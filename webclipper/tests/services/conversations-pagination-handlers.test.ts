import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';

const storageMocks = vi.hoisted(() => ({
  deleteConversationsByIds: vi.fn(),
  findConversationById: vi.fn(),
  findConversationBySourceAndKey: vi.fn(),
  getConversationListBootstrap: vi.fn(),
  getConversationListPage: vi.fn(),
  getConversationDetail: vi.fn(),
  hasConversation: vi.fn(),
  mergeConversationsByIds: vi.fn(),
}));

const writeMocks = vi.hoisted(() => ({
  writeConversationMessagesSnapshot: vi.fn(),
  writeConversationSnapshot: vi.fn(),
}));

vi.mock('@services/conversations/data/storage', () => ({
  deleteConversationsByIds: storageMocks.deleteConversationsByIds,
  findConversationById: storageMocks.findConversationById,
  findConversationBySourceAndKey: storageMocks.findConversationBySourceAndKey,
  getConversationListBootstrap: storageMocks.getConversationListBootstrap,
  getConversationListPage: storageMocks.getConversationListPage,
  getConversationDetail: storageMocks.getConversationDetail,
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
  registerConversationHandlers(router as any);
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.deleteConversationsByIds.mockReset();
  storageMocks.findConversationById.mockReset();
  storageMocks.findConversationBySourceAndKey.mockReset();
  storageMocks.getConversationListBootstrap.mockReset();
  storageMocks.getConversationListPage.mockReset();
  storageMocks.getConversationDetail.mockReset();
  storageMocks.hasConversation.mockReset();
  storageMocks.mergeConversationsByIds.mockReset();
  writeMocks.writeConversationMessagesSnapshot.mockReset();
  writeMocks.writeConversationSnapshot.mockReset();
});

describe('conversations pagination handlers', () => {
  it('routes bootstrap query to storage with normalized payload', async () => {
    storageMocks.getConversationListBootstrap.mockResolvedValue({
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
    expect(storageMocks.getConversationListBootstrap).toHaveBeenCalledWith(
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
    storageMocks.findConversationById.mockResolvedValue({
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
    expect(storageMocks.findConversationById).toHaveBeenCalledWith(99);
    expect(res.data).toMatchObject({ id: 99, conversationKey: 'k-99' });
  });
});
