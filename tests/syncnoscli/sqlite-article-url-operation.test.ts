import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { updateSqliteArticleUrl } from '../../packages/syncnoscli/src/sqlite/article-url-operation';
import { createCommentsRepository } from '../../packages/syncnoscli/src/sqlite/comments-repository';
import { createConversationsRepository } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadWriteForHost } from '../../packages/syncnoscli/src/sqlite/database';
import { createImagesRepository } from '../../packages/syncnoscli/src/sqlite/images-repository';
import { createMappingsRepository } from '../../packages/syncnoscli/src/sqlite/mappings-repository';
import { createMessagesRepository } from '../../packages/syncnoscli/src/sqlite/messages-repository';
import { readFactsRevision } from '../../packages/syncnoscli/src/sqlite/revision';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];

async function openRepositories() {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-article-url-'));
  temporaryRoots.push(root);
  const handle = await openReadWriteForHost({ paths: resolveSyncNosRuntimePaths({ homeDirectory: root }) });
  return {
    comments: createCommentsRepository(handle.database),
    conversations: createConversationsRepository(handle.database),
    database: handle.database,
    handle,
    images: createImagesRepository(handle.database),
    mappings: createMappingsRepository(handle.database),
    messages: createMessagesRepository(handle.database),
  };
}

function articlePayload(url: string, title = url) {
  return {
    sourceType: 'article',
    source: 'web',
    conversationKey: `article:${url}`,
    title,
    url,
    lastCapturedAt: 1,
  };
}

