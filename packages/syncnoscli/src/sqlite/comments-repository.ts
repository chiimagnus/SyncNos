import { LocalDataContractError } from '@services/local-data/contracts';
import { parseArticleCommentDto, type ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { parseArticleCommentLocator } from '@services/comments/domain/comment-locator';
import type { ArticleComment } from '@services/comments/domain/models';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

import { mapSqliteError } from './database';
import {
  canonicalJsonRecord,
  canonicalJsonText,
  positiveId,
  readCanonicalJsonRecord,
  safeString,
} from './fact-payload';
import { runFactsTransaction } from './revision';
import type { SyncNosSqliteDatabase } from './schema';

type CommentRow = Readonly<{
  id: number;
  conversation_id: number | null;
  parent_comment_id: number | null;
  canonical_url: string;
  conversation_source: string | null;
  conversation_key: string | null;
  created_at: number;
  updated_at: number;
  root_structural_digest: string | null;
  structural_digest: string | null;
  payload_json: string;
}>;

type ConversationRow = Readonly<{
  id: number;
  source: string;
  conversation_key: string;
  source_type: string;
  url: string;
}>;

export type AddSqliteArticleCommentInput = Readonly<{
  authorName?: unknown;
  canonicalUrl: unknown;
  commentText: unknown;
  conversationId?: unknown;
  conversationKey?: unknown;
  conversationSource?: unknown;
  createdAt?: unknown;
  locator?: unknown;
  parentId?: unknown;
  quoteText?: unknown;
  updatedAt?: unknown;
}>;

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function execute<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw mapSqliteError(error);
  }
}

function normalizedTimestamp(value: unknown, fallback: number): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function selectCommentById(database: SyncNosSqliteDatabase, id: number): CommentRow | null {
  return (database.prepare('SELECT * FROM article_comments WHERE id = ?').get(id) as CommentRow | undefined) ?? null;
}

function selectConversationById(database: SyncNosSqliteDatabase, id: number): ConversationRow | null {
  return (database.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined) ?? null;
}

function articleConversationContext(
  database: SyncNosSqliteDatabase,
  conversationId: number,
): Readonly<{ conversationKey: string; conversationSource: string }> {
  const conversation = selectConversationById(database, conversationId);
  const conversationSource = safeString(conversation?.source);
  const conversationKey = safeString(conversation?.conversation_key);
  if (
    !conversation ||
    safeString(conversation.source_type).toLowerCase() !== 'article' ||
    !conversationSource ||
    !conversationKey
  ) {
    invalidArgument();
  }
  return Object.freeze({ conversationSource, conversationKey });
}

function optionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') invalidArgument();
  return value.trim() || null;
}

