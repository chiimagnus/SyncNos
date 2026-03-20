import { describe, expect, it } from 'vitest';

import {
  filterStorageForBackup,
  mergeConversationRecord,
  mergeMessageRecord,
  mergeSyncMappingRecord,
  uniqueConversationKey,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
} from '../../src/sync/backup/backup-utils';

describe('backup backup-utils', () => {
  it('uniqueConversationKey returns stable source||key', () => {
    expect(uniqueConversationKey({ source: 'chatgpt', conversationKey: 'c1' })).toBe('chatgpt||c1');
    expect(uniqueConversationKey({ source: '', conversationKey: 'c1' })).toBe('');
  });

  it('filterStorageForBackup keeps all non-sensitive settings', () => {
    const filtered = filterStorageForBackup({
      notion_oauth_client_id: 'abc',
      notion_oauth_client_secret: 'secret',
      notion_parent_page_id: 'p1',
      notion_db_id_syncnos_ai_chats: 'db1',
      notion_db_id_syncnos_web_articles: 'db2',
      popup_active_tab: 'settings',
      popup_source_filter_key: 'all',
      chat_with_prompt_template_v1: 'talk',
      chat_with_max_chars_v1: 28000,
      chat_with_ai_platforms_v1: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
      notion_oauth_token_v1: { accessToken: 'secret' },
      obsidian_api_base_url: 'http://127.0.0.1:27123',
      obsidian_api_key: 'obsidian-key',
    });
    expect(filtered).toEqual({
      notion_oauth_client_id: 'abc',
      notion_parent_page_id: 'p1',
      notion_db_id_syncnos_ai_chats: 'db1',
      notion_db_id_syncnos_web_articles: 'db2',
      popup_active_tab: 'settings',
      popup_source_filter_key: 'all',
      chat_with_prompt_template_v1: 'talk',
      chat_with_max_chars_v1: 28000,
      chat_with_ai_platforms_v1: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
      obsidian_api_base_url: 'http://127.0.0.1:27123',
      obsidian_api_key: 'obsidian-key',
    });
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

  it('mergeSyncMappingRecord does not mix incoming message updatedAt into a different local cursor anchor', () => {
    const merged = mergeSyncMappingRecord(
      {
        id: 10,
        source: 'chatgpt',
        conversationKey: 'c1',
        notionPageId: 'page_local',
        lastSyncedMessageKey: 'm1',
        lastSyncedSequence: 1,
        lastSyncedAt: 100,
        updatedAt: 200,
      },
      {
        source: 'chatgpt',
        conversationKey: 'c1',
        notionPageId: 'page_backup',
        lastSyncedMessageKey: 'm2',
        lastSyncedSequence: 2,
        lastSyncedAt: 300,
        lastSyncedMessageUpdatedAt: 456,
        updatedAt: 400,
      },
    );

    expect(merged.notionPageId).toBe('page_local');
    expect(merged.lastSyncedMessageKey).toBe('m1');
    expect(merged.lastSyncedSequence).toBe(1);
    expect(merged.lastSyncedAt).toBe(100);
    expect(merged.lastSyncedMessageUpdatedAt).toBeUndefined();
    expect(merged.updatedAt).toBe(400);
  });

  it('mergeSyncMappingRecord can fill message updatedAt when incoming cursor matches the chosen anchor', () => {
    const merged = mergeSyncMappingRecord(
      {
        source: 'chatgpt',
        conversationKey: 'c1',
        notionPageId: 'page_local',
      },
      {
        source: 'chatgpt',
        conversationKey: 'c1',
        notionPageId: 'page_backup',
        lastSyncedMessageKey: 'm2',
        lastSyncedSequence: 2,
        lastSyncedAt: 300,
        lastSyncedMessageUpdatedAt: 456,
        updatedAt: 400,
      },
    );

    expect(merged.lastSyncedMessageKey).toBe('m2');
    expect(merged.lastSyncedSequence).toBe(2);
    expect(merged.lastSyncedMessageUpdatedAt).toBe(456);
  });
});
