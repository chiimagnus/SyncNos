import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LocalDataContractError,
  normalizeSearchQuery,
  type LocalDataSearchSort,
  type SearchCursorBinding,
} from '@services/local-data/contracts';

import { createConversationsRepository } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadWriteForHost } from '../../packages/syncnoscli/src/sqlite/database';
import { createMappingsRepository } from '../../packages/syncnoscli/src/sqlite/mappings-repository';
import { createMessagesRepository } from '../../packages/syncnoscli/src/sqlite/messages-repository';
import { readFactsRevision, runFactsTransaction } from '../../packages/syncnoscli/src/sqlite/revision';
import { createSearchRepository } from '../../packages/syncnoscli/src/sqlite/search';
import {
  getSqliteFtsCapability,
  migrateSqliteSchema,
  rebuildSqliteFtsIndexWithinFactsTransaction,
  SQLITE_FTS_TABLE_NAME,
} from '../../packages/syncnoscli/src/sqlite/schema';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];

async function openRepositories() {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-search-'));
  temporaryRoots.push(root);
  const paths = resolveSyncNosRuntimePaths({ homeDirectory: root });
  const handle = await openReadWriteForHost({ paths });
  return {
    conversations: createConversationsRepository(handle.database),
    database: handle.database,
    handle,
    mappings: createMappingsRepository(handle.database),
    messages: createMessagesRepository(handle.database),
    paths,
    search: createSearchRepository(handle.database),
  };
}

function expectLocalError(callback: () => unknown, code: LocalDataContractError['code']): void {
  let thrown: unknown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalDataContractError);
  expect((thrown as LocalDataContractError).code).toBe(code);
}

