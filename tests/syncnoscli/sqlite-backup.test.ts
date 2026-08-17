import { afterEach, describe, expect, it } from 'vitest';

import {
  exportBackupPortableFacts,
  importBackupPortableFacts,
} from '../../packages/syncnoscli/src/sqlite/backup-repository';
import { readFactsRevision } from '../../packages/syncnoscli/src/sqlite/revision';

import { createSqliteTestFixture } from './sqlite-test-fixture';

const fixture = createSqliteTestFixture('syncnoscli-backup-');

afterEach(fixture.cleanup);

describe('SQLite portable backup repository', () => {
  it('round-trips conversations, mappings, image references, and comment threads in one revision bump', async () => {
    const source = await fixture.open();
    const article = source.conversations.upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'backup-article',
      title: 'Backup article',
      url: 'https://example.com/backup',
      lastCapturedAt: 11,
    });
    const asset = await source.images.putImageAsset({
      bytes: Uint8Array.from([1, 2, 3, 4]),
      contentType: 'image/png',
      conversationId: article.id,
      url: 'https://cdn.example/backup.png',
    });
    source.messages.syncConversationMessages(article.id, [
      {
        messageKey: 'm1',
        role: 'assistant',
        contentText: 'backup body',
        contentMarkdown: `![image](syncnos-asset://${asset.id})`,
        sequence: 1,
        updatedAt: 12,
      },
    ]);
    source.mappings.patchSyncMapping(article.id, {
      notionPageId: 'notion-backup',
      feishuDocId: 'feishu-backup',
      providerOpaque: { preserved: true },
    });
    const root = source.comments.addArticleComment({
      canonicalUrl: 'https://example.com/backup',
      commentText: 'root',
      conversationId: article.id,
      createdAt: 20,
    });
    source.comments.addArticleComment({
      canonicalUrl: 'https://example.com/backup',
      commentText: 'reply',
      conversationId: article.id,
      createdAt: 21,
      parentId: root.id,
    });

    const exported = exportBackupPortableFacts(source.database);
    expect(exported.facts.bundles).toHaveLength(1);
    expect(exported.facts.imageAssets).toHaveLength(1);
    expect(exported.facts.articleComments.comments).toHaveLength(2);
    const exportedConversationKey = String(exported.facts.bundles[0]!.conversation.conversationKey);

    const target = await fixture.open();
    const beforeRevision = readFactsRevision(target.database);
    const stats = importBackupPortableFacts(target.database, exported.facts);
    expect(readFactsRevision(target.database)).toBe(beforeRevision + 1);
    expect(stats).toMatchObject({
      conversationsAdded: 1,
      messagesAdded: 1,
      mappingsAdded: 1,
      commentsAdded: 2,
    });

    const restoredTarget = target.conversations.findConversationBySourceAndKey('web', exportedConversationKey);
    const restored = target.conversations.getConversationById(restoredTarget!.id);
    expect(restored).toMatchObject({
      title: 'Backup article',
      notionPageId: 'notion-backup',
      feishuDocId: 'feishu-backup',
    });
    const restoredMessages = target.messages.getMessagesByConversationId(restored!.id);
    expect(restoredMessages).toHaveLength(1);
    const restoredAsset = target.images.findImageAssetByConversationAndUrl({
      conversationId: restored!.id,
      url: 'https://cdn.example/backup.png',
    });
    expect(restoredAsset?.bytes).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(restoredMessages[0]?.contentMarkdown).toContain(`syncnos-asset://${restoredAsset!.id}`);
    expect(target.mappings.getSyncMappingByConversation(restored!.id)?.mapping).toMatchObject({
      notionPageId: 'notion-backup',
      feishuDocId: 'feishu-backup',
      providerOpaque: { preserved: true },
    });
    const comments = target.comments.listArticleCommentsByConversationId(restored!.id);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ commentText: 'root', parentId: null });
    expect(comments[1]).toMatchObject({ commentText: 'reply', parentId: comments[0]!.id });
  });

  it('keeps existing bytes/body and merges the same backup conservatively on repeat import', async () => {
    const source = await fixture.open();
    const conversation = source.conversations.upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'repeat',
      title: 'Incoming',
      lastCapturedAt: 1,
    });
    const incomingAsset = await source.images.putImageAsset({
      bytes: Uint8Array.from([1]),
      contentType: 'image/png',
      conversationId: conversation.id,
      url: 'https://cdn.example/repeat.png',
    });
    source.messages.syncConversationMessages(conversation.id, [
      {
        messageKey: 'm1',
        role: 'assistant',
        contentText: 'incoming',
        contentMarkdown: `incoming ![](syncnos-asset://${incomingAsset.id})`,
        sequence: 1,
        updatedAt: 1,
      },
    ]);
    const facts = exportBackupPortableFacts(source.database).facts;

    const target = await fixture.open();
    const local = target.conversations.upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'repeat',
      title: 'Local title',
      lastCapturedAt: 2,
    });
    const localAsset = await target.images.putImageAsset({
      bytes: Uint8Array.from([9, 9]),
      contentType: 'image/png',
      conversationId: local.id,
      url: 'https://cdn.example/repeat.png',
    });
    target.messages.syncConversationMessages(local.id, [
      {
        messageKey: 'm1',
        role: 'assistant',
        contentText: 'local newer',
        contentMarkdown: `local ![](syncnos-asset://${localAsset.id})`,
        sequence: 1,
        updatedAt: 10,
      },
    ]);

    const stats = importBackupPortableFacts(target.database, facts);
    expect(stats).toMatchObject({ conversationsUpdated: 1, messagesUpdated: 1 });
    expect(target.conversations.findConversationBySourceAndKey('chatgpt', 'repeat')?.title).toBe('Local title');
    expect(
      target.images.findImageAssetByConversationAndUrl({
        conversationId: local.id,
        url: 'https://cdn.example/repeat.png',
      })?.bytes,
    ).toEqual(Uint8Array.from([9, 9]));
    expect(target.messages.getMessagesByConversationId(local.id)[0]?.contentMarkdown).toBe(
      `local ![](syncnos-asset://${localAsset.id})`,
    );
  });
});
