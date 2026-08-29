import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createZipBlob } from '@services/sync/backup/zip-utils';

export const BACKUP_V2_FIXTURE_EXPORTED_AT = '2026-08-29T08:00:00.000Z';
export const BACKUP_V2_FIXTURE_CAPTURED_AT = Date.parse(BACKUP_V2_FIXTURE_EXPORTED_AT);

export type BackupV2FixtureOptions = {
  chatTitle?: string;
  extraChatWarning?: string;
};

export type BackupV2FixtureExpected = {
  chat: { source: string; conversationKey: string; title: string; warningFlags: string[]; assetId: number };
  article: { source: string; conversationKey: string; canonicalUrl: string };
  video: { source: string; conversationKey: string };
  counts: {
    conversations: number;
    messages: number;
    sync_mappings: number;
    image_cache: number;
    article_comments: number;
  };
};

const encoder = new TextEncoder();
const FIXTURE_MTIME = new Date(BACKUP_V2_FIXTURE_EXPORTED_AT);

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, null, 2));
}

export function buildBackupV2FixtureEntries(options: BackupV2FixtureOptions = {}): {
  entries: Map<string, Uint8Array>;
  expected: BackupV2FixtureExpected;
} {
  const chatTitle = String(options.chatTitle || 'Reload-free fixture chat');
  const chatWarningFlags = [
    'fixture-warning',
    ...(String(options.extraChatWarning || '').trim() ? [String(options.extraChatWarning).trim()] : []),
  ];
  const chatConversationKey = 'reload-free-chat';
  const articleConversationKey = 'article:https://example.com/reload-free-article';
  const articleCanonicalUrl = 'https://example.com/reload-free-article';
  const videoConversationKey = 'reload-free-video';
  const chatUniqueKey = `chatgpt||${chatConversationKey}`;
  const articleUniqueKey = `web||${articleConversationKey}`;
  const assetId = 701;

  const chatPath = 'sources/chatgpt/reload-free-chat.json';
  const articlePath = 'sources/web/reload-free-article.json';
  const videoPath = 'sources/youtube/reload-free-video.json';
  const imageIndexPath = 'assets/image-cache/index.json';
  const imageBlobPath = 'assets/image-cache/blobs/701.png';
  const commentsIndexPath = 'assets/article-comments/index.json';

  const counts = {
    conversations: 3,
    messages: 4,
    sync_mappings: 1,
    image_cache: 1,
    article_comments: 2,
  } as const;

  const manifest = {
    backupSchemaVersion: 2,
    exportedAt: BACKUP_V2_FIXTURE_EXPORTED_AT,
    db: { name: 'webclipper', version: 10 },
    counts,
    config: { storageLocalPath: 'config/storage-local.json' },
    index: { conversationsCsvPath: 'sources/conversations.csv' },
    sources: [
      { source: 'chatgpt', conversationCount: 1, files: [chatPath] },
      { source: 'web', conversationCount: 1, files: [articlePath] },
      { source: 'youtube', conversationCount: 1, files: [videoPath] },
    ],
    assets: { imageCacheIndexPath: imageIndexPath, articleCommentsIndexPath: commentsIndexPath },
  };

  const chatBundle = {
    schemaVersion: 1,
    conversation: {
      id: 101,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: chatConversationKey,
      title: chatTitle,
      url: 'https://chatgpt.com/c/reload-free-chat',
      author: 'Fixture Author',
      warningFlags: chatWarningFlags,
      lastCapturedAt: BACKUP_V2_FIXTURE_CAPTURED_AT,
    },
    messages: [
      {
        id: 1001,
        messageKey: 'chat-user-1',
        role: 'user',
        contentText: 'Fixture question',
        contentMarkdown: 'Fixture question',
        sequence: 1,
        updatedAt: BACKUP_V2_FIXTURE_CAPTURED_AT,
      },
      {
        id: 1002,
        messageKey: 'chat-assistant-1',
        role: 'assistant',
        contentText: 'Fixture answer with image',
        contentMarkdown: `Fixture answer with image\n\n![fixture](syncnos-asset://${assetId})`,
        sequence: 2,
        updatedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 1,
      },
    ],
    syncMapping: {
      source: 'chatgpt',
      conversationKey: chatConversationKey,
      notionPageId: 'fixture-notion-page',
      notionPageUrl: 'https://www.notion.so/fixture-workspace/fixture-notion-page',
      notionWorkspaceSlug: 'fixture-workspace',
      feishuDocId: 'fixture-feishu-doc',
      githubRemoteKey: 'github.com/fixture/repo@main',
      lastSyncedMessageKey: 'chat-assistant-1',
      lastSyncedSequence: 2,
      lastSyncedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 2,
      updatedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 2,
    },
  };

  const articleBundle = {
    schemaVersion: 1,
    conversation: {
      id: 102,
      sourceType: 'article',
      source: 'web',
      conversationKey: articleConversationKey,
      title: 'Reload-free fixture article',
      url: articleCanonicalUrl,
      author: 'Article Author',
      publishedAt: '2026-08-29T07:00:00.000Z',
      warningFlags: [],
      lastCapturedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 10,
    },
    messages: [
      {
        id: 1003,
        messageKey: 'article_body',
        role: 'article',
        contentText: 'Fixture article body',
        contentMarkdown: '# Fixture article\n\nFixture article body.',
        sequence: 1,
        updatedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 10,
      },
    ],
    syncMapping: null,
  };

  const videoBundle = {
    schemaVersion: 1,
    conversation: {
      id: 103,
      sourceType: 'video',
      source: 'youtube',
      conversationKey: videoConversationKey,
      title: 'Reload-free fixture video',
      url: 'https://www.youtube.com/watch?v=fixture',
      warningFlags: [],
      lastCapturedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 20,
    },
    messages: [
      {
        id: 1004,
        messageKey: 'video-transcript-1',
        role: 'transcript',
        contentText: 'Fixture transcript',
        contentMarkdown: 'Fixture transcript',
        sequence: 1,
        updatedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 20,
      },
    ],
    syncMapping: null,
  };

  const imageIndex = {
    schemaVersion: 1,
    assets: [
      {
        assetId,
        uniqueKey: chatUniqueKey,
        url: 'https://images.example.test/reload-free-fixture.png',
        contentType: 'image/png',
        byteSize: 4,
        createdAt: BACKUP_V2_FIXTURE_CAPTURED_AT,
        updatedAt: BACKUP_V2_FIXTURE_CAPTURED_AT,
        blobPath: imageBlobPath,
      },
    ],
  };

  const commentsIndex = {
    schemaVersion: 1,
    comments: [
      {
        commentId: 801,
        parentCommentId: null,
        uniqueKey: articleUniqueKey,
        canonicalUrl: articleCanonicalUrl,
        authorName: 'Comment Author',
        quoteText: 'Fixture article body',
        commentText: 'Fixture root comment',
        locator: null,
        createdAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 30,
        updatedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 30,
      },
      {
        commentId: 802,
        parentCommentId: 801,
        uniqueKey: articleUniqueKey,
        canonicalUrl: articleCanonicalUrl,
        authorName: 'Reply Author',
        quoteText: '',
        commentText: 'Fixture reply',
        locator: null,
        createdAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 31,
        updatedAt: BACKUP_V2_FIXTURE_CAPTURED_AT + 31,
      },
    ],
  };

  const entries = new Map<string, Uint8Array>([
    ['manifest.json', jsonBytes(manifest)],
    ['config/storage-local.json', jsonBytes({ schemaVersion: 1, storageLocal: {} })],
    [
      'sources/conversations.csv',
      encoder.encode(
        [
          'source,conversationKey,title,url,lastCapturedAt,messageCount,notionPageId,hasNotionPageId,filePath',
          `chatgpt,${chatConversationKey},${chatTitle},https://chatgpt.com/c/reload-free-chat,${BACKUP_V2_FIXTURE_CAPTURED_AT},2,fixture-notion-page,true,chatgpt/reload-free-chat.json`,
          `web,${articleConversationKey},Reload-free fixture article,${articleCanonicalUrl},${BACKUP_V2_FIXTURE_CAPTURED_AT + 10},1,,false,web/reload-free-article.json`,
          `youtube,${videoConversationKey},Reload-free fixture video,https://www.youtube.com/watch?v=fixture,${BACKUP_V2_FIXTURE_CAPTURED_AT + 20},1,,false,youtube/reload-free-video.json`,
        ].join('\n'),
      ),
    ],
    [chatPath, jsonBytes(chatBundle)],
    [articlePath, jsonBytes(articleBundle)],
    [videoPath, jsonBytes(videoBundle)],
    [imageIndexPath, jsonBytes(imageIndex)],
    [imageBlobPath, Uint8Array.from([137, 80, 78, 71])],
    [commentsIndexPath, jsonBytes(commentsIndex)],
  ]);

  return {
    entries,
    expected: {
      chat: {
        source: 'chatgpt',
        conversationKey: chatConversationKey,
        title: chatTitle,
        warningFlags: [...chatWarningFlags],
        assetId,
      },
      article: { source: 'web', conversationKey: articleConversationKey, canonicalUrl: articleCanonicalUrl },
      video: { source: 'youtube', conversationKey: videoConversationKey },
      counts: { ...counts },
    },
  };
}

export async function createBackupV2FixtureZip(options: BackupV2FixtureOptions = {}): Promise<Blob> {
  const { entries } = buildBackupV2FixtureEntries(options);
  return await createZipBlob(
    Array.from(entries, ([name, data]) => ({ name, data, lastModified: FIXTURE_MTIME })),
  );
}

export async function writeBackupV2FixtureZip(options: BackupV2FixtureOptions = {}): Promise<{
  path: string;
  expected: BackupV2FixtureExpected;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'syncnos-reload-free-backup-'));
  const path = join(directory, 'SyncNos-Reload-Free-Data-Consistency-Fixture.zip');
  const blob = await createBackupV2FixtureZip(options);
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return { path, expected: buildBackupV2FixtureEntries(options).expected };
}
