import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationSearchHandlers } from '@services/conversations/background/search-handlers';
import {
  MAX_SEARCH_SNIPPET_BYTES,
  normalizeSearchQuery,
  type LocalDataSearchPage,
} from '@services/local-data/contracts';

import { createSqliteTestFixture } from '../../syncnoscli/sqlite-test-fixture';

const fixture = createSqliteTestFixture('syncnos-search-security-');

afterEach(fixture.cleanup);

function page(overrides: Partial<LocalDataSearchPage> = {}): LocalDataSearchPage {
  return {
    cursor: null,
    factsRevision: 1,
    facets: { sites: [], sources: [] },
    hasMore: false,
    items: [],
    truncatedByScanLimit: false,
    ...overrides,
  };
}

function activeRouter(search: ReturnType<typeof vi.fn>) {
  const run = vi.fn(
    async ({ read }: any) =>
      await read({
        factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
        mode: 'native',
        repository: { searchConversations: search },
      }),
  );
  const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
  registerConversationSearchHandlers(router as any, {
    factsGate: {
      journalSnapshot: {
        mode: 'active',
        journal: {} as any,
        factsEpoch: 'native:11111111-1111-4111-8111-111111111111',
        error: null,
      },
    } as any,
    conversationReadRunner: { run } as any,
  });
  return { router, run };
}

describe('conversation search security and budgets', () => {
  it('treats injection-looking input as one normalized literal and rejects raw grammar, SQL/path fields, and oversized pages', async () => {
    const search = vi.fn(async () => page());
    const { router } = activeRouter(search);
    const literal = 'x" OR 1=1 -- 😀';

    await expect(
      router.__handleMessageForTests({
        type: 'searchConversations',
        requestId: 'security.1',
        query: literal,
      }),
    ).resolves.toMatchObject({ ok: true, data: { requestId: 'security.1' } });
    expect(search).toHaveBeenCalledWith({ query: normalizeSearchQuery(literal) });

    for (const injected of [
      { query: literal, ftsPhrase: 'x*' },
      { query: literal, sql: 'SELECT * FROM conversations' },
      { query: literal, path: '/private/syncnos.sqlite' },
      { query: literal, html: '<mark>x</mark>' },
      { query: literal, limit: 51 },
    ]) {
      const response = await router.__handleMessageForTests({
        type: 'searchConversations',
        requestId: 'security.reject',
        ...injected,
      });
      expect(response).toMatchObject({ ok: false, error: { extra: { code: 'INVALID_ARGUMENT' } } });
    }
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('refuses an oversized ordinary browser response instead of forwarding a multi-megabyte search page', async () => {
    const hugeLabel = 'x'.repeat(4096);
    const search = vi.fn(async () =>
      page({
        facets: {
          sources: [],
          sites: Array.from({ length: 80 }, (_, index) => ({
            count: 1,
            key: `domain:${index}.example`,
            label: `${index}-${hugeLabel}`,
          })),
        },
      }),
    );
    const { router } = activeRouter(search);

    const response = await router.__handleMessageForTests({
      type: 'searchConversations',
      requestId: 'security.bytes',
      query: 'needle',
    });

    expect(response).toMatchObject({
      ok: false,
      error: {
        extra: {
          code: 'PAYLOAD_TOO_LARGE',
          diagnostics: { limitBytes: 256 * 1024 },
        },
      },
    });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('caps direct repository pages at 50 and bounds an FTS excerpt by UTF-8 bytes without breaking its highlight', async () => {
    const { conversations, handle, messages, search } = await fixture.open();
    try {
      for (let index = 0; index < 55; index += 1) {
        conversations.upsertConversation({
          conversationKey: `page-${index}`,
          lastCapturedAt: 1000 - index,
          source: 'chatgpt',
          sourceType: 'chat',
          title: `needle result ${index}`,
        });
      }
      const capped = search.searchConversations({ query: normalizeSearchQuery('needle'), limit: 200, sort: 'recent' });
      expect(capped.items).toHaveLength(50);
      expect(capped.hasMore).toBe(true);

      const large = conversations.upsertConversation({
        conversationKey: 'oversized-fts-token',
        lastCapturedAt: 2000,
        source: 'chatgpt',
        sourceType: 'chat',
        title: 'large excerpt fixture',
      });
      messages.syncConversationMessages(large.id, [
        {
          contentText: `${'😀'.repeat(3000)} giganticneedle ${'😀'.repeat(3000)}`,
          messageKey: 'large-token',
          role: 'assistant',
          sequence: 1,
          updatedAt: 2000,
        },
      ]);

      const result = search.searchConversations({ query: normalizeSearchQuery('giganticneedle') });
      expect(result.items).toHaveLength(1);
      const item = result.items[0]!;
      expect(Buffer.byteLength(item.snippet, 'utf8')).toBeLessThanOrEqual(MAX_SEARCH_SNIPPET_BYTES);
      expect(item.highlights).not.toHaveLength(0);
      const highlight = item.highlights[0]!;
      expect(item.snippet.slice(highlight.start, highlight.end)).toBe('giganticneedle');
      expect(item.snippet).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(item.snippet).not.toMatch(/^[\uDC00-\uDFFF]/u);
    } finally {
      handle.close();
    }
  });

  it('keeps the browser search path free of IDB full-scan, provider/OAuth, raw HTML, and network side effects', () => {
    const root = resolve(import.meta.dirname, '../../..');
    for (const relativePath of [
      'src/services/conversations/background/search-handlers.ts',
      'src/services/conversations/client/search.ts',
      'src/viewmodels/conversations/useConversationSearchSheet.ts',
      'packages/syncnoscli/src/sqlite/search.ts',
    ]) {
      const source = readFileSync(resolve(root, relativePath), 'utf8');
      expect(source).not.toMatch(
        /@platform\/idb|\/platform\/idb|oauth|notion|feishu|obsidian|dangerouslySetInnerHTML|\bfetch\s*\(/i,
      );
    }
  });
});
