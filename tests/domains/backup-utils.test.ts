import { describe, expect, it } from 'vitest';

import { DATA_REVISION_WAKE_STORAGE_KEY } from '@services/data-revisions/wake';
import {
  areBackupValuesEqual,
  filterStorageForBackup,
  mergeConversationRecord,
  mergeMessageRecord,
  uniqueConversationKey,
  validateBackupManifest,
  validateConversationBundle,
} from '@services/sync/backup/backup-utils';

describe('backup backup-utils', () => {
  it('uniqueConversationKey returns stable source||key', () => {
    expect(uniqueConversationKey({ source: 'chatgpt', conversationKey: 'c1' })).toBe('chatgpt||c1');
    expect(uniqueConversationKey({ source: '', conversationKey: 'c1' })).toBe('');
  });

  it('filterStorageForBackup keeps non-sensitive settings and removes secrets', () => {
    const filtered = filterStorageForBackup({
      notion_oauth_client_id: 'abc',
      notion_oauth_client_secret: 'secret',
      notion_oauth_pending_state: 'pending-state',
      notion_oauth_last_error: 'oauth-error',
      notion_parent_page_id: 'p1',
      notion_db_id_syncnos_ai_chats: 'db1',
      notion_db_id_syncnos_web_articles: 'db2',
      popup_active_tab: 'settings',
      popup_source_filter_key: 'all',
      notion_oauth_token_v1: { accessToken: 'secret' },
      feishu_oauth_client_id: 'feishu-app',
      feishu_oauth_client_secret: 'FEISHU_SECRET_SENTINEL',
      feishu_oauth_token_exchange_proxy_url: 'https://worker.example.com/exchange',
      feishu_oauth_token_v1: { accessToken: 'FEISHU_ACCESS_SENTINEL', refreshToken: 'FEISHU_REFRESH_SENTINEL' },
      feishu_oauth_pending_state: 'FEISHU_PENDING_SENTINEL',
      feishu_oauth_last_error: 'FEISHU_ERROR_SENTINEL',
      feishu_chat_folder: 'AIChats',
      feishu_article_folder: 'WebArticles',
      feishu_video_folder: 'Videos',
      obsidian_api_base_url: 'http://127.0.0.1:27123',
      obsidian_api_key: 'obsidian-key',
      github_repository: 'chiimagnus/SyncNos-Webclipper',
      github_branch: 'main',
      github_auth_state_v1: {
        version: 1,
        state: 'connected',
        token: { accessToken: 'ACCESS_SENTINEL_SECRET', refreshToken: 'REFRESH_SENTINEL_SECRET' },
      },
      github_auth_state_v2: { deviceCode: 'DEVICE_SENTINEL_SECRET' },
      [DATA_REVISION_WAKE_STORAGE_KEY]: 'runtime-nonce',
    });
    expect(filtered).toEqual({
      notion_parent_page_id: 'p1',
      notion_db_id_syncnos_ai_chats: 'db1',
      notion_db_id_syncnos_web_articles: 'db2',
      popup_active_tab: 'settings',
      popup_source_filter_key: 'all',
      feishu_oauth_client_id: 'feishu-app',
      feishu_oauth_token_exchange_proxy_url: 'https://worker.example.com/exchange',
      feishu_chat_folder: 'AIChats',
      feishu_article_folder: 'WebArticles',
      feishu_video_folder: 'Videos',
      obsidian_api_base_url: 'http://127.0.0.1:27123',
      github_repository: 'chiimagnus/SyncNos-Webclipper',
      github_branch: 'main',
    });
    expect(JSON.stringify(filtered)).not.toMatch(
      /ACCESS_SENTINEL_SECRET|REFRESH_SENTINEL_SECRET|DEVICE_SENTINEL_SECRET|FEISHU_SECRET_SENTINEL|FEISHU_ACCESS_SENTINEL|FEISHU_REFRESH_SENTINEL|FEISHU_PENDING_SENTINEL|FEISHU_ERROR_SENTINEL/,
    );
  });

  it('keeps only the canonical inpage display setting', () => {
    expect(filterStorageForBackup({ inpage_display_mode: 'supported' })).toEqual({ inpage_display_mode: 'supported' });
    expect(filterStorageForBackup({ inpage_display_mode: 'off' })).toEqual({ inpage_display_mode: 'off' });
    expect(filterStorageForBackup({ inpage_display_mode: 'bad' })).toEqual({});
    expect(filterStorageForBackup({ inpage_retired_setting: true, keep: 1 })).toEqual({ keep: 1 });
  });

  it('validateBackupManifest accepts a minimal zip v2 manifest', () => {
    const res = validateBackupManifest({
      backupSchemaVersion: 2,
      exportedAt: new Date().toISOString(),
      db: { name: 'webclipper', version: 3 },
      counts: { conversations: 1, messages: 2, sync_mappings: 0 },
      config: { storageLocalPath: 'config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
      sources: [{ source: 'chatgpt', conversationCount: 1, files: ['sources/chatgpt/c1.json'] }],
    });
    expect(res.ok).toBe(true);
  });

  it('validateBackupManifest requires current v3 asset counts and index paths', () => {
    const base = {
      backupSchemaVersion: 3,
      exportedAt: new Date().toISOString(),
      db: { name: 'webclipper', version: 13 },
      counts: { conversations: 0, messages: 0, sync_mappings: 0, image_cache: 0, article_comments: 0 },
      config: { storageLocalPath: 'config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
      sources: [],
      assets: {
        imageCacheIndexPath: 'assets/image-cache/index.json',
        articleCommentsIndexPath: 'assets/article-comments/index.json',
      },
    };
    const validate = validateBackupManifest;
    expect(validate(base).ok).toBe(true);
    expect(
      validate({ ...base, counts: { conversations: 0, messages: 0, sync_mappings: 0, article_comments: 0 } }).ok,
    ).toBe(false);
    expect(validate({ ...base, assets: { articleCommentsIndexPath: 'assets/article-comments/index.json' } }).ok).toBe(
      false,
    );
  });

  it('validateBackupManifest rejects unsafe paths', () => {
    const res = validateBackupManifest({
      backupSchemaVersion: 2,
      exportedAt: new Date().toISOString(),
      db: { name: 'webclipper', version: 3 },
      counts: { conversations: 1, messages: 0, sync_mappings: 0 },
      config: { storageLocalPath: '../config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
      sources: [],
    });
    expect(res.ok).toBe(false);
  });

  it('validateConversationBundle requires messageKey and mapping match', () => {
    const res1 = validateConversationBundle({
      schemaVersion: 1,
      conversation: { source: 'chatgpt', conversationKey: 'c1' },
      messages: [{ role: 'user' }],
      syncMapping: null,
    });
    expect(res1.ok).toBe(false);

    const res2 = validateConversationBundle({
      schemaVersion: 1,
      conversation: { source: 'chatgpt', conversationKey: 'c1' },
      messages: [{ messageKey: 'm1', role: 'user', contentMarkdown: 'hi' }],
      syncMapping: { source: 'chatgpt', conversationKey: 'c2' },
    });
    expect(res2.ok).toBe(false);
  });

  it('mergeConversationRecord does not overwrite non-empty local title/url', () => {
    const existing = {
      id: 10,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'c1',
      title: 'Local',
      url: 'https://a',
      lastActivityAt: 5,
    };
    const incoming = {
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'c1',
      title: 'Backup',
      url: 'https://b',
      lastActivityAt: 9,
    };
    const merged = mergeConversationRecord(existing, incoming);
    expect(merged.title).toBe('Local');
    expect(merged.url).toBe('https://a');
    expect(merged.lastActivityAt).toBe(9);
  });

  it('mergeConversationRecord leaves an absent notionPageId absent', () => {
    const merged = mergeConversationRecord(
      { source: 'chatgpt', conversationKey: 'c1', title: 'Local', url: 'https://a', lastActivityAt: 5 },
      { source: 'chatgpt', conversationKey: 'c1', title: 'Backup', url: 'https://b', lastActivityAt: 9 },
    );

    expect(merged).not.toHaveProperty('notionPageId');
  });

  it('compares backup values with stable object keys, ordered arrays, and real timestamps', () => {
    expect(
      areBackupValuesEqual(
        { updatedAt: 10, nested: { a: 1, b: 2 }, ordered: ['x', { y: 3 }] },
        { ordered: ['x', { y: 3 }], nested: { b: 2, a: 1 }, updatedAt: 10 },
      ),
    ).toBe(true);
    expect(areBackupValuesEqual({ ordered: ['a', 'b'] }, { ordered: ['b', 'a'] })).toBe(false);
    expect(areBackupValuesEqual({ updatedAt: 10 }, { updatedAt: 11 })).toBe(false);
    expect(areBackupValuesEqual(null, null)).toBe(true);
    expect(areBackupValuesEqual(1, 1)).toBe(true);
    expect(areBackupValuesEqual(1, '1')).toBe(false);
  });

  it('mergeMessageRecord stays pure when both timestamps are missing or invalid', () => {
    const merged = mergeMessageRecord(
      { conversationId: 1, messageKey: 'm1', contentText: 'local', updatedAt: Number.NaN },
      { conversationId: 1, messageKey: 'm1', contentMarkdown: 'incoming', updatedAt: -1 },
    );

    expect(merged.contentMarkdown).toBe('local');
    expect(merged).not.toHaveProperty('updatedAt');
  });

  it('mergeMessageRecord keeps newer explicit emptiness and lets only newer backups replace it', () => {
    const existing = {
      id: 1,
      conversationId: 9,
      messageKey: 'm1',
      contentMarkdown: '',
      updatedAt: 10,
      sequence: 1,
      role: 'user',
    };
    const incoming = {
      conversationId: 9,
      messageKey: 'm1',
      contentMarkdown: '## hi',
      updatedAt: 9,
      sequence: 1,
      role: 'user',
    };
    const merged1 = mergeMessageRecord(existing, incoming);
    expect(merged1.contentMarkdown).toBe('');
    expect(merged1.updatedAt).toBe(10);

    const newer = {
      conversationId: 9,
      messageKey: 'm1',
      contentMarkdown: 'new',
      updatedAt: 12,
      sequence: 2,
      role: 'user',
    };
    const merged2 = mergeMessageRecord(existing, newer);
    expect(merged2.contentMarkdown).toBe('new');
    expect(merged2).not.toHaveProperty('contentText');
    expect(merged2.updatedAt).toBe(12);
    expect(merged2.sequence).toBe(2);
  });

  it('mergeMessageRecord preserves explicit clears and never revives older content', () => {
    const merged = mergeMessageRecord(
      {
        conversationId: 1,
        messageKey: 'm1',
        role: 'assistant',
        contentMarkdown: '**old body**',
        updatedAt: 10,
      },
      {
        conversationId: 1,
        messageKey: 'm1',
        role: 'assistant',
        contentMarkdown: '',
        updatedAt: 11,
      },
    );

    expect(merged.contentMarkdown).toBe('');
    expect(merged.updatedAt).toBe(11);
    expect(merged).not.toHaveProperty('contentText');
  });

  it('mergeMessageRecord does not let older rich Markdown replace newer canonical content', () => {
    const merged = mergeMessageRecord(
      {
        conversationId: 1,
        messageKey: 'm1',
        role: 'assistant',
        contentMarkdown: 'hi',
        updatedAt: 20,
      },
      {
        conversationId: 1,
        messageKey: 'm1',
        role: 'assistant',
        contentMarkdown: '## hi',
        updatedAt: 10,
      },
    );

    expect(merged.contentMarkdown).toBe('hi');
    expect(merged.updatedAt).toBe(20);
  });

  it('mergeConversationRecord preserves local canonical Video metadata, fills missing values, and drops retired fields', () => {
    const merged = mergeConversationRecord(
      {
        id: 10,
        sourceType: 'video',
        source: 'video',
        conversationKey: 'video:https://example.com/video',
        title: 'Local',
        url: 'https://example.com/video',
        platform: 'bilibili',
        durationSeconds: 120.5,
        thumbnailUrl: 'https://example.com/local.jpg',
        videoDescription: 'Local description',
        transcriptSource: 'C',
        hasTimestamps: false,
        description: 'retired description',
        lastActivityAt: 20,
      },
      {
        sourceType: 'video',
        source: 'video',
        conversationKey: 'video:https://example.com/video',
        title: 'Backup',
        url: 'https://example.com/video',
        platform: 'youtube',
        durationSeconds: 999,
        thumbnailUrl: 'https://example.com/backup.jpg',
        videoDescription: 'Backup description',
        transcriptSource: 'A',
        hasTimestamps: true,
        lastActivityAt: 30,
      },
    );

    expect(merged).toMatchObject({
      platform: 'bilibili',
      durationSeconds: 120.5,
      thumbnailUrl: 'https://example.com/local.jpg',
      videoDescription: 'Local description',
      lastActivityAt: 30,
    });
    expect(merged).not.toHaveProperty('transcriptSource');
    expect(merged).not.toHaveProperty('hasTimestamps');
    expect(merged).not.toHaveProperty('description');

    const filled = mergeConversationRecord(
      {
        sourceType: 'video',
        source: 'video',
        conversationKey: 'video:https://example.com/missing',
        title: 'Local',
        url: 'https://example.com/missing',
        platform: 'invalid',
        durationSeconds: -1,
        thumbnailUrl: '',
        videoDescription: '',
        lastActivityAt: 1,
      },
      {
        sourceType: 'video',
        source: 'video',
        conversationKey: 'video:https://example.com/missing',
        platform: 'youtube',
        durationSeconds: 42.25,
        thumbnailUrl: 'https://example.com/backup.jpg',
        videoDescription: 'Backup description',
        lastActivityAt: 2,
      },
    );
    expect(filled).toMatchObject({
      platform: 'youtube',
      durationSeconds: 42.25,
      thumbnailUrl: 'https://example.com/backup.jpg',
      videoDescription: 'Backup description',
    });
  });

  it('mergeMessageRecord keeps structured Video content only from the winning transcript row', () => {
    const older = {
      conversationId: 1,
      messageKey: 'video_transcript',
      role: 'transcript',
      contentMarkdown: 'older',
      updatedAt: 10,
      transcriptCues: [{ startSeconds: 1, endSeconds: 2, text: 'older', raw: true }],
      videoChapters: [{ title: 'Old', startSeconds: 0, endSeconds: 10, imgUrl: 'raw' }],
    };
    const newerWithoutStructuredFields = {
      conversationId: 1,
      messageKey: 'video_transcript',
      role: 'transcript',
      contentMarkdown: 'newer',
      updatedAt: 20,
    };

    const merged = mergeMessageRecord(older, newerWithoutStructuredFields);
    expect(merged.contentMarkdown).toBe('newer');
    expect(merged).not.toHaveProperty('transcriptCues');
    expect(merged).not.toHaveProperty('videoChapters');

    const canonicalWinner = mergeMessageRecord(newerWithoutStructuredFields, {
      ...older,
      updatedAt: 30,
      transcriptCues: [{ startSeconds: 1.234, endSeconds: 3.456, text: 'winner', raw: true }],
      videoChapters: [{ title: ' Winner\nchapter ', startSeconds: 0, endSeconds: 30, imgUrl: 'raw' }],
    });
    expect(canonicalWinner.transcriptCues).toEqual([{ startSeconds: 1.234, endSeconds: 3.456, text: 'winner' }]);
    expect(canonicalWinner.videoChapters).toEqual([{ title: 'Winner chapter', startSeconds: 0, endSeconds: 30 }]);
  });

  it('mergeMessageRecord removes stray Video structured fields from non-transcript messages', () => {
    const merged = mergeMessageRecord(
      {},
      {
        conversationId: 1,
        messageKey: 'ordinary',
        role: 'assistant',
        contentMarkdown: 'ordinary',
        updatedAt: 10,
        transcriptCues: [{ startSeconds: 1, endSeconds: null, text: 'stray' }],
        videoChapters: [{ title: 'stray', startSeconds: 0, endSeconds: null }],
      },
    );
    expect(merged).not.toHaveProperty('transcriptCues');
    expect(merged).not.toHaveProperty('videoChapters');
  });
});
