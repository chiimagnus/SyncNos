import { Blob } from 'node:buffer';

import { afterEach, describe, expect, it } from 'vitest';

import { mergeConversationsWithinTransaction } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { readFactsRevision, runFactsTransaction } from '../../packages/syncnoscli/src/sqlite/revision';

import { createSqliteTestFixture } from './sqlite-test-fixture';

const fixture = createSqliteTestFixture('syncnoscli-images-comments-');

function articlePayload(url: string, title = 'Article') {
  return {
    sourceType: 'article',
    source: 'web',
    conversationKey: `article:${url}`,
    title,
    url,
    lastCapturedAt: 1,
  };
}

afterEach(fixture.cleanup);

describe('SQLite image repository', () => {
  it('normalizes all legacy byte forms once, enforces ownership, and never reuses deleted asset ids', async () => {
    const { conversations, database, handle, images } = await fixture.open();
    try {
      const conversation = conversations.upsertConversation(articlePayload('https://example.com/images'));
      const bytes = Uint8Array.from([1, 2, 3, 4]);
      const blob = await images.putImageAsset({
        blob: new Blob([bytes], { type: 'image/png' }),
        conversationId: conversation.id,
        metadata: { createdAt: 1, dataUrl: 'data:image/png;base64,AAAA' },
        url: 'https://example.com/blob.png',
      });
      const dataUrl = await images.putImageAsset({
        conversationId: conversation.id,
        dataUrl: 'data:image/png;base64,AQIDBA==',
        url: 'https://example.com/data.png',
      });
      const arrayBuffer = await images.putImageAsset({
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        contentType: 'image/png',
        conversationId: conversation.id,
        url: 'https://example.com/buffer.png',
      });
      const typedArray = await images.putImageAsset({
        bytes,
        contentType: 'image/png',
        conversationId: conversation.id,
        url: 'https://example.com/typed.png',
      });

      for (const asset of [blob, dataUrl, arrayBuffer, typedArray]) {
        expect(asset.contentType).toBe('image/png');
        expect(asset.bytes).toEqual(bytes);
        expect(asset.byteSize).toBe(bytes.byteLength);
      }
      const dataPayload = database.prepare('SELECT payload_json FROM image_cache WHERE id = ?').get(dataUrl.id) as {
        payload_json: string;
      };
      expect(dataPayload.payload_json).not.toContain('AQIDBA==');
      expect(dataPayload.payload_json).not.toContain('dataUrl');
      expect(images.getImageAssetById({ id: blob.id, conversationId: conversation.id })).toMatchObject({ id: blob.id });
      expect(images.getImageAssetById({ id: blob.id, conversationId: conversation.id + 1 })).toBeNull();

      const replacement = await images.putImageAsset({
        bytes: Uint8Array.from([9, 8]),
        contentType: 'image/png',
        conversationId: conversation.id,
        url: 'https://example.com/typed.png',
      });
      expect(replacement.id).toBe(typedArray.id);
      expect(replacement.bytes).toEqual(Uint8Array.from([9, 8]));

      expect(conversations.deleteConversationsByIds([conversation.id])).toEqual({
        deletedConversations: 1,
        deletedImageCache: 4,
        deletedMappings: 0,
        deletedMessages: 0,
      });
      const nextConversation = conversations.upsertConversation(articlePayload('https://example.com/images-next'));
      const next = await images.putImageAsset({
        bytes,
        contentType: 'image/png',
        conversationId: nextConversation.id,
        url: 'https://example.com/next.png',
      });
      expect(next.id).toBeGreaterThan(typedArray.id);
    } finally {
      handle.close();
    }
  });

  it('keeps conflicting image facts, moves unique assets, and rewrites attached comment context in one merge', async () => {
    const { comments, conversations, database, handle, images } = await fixture.open();
    try {
      const keep = conversations.upsertConversation(articlePayload('https://example.com/keep', 'Keep'));
      const remove = conversations.upsertConversation(articlePayload('https://example.com/remove', 'Remove'));
      const keptShared = await images.putImageAsset({
        bytes: Uint8Array.from([1]),
        contentType: 'image/png',
        conversationId: keep.id,
        url: 'https://cdn.example/shared.png',
      });
      const removedShared = await images.putImageAsset({
        bytes: Uint8Array.from([2]),
        contentType: 'image/png',
        conversationId: remove.id,
        url: 'https://cdn.example/shared.png',
      });
      const moved = await images.putImageAsset({
        bytes: Uint8Array.from([3]),
        contentType: 'image/png',
        conversationId: remove.id,
        url: 'https://cdn.example/moved.png',
      });
      const attached = comments.addArticleComment({
        canonicalUrl: 'https://example.com/remove',
        commentText: 'attached to the merged article',
        conversationId: remove.id,
        createdAt: 1,
      });

      expect(
        runFactsTransaction(database, () =>
          mergeConversationsWithinTransaction(database, {
            keepConversationId: keep.id,
            removeConversationId: remove.id,
          }),
        ).result,
      ).toMatchObject({ merged: true, movedImageCache: 1, movedMessages: 0 });
      expect(images.getImageAssetById({ conversationId: keep.id, id: keptShared.id })).toMatchObject({
        bytes: Uint8Array.from([1]),
        id: keptShared.id,
      });
      expect(images.getImageAssetById({ conversationId: keep.id, id: removedShared.id })).toBeNull();
      expect(images.getImageAssetById({ conversationId: keep.id, id: moved.id })).toMatchObject({
        bytes: Uint8Array.from([3]),
        id: moved.id,
      });
      expect(comments.listArticleCommentsByCanonicalUrl('https://example.com/remove')).toMatchObject([
        { conversationId: keep.id, id: attached.id },
      ]);
      expect(
        database
          .prepare('SELECT conversation_id, conversation_source, conversation_key FROM article_comments WHERE id = ?')
          .get(attached.id),
      ).toEqual({
        conversation_id: keep.id,
        conversation_key: keep.conversationKey,
        conversation_source: keep.source,
      });
    } finally {
      handle.close();
    }
  });
});

