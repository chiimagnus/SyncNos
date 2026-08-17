import { describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationSearchHandlers } from '@services/conversations/background/search-handlers';
import { LocalDataContractError, type LocalDataSearchPage } from '@services/local-data/contracts';

const PAGE: LocalDataSearchPage = {
  cursor: { literal: 'Café 你好', token: 'opaque-next' },
  factsRevision: 7,
  facets: {
    sources: [{ key: 'chatgpt', label: 'chatgpt', count: 2 }],
    sites: [{ key: 'domain:example.test', label: 'example.test', count: 1 }],
  },
  hasMore: true,
  items: [
    {
      backendConversationId: 91,
      source: 'chatgpt',
      conversationKey: 'stable-key',
      sourceType: 'chat',
      title: 'Café result',
      url: 'https://example.test/thread',
      siteKey: 'domain:example.test',
      score: -1.2,
      lastCapturedAt: 123,
      snippet: 'A😀 Café 你好 result',
      highlights: [{ start: 4, end: 11 }],
    },
  ],
  truncatedByScanLimit: false,
};

function createRouter(input: { mode: 'active' | 'not_started' | 'transitional'; search?: ReturnType<typeof vi.fn> }) {
  const search = input.search ?? vi.fn(async () => PAGE);
  const idbTouch = vi.fn();
  const run = vi.fn(async ({ read }: any) => {
    if (input.mode === 'transitional') throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
    const mode = input.mode === 'active' ? 'native' : 'idb';
    const repository = mode === 'native' ? { searchConversations: search } : { getConversationListBootstrap: idbTouch };
    return await read({
      factsEpoch: mode === 'native' ? 'native:11111111-1111-4111-8111-111111111111' : 'idb-v1',
      mode,
      repository,
    });
  });
  const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
  registerConversationSearchHandlers(router as any, {
    factsGate: {
      journalSnapshot:
        input.mode === 'active'
          ? {
              mode: 'active',
              journal: {} as any,
              factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
              error: null,
            }
          : input.mode === 'not_started'
            ? { mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }
            : { mode: 'blocked', journal: null, factsEpoch: null, error: { code: 'MIGRATION_IN_PROGRESS' } as any },
    } as any,
    conversationReadRunner: { run } as any,
  });
  return { router, run, search, idbTouch };
}

describe('conversation search background handlers', () => {
  it('answers capability from the initialized gate snapshot without entering facts storage', async () => {
    const active = createRouter({ mode: 'active' });
    await expect(active.router.__handleMessageForTests({ type: 'getLocalSearchCapability' })).resolves.toMatchObject({
      ok: true,
      data: { searchable: true },
    });
    expect(active.run).not.toHaveBeenCalled();
    expect(active.search).not.toHaveBeenCalled();

    const inactive = createRouter({ mode: 'not_started' });
    await expect(inactive.router.__handleMessageForTests({ type: 'getLocalSearchCapability' })).resolves.toMatchObject({
      ok: true,
      data: { searchable: false },
    });
    expect(inactive.run).not.toHaveBeenCalled();
    expect(inactive.idbTouch).not.toHaveBeenCalled();
  });

  it('normalizes the raw literal in background and forwards only the typed active Native request', async () => {
    const ctx = createRouter({ mode: 'active' });
    const response = await ctx.router.__handleMessageForTests({
      type: 'searchConversations',
      requestId: 'search.1',
      query: '  Cafe\u0301\u00a0你好  ',
      sourceKey: 'chatgpt',
      siteKey: 'domain:example.test',
      sort: 'recent',
      limit: 25,
    });

    expect(response).toEqual({ ok: true, data: { requestId: 'search.1', page: PAGE }, error: null });
    expect(ctx.search).toHaveBeenCalledTimes(1);
    expect(ctx.search).toHaveBeenCalledWith({
      query: { literal: 'Café 你好', scalarCount: 7, mode: 'fts-phrase', ftsPhrase: '"Café 你好"' },
      sourceKey: 'chatgpt',
      siteKey: 'domain:example.test',
      sort: 'recent',
      limit: 25,
    });
  });

  it('rejects injected normalized/SQL fields before Native and never falls back to IDB', async () => {
    const active = createRouter({ mode: 'active' });
    const injected = await active.router.__handleMessageForTests({
      type: 'searchConversations',
      requestId: 'search.2',
      query: { literal: 'x', mode: 'fts-phrase', ftsPhrase: 'x*' },
      sql: 'DELETE FROM conversations',
    });
    expect(injected).toMatchObject({ ok: false, error: { extra: { code: 'INVALID_ARGUMENT' } } });
    expect(active.search).not.toHaveBeenCalled();

    const inactive = createRouter({ mode: 'not_started' });
    const response = await inactive.router.__handleMessageForTests({
      type: 'searchConversations',
      requestId: 'search.3',
      query: 'hello',
    });
    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'DATABASE_NOT_INITIALIZED' } } });
    expect(inactive.idbTouch).not.toHaveBeenCalled();
  });

  it('preserves migration, Host and stale-cursor errors without silent retry', async () => {
    const transitional = createRouter({ mode: 'transitional' });
    await expect(
      transitional.router.__handleMessageForTests({
        type: 'searchConversations',
        requestId: 'search.4',
        query: 'hello',
      }),
    ).resolves.toMatchObject({ ok: false, error: { extra: { code: 'MIGRATION_IN_PROGRESS' } } });

    const stale = createRouter({
      mode: 'active',
      search: vi.fn(async () => {
        throw new LocalDataContractError('STALE_SEARCH_CURSOR');
      }),
    });
    const response = await stale.router.__handleMessageForTests({
      type: 'searchConversations',
      requestId: 'search.5',
      query: 'hello',
      cursor: { literal: 'hello', token: 'old-page' },
    });
    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'STALE_SEARCH_CURSOR' } } });
    expect(stale.search).toHaveBeenCalledTimes(1);
  });
});