function search(
  repository: ReturnType<typeof createSearchRepository>,
  query: string,
  input: Readonly<{
    cursor?: SearchCursorBinding;
    limit?: number;
    siteKey?: string;
    sort?: LocalDataSearchSort;
    sourceKey?: string;
  }> = {},
) {
  return repository.searchConversations({ ...input, query: normalizeSearchQuery(query) });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SQLite search repository', () => {
  it('keeps FTS best/recent semantics, literal fallback, facets, and UTF-16 highlights deterministic', async () => {
    const { conversations, handle, messages, search: repository } = await openRepositories();
    try {
      const recentBody = conversations.upsertConversation({
        conversationKey: 'recent-body',
        lastCapturedAt: 300,
        source: 'chatgpt',
        sourceType: 'chat',
        title: 'Recent conversation',
      });
      messages.syncConversationMessages(recentBody.id, [
        {
          contentText: '😀 before keyword appears in this recent message. 你好世界',
          messageKey: 'recent-message',
          role: 'assistant',
          sequence: 1,
          updatedAt: 300,
        },
      ]);
      const titleMatch = conversations.upsertConversation({
        conversationKey: 'title-match',
        lastCapturedAt: 100,
        source: 'web',
        sourceType: 'article',
        title: 'keyword in a title',
        url: 'https://example.com/search',
      });
      messages.syncConversationMessages(titleMatch.id, [
        {
          contentText: 'unrelated content',
          messageKey: 'title-message',
          role: 'assistant',
          sequence: 1,
          updatedAt: 100,
        },
      ]);
      const otherSite = conversations.upsertConversation({
        conversationKey: 'other-site-match',
        lastCapturedAt: 50,
        source: 'web',
        sourceType: 'article',
        title: 'another site',
        url: 'https://second.example/search',
      });
      messages.syncConversationMessages(otherSite.id, [
        {
          contentText: 'keyword on another site',
          messageKey: 'other-site-message',
          role: 'assistant',
          sequence: 1,
          updatedAt: 50,
        },
      ]);

      const best = search(repository, 'keyword', { sort: 'best' });
      const recent = search(repository, 'keyword', { sort: 'recent' });
      expect(best.items[0]).toMatchObject({ source: 'web', title: 'keyword in a title' });
      expect(recent.items[0]).toMatchObject({ conversationKey: 'recent-body', score: null });
      expect(best.items[0]?.score).toEqual(expect.any(Number));
      expect(best.items[0]?.snippet).toContain('keyword');
      const highlighted = best.items[0]?.highlights[0];
      expect(highlighted).toBeDefined();
      expect(best.items[0]?.snippet.slice(highlighted!.start, highlighted!.end)).toBe('keyword');

      const webOnly = search(repository, 'keyword', { siteKey: 'domain:example.com', sourceKey: 'web' });
      expect(webOnly.items.map((item) => item.title)).toEqual(['keyword in a title']);
      expect(webOnly.facets.sources).toEqual([{ count: 1, key: 'web', label: 'web' }]);
      expect(webOnly.facets.sites).toEqual([
        { count: 1, key: 'domain:example.com', label: 'example.com' },
        { count: 1, key: 'domain:second.example', label: 'second.example' },
      ]);
      expect(search(repository, 'keyword', { sourceKey: 'web' }).facets.sources).toEqual([
        { count: 2, key: 'web', label: 'web' },
        { count: 1, key: 'chatgpt', label: 'chatgpt' },
      ]);

      const cjk = search(repository, '你好世', { sourceKey: 'chatgpt' });
      expect(cjk.items).toHaveLength(1);
      const cjkHighlight = cjk.items[0]?.highlights[0];
      expect(cjk.items[0]?.snippet.slice(cjkHighlight!.start, cjkHighlight!.end)).toBe('你好世');
      const emoji = search(repository, '😀', { siteKey: 'domain:example.com', sourceKey: 'chatgpt' });
      expect(emoji.items).toHaveLength(1);
      expect(
        emoji.items[0]?.snippet.slice(emoji.items[0]!.highlights[0]!.start, emoji.items[0]!.highlights[0]!.end),
      ).toBe('😀');
      expect(emoji.truncatedByScanLimit).toBe(false);
      expect(search(repository, '你好', { sourceKey: 'chatgpt' }).items).toHaveLength(1);

      expect(search(repository, 'keyword OR no-match')).toMatchObject({ items: [] });
    } finally {
      handle.close();
    }
  });

  it('binds cursors to stable sorting and rejects pages after another browser commits facts', async () => {
    const { conversations, handle, paths, search: repository } = await openRepositories();
    try {
      for (const [conversationKey, lastCapturedAt] of [
        ['page-one', 300],
        ['page-two', 200],
        ['page-three', 100],
      ] as const) {
        conversations.upsertConversation({
          conversationKey,
          lastCapturedAt,
          source: 'chatgpt',
          sourceType: 'chat',
          title: `common ${conversationKey}`,
        });
      }
      const first = search(repository, 'common', { limit: 1, sort: 'recent' });
      expect(first.cursor).not.toBeNull();
      const second = repository.searchConversations({
        cursor: first.cursor!,
        limit: 1,
        query: normalizeSearchQuery('common'),
        sort: 'recent',
      });
      expect(second.factsRevision).toBe(first.factsRevision);
      expect(second.items.map((item) => item.conversationKey)).toEqual(['page-two']);
      const bestFirst = search(repository, 'common', { limit: 1, sort: 'best' });
      expect(bestFirst.cursor).not.toBeNull();
      const bestSecond = repository.searchConversations({
        cursor: bestFirst.cursor!,
        limit: 1,
        query: normalizeSearchQuery('common'),
        sort: 'best',
      });
      expect(bestSecond.items).toHaveLength(1);
      expect(bestSecond.items[0]?.conversationKey).not.toBe(bestFirst.items[0]?.conversationKey);
      expectLocalError(
        () =>
          repository.searchConversations({
            cursor: first.cursor!,
            limit: 1,
            query: normalizeSearchQuery('common'),
            sort: 'best',
          }),
        'STALE_SEARCH_CURSOR',
      );

      const secondBrowser = await openReadWriteForHost({ paths });
      try {
        createConversationsRepository(secondBrowser.database).upsertConversation({
          conversationKey: 'page-four',
          lastCapturedAt: 400,
          source: 'chatgpt',
          sourceType: 'chat',
          title: 'common page-four',
        });
      } finally {
        secondBrowser.close();
      }
      expectLocalError(
        () =>
          repository.searchConversations({
            cursor: first.cursor!,
            limit: 1,
            query: normalizeSearchQuery('common'),
            sort: 'recent',
          }),
        'STALE_SEARCH_CURSOR',
      );
    } finally {
      handle.close();
    }
  });

  it('uses distinct fallback ranking, cursor tuples, and per-conversation derived updates', async () => {
    const { conversations, handle, messages, search: repository } = await openRepositories();
    try {
      const recentBody = conversations.upsertConversation({
        conversationKey: 'fallback-recent-body',
        lastCapturedAt: 300,
        source: 'chatgpt',
        sourceType: 'chat',
        title: 'plain title',
      });
      messages.syncConversationMessages(recentBody.id, [
        { contentText: 'xy in body', messageKey: 'm1', role: 'assistant', sequence: 1, updatedAt: 1 },
      ]);
      const olderTitle = conversations.upsertConversation({
        conversationKey: 'fallback-title-hit',
        lastCapturedAt: 100,
        source: 'chatgpt',
        sourceType: 'chat',
        title: 'xy in title',
      });
      const best = search(repository, 'xy', { limit: 1, sort: 'best' });
      const recent = search(repository, 'xy', { limit: 1, sort: 'recent' });
      expect(best.items.map((item) => item.conversationKey)).toEqual(['fallback-title-hit']);
      expect(recent.items.map((item) => item.conversationKey)).toEqual(['fallback-recent-body']);
      expect(best.cursor).not.toBeNull();
      expect(
        repository.searchConversations({ cursor: best.cursor!, query: normalizeSearchQuery('xy'), sort: 'best' }).items,
      ).toMatchObject([{ conversationKey: 'fallback-recent-body' }]);
      expectLocalError(
        () =>
          repository.searchConversations({
            cursor: best.cursor!,
            query: normalizeSearchQuery('xy'),
            sort: 'best',
            sourceKey: 'web',
          }),
        'STALE_SEARCH_CURSOR',
      );

      messages.syncConversationMessages(recentBody.id, [
        { contentText: 'replacement body', messageKey: 'm1', role: 'assistant', sequence: 1, updatedAt: 2 },
      ]);
      expect(search(repository, 'xy', { sort: 'recent' }).items.map((item) => item.conversationKey)).toEqual([
        'fallback-title-hit',
      ]);
      conversations.deleteConversationsByIds([olderTitle.id]);
      expect(search(repository, 'xy', { sort: 'best' }).items).toEqual([]);
    } finally {
      handle.close();
    }
  });

  it('keeps one- and two-scalar fallback searches inside the fixed recent candidate cap', async () => {
    const { database, handle, search: repository } = await openRepositories();
    try {
      runFactsTransaction(database, () => {
        const insert = database.prepare(
          `INSERT INTO conversations (
             source, conversation_key, source_type, title, url, author, published_at, list_source_key, list_site_key,
             last_captured_at, notion_page_id, feishu_doc_id, payload_json
           ) VALUES (?, ?, 'chat', ?, '', '', '', 'chatgpt', 'unknown', ?, '', '', ?)`,
        );
        for (let index = 0; index <= 500; index += 1) {
          insert.run('chatgpt', `fallback-${index}`, index === 500 ? 'x' : 'aaaa', 1_000 - index, '{}');
        }
        rebuildSqliteFtsIndexWithinFactsTransaction(database);
      });

      const result = search(repository, 'x', { sort: 'recent' });
      expect(result.items).toEqual([]);
      expect(result.truncatedByScanLimit).toBe(true);
    } finally {
      handle.close();
    }
  });

  it('keeps literal-fallback facets scoped and drops a non-web site filter', async () => {
    const { conversations, handle, search: repository } = await openRepositories();
    try {
      conversations.upsertConversation({
        conversationKey: 'fallback-chat',
        lastCapturedAt: 3,
        source: 'chatgpt',
        sourceType: 'chat',
        title: 'needle chat',
      });
      conversations.upsertConversation({
        conversationKey: 'fallback-web-one',
        lastCapturedAt: 2,
        source: 'web',
        sourceType: 'article',
        title: 'needle web one',
        url: 'https://one.example/article',
      });
      conversations.upsertConversation({
        conversationKey: 'fallback-web-two',
        lastCapturedAt: 1,
        source: 'web',
        sourceType: 'article',
        title: 'needle web two',
        url: 'https://two.example/article',
      });

      const scoped = search(repository, 'ne', { siteKey: 'domain:one.example', sourceKey: 'web' });
      expect(scoped.items.map((item) => item.title)).toEqual(['needle web one']);
      expect(scoped.facets.sources).toEqual([{ count: 1, key: 'web', label: 'web' }]);
      expect(scoped.facets.sites).toEqual([
        { count: 1, key: 'domain:one.example', label: 'one.example' },
        { count: 1, key: 'domain:two.example', label: 'two.example' },
      ]);

      const chat = search(repository, 'ne', { siteKey: 'domain:one.example', sourceKey: 'chatgpt' });
      expect(chat.items.map((item) => item.title)).toEqual(['needle chat']);
      expect(chat.facets.sites).toEqual([{ count: 1, key: 'unknown', label: 'unknown' }]);
    } finally {
      handle.close();
    }
  });

  it('rebuilds derived docs on an authorized migration and contains FTS-local failures without losing facts', async () => {
    const { conversations, database, handle, mappings, messages, search: repository } = await openRepositories();
    try {
      const first = conversations.upsertConversation({
        conversationKey: 'needs-rebuild',
        lastCapturedAt: 1,
        source: 'chatgpt',
        sourceType: 'chat',
        title: 'rebuild title',
      });
      messages.syncConversationMessages(first.id, [
        { contentText: 'rebuild body', messageKey: 'm1', role: 'assistant', sequence: 1, updatedAt: 1 },
      ]);
      database.exec(`DROP TABLE ${SQLITE_FTS_TABLE_NAME};`);
      expect(getSqliteFtsCapability(database).available).toBe(false);
      expectLocalError(() => search(repository, 'rebuild'), 'FTS_UNAVAILABLE');
      migrateSqliteSchema(database);
      expect(search(repository, 'rebuild').items.map((item) => item.conversationKey)).toEqual(['needs-rebuild']);

      const originalPrepare = database.prepare.bind(database);
      const revisionBeforeReadFailure = readFactsRevision(database);
      const readFailure = vi.spyOn(database, 'prepare').mockImplementation(((sql: string) => {
        if (sql.includes(`FROM ${SQLITE_FTS_TABLE_NAME}`) && sql.includes('MATCH ?')) {
          throw Object.assign(new Error('fts read failed'), { code: 'SQLITE_ERROR' });
        }
        return originalPrepare(sql);
      }) as typeof database.prepare);
      try {
        expectLocalError(() => search(repository, 'rebuild'), 'FTS_UNAVAILABLE');
      } finally {
        readFailure.mockRestore();
      }
      expect(readFactsRevision(database)).toBe(revisionBeforeReadFailure);
      expect(getSqliteFtsCapability(database)).toEqual({ available: true, reason: null });

      database.exec('BEGIN IMMEDIATE;');
      try {
        expectLocalError(() => search(repository, 'rebuild'), 'BUSY');
      } finally {
        database.exec('ROLLBACK;');
      }

      const revisionBeforeLocalFailure = readFactsRevision(database);
      const localFailure = vi.spyOn(database, 'prepare').mockImplementation(((sql: string) => {
        if (sql.includes(`INSERT INTO ${SQLITE_FTS_TABLE_NAME}`)) {
          throw Object.assign(new Error('fts write failed'), { code: 'SQLITE_ERROR' });
        }
        return originalPrepare(sql);
      }) as typeof database.prepare);
      const indexedLate = conversations.upsertConversation({
        conversationKey: 'fts-write-failure',
        lastCapturedAt: 2,
        source: 'chatgpt',
        sourceType: 'chat',
        title: 'recoverable FTS document',
      });
      expect(conversations.getConversationById(indexedLate.id)).toMatchObject({ title: 'recoverable FTS document' });
      expect(readFactsRevision(database)).toBe(revisionBeforeLocalFailure + 1);
      expect(database.prepare("SELECT value FROM meta WHERE key = 'fts_status'").get()).toEqual({
        value: 'unavailable',
      });
      expect(database.prepare("SELECT value FROM meta WHERE key = 'fts_index_status'").get()).toEqual({
        value: 'needs-rebuild',
      });
      expectLocalError(() => search(repository, 'recoverable'), 'FTS_UNAVAILABLE');

      mappings.patchSyncMapping(indexedLate.id, { notionPageId: 'mapping-while-fts-is-down' });
      expect(mappings.getSyncMappingByConversation(indexedLate.id)?.mapping).toMatchObject({
        notionPageId: 'mapping-while-fts-is-down',
      });
      expect(readFactsRevision(database)).toBe(revisionBeforeLocalFailure + 2);
      expect(database.prepare("SELECT value FROM meta WHERE key = 'fts_status'").get()).toEqual({
        value: 'unavailable',
      });
      localFailure.mockRestore();

      messages.syncConversationMessages(indexedLate.id, [
        { contentText: 'recovered body', messageKey: 'm2', role: 'assistant', sequence: 1, updatedAt: 2 },
      ]);
      expect(getSqliteFtsCapability(database)).toEqual({ available: true, reason: null });
      expect(search(repository, 'recoverable').items.map((item) => item.conversationKey)).toEqual([
        'fts-write-failure',
      ]);

      const revisionBeforeDeleteFailure = readFactsRevision(database);
      const deleteFailure = vi.spyOn(database, 'prepare').mockImplementation(((sql: string) => {
        if (sql === `DELETE FROM ${SQLITE_FTS_TABLE_NAME} WHERE conversation_id = ?`) {
          throw Object.assign(new Error('fts delete failed'), { code: 'SQLITE_ERROR' });
        }
        return originalPrepare(sql);
      }) as typeof database.prepare);
      try {
        expect(conversations.deleteConversationsByIds([indexedLate.id])).toMatchObject({ deletedConversations: 1 });
      } finally {
        deleteFailure.mockRestore();
      }
      expect(conversations.getConversationById(indexedLate.id)).toBeNull();
      expect(readFactsRevision(database)).toBe(revisionBeforeDeleteFailure + 1);
      expect(database.prepare("SELECT value FROM meta WHERE key = 'fts_status'").get()).toEqual({
        value: 'unavailable',
      });
      expect(database.prepare("SELECT value FROM meta WHERE key = 'fts_index_status'").get()).toEqual({
        value: 'needs-rebuild',
      });
      expectLocalError(() => search(repository, 'recoverable'), 'FTS_UNAVAILABLE');

      const revisionBeforeBaseFailure = readFactsRevision(database);
      const baseFailure = vi.spyOn(database, 'prepare').mockImplementation(((sql: string) => {
        if (sql.includes(`INSERT INTO ${SQLITE_FTS_TABLE_NAME}`)) {
          throw Object.assign(new Error('disk failed'), { code: 'SQLITE_IOERR' });
        }
        return originalPrepare(sql);
      }) as typeof database.prepare);
      expect(() =>
        conversations.upsertConversation({
          conversationKey: 'base-failure',
          lastCapturedAt: 3,
          source: 'chatgpt',
          sourceType: 'chat',
          title: 'must roll back',
        }),
      ).toThrow(LocalDataContractError);
      baseFailure.mockRestore();
      expect(conversations.findConversationBySourceAndKey('chatgpt', 'base-failure')).toBeNull();
      expect(readFactsRevision(database)).toBe(revisionBeforeBaseFailure);
    } finally {
      handle.close();
    }
  });

  it('does not drop an FTS table unless its full derived schema is verified', async () => {
    const { database, handle } = await openRepositories();
    try {
      database.exec(`DROP TABLE ${SQLITE_FTS_TABLE_NAME};`);
      database.exec(`CREATE VIRTUAL TABLE ${SQLITE_FTS_TABLE_NAME} USING fts5 (unrelated, tokenize='trigram');`);

      migrateSqliteSchema(database);

      const row = database
        .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
        .get('table', SQLITE_FTS_TABLE_NAME) as Readonly<{ sql?: unknown }> | undefined;
      expect(row?.sql).toContain('unrelated');
      expect(getSqliteFtsCapability(database).available).toBe(false);
    } finally {
      handle.close();
    }
  });
});
