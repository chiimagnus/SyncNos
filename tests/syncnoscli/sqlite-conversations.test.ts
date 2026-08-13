import { afterEach, describe, expect, it } from 'vitest';

import { encodeCanonicalJson } from '@services/local-data/facts-archive';

import { createConversationsRepository } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadOnly } from '../../packages/syncnoscli/src/sqlite/database';

import { createSqliteTestFixture } from './sqlite-test-fixture';

const fixture = createSqliteTestFixture('syncnoscli-conversations-');

afterEach(fixture.cleanup);

describe('SQLite conversation repository', () => {
  it('rewrites a legacy article row to the canonical web identity instead of duplicating it', async () => {
    const { conversations: repository, database, handle } = await fixture.open();
    try {
      const payload = encodeCanonicalJson({
        conversationKey: 'article_https://example.com/post',
        lastCapturedAt: 1,
        legacyUnknownField: 'preserved',
        source: 'article',
        sourceType: 'article',
        title: 'Legacy title',
        url: 'https://example.com/post#fragment',
      }).text;
      const inserted = database
        .prepare(
          `INSERT INTO conversations (
             source, conversation_key, source_type, title, url, author, published_at, list_source_key, list_site_key,
             last_captured_at, notion_page_id, feishu_doc_id, payload_json
           ) VALUES ('article', 'article_https://example.com/post', 'article', 'Legacy title',
             'https://example.com/post#fragment', '', '', 'article', 'domain:example.com', 1, '', '', ?)`,
        )
        .run(payload);
      const conversation = repository.upsertConversation({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/post',
        title: 'Canonical title',
        url: 'https://example.com/post',
        lastCapturedAt: 2,
      }) as Record<string, unknown>;

      expect(conversation).toMatchObject({
        id: Number(inserted.lastInsertRowid),
        source: 'web',
        conversationKey: 'article:https://example.com/post',
        url: 'https://example.com/post',
        legacyUnknownField: 'preserved',
      });
      expect(
        repository.getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 10 }).items,
      ).toHaveLength(1);
    } finally {
      handle.close();
    }
  });

  it('preserves unknown payload fields while keeping article identity and derived list keys canonical', async () => {
    const { conversations: repository, handle, paths } = await fixture.open();
    try {
      const first = repository.upsertConversation({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'legacy-key',
        title: 'First title',
        url: 'https://example.com/post#fragment',
        lastCapturedAt: 1,
        opaqueFromOldVersion: { value: true },
      }) as Record<string, unknown>;
      const updated = repository.upsertConversation({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'another-key',
        title: 'Updated title',
        url: 'https://example.com/post',
        lastCapturedAt: 2,
        opaqueFromNewVersion: ['kept'],
      }) as Record<string, unknown>;

      expect(updated.id).toBe(first.id);
      expect(updated.conversationKey).toBe('article:https://example.com/post');
      expect(updated.url).toBe('https://example.com/post');
      expect(updated.listSourceKey).toBe('web');
      expect(updated.listSiteKey).toBe('domain:example.com');
      expect(updated.opaqueFromOldVersion).toEqual({ value: true });
      expect(updated.opaqueFromNewVersion).toEqual(['kept']);

      const page = repository.getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 10 });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: first.id,
        conversationKey: 'article:https://example.com/post',
        title: 'Updated title',
      });
      expect(page.facets.sources).toEqual([{ key: 'web', label: 'web', count: 1 }]);
      expect(page.facets.sites).toEqual([{ key: 'domain:example.com', label: 'example.com', count: 1 }]);

      handle.close();
      const readOnly = await openReadOnly({ paths });
      try {
        expect(createConversationsRepository(readOnly.database).getConversationListBootstrap().items).toHaveLength(1);
      } finally {
        readOnly.close();
      }
    } finally {
      handle.close();
    }
  });

  it('uses the IDB cursor order and calculates summary/facets without materializing the full list', async () => {
    const { conversations: repository, handle } = await fixture.open();
    try {
      const now = Date.now();
      const a = repository.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'tie-a',
        title: 'A',
        lastCapturedAt: now,
      });
      const b = repository.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'tie-b',
        title: 'B',
        lastCapturedAt: now,
      });
      repository.upsertConversation({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/older',
        title: 'Older article',
        url: 'https://example.com/older',
        lastCapturedAt: now - 1,
      });

      const first = repository.getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 2 });
      expect(first.items.map((item) => item.conversationKey)).toEqual(['tie-b', 'tie-a']);
      expect(first.cursor).toEqual({ lastCapturedAt: now, id: a.id });
      expect(first.hasMore).toBe(true);
      expect(first.summary).toEqual({ totalCount: 3, todayCount: 3 });
      expect(first.facets.sources).toEqual([
        { key: 'chatgpt', label: 'chatgpt', count: 2 },
        { key: 'web', label: 'web', count: 1 },
      ]);
      expect(first.facets.sites).toEqual([{ key: 'domain:example.com', label: 'example.com', count: 1 }]);

      const second = repository.getConversationListPage({ sourceKey: 'all', siteKey: 'all', limit: 2 }, first.cursor!);
      expect(second.items.map((item) => item.conversationKey)).toEqual(['article:https://example.com/older']);
      expect(second.hasMore).toBe(false);
      expect(a.id).toBeLessThan(b.id);
    } finally {
      handle.close();
    }
  });

  it('counts attached and orphan article comment threads, without adding counts to chats', async () => {
    const { comments, conversations: repository, handle } = await fixture.open();
    try {
      const article = repository.upsertConversation({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/thread',
        title: 'Article',
        url: 'https://example.com/thread#ignored',
        lastCapturedAt: 2,
      });
      repository.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'chat-thread',
        title: 'Chat',
        lastCapturedAt: 1,
      });
      const root = comments.addArticleComment({
        canonicalUrl: 'https://example.com/thread',
        commentText: 'root',
        conversationId: article.id,
        createdAt: 1,
      });
      comments.addArticleComment({
        canonicalUrl: 'https://example.com/thread',
        commentText: 'reply',
        conversationId: article.id,
        createdAt: 2,
        parentId: root.id,
      });
      comments.addArticleComment({
        canonicalUrl: 'https://example.com/thread',
        commentText: 'orphan root',
        createdAt: 3,
      });

      const page = repository.getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 10 });
      expect(page.items.find((item) => item.id === article.id)?.commentThreadCount).toBe(2);
      expect(page.items.find((item) => item.sourceType === 'chat')?.commentThreadCount).toBeUndefined();
    } finally {
      handle.close();
    }
  });

  it('merges payloads, preserves standalone comments, and never reuses deleted numeric conversation ids', async () => {
    const { comments, conversations: repository, handle } = await fixture.open();
    try {
      const keep = repository.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'keep',
        title: '',
        lastCapturedAt: 1,
        opaqueKeep: true,
      });
      const remove = repository.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'remove',
        title: 'from remove',
        lastCapturedAt: 2,
        opaqueRemove: true,
      });
      const merged = repository.mergeConversationsByIds({
        keepConversationId: keep.id,
        removeConversationId: remove.id,
      });
      expect(merged).toMatchObject({ keptConversationId: keep.id, removedConversationId: remove.id, merged: true });
      expect(repository.getConversationById(keep.id)).toMatchObject({
        title: 'from remove',
        opaqueKeep: true,
        opaqueRemove: true,
      });
      expect(repository.getConversationById(remove.id)).toBeNull();

      const standalone = comments.addArticleComment({
        canonicalUrl: 'https://example.com/standalone',
        commentText: 'standalone',
        createdAt: 1,
      });
      const deleted = repository.deleteConversationsByIds([keep.id]);
      expect(deleted).toEqual({
        deletedConversations: 1,
        deletedImageCache: 0,
        deletedMappings: 0,
        deletedMessages: 0,
      });
      expect(comments.listArticleCommentsByCanonicalUrl('https://example.com/standalone')).toMatchObject([
        { id: standalone.id, conversationId: null },
      ]);

      const insertedAfterDelete = repository.upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'after-delete',
        title: 'after',
        lastCapturedAt: 3,
      });
      expect(insertedAfterDelete.id).toBeGreaterThan(remove.id);
    } finally {
      handle.close();
    }
  });
});
