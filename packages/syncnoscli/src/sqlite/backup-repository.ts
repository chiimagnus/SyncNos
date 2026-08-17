import {
  buildArticleCommentArchiveBaseKey,
  buildArticleCommentArchiveFingerprint,
  prepareArticleCommentArchiveImport,
} from '@services/comments/domain/comment-archive';
import {
  normalizeFallbackImageUrl,
  rewriteSyncnosAssetUrlsInMarkdown,
  SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC,
  uniqueConversationKey,
} from '@services/local-data/facts-archive';
import {
  buildPortableBackupFacts,
  createEmptyImportStats,
  normalizeBackupHttpUrl,
  type BackupPortableFacts,
  type BackupRecord,
  type ImportStats,
} from '@services/sync/backup/local-data';

import { upsertMigrationConversationWithinTransaction } from './conversations-repository';
import { canonicalJsonText, readCanonicalJsonRecord, safeString } from './fact-payload';
import { upsertMigrationImageWithinTransaction } from './images-repository';
import { upsertMigrationSyncMappingWithinTransaction } from './mappings-repository';
import { upsertMigrationMessageWithinTransaction } from './messages-repository';
import { runFactsTransaction } from './revision';
import { rebuildSqliteFtsIndexWithinFactsTransaction, type SyncNosSqliteDatabase } from './schema';

type ConversationRow = Readonly<{
  id: number;
  source: string;
  conversation_key: string;
  url: string;
  payload_json: string;
}>;

type MessageRow = Readonly<{
  id: number;
  conversation_id: number;
  payload_json: string;
}>;

type MappingRow = Readonly<{
  id: number;
  payload_json: string;
}>;

type ImageRow = Readonly<{
  id: number;
  conversation_id: number;
  content_type: string;
  byte_size: number;
  bytes: Uint8Array;
  payload_json: string;
}>;

type CommentRow = Readonly<{
  id: number;
  conversation_id: number | null;
  parent_comment_id: number | null;
  canonical_url: string;
  created_at: number;
  updated_at: number;
  payload_json: string;
}>;

function rawRecord(payloadJson: string, fields: Record<string, unknown>): BackupRecord {
  return { ...readCanonicalJsonRecord(payloadJson), ...fields } as BackupRecord;
}

function allRows<T>(database: SyncNosSqliteDatabase, sql: string): T[] {
  return database.prepare(sql).all() as T[];
}

