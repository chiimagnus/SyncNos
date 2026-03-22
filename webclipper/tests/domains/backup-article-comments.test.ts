import { describe, expect, it } from 'vitest';

import {
  BACKUP_ZIP_SCHEMA_VERSION,
  validateArticleCommentsIndexDocument,
  validateBackupManifest,
} from '@services/sync/backup/backup-utils';

describe('backup article comments', () => {
  it('validates article comments index documents', () => {
    const doc = {
      schemaVersion: 1,
      comments: [
        {
          commentId: 1,
          parentCommentId: null,
          uniqueKey: 'web||a',
          canonicalUrl: 'https://example.com/a',
          quoteText: 'q',
          commentText: 'c',
          createdAt: 1,
          updatedAt: 2,
        },
        {
          commentId: 2,
          parentCommentId: 1,
          uniqueKey: '',
          canonicalUrl: 'https://example.com/a',
          quoteText: '',
          commentText: 'reply',
          createdAt: 3,
          updatedAt: 3,
        },
      ],
    };
    expect(validateArticleCommentsIndexDocument(doc).ok).toBe(true);
    expect(validateArticleCommentsIndexDocument({ schemaVersion: 1, comments: [{ commentId: 1 }] }).ok).toBe(false);
  });

  it('accepts manifests with articleCommentsIndexPath', () => {
    const manifest = {
      backupSchemaVersion: BACKUP_ZIP_SCHEMA_VERSION,
      exportedAt: '2026-01-01T00:00:00.000Z',
      db: { name: 'SyncNos', version: 6 },
      counts: { conversations: 0, messages: 0, sync_mappings: 0, image_cache: 0, article_comments: 0 },
      config: { storageLocalPath: 'config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
      sources: [],
      assets: {
        imageCacheIndexPath: 'assets/image-cache/index.json',
        articleCommentsIndexPath: 'assets/article-comments/index.json',
      },
    };
    expect(validateBackupManifest(manifest).ok).toBe(true);
    expect(
      validateBackupManifest({
        ...manifest,
        assets: { ...manifest.assets, articleCommentsIndexPath: '../oops.json' },
      }).ok,
    ).toBe(false);
  });
});