function asComment(row: CommentRow): ArticleComment {
  const payload = {
    ...readCanonicalJsonRecord(row.payload_json),
    id: row.id,
    parentId: row.parent_comment_id,
    conversationId: row.conversation_id,
    canonicalUrl: row.canonical_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const parsed = parseArticleCommentDto(payload);
  if (!parsed) invalidArgument();
  return parsed;
}

function contextMatches(
  left: CommentRow,
  right: Readonly<{ canonicalUrl: string; conversationId: number | null }>,
): boolean {
  return left.canonical_url === right.canonicalUrl && left.conversation_id === right.conversationId;
}

function commentPayload(input: AddSqliteArticleCommentInput): Readonly<{
  canonicalUrl: string;
  commentText: string;
  conversationId: number | null;
  conversationKey: string | null;
  conversationSource: string | null;
  createdAt: number;
  locator: unknown | null;
  parentId: number | null;
  payloadJson: string;
  updatedAt: number;
}> {
  const raw = canonicalJsonRecord(input, ['id', 'conversationId', 'conversationKey', 'conversationSource', 'parentId']);
  const canonicalUrl = canonicalizeArticleUrl(input.canonicalUrl);
  const commentText = safeString(input.commentText);
  if (!canonicalUrl || !commentText) invalidArgument();
  const conversationId = input.conversationId == null ? null : positiveId(input.conversationId);
  if (input.conversationId != null && !conversationId) invalidArgument();
  const parentId = input.parentId == null ? null : positiveId(input.parentId);
  if (input.parentId != null && !parentId) invalidArgument();
  if (input.authorName != null && typeof input.authorName !== 'string') invalidArgument();
  if (input.quoteText != null && typeof input.quoteText !== 'string') invalidArgument();
  const now = Date.now();
  const createdAt = normalizedTimestamp(input.createdAt, now);
  const updatedAt = normalizedTimestamp(input.updatedAt, createdAt);
  let locator: unknown | null = null;
  if (input.locator != null) {
    const parsed = parseArticleCommentLocator(input.locator);
    if (!parsed.ok) invalidArgument();
    locator = parsed.value;
  }
  const conversationSource = optionalString(input.conversationSource);
  const conversationKey = optionalString(input.conversationKey);
  if (!conversationId && (conversationSource || conversationKey)) invalidArgument();
  const payload: Record<string, unknown> = {
    ...raw,
    canonicalUrl,
    authorName: input.authorName == null ? null : input.authorName,
    quoteText: input.quoteText == null ? '' : input.quoteText,
    commentText,
    locator,
    createdAt,
    updatedAt,
  };
  delete payload.id;
  delete payload.conversationId;
  delete payload.conversationKey;
  delete payload.conversationSource;
  delete payload.parentId;
  return Object.freeze({
    canonicalUrl,
    commentText,
    conversationId,
    conversationSource,
    conversationKey,
    createdAt,
    locator,
    parentId,
    updatedAt,
    payloadJson: canonicalJsonText(payload),
  });
}

function addArticleComment(database: SyncNosSqliteDatabase, input: AddSqliteArticleCommentInput): ArticleComment {
  const payload = commentPayload(input);
  return execute(
    () =>
      runFactsTransaction(database, () => {
        const context = payload.conversationId ? articleConversationContext(database, payload.conversationId) : null;
        if (
          context &&
          (canonicalizeArticleUrl(selectConversationById(database, payload.conversationId!)?.url) !==
            payload.canonicalUrl ||
            (payload.conversationSource && payload.conversationSource !== context.conversationSource) ||
            (payload.conversationKey && payload.conversationKey !== context.conversationKey))
        )
          invalidArgument();
        if (payload.parentId) {
          const parent = selectCommentById(database, payload.parentId);
          if (!parent || parent.parent_comment_id != null || !contextMatches(parent, payload)) invalidArgument();
        }
        const result = database
          .prepare(
            `INSERT INTO article_comments (
             conversation_id, parent_comment_id, canonical_url, conversation_source, conversation_key, created_at, updated_at,
             root_structural_digest, structural_digest, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          )
          .run(
            payload.conversationId,
            payload.parentId,
            payload.canonicalUrl,
            context?.conversationSource ?? null,
            context?.conversationKey ?? null,
            payload.createdAt,
            payload.updatedAt,
            payload.payloadJson,
          );
        const id = positiveId(result.lastInsertRowid);
        if (!id) invalidArgument();
        const inserted = selectCommentById(database, id);
        if (!inserted) invalidArgument();
        return asComment(inserted);
      }).result,
  );
}

function listArticleCommentsByCanonicalUrl(database: SyncNosSqliteDatabase, rawUrl: unknown): ArticleCommentDto[] {
  const canonicalUrl = canonicalizeArticleUrl(rawUrl);
  if (!canonicalUrl) return [];
  return execute(() =>
    (
      database
        .prepare('SELECT * FROM article_comments WHERE canonical_url = ? ORDER BY created_at ASC, id ASC')
        .all(canonicalUrl) as CommentRow[]
    ).map(asComment),
  );
}

function listArticleCommentsByConversationId(database: SyncNosSqliteDatabase, value: unknown): ArticleCommentDto[] {
  const conversationId = positiveId(value);
  if (!conversationId) return [];
  return execute(() =>
    (
      database
        .prepare('SELECT * FROM article_comments WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
        .all(conversationId) as CommentRow[]
    ).map(asComment),
  );
}

function descendants(database: SyncNosSqliteDatabase, commentId: number): number[] {
  const ids = [commentId];
  const seen = new Set(ids);
  for (let index = 0; index < ids.length; index += 1) {
    const children = database
      .prepare('SELECT id FROM article_comments WHERE parent_comment_id = ? ORDER BY id ASC')
      .all(ids[index]) as Array<{ id: number }>;
    for (const child of children) {
      if (!positiveId(child.id) || seen.has(child.id)) continue;
      seen.add(child.id);
      ids.push(child.id);
    }
  }
  return ids;
}

function deleteArticleCommentById(database: SyncNosSqliteDatabase, value: unknown): boolean {
  const commentId = positiveId(value);
  if (!commentId) return false;
  return execute(() => {
    if (!selectCommentById(database, commentId)) return false;
    return runFactsTransaction(database, () => {
      const ids = descendants(database, commentId);
      const placeholders = ids.map(() => '?').join(', ');
      // A damaged historical cycle cannot be deleted leaf-first. Null the links only
      // among rows already selected for deletion, then remove the same exact set.
      database
        .prepare(`UPDATE article_comments SET parent_comment_id = NULL WHERE parent_comment_id IN (${placeholders})`)
        .run(...ids);
      database.prepare(`DELETE FROM article_comments WHERE id IN (${placeholders})`).run(...ids);
      return true;
    }).result;
  });
}

function getArticleCommentDeleteContextById(
  database: SyncNosSqliteDatabase,
  value: unknown,
): Readonly<{
  canonicalUrl: string;
  conversationId: number | null;
}> | null {
  const commentId = positiveId(value);
  if (!commentId) return null;
  return execute(() => {
    const target = selectCommentById(database, commentId);
    const row =
      target ??
      (database
        .prepare('SELECT * FROM article_comments WHERE parent_comment_id = ? ORDER BY id ASC LIMIT 1')
        .get(commentId) as CommentRow | undefined) ??
      null;
    if (!row) return null;
    let canonicalUrl = row.canonical_url;
    let conversationId = row.conversation_id;
    if ((!canonicalUrl || !conversationId) && row.parent_comment_id) {
      const parent = selectCommentById(database, row.parent_comment_id);
      canonicalUrl = canonicalUrl || parent?.canonical_url || '';
      conversationId = conversationId ?? parent?.conversation_id ?? null;
    }
    return Object.freeze({ canonicalUrl, conversationId });
  });
}

function rewriteCommentPayload(row: CommentRow, input: Readonly<{ canonicalUrl?: string; updatedAt: number }>): string {
  const payload = { ...readCanonicalJsonRecord(row.payload_json) } as Record<string, unknown>;
  if (input.canonicalUrl) payload.canonicalUrl = input.canonicalUrl;
  payload.updatedAt = input.updatedAt;
  return canonicalJsonText(payload);
}

function hasAnyArticleCommentsForCanonicalUrl(database: SyncNosSqliteDatabase, rawUrl: unknown): boolean {
  const canonicalUrl = canonicalizeArticleUrl(rawUrl);
  if (!canonicalUrl) return false;
  return execute(() =>
    Boolean(
      database.prepare('SELECT 1 AS present FROM article_comments WHERE canonical_url = ? LIMIT 1').get(canonicalUrl),
    ),
  );
}

function attachOrphanCommentsToConversation(
  database: SyncNosSqliteDatabase,
  rawUrl: unknown,
  value: unknown,
): Readonly<{ updated: number }> {
  const canonicalUrl = canonicalizeArticleUrl(rawUrl);
  const conversationId = positiveId(value);
  if (!canonicalUrl || !conversationId) return Object.freeze({ updated: 0 });
  return execute(() => {
    return runFactsTransaction(database, () => {
      const context = articleConversationContext(database, conversationId);
      if (canonicalizeArticleUrl(selectConversationById(database, conversationId)?.url) !== canonicalUrl)
        invalidArgument();
      const rows = database
        .prepare('SELECT * FROM article_comments WHERE canonical_url = ? AND conversation_id IS NULL ORDER BY id ASC')
        .all(canonicalUrl) as CommentRow[];
      if (!rows.length) return Object.freeze({ updated: 0 });
      const now = Date.now();
      const update = database.prepare(
        `UPDATE article_comments
            SET conversation_id = ?, conversation_source = ?, conversation_key = ?, updated_at = ?,
                root_structural_digest = NULL, structural_digest = NULL, payload_json = ?
          WHERE id = ?`,
      );
      for (const row of rows) {
        update.run(
          conversationId,
          context.conversationSource,
          context.conversationKey,
          now,
          rewriteCommentPayload(row, { updatedAt: now }),
          row.id,
        );
      }
      return Object.freeze({ updated: rows.length });
    }).result;
  });
}

/** Runs inside a caller-owned facts transaction for the article URL compound operation. */
export function migrateArticleCommentsCanonicalUrlWithinTransaction(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    conversationId: number;
    conversationKey: string;
    conversationSource: string;
    fromCanonicalUrl: string;
    toCanonicalUrl: string;
  }>,
): number {
  if (input.fromCanonicalUrl === input.toCanonicalUrl) return 0;
  const rows = database
    .prepare(
      `SELECT * FROM article_comments
        WHERE canonical_url = ? AND (conversation_id IS NULL OR conversation_id = ?)
        ORDER BY id ASC`,
    )
    .all(input.fromCanonicalUrl, input.conversationId) as CommentRow[];
  if (!rows.length) return 0;
  const now = Date.now();
  const update = database.prepare(
    `UPDATE article_comments
        SET canonical_url = ?, conversation_source = ?, conversation_key = ?, updated_at = ?,
            root_structural_digest = NULL, structural_digest = NULL, payload_json = ?
      WHERE id = ?`,
  );
  for (const row of rows) {
    update.run(
      input.toCanonicalUrl,
      input.conversationSource,
      input.conversationKey,
      now,
      rewriteCommentPayload(row, { canonicalUrl: input.toCanonicalUrl, updatedAt: now }),
      row.id,
    );
  }
  return rows.length;
}

function migrateArticleCommentsCanonicalUrl(
  database: SyncNosSqliteDatabase,
  input: Readonly<{ conversationId: unknown; fromCanonicalUrl: unknown; toCanonicalUrl: unknown }>,
): Readonly<{ updated: number }> {
  const fromCanonicalUrl = canonicalizeArticleUrl(input.fromCanonicalUrl);
  const toCanonicalUrl = canonicalizeArticleUrl(input.toCanonicalUrl);
  const conversationId = positiveId(input.conversationId);
  if (!fromCanonicalUrl || !toCanonicalUrl || !conversationId) invalidArgument();
  if (fromCanonicalUrl === toCanonicalUrl) return Object.freeze({ updated: 0 });
  return execute(() => {
    const context = articleConversationContext(database, conversationId);
    const count = database
      .prepare(
        `SELECT COUNT(*) AS count FROM article_comments
          WHERE canonical_url = ? AND (conversation_id IS NULL OR conversation_id = ?)`,
      )
      .get(fromCanonicalUrl, conversationId) as { count?: unknown } | undefined;
    if (!(Number(count?.count) > 0)) return Object.freeze({ updated: 0 });
    return runFactsTransaction(database, () =>
      Object.freeze({
        updated: migrateArticleCommentsCanonicalUrlWithinTransaction(database, {
          conversationId,
          conversationSource: context.conversationSource,
          conversationKey: context.conversationKey,
          fromCanonicalUrl,
          toCanonicalUrl,
        }),
      }),
    ).result;
  });
}

export function moveCommentsForConversationMerge(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    keepConversationId: number;
    keepConversationKey: string;
    keepConversationSource: string;
    removeConversationId: number;
  }>,
): number {
  const rows = database
    .prepare('SELECT * FROM article_comments WHERE conversation_id = ? ORDER BY id ASC')
    .all(input.removeConversationId) as CommentRow[];
  if (!rows.length) return 0;
  const now = Date.now();
  const update = database.prepare(
    `UPDATE article_comments
        SET conversation_id = ?, conversation_source = ?, conversation_key = ?, updated_at = ?,
            root_structural_digest = NULL, structural_digest = NULL, payload_json = ?
      WHERE id = ?`,
  );
  for (const row of rows) {
    update.run(
      input.keepConversationId,
      input.keepConversationSource,
      input.keepConversationKey,
      now,
      rewriteCommentPayload(row, { updatedAt: now }),
      row.id,
    );
  }
  return rows.length;
}

/** Conversation deletion deliberately turns attached comments into URL-scoped orphans instead of cascading data loss. */
export function detachCommentsForDeletedConversationIds(
  database: SyncNosSqliteDatabase,
  conversationIds: readonly number[],
): number {
  let detached = 0;
  const now = Date.now();
  const update = database.prepare(
    `UPDATE article_comments
        SET conversation_id = NULL, conversation_source = NULL, conversation_key = NULL, updated_at = ?,
            root_structural_digest = NULL, structural_digest = NULL, payload_json = ?
      WHERE id = ?`,
  );
  for (const conversationId of conversationIds) {
    const rows = database
      .prepare('SELECT * FROM article_comments WHERE conversation_id = ? ORDER BY id ASC')
      .all(conversationId) as CommentRow[];
    for (const row of rows) {
      update.run(now, rewriteCommentPayload(row, { updatedAt: now }), row.id);
      detached += 1;
    }
  }
  return detached;
}

export function createCommentsRepository(database: SyncNosSqliteDatabase) {
  return Object.freeze({
    addArticleComment: (input: AddSqliteArticleCommentInput) => addArticleComment(database, input),
    attachOrphanCommentsToConversation: (canonicalUrl: unknown, conversationId: unknown) =>
      attachOrphanCommentsToConversation(database, canonicalUrl, conversationId),
    deleteArticleCommentById: (commentId: unknown) => deleteArticleCommentById(database, commentId),
    getArticleCommentDeleteContextById: (commentId: unknown) => getArticleCommentDeleteContextById(database, commentId),
    hasAnyArticleCommentsForCanonicalUrl: (canonicalUrl: unknown) =>
      hasAnyArticleCommentsForCanonicalUrl(database, canonicalUrl),
    listArticleCommentsByCanonicalUrl: (canonicalUrl: unknown) =>
      listArticleCommentsByCanonicalUrl(database, canonicalUrl),
    listArticleCommentsByConversationId: (conversationId: unknown) =>
      listArticleCommentsByConversationId(database, conversationId),
    migrateArticleCommentsCanonicalUrl: (
      input: Readonly<{ conversationId: unknown; fromCanonicalUrl: unknown; toCanonicalUrl: unknown }>,
    ) => migrateArticleCommentsCanonicalUrl(database, input),
  });
}

export type CommentsRepository = ReturnType<typeof createCommentsRepository>;
