import { Blob } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCommentsRepository } from '../../packages/syncnoscli/src/sqlite/comments-repository';
import { createConversationsRepository } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadWriteForHost } from '../../packages/syncnoscli/src/sqlite/database';
import { createImagesRepository } from '../../packages/syncnoscli/src/sqlite/images-repository';
import { readFactsRevision } from '../../packages/syncnoscli/src/sqlite/revision';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];

async function openRepositories() {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-images-comments-'));
  temporaryRoots.push(root);
  const handle = await openReadWriteForHost({ paths: resolveSyncNosRuntimePaths({ homeDirectory: root }) });
  return {
    comments: createCommentsRepository(handle.database),
    conversations: createConversationsRepository(handle.database),
    database: handle.database,
    handle,
    images: createImagesRepository(handle.database),
  };
}

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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SQLite image repository', () => {
  it('normalizes all legacy byte forms once, enforces ownership, and never reuses deleted asset ids', async () => {
    const { conversations, database, handle, images } = await openRepositories();
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
});

describe('SQLite article comments repository', () => {
  it('keeps root/reply/orphan behavior, derives stable context, and detaches rather than cascades on conversation deletion', async () => {
    const { comments, conversations, database, handle } = await openRepositories();
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
    const { comments, conversations, database, handle } = await openRepositories();
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
