import { describe, expect, it } from 'vitest';

import {
  filterStorageForBackup,
  mergeConversationRecord,
  mergeMessageRecord,
  uniqueConversationKey,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
} from '../../src/domains/backup/backup-utils';

describe('domains/backup backup-utils', () => {
  it('uniqueConversationKey returns stable source||key', () => {
    expect(uniqueConversationKey({ source: 'chatgpt', conversationKey: 'c1' })).toBe('chatgpt||c1');
    expect(uniqueConversationKey({ source: '', conversationKey: 'c1' })).toBe('');
  });

  it('filterStorageForBackup keeps allowlist only', () => {
    const filtered = filterStorageForBackup({
      notion_oauth_client_id: 'abc',
      notion_parent_page_id: 'p1',
      notion_db_id_syncnos_ai_chats: 'db1',
      notion_db_id_syncnos_web_articles: 'db2',
      popup_active_tab: 'settings',
      popup_source_filter_key: 'all',
      notion_ai_preferred_model_index: 3,
      notion_oauth_token_v1: { accessToken: 'secret' },
    });
    expect(filtered).toEqual({
      notion_oauth_client_id: 'abc',
      notion_parent_page_id: 'p1',
      notion_db_id_syncnos_ai_chats: 'db1',
      notion_db_id_syncnos_web_articles: 'db2',
      popup_active_tab: 'settings',
      popup_source_filter_key: 'all',
      notion_ai_preferred_model_index: 3,
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
      index: { conversationsCsvPath: 'index/conversations.csv' },
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
      index: { conversationsCsvPath: 'index/conversations.csv' },
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
});

