import { describe, expect, it } from 'vitest';

import {
  prepareArticleCommentArchiveImport,
  serializeArticleCommentArchive,
  validateArticleCommentArchiveDocument,
} from '@services/comments/domain/comment-archive';
import {
  BACKUP_ZIP_SCHEMA_VERSION,
  areBackupValuesEqual,
  validateArticleCommentsIndexDocument,
  validateBackupManifest,
} from '@services/sync/backup/backup-utils';

const root = (overrides: Record<string, unknown> = {}) => ({
  commentId: 1,
  parentCommentId: null,
  uniqueKey: 'web||a',
  canonicalUrl: 'https://example.com/a',
  authorName: null,
  quoteText: 'q',
  commentText: 'c',
  locator: null,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

describe('backup article comments', () => {
  it('accepts V1 archives and reports missing optional fields', () => {
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
      ],
    };
    const result = validateArticleCommentArchiveDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['v1_missing_author', 'v1_missing_locator']);
    expect(validateArticleCommentsIndexDocument(doc).ok).toBe(true);
  });

  it('strictly validates V2 locator and field budgets', () => {
    expect(validateArticleCommentArchiveDocument({ schemaVersion: 2, comments: [root()] }).ok).toBe(true);
    expect(
      validateArticleCommentArchiveDocument({ schemaVersion: 2, comments: [root({ locator: { v: 99 } })] }).ok,
    ).toBe(false);
    expect(
      validateArticleCommentArchiveDocument({
        schemaVersion: 2,
        comments: [root({ commentText: 'x'.repeat(200_001) })],
      }).ok,
    ).toBe(false);
  });

  it('rejects duplicate, cyclic, nested-parent and cross-context graphs', () => {
    expect(validateArticleCommentArchiveDocument({ schemaVersion: 2, comments: [root(), root()] }).ok).toBe(false);
    expect(
      validateArticleCommentArchiveDocument({
        schemaVersion: 2,
        comments: [root({ parentCommentId: 2 }), root({ commentId: 2, parentCommentId: 1 })],
      }).ok,
    ).toBe(false);
    expect(
      validateArticleCommentArchiveDocument({
        schemaVersion: 2,
        comments: [root(), root({ commentId: 2, parentCommentId: 1 }), root({ commentId: 3, parentCommentId: 2 })],
      }).ok,
    ).toBe(false);
    expect(
      validateArticleCommentArchiveDocument({
        schemaVersion: 2,
        comments: [root(), root({ commentId: 2, parentCommentId: 1, canonicalUrl: 'https://example.com/b' })],
      }).ok,
    ).toBe(false);
  });

  it('accepts orphan rows with an auditable warning for historical compatibility', () => {
    const result = validateArticleCommentArchiveDocument({
      schemaVersion: 2,
      comments: [root({ parentCommentId: 999 })],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([{ code: 'orphan_parent', commentId: 1 }]);
  });

  it('serializes a canonical V2 graph and preserves author/locator fields', () => {
    const locator = {
      v: 1 as const,
      env: 'app' as const,
      quote: { type: 'TextQuoteSelector' as const, exact: 'q' },
      position: { type: 'TextPositionSelector' as const, start: 1, end: 2 },
    };
    const serialized = serializeArticleCommentArchive(
      [
        {
          id: 2,
          parentId: 1,
          conversationId: 10,
          canonicalUrl: 'https://example.com/a',
          authorName: 'B',
          quoteText: '',
          commentText: 'reply',
          locator: null,
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: 1,
          parentId: null,
          conversationId: 10,
          canonicalUrl: 'https://example.com/a',
          authorName: 'A',
          quoteText: 'q',
          commentText: 'root',
          locator,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 3,
          parentId: 999,
          conversationId: 10,
          canonicalUrl: 'https://example.com/a',
          authorName: null,
          quoteText: '',
          commentText: 'orphan',
          locator: null,
          createdAt: 3,
          updatedAt: 3,
        },
      ],
      new Map([[10, 'web||a']]),
    );
    expect(serialized.document.schemaVersion).toBe(2);
    expect(serialized.document.comments.map((item) => [item.commentId, item.parentCommentId])).toEqual([
      [3, null],
      [1, null],
      [2, 1],
    ]);
    expect(serialized.document.comments[1]?.authorName).toBe('A');
    expect(serialized.document.comments[1]?.locator).toEqual(locator);
    expect(serialized.warnings).toContainEqual({ code: 'orphan_promoted', commentId: 3 });
    expect(validateArticleCommentArchiveDocument(serialized.document).ok).toBe(true);
  });

  it('prepares roots before replies and promotes compatible V1 orphans', () => {
    const prepared = prepareArticleCommentArchiveImport({
      schemaVersion: 1,
      comments: [
        root({ commentId: 2, parentCommentId: 1, commentText: 'reply', createdAt: 2, updatedAt: 2 }),
        root(),
        root({ commentId: 3, parentCommentId: 999, commentText: 'orphan', createdAt: 3, updatedAt: 3 }),
      ],
    });
    expect(prepared.items.map((item) => [item.commentId, item.parentCommentId])).toEqual([
      [3, null],
      [1, null],
      [2, 1],
    ]);
    expect(prepared.items.every((item) => Boolean(item.fingerprint))).toBe(true);
    expect(prepared.warnings).toContainEqual({ code: 'orphan_parent', commentId: 3 });
  });

  it('keeps archive fingerprints distinct across conversations sharing the same URL and text', () => {
    const prepared = prepareArticleCommentArchiveImport({
      schemaVersion: 2,
      comments: [root({ commentId: 1, uniqueKey: 'web||a' }), root({ commentId: 2, uniqueKey: 'web||b' })],
    });

    expect(prepared.items).toHaveLength(2);
    expect(prepared.items[0]?.fingerprint).not.toBe(prepared.items[1]?.fingerprint);
  });

  it('treats comment records with reordered object keys as equal without ignoring timestamps', () => {
    const left = {
      id: 7,
      canonicalUrl: 'https://example.com/a',
      locator: { quote: { exact: 'q', prefix: 'p' }, position: { start: 1, end: 2 } },
      updatedAt: 20,
    };
    const reordered = {
      updatedAt: 20,
      locator: { position: { end: 2, start: 1 }, quote: { prefix: 'p', exact: 'q' } },
      canonicalUrl: 'https://example.com/a',
      id: 7,
    };

    expect(areBackupValuesEqual(left, reordered)).toBe(true);
    expect(areBackupValuesEqual(left, { ...reordered, updatedAt: 21 })).toBe(false);
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