describe('SQLite article comments repository', () => {
  it('keeps root/reply/orphan behavior, derives stable context, and detaches rather than cascades on conversation deletion', async () => {
    const { comments, conversations, database, handle } = await fixture.open();
    try {
      const url = 'https://example.com/comments#fragment';
      const canonicalUrl = 'https://example.com/comments';
      const article = conversations.upsertConversation(articlePayload(url));
      const root = comments.addArticleComment({
        canonicalUrl,
        commentText: 'root',
        conversationId: article.id,
        createdAt: 10,
      });
      const reply = comments.addArticleComment({
        canonicalUrl,
        commentText: 'reply',
        conversationId: article.id,
        createdAt: 11,
        parentId: root.id,
      });
      const orphan = comments.addArticleComment({ canonicalUrl, commentText: 'orphan', createdAt: 12 });
      expect(comments.attachOrphanCommentsToConversation(canonicalUrl, article.id)).toEqual({ updated: 1 });
      expect(comments.listArticleCommentsByConversationId(article.id).map((comment) => comment.id)).toEqual([
        root.id,
        reply.id,
        orphan.id,
      ]);
      const context = database
        .prepare('SELECT conversation_source, conversation_key FROM article_comments WHERE id = ?')
        .get(root.id) as { conversation_key: string; conversation_source: string };
      expect(context).toEqual({
        conversation_source: 'web',
        conversation_key: 'article:https://example.com/comments',
      });

      expect(comments.deleteArticleCommentById(root.id)).toBe(true);
      expect(comments.listArticleCommentsByCanonicalUrl(canonicalUrl).map((comment) => comment.id)).toEqual([
        orphan.id,
      ]);
      const replacement = comments.addArticleComment({
        canonicalUrl,
        commentText: 'replacement',
        conversationId: article.id,
        createdAt: 13,
      });
      expect(replacement.id).toBeGreaterThan(reply.id);

      expect(conversations.deleteConversationsByIds([article.id])).toEqual({
        deletedConversations: 1,
        deletedImageCache: 0,
        deletedMappings: 0,
        deletedMessages: 0,
      });
      expect(comments.listArticleCommentsByCanonicalUrl(canonicalUrl)).toMatchObject([
        { id: orphan.id, conversationId: null },
        { id: replacement.id, conversationId: null },
      ]);
    } finally {
      handle.close();
    }
  });

  it('rejects invalid comments and cross-context replies before any facts mutation', async () => {
    const { comments, conversations, database, handle } = await fixture.open();
    try {
      const article = conversations.upsertConversation(articlePayload('https://example.com/valid'));
      const other = conversations.upsertConversation(articlePayload('https://example.com/other'));
      const root = comments.addArticleComment({
        canonicalUrl: 'https://example.com/valid',
        commentText: 'root',
        conversationId: article.id,
      });
      const revisionBefore = readFactsRevision(database);

      expect(() =>
        comments.addArticleComment({
          canonicalUrl: 'https://example.com/valid',
          commentText: 'invalid locator',
          conversationId: article.id,
          locator: { v: 1 },
        }),
      ).toThrow();
      expect(() =>
        comments.addArticleComment({
          canonicalUrl: 'https://example.com/other',
          commentText: 'wrong parent context',
          conversationId: other.id,
          parentId: root.id,
        }),
      ).toThrow();
      expect(readFactsRevision(database)).toBe(revisionBefore);
      expect(comments.listArticleCommentsByCanonicalUrl('https://example.com/valid')).toHaveLength(1);
      expect(comments.listArticleCommentsByCanonicalUrl('https://example.com/other')).toHaveLength(0);
    } finally {
      handle.close();
    }
  });
});