function updateInput(source: string, conversationKey: string, fromCanonicalUrl: string, toCanonicalUrl: string) {
  return { source, conversationKey, fromCanonicalUrl, toCanonicalUrl };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SQLite article URL operation', () => {
  it('updates article, comments, mappings, messages, and images in one revision', async () => {
    const { comments, conversations, database, handle, images, mappings, messages } = await openRepositories();
    try {
      const from = 'https://example.com/article-before';
      const to = 'https://example.com/article-after';
      const article = conversations.upsertConversation(articlePayload(from));
      messages.syncConversationMessages(article.id, [
        { messageKey: 'message', role: 'assistant', contentText: 'body', sequence: 1 },
      ]);
      mappings.setSyncCursor(article.id, { lastSyncedMessageKey: 'message', lastSyncedSequence: 1 });
      const image = await images.putImageAsset({
        bytes: Uint8Array.from([1, 2, 3]),
        contentType: 'image/png',
        conversationId: article.id,
        url: 'https://example.com/image.png',
      });
      const root = comments.addArticleComment({ canonicalUrl: from, commentText: 'root', conversationId: article.id });
      const reply = comments.addArticleComment({
        canonicalUrl: from,
        commentText: 'reply',
        conversationId: article.id,
        parentId: root.id,
      });
      const orphan = comments.addArticleComment({ canonicalUrl: from, commentText: 'orphan' });
      const revisionBefore = readFactsRevision(database);

      expect(() =>
        updateSqliteArticleUrl(
          database,
          updateInput(article.source, article.conversationKey, 'https://example.com/not-the-current-article', to),
        ),
      ).toThrow();
      expect(readFactsRevision(database)).toBe(revisionBefore);

      const result = updateSqliteArticleUrl(
        database,
        updateInput(article.source, article.conversationKey, from, `${to}#fragment`),
      );
      expect(result).toMatchObject({
        commentsUpdated: 3,
        conversationId: article.id,
        conversationKey: `article:${to}`,
        conversationSource: 'web',
        fromCanonicalUrl: from,
        merged: false,
        toCanonicalUrl: to,
      });
      expect(readFactsRevision(database)).toBe(revisionBefore + 1);
      expect(conversations.findConversationBySourceAndKey('web', `article:${from}`)).toBeNull();
      expect(conversations.getConversationById(article.id)).toMatchObject({
        conversationKey: `article:${to}`,
        source: 'web',
        sourceType: 'article',
        url: to,
      });
      expect(messages.getMessagesByConversationId(article.id).map((message) => message.messageKey)).toEqual([
        'message',
      ]);
      expect(mappings.getSyncMappingByConversation(article.id)?.mapping).toMatchObject({
        conversationKey: `article:${to}`,
        source: 'web',
      });
      expect(images.getImageAssetById({ id: image.id, conversationId: article.id })).toMatchObject({ id: image.id });
      expect(comments.listArticleCommentsByCanonicalUrl(to).map((comment) => comment.id)).toEqual([
        root.id,
        reply.id,
        orphan.id,
      ]);
      expect(
        database
          .prepare(
            'SELECT DISTINCT conversation_source, conversation_key FROM article_comments WHERE canonical_url = ?',
          )
          .all(to),
      ).toEqual([{ conversation_source: 'web', conversation_key: `article:${to}` }]);
      expect(comments.listArticleCommentsByCanonicalUrl(from)).toEqual([]);
    } finally {
      handle.close();
    }
  });

  it('merges a destination conflict without retaining source numeric handles', async () => {
    const { comments, conversations, database, handle, images, mappings, messages } = await openRepositories();
    try {
      const from = 'https://example.com/merge-from';
      const to = 'https://example.com/merge-to';
      const source = conversations.upsertConversation(articlePayload(from, 'Source'));
      const target = conversations.upsertConversation(articlePayload(to, 'Target'));
      messages.syncConversationMessages(source.id, [
        { messageKey: 'shared', role: 'assistant', contentText: 'source shared', sequence: 1 },
        { messageKey: 'source-only', role: 'assistant', contentText: 'source only', sequence: 2 },
      ]);
      messages.syncConversationMessages(target.id, [
        { messageKey: 'shared', role: 'assistant', contentText: 'target shared', sequence: 1 },
        { messageKey: 'target-only', role: 'assistant', contentText: 'target only', sequence: 2 },
      ]);
      mappings.setSyncCursor(source.id, { lastSyncedMessageKey: 'source-only', lastSyncedSequence: 2 });
      mappings.setSyncCursor(target.id, { lastSyncedMessageKey: 'target-only', lastSyncedSequence: 2 });
      const sourceShared = await images.putImageAsset({
        bytes: Uint8Array.from([1]),
        contentType: 'image/png',
        conversationId: source.id,
        url: 'https://example.com/shared.png',
      });
      const sourceOnly = await images.putImageAsset({
        bytes: Uint8Array.from([2]),
        contentType: 'image/png',
        conversationId: source.id,
        url: 'https://example.com/source.png',
      });
      const targetShared = await images.putImageAsset({
        bytes: Uint8Array.from([3]),
        contentType: 'image/png',
        conversationId: target.id,
        url: 'https://example.com/shared.png',
      });
      const sourceRoot = comments.addArticleComment({
        canonicalUrl: from,
        commentText: 'source root',
        conversationId: source.id,
      });
      const sourceOrphan = comments.addArticleComment({ canonicalUrl: from, commentText: 'source orphan' });
      const targetRoot = comments.addArticleComment({
        canonicalUrl: to,
        commentText: 'target root',
        conversationId: target.id,
      });

      const result = updateSqliteArticleUrl(database, updateInput(source.source, source.conversationKey, from, to));
      expect(result).toMatchObject({
        commentsUpdated: 2,
        conversationId: target.id,
        merged: true,
        toCanonicalUrl: to,
      });
      expect(conversations.getConversationById(source.id)).toBeNull();
      expect(messages.getMessagesByConversationId(target.id).map((message) => message.messageKey)).toEqual([
        'shared',
        'source-only',
        'target-only',
      ]);
      expect(images.getImageAssetById({ id: sourceShared.id, conversationId: target.id })).toBeNull();
      expect(images.getImageAssetById({ id: targetShared.id, conversationId: target.id })?.bytes).toEqual(
        Uint8Array.from([3]),
      );
      expect(images.getImageAssetById({ id: sourceOnly.id, conversationId: target.id })).toMatchObject({
        id: sourceOnly.id,
      });
      expect(mappings.getSyncMappingByConversation(target.id)?.mapping).toMatchObject({
        lastSyncedMessageKey: 'target-only',
        conversationKey: `article:${to}`,
      });
      expect(comments.listArticleCommentsByCanonicalUrl(to).map((comment) => comment.id)).toEqual([
        sourceRoot.id,
        sourceOrphan.id,
        targetRoot.id,
      ]);
      expect(comments.listArticleCommentsByConversationId(target.id).map((comment) => comment.id)).toEqual([
        sourceRoot.id,
        targetRoot.id,
      ]);
    } finally {
      handle.close();
    }
  });

  it('rolls every dependent write back when comment URL migration fails', async () => {
    const { comments, conversations, database, handle, images, mappings, messages } = await openRepositories();
    try {
      const from = 'https://example.com/rollback-from';
      const to = 'https://example.com/rollback-to';
      const source = conversations.upsertConversation(articlePayload(from));
      const target = conversations.upsertConversation(articlePayload(to));
      messages.syncConversationMessages(source.id, [
        { messageKey: 'source', role: 'assistant', contentText: 'source', sequence: 1 },
      ]);
      mappings.setSyncCursor(source.id, { lastSyncedMessageKey: 'source', lastSyncedSequence: 1 });
      const image = await images.putImageAsset({
        bytes: Uint8Array.from([7]),
        contentType: 'image/png',
        conversationId: source.id,
        url: 'https://example.com/rollback.png',
      });
      const comment = comments.addArticleComment({
        canonicalUrl: from,
        commentText: 'source comment',
        conversationId: source.id,
      });
      const revisionBefore = readFactsRevision(database);
      database.exec(`
        CREATE TRIGGER reject_article_comment_url
        BEFORE UPDATE OF canonical_url ON article_comments
        BEGIN
          SELECT RAISE(ABORT, 'reject article comment URL');
        END;
      `);

      expect(() =>
        updateSqliteArticleUrl(database, updateInput(source.source, source.conversationKey, from, to)),
      ).toThrow();
      expect(readFactsRevision(database)).toBe(revisionBefore);
      expect(conversations.getConversationById(source.id)).toMatchObject({
        conversationKey: `article:${from}`,
        url: from,
      });
      expect(conversations.getConversationById(target.id)).toMatchObject({
        conversationKey: `article:${to}`,
        url: to,
      });
      expect(messages.getMessagesByConversationId(source.id).map((message) => message.messageKey)).toEqual(['source']);
      expect(images.getImageAssetById({ id: image.id, conversationId: source.id })).toMatchObject({ id: image.id });
      expect(mappings.getSyncMappingByConversation(source.id)?.mapping).toMatchObject({
        conversationKey: `article:${from}`,
      });
      expect(comments.listArticleCommentsByCanonicalUrl(from).map((item) => item.id)).toEqual([comment.id]);
      expect(comments.listArticleCommentsByCanonicalUrl(to)).toEqual([]);
    } finally {
      handle.close();
    }
  });
});
