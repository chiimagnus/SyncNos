import { describe, expect, it } from 'vitest';

import { DATA_REVISION_WAKE_STORAGE_KEY } from '@services/data-revisions/wake';
import {
  areBackupValuesEqual,
  filterStorageForBackup,
  mergeConversationRecord,
  mergeMessageRecord,
  uniqueConversationKey,
  validateBackupDocument,
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

  it('canonicalizes display mode without propagating legacy or invalid values', () => {
    expect(filterStorageForBackup({ inpage_supported_only: true })).toEqual({ inpage_display_mode: 'supported' });
    expect(filterStorageForBackup({ inpage_supported_only: false })).toEqual({ inpage_display_mode: 'all' });
    expect(filterStorageForBackup({ inpage_display_mode: 'supported', inpage_supported_only: false })).toEqual({
      inpage_display_mode: 'supported',
    });
    expect(filterStorageForBackup({ inpage_display_mode: 'bad' })).toEqual({});
  });

  it('validateBackupDocument rejects unsupported version', () => {
    const res = validateBackupDocument({ schemaVersion: 999, stores: {} });
    expect(res.ok).toBe(false);
  });

  it('validateBackupDocument rejects duplicate conversation keys', () => {
    const doc = {
      schemaVersion: 1,
      stores: {
        conversations: [
          { id: 1, source: 'chatgpt', conversationKey: 'c1' },
          { id: 2, source: 'chatgpt', conversationKey: 'c1' },
        ],
        messages: [{ id: 1, conversationId: 1, messageKey: 'm1' }],
        sync_mappings: [],
      },
    };
    const res = validateBackupDocument(doc);
    expect(res.ok).toBe(false);
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
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi' }],
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
      lastCapturedAt: 5,
    };
    const incoming = {
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'c1',
      title: 'Backup',
      url: 'https://b',
      lastCapturedAt: 9,
    };
    const merged = mergeConversationRecord(existing, incoming);
    expect(merged.title).toBe('Local');
    expect(merged.url).toBe('https://a');
    expect(merged.lastCapturedAt).toBe(9);
  });

  it('mergeConversationRecord leaves an absent notionPageId absent', () => {
    const merged = mergeConversationRecord(
      { source: 'chatgpt', conversationKey: 'c1', title: 'Local', url: 'https://a', lastCapturedAt: 5 },
      { source: 'chatgpt', conversationKey: 'c1', title: 'Backup', url: 'https://b', lastCapturedAt: 9 },
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

    expect(merged.contentMarkdown).toBe('incoming');
    expect(merged).not.toHaveProperty('updatedAt');
  });

  it('mergeMessageRecord prefers newer updatedAt and fills missing markdown', () => {
    const existing = {
      id: 1,
      conversationId: 9,
      messageKey: 'm1',
      contentMarkdown: '',
      contentText: 'hi',
      updatedAt: 10,
      sequence: 1,
      role: 'user',
    };
    const incoming = {
      conversationId: 9,
      messageKey: 'm1',
      contentMarkdown: '## md',
      contentText: 'hi',
      updatedAt: 9,
      sequence: 1,
      role: 'user',
    };
    const merged1 = mergeMessageRecord(existing, incoming);
    expect(merged1.contentMarkdown).toBe('## md');
    expect(merged1.updatedAt).toBe(10);

    const newer = {
      conversationId: 9,
      messageKey: 'm1',
      contentMarkdown: 'new',
      contentText: 'hi!',
      updatedAt: 12,
      sequence: 2,
      role: 'user',
    };
    const merged2 = mergeMessageRecord(existing, newer);
    expect(merged2.contentMarkdown).toBe('new');
    expect(merged2.contentText).toBe('hi!');
    expect(merged2.updatedAt).toBe(12);
    expect(merged2.sequence).toBe(2);
  });
});