function readBackupPortableFactsSnapshot(database: SyncNosSqliteDatabase) {
  const conversations = allRows<ConversationRow>(
    database,
    'SELECT id, source, conversation_key, url, payload_json FROM conversations ORDER BY id ASC',
  );
  const messages = allRows<MessageRow>(
    database,
    'SELECT id, conversation_id, payload_json FROM messages ORDER BY id ASC',
  );
  const mappings = allRows<MappingRow>(database, 'SELECT id, payload_json FROM sync_mappings ORDER BY id ASC');
  const images = allRows<ImageRow>(
    database,
    'SELECT id, conversation_id, content_type, byte_size, bytes, payload_json FROM image_cache ORDER BY id ASC',
  );
  const comments = allRows<CommentRow>(
    database,
    `SELECT id, conversation_id, parent_comment_id, canonical_url, created_at, updated_at, payload_json
       FROM article_comments ORDER BY id ASC`,
  );

  return buildPortableBackupFacts({
    conversations: conversations.map((row) =>
      rawRecord(row.payload_json, {
        id: row.id,
        source: row.source,
        conversationKey: row.conversation_key,
        url: row.url,
      }),
    ),
    messages: messages.map((row) => rawRecord(row.payload_json, { id: row.id, conversationId: row.conversation_id })),
    syncMappings: mappings.map((row) => rawRecord(row.payload_json, { id: row.id })),
    imageCache: images.flatMap((row) => {
      const bytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array();
      if (bytes.byteLength <= 0 || bytes.byteLength !== Number(row.byte_size)) return [];
      return [
        {
          record: rawRecord(row.payload_json, {
            id: row.id,
            conversationId: row.conversation_id,
            contentType: row.content_type,
            byteSize: row.byte_size,
          }),
          bytes,
        },
      ];
    }),
    articleComments: comments.map((row) =>
      rawRecord(row.payload_json, {
        id: row.id,
        conversationId: row.conversation_id,
        parentId: row.parent_comment_id,
        canonicalUrl: row.canonical_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    ),
  });
}

/** Reads all five fact families from one SQLite snapshot so concurrent profile writes cannot tear a backup. */
export function exportBackupPortableFacts(database: SyncNosSqliteDatabase) {
  if (database.inTransaction) return readBackupPortableFactsSnapshot(database);
  return database.transaction(() => readBackupPortableFactsSnapshot(database))();
}

function existingConversationId(
  database: SyncNosSqliteDatabase,
  source: string,
  conversationKey: string,
): number | null {
  const row = database
    .prepare('SELECT id FROM conversations WHERE source = ? AND conversation_key = ?')
    .get(source, conversationKey) as { id?: unknown } | undefined;
  const id = Number(row?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function existingMessageId(database: SyncNosSqliteDatabase, conversationId: number, messageKey: string): number | null {
  const row = database
    .prepare('SELECT id FROM messages WHERE conversation_id = ? AND message_key = ?')
    .get(conversationId, messageKey) as { id?: unknown } | undefined;
  const id = Number(row?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function existingMappingId(database: SyncNosSqliteDatabase, source: string, conversationKey: string): number | null {
  const row = database
    .prepare('SELECT id FROM sync_mappings WHERE source = ? AND conversation_key = ?')
    .get(source, conversationKey) as { id?: unknown } | undefined;
  const id = Number(row?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function commentRowsByCanonicalUrl(database: SyncNosSqliteDatabase, canonicalUrl: string): CommentRow[] {
  return database
    .prepare(
      `SELECT id, conversation_id, parent_comment_id, canonical_url, created_at, updated_at, payload_json
         FROM article_comments WHERE canonical_url = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(canonicalUrl) as CommentRow[];
}

function mergeBackupCommentsWithinTransaction(
  database: SyncNosSqliteDatabase,
  facts: BackupPortableFacts,
  uniqueToLocalId: ReadonlyMap<string, number>,
  stats: ImportStats,
): void {
  const prepared = prepareArticleCommentArchiveImport(facts.articleComments);
  stats.commentWarnings.push(...prepared.warnings.map((warning) => `${warning.code}:${warning.commentId ?? ''}`));
  if (!prepared.items.length) return;

  const localConversationIdByCanonicalUrl = new Map<string, number | null>();
  const identityByLocalId = new Map<number, Readonly<{ conversationKey: string; source: string }>>();
  const uniqueKeyByLocalId = new Map<number, string>();
  for (const bundle of facts.bundles) {
    const uniqueKey = uniqueConversationKey(bundle.conversation);
    const localId = uniqueKey ? uniqueToLocalId.get(uniqueKey) : null;
    if (!localId) continue;
    uniqueKeyByLocalId.set(localId, uniqueKey);
    identityByLocalId.set(localId, {
      source: safeString(bundle.conversation.source),
      conversationKey: safeString(bundle.conversation.conversationKey),
    });
    const url = normalizeBackupHttpUrl(bundle.conversation.url);
    if (!url) continue;
    if (!localConversationIdByCanonicalUrl.has(url)) localConversationIdByCanonicalUrl.set(url, localId);
    else if (localConversationIdByCanonicalUrl.get(url) !== localId) localConversationIdByCanonicalUrl.set(url, null);
  }

  const existingByFingerprint = new Map<string, CommentRow>();
  const existingBaseKeyById = new Map<number, string>();
  const existingRows: CommentRow[] = [];
  for (const canonicalUrl of new Set(prepared.items.map((item) => item.canonicalUrl))) {
    for (const row of commentRowsByCanonicalUrl(database, canonicalUrl)) {
      const payload = readCanonicalJsonRecord(row.payload_json);
      const commentText = safeString(payload.commentText);
      if (!commentText) continue;
      const baseKey = buildArticleCommentArchiveBaseKey({
        uniqueKey: row.conversation_id ? (uniqueKeyByLocalId.get(row.conversation_id) ?? '') : '',
        canonicalUrl: row.canonical_url,
        createdAt: row.created_at,
        quoteText: String(payload.quoteText || ''),
        commentText,
      });
      existingBaseKeyById.set(row.id, baseKey);
      existingRows.push(row);
    }
  }
  for (const row of existingRows) {
    const parentBaseKey = row.parent_comment_id ? (existingBaseKeyById.get(row.parent_comment_id) ?? '') : '';
    const fingerprint = buildArticleCommentArchiveFingerprint(existingBaseKeyById.get(row.id) ?? '', parentBaseKey);
    if (!existingByFingerprint.has(fingerprint)) existingByFingerprint.set(fingerprint, row);
  }

  const incomingIdToLocalId = new Map<number, number>();
  const now = Date.now();
  for (const item of prepared.items) {
    const parentId = item.parentCommentId == null ? null : (incomingIdToLocalId.get(item.parentCommentId) ?? null);
    const mappedConversationId =
      item.uniqueKey && uniqueToLocalId.has(item.uniqueKey)
        ? uniqueToLocalId.get(item.uniqueKey)!
        : (localConversationIdByCanonicalUrl.get(item.canonicalUrl) ?? null);
    const identity = mappedConversationId ? (identityByLocalId.get(mappedConversationId) ?? null) : null;
    const existing = existingByFingerprint.get(item.fingerprint) ?? null;
    if (existing) {
      incomingIdToLocalId.set(item.commentId, existing.id);
      const payload = readCanonicalJsonRecord(existing.payload_json) as BackupRecord;
      const incomingUpdatedAt = Number(item.updatedAt) || 0;
      const existingUpdatedAt = Number(existing.updated_at) || 0;
      const nextParentId =
        existing.parent_comment_id == null && parentId != null ? parentId : existing.parent_comment_id;
      const nextConversationId =
        existing.conversation_id == null && mappedConversationId != null
          ? mappedConversationId
          : existing.conversation_id;
      const nextPayload: BackupRecord = {
        ...payload,
        canonicalUrl: item.canonicalUrl,
        authorName: incomingUpdatedAt >= existingUpdatedAt ? (item.authorName ?? '') : payload.authorName,
        quoteText: incomingUpdatedAt >= existingUpdatedAt ? item.quoteText : String(payload.quoteText || ''),
        commentText: incomingUpdatedAt >= existingUpdatedAt ? item.commentText : String(payload.commentText || ''),
        locator: incomingUpdatedAt >= existingUpdatedAt ? item.locator : payload.locator,
        createdAt: Number(existing.created_at) || item.createdAt || now,
        updatedAt: Math.max(existingUpdatedAt, incomingUpdatedAt),
      };
      const changed =
        nextParentId !== existing.parent_comment_id ||
        nextConversationId !== existing.conversation_id ||
        canonicalJsonText(nextPayload) !== existing.payload_json;
      if (!changed) {
        stats.commentsSkipped += 1;
        continue;
      }
      const nextIdentity = nextConversationId ? (identityByLocalId.get(nextConversationId) ?? identity) : null;
      database
        .prepare(
          `UPDATE article_comments
              SET conversation_id = ?, parent_comment_id = ?, canonical_url = ?, conversation_source = ?, conversation_key = ?,
                  created_at = ?, updated_at = ?, payload_json = ?
            WHERE id = ?`,
        )
        .run(
          nextConversationId,
          nextParentId,
          item.canonicalUrl,
          nextIdentity?.source ?? null,
          nextIdentity?.conversationKey ?? null,
          Number(nextPayload.createdAt) || item.createdAt || now,
          Number(nextPayload.updatedAt) || item.updatedAt || now,
          canonicalJsonText(nextPayload),
          existing.id,
        );
      stats.commentsUpdated += 1;
      continue;
    }

    const payload: BackupRecord = {
      canonicalUrl: item.canonicalUrl,
      authorName: item.authorName ?? '',
      quoteText: item.quoteText,
      commentText: item.commentText,
      locator: item.locator,
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || item.createdAt || now,
    };
    const result = database
      .prepare(
        `INSERT INTO article_comments (
           conversation_id, parent_comment_id, canonical_url, conversation_source, conversation_key, created_at, updated_at,
           root_structural_digest, structural_digest, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        mappedConversationId,
        parentId,
        item.canonicalUrl,
        identity?.source ?? null,
        identity?.conversationKey ?? null,
        Number(payload.createdAt),
        Number(payload.updatedAt),
        canonicalJsonText(payload),
      );
    const id = Number(result.lastInsertRowid);
    if (Number.isSafeInteger(id) && id > 0) incomingIdToLocalId.set(item.commentId, id);
    stats.commentsAdded += 1;
  }
}

function fillConversationProviderIdsWithinTransaction(database: SyncNosSqliteDatabase, mapping: BackupRecord): void {
  const source = safeString(mapping.source);
  const conversationKey = safeString(mapping.conversationKey);
  if (!source || !conversationKey) return;
  const row = database
    .prepare(
      'SELECT id, notion_page_id, feishu_doc_id, payload_json FROM conversations WHERE source = ? AND conversation_key = ?',
    )
    .get(source, conversationKey) as
    | Readonly<{ id: number; notion_page_id: string; feishu_doc_id: string; payload_json: string }>
    | undefined;
  if (!row) return;
  const notionPageId = safeString(mapping.notionPageId);
  const feishuDocId = safeString(mapping.feishuDocId);
  const nextNotionPageId = safeString(row.notion_page_id) || notionPageId;
  const nextFeishuDocId = safeString(row.feishu_doc_id) || feishuDocId;
  if (nextNotionPageId === safeString(row.notion_page_id) && nextFeishuDocId === safeString(row.feishu_doc_id)) return;
  const payload = {
    ...readCanonicalJsonRecord(row.payload_json),
    notionPageId: nextNotionPageId,
    feishuDocId: nextFeishuDocId,
  };
  database
    .prepare('UPDATE conversations SET notion_page_id = ?, feishu_doc_id = ?, payload_json = ? WHERE id = ?')
    .run(nextNotionPageId, nextFeishuDocId, canonicalJsonText(payload), row.id);
}

/** Applies one fully validated user backup in one SQLite facts transaction and one revision bump. */
export function importBackupPortableFacts(database: SyncNosSqliteDatabase, facts: BackupPortableFacts): ImportStats {
  const stats = createEmptyImportStats();
  return runFactsTransaction(database, () => {
    const uniqueToLocalId = new Map<string, number>();
    for (const bundle of facts.bundles) {
      const source = safeString(bundle.conversation.source);
      const conversationKey = safeString(bundle.conversation.conversationKey);
      if (!source || !conversationKey) continue;
      const existed = existingConversationId(database, source, conversationKey) !== null;
      const conversation = upsertMigrationConversationWithinTransaction(database, { ...bundle.conversation });
      uniqueToLocalId.set(`${source}||${conversationKey}`, conversation.id);
      if (existed) stats.conversationsUpdated += 1;
      else stats.conversationsAdded += 1;
    }

    mergeBackupCommentsWithinTransaction(database, facts, uniqueToLocalId, stats);

    const assetIdRemap = new Map<number, number>();
    const fallbackUrlByOldId = new Map<number, string>();
    for (const asset of facts.imageAssets) {
      const conversationId = uniqueToLocalId.get(asset.uniqueKey);
      if (!conversationId || !asset.bytes) {
        fallbackUrlByOldId.set(asset.assetId, normalizeFallbackImageUrl(asset.url));
        continue;
      }
      const stored = upsertMigrationImageWithinTransaction(database, {
        bytes: asset.bytes,
        contentType: asset.contentType,
        conversationId,
        metadata: {
          url: asset.url,
          contentType: asset.contentType,
          byteSize: asset.bytes.byteLength,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        },
      });
      assetIdRemap.set(asset.assetId, stored.id);
    }

    for (const bundle of facts.bundles) {
      const uniqueKey = uniqueConversationKey(bundle.conversation);
      const conversationId = uniqueToLocalId.get(uniqueKey);
      for (const raw of bundle.messages) {
        const messageKey = safeString(raw.messageKey);
        if (!conversationId || !messageKey) {
          stats.messagesSkipped += 1;
          continue;
        }
        const existed = existingMessageId(database, conversationId, messageKey) !== null;
        const markdown = String(raw.contentMarkdown || '');
        const rewrittenMarkdown = rewriteSyncnosAssetUrlsInMarkdown(markdown, {
          remap: assetIdRemap,
          fallbackUrlByOldId,
          ...(facts.imageCacheMode === 'missing-index' ? { defaultUrl: SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC } : {}),
        });
        upsertMigrationMessageWithinTransaction(database, {
          conversationId,
          payload: { ...raw, contentMarkdown: rewrittenMarkdown },
        });
        if (existed) stats.messagesUpdated += 1;
        else stats.messagesAdded += 1;
      }
    }

    const mappings = [
      ...facts.bundles.flatMap((bundle) => (bundle.syncMapping ? [{ ...bundle.syncMapping }] : [])),
      ...facts.looseMappings.map((mapping) => ({ ...mapping })),
    ];
    for (const mapping of mappings) {
      const source = safeString(mapping.source);
      const conversationKey = safeString(mapping.conversationKey);
      if (!source || !conversationKey) continue;
      const existed = existingMappingId(database, source, conversationKey) !== null;
      upsertMigrationSyncMappingWithinTransaction(database, mapping);
      fillConversationProviderIdsWithinTransaction(database, mapping);
      if (existed) stats.mappingsUpdated += 1;
      else stats.mappingsAdded += 1;
    }

    rebuildSqliteFtsIndexWithinFactsTransaction(database);
    return stats;
  }).result;
}
