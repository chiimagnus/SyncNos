import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';

const storageMocks = vi.hoisted(() => ({
  deleteConversationsByIds: vi.fn(),
  findConversationBySourceAndKey: vi.fn(),
  getConversationById: vi.fn(),
  getConversationListBootstrap: vi.fn(),
  getConversationListPage: vi.fn(),
  getConversationDetail: vi.fn(),
  getConversationTailWindowBySourceAndKey: vi.fn(),
  mergeConversationsByIds: vi.fn(),
  searchConversations: vi.fn(),
  syncConversationMessages: vi.fn(),
  updateConversationUrlById: vi.fn(),
  upsertConversation: vi.fn(),
}));

vi.mock('@services/conversations/data/storage', () => ({
  deleteConversationsByIds: storageMocks.deleteConversationsByIds,
  findConversationBySourceAndKey: storageMocks.findConversationBySourceAndKey,
  getConversationById: storageMocks.getConversationById,
  getConversationListBootstrap: storageMocks.getConversationListBootstrap,
  getConversationListPage: storageMocks.getConversationListPage,
  getConversationDetail: storageMocks.getConversationDetail,
  getConversationTailWindowBySourceAndKey: storageMocks.getConversationTailWindowBySourceAndKey,
  mergeConversationsByIds: storageMocks.mergeConversationsByIds,
  searchConversations: storageMocks.searchConversations,
  syncConversationMessages: storageMocks.syncConversationMessages,
  updateConversationUrlById: storageMocks.updateConversationUrlById,
  upsertConversation: storageMocks.upsertConversation,
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
    onConversationChanged: async () => {},
    onRemoteCleanupPending: async () => {},
  });
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.deleteConversationsByIds.mockReset();
  storageMocks.findConversationBySourceAndKey.mockReset();
  storageMocks.getConversationById.mockReset();
  storageMocks.getConversationListBootstrap.mockReset();
  storageMocks.getConversationListPage.mockReset();
  storageMocks.getConversationDetail.mockReset();
  storageMocks.getConversationTailWindowBySourceAndKey.mockReset();
  storageMocks.mergeConversationsByIds.mockReset();
  storageMocks.searchConversations.mockReset();
  storageMocks.syncConversationMessages.mockReset();
  storageMocks.updateConversationUrlById.mockReset();
  storageMocks.upsertConversation.mockReset();
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

    const res = await router.dispatch({
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

  it.each([
    [{ lastActivityAt: 'bad', id: 1 }, 'non-finite Activity'],
    [{ lastActivityAt: -1, id: 1 }, 'negative Activity'],
    [{ lastActivityAt: 0, id: 1.5 }, 'fractional id'],
    [{ lastActivityAt: 0, id: 0 }, 'non-positive id'],
  ])('rejects page requests with invalid cursor shape: %s', async (cursor) => {
    const router = createRouter();
    const res = await router.dispatch({
      type: 'getConversationListPage',
      query: { sourceKey: 'all', siteKey: 'all', limit: 20 },
      cursor,
    });

    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe('invalid cursor');
    expect((res.error?.extra as any)?.code).toBe('INVALID_ARGUMENT');
    expect((res.error?.extra as any)?.field).toBe('cursor');
    expect(storageMocks.getConversationListPage).not.toHaveBeenCalled();
  });

  it('rejects by-loc lookup when source/conversationKey is invalid', async () => {
    const router = createRouter();
    const noSource = await router.dispatch({
      type: 'findConversationBySourceAndKey',
      source: '',
      conversationKey: 'abc',
    });
    expect(noSource.ok).toBe(false);
    expect(noSource.error?.message).toBe('invalid source');
    expect((noSource.error?.extra as any)?.field).toBe('source');

    const noKey = await router.dispatch({
      type: 'findConversationBySourceAndKey',
      source: 'chatgpt',
      conversationKey: '',
    });
    expect(noKey.ok).toBe(false);
    expect(noKey.error?.message).toBe('invalid conversationKey');
    expect((noKey.error?.extra as any)?.field).toBe('conversationKey');
  });

  it('returns canonical metadata on by-id lookup', async () => {
    storageMocks.getConversationById.mockResolvedValue({
      id: 99,
      source: 'chatgpt',
      conversationKey: 'k-99',
      lastActivityAt: 123,
      author: 'Author',
      publishedAt: '2026-08-29',
      warningFlags: ['partial'],
      notionPageId: 'notion-99',
      feishuDocId: 'feishu-99',
    });
    const router = createRouter();

    const res = await router.dispatch({
      type: 'findConversationById',
      conversationId: 99,
    });

    expect(res.ok).toBe(true);
    expect(storageMocks.getConversationById).toHaveBeenCalledWith(99);
    expect(res.data).toMatchObject({
      id: 99,
      conversationKey: 'k-99',
      author: 'Author',
      publishedAt: '2026-08-29',
      warningFlags: ['partial'],
      notionPageId: 'notion-99',
      feishuDocId: 'feishu-99',
    });
  });

  it('routes canonical URL updates and preserves stable storage error codes', async () => {
    storageMocks.updateConversationUrlById.mockResolvedValueOnce({
      conversationId: 7,
      url: 'https://example.com/new',
      source: 'web',
      conversationKey: 'article:https://example.com/new',
      changed: true,
      merged: false,
      removedConversationId: null,
    });
    const router = createRouter();
    const ok = await router.dispatch({
      type: 'updateConversationUrl',
      conversationId: 7,
      url: 'https://example.com/new#fragment',
      mergeExisting: false,
    });
    expect(ok).toMatchObject({ ok: true, data: { conversationId: 7, changed: true } });
    expect(storageMocks.updateConversationUrlById).toHaveBeenCalledWith({
      conversationId: 7,
      url: 'https://example.com/new#fragment',
      mergeExisting: false,
    });

    storageMocks.updateConversationUrlById.mockRejectedValueOnce(
      Object.assign(new Error('article URL already belongs to another conversation'), {
        code: 'conversation_url_conflict',
        extra: { conflictingConversationId: 9 },
      }),
    );
    const conflict = await router.dispatch({
      type: 'updateConversationUrl',
      conversationId: 7,
      url: 'https://example.com/target',
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: {
        message: 'article URL already belongs to another conversation',
        extra: { code: 'conversation_url_conflict', conflictingConversationId: 9 },
      },
    });
  });

  it('routes conversation search with normalized filters and bounded limit', async () => {
    storageMocks.searchConversations.mockResolvedValue([{ conversation: { id: 1 }, hit: { field: 'title' } }]);
    const router = createRouter();
    const res = await router.dispatch({
      type: 'searchConversations',
      query: '  Needle  ',
      sourceKey: 'WEB',
      siteKey: 'DOMAIN:Example.com',
      after: 10,
      before: 100,
      limit: 999,
    });

    expect(res.ok).toBe(true);
    expect(storageMocks.searchConversations).toHaveBeenCalledWith({
      query: 'Needle',
      sourceKey: 'web',
      siteKey: 'domain:example.com',
      after: 10,
      before: 100,
      limit: 100,
    });
  });

  it.each([
    [{ query: '' }, 'query', 'invalid query'],
    [{ query: 'x', limit: 0 }, 'limit', 'invalid limit'],
    [{ query: 'x', after: 'bad' }, 'after', 'invalid after'],
    [{ query: 'x', before: -1 }, 'before', 'invalid before'],
    [{ query: 'x', after: 100, before: 100 }, 'range', 'after must be earlier than before'],
  ])('rejects invalid conversation search input: %o', async (input, field, message) => {
    const router = createRouter();
    const res = await router.dispatch({ type: 'searchConversations', ...input });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe(message);
    expect((res.error?.extra as any)?.code).toBe('INVALID_ARGUMENT');
    expect((res.error?.extra as any)?.field).toBe(field);
    expect(storageMocks.searchConversations).not.toHaveBeenCalled();
  });

  it('rejects tail window lookup when source/conversationKey/limit are invalid', async () => {
    const router = createRouter();

    const noSource = await router.dispatch({
      type: 'getConversationTailWindowBySourceAndKey',
      source: '',
      conversationKey: 'abc',
    });
    expect(noSource.ok).toBe(false);
    expect(noSource.error?.message).toBe('invalid source');
    expect((noSource.error?.extra as any)?.field).toBe('source');

    const noKey = await router.dispatch({
      type: 'getConversationTailWindowBySourceAndKey',
      source: 'chatgpt',
      conversationKey: '',
    });
    expect(noKey.ok).toBe(false);
    expect(noKey.error?.message).toBe('invalid conversationKey');
    expect((noKey.error?.extra as any)?.field).toBe('conversationKey');

    const invalidLimit = await router.dispatch({
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
    storageMocks.getConversationTailWindowBySourceAndKey.mockResolvedValueOnce({
      conversation: { id: 9 },
      messages: [{ messageKey: 'm1' }],
    });
    storageMocks.getConversationTailWindowBySourceAndKey.mockResolvedValueOnce({
      conversation: null,
      messages: [],
    });
    const router = createRouter();

    const withLimit = await router.dispatch({
      type: 'getConversationTailWindowBySourceAndKey',
      source: 'chatgpt',
      conversationKey: 'k1',
      limit: 1000,
    });
    expect(withLimit.ok).toBe(true);
    expect(withLimit.data).toEqual({
      conversationId: 9,
      messages: [{ messageKey: 'm1' }],
    });
    expect(storageMocks.getConversationTailWindowBySourceAndKey).toHaveBeenNthCalledWith(1, 'chatgpt', 'k1', 200);

    const withoutLimit = await router.dispatch({
      type: 'getConversationTailWindowBySourceAndKey',
      source: 'chatgpt',
      conversationKey: 'k2',
    });
    expect(withoutLimit.ok).toBe(true);
    expect(withoutLimit.data).toEqual({
      conversationId: null,
      messages: [],
    });
    expect(storageMocks.getConversationTailWindowBySourceAndKey).toHaveBeenNthCalledWith(2, 'chatgpt', 'k2', 200);
  });
});
