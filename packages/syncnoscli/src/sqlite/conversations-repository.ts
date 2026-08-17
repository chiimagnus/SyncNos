import { Buffer } from 'node:buffer';

import { mergeMigrationConversationPayload } from '@services/local-data/facts-archive';
import {
  LocalDataContractError,
  type ConversationCaptureSnapshot,
  type InsightFactsSnapshot,
  type InsightStatsRequestPayload,
} from '@services/local-data/contracts';
import { computeArticleCommentThreadCount } from '@services/comments/domain/comment-metrics';
import { parseArticleCommentDtos } from '@services/comments/domain/comment-dto';
import {
  LIST_SITE_KEY_ALL,
  LIST_SOURCE_KEY_ALL,
  normalizeConversationListQuery,
  type ConversationListQueryInput,
} from '@services/conversations/domain/list-query';
import type { Conversation } from '@services/conversations/domain/models';
import { buildInsightFactsSnapshot } from '@services/conversations/domain/insight-facts';
import type {
  ConversationListCursor,
  ConversationListFacets,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListSummary,
} from '@services/conversations/domain/list-pagination';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

import { mapSqliteError } from './database';
import { detachCommentsForDeletedConversationIds, moveCommentsForConversationMerge } from './comments-repository';
import {
  canonicalJsonRecord,
  canonicalJsonText,
  positiveId,
  readCanonicalJsonRecord,
  safeString,
  type JsonRecord,
} from './fact-payload';
import { deleteMappingsForConversationReferences, migrateSyncMappingKeyWithinTransaction } from './mappings-repository';
import {
  deleteMessagesForConversationIds,
  moveMessagesForConversationMerge,
  syncMessagesWithinTransaction,
  type MessagePersistenceOptions,
} from './messages-repository';
import { deleteImagesForConversationIds, moveImagesForConversationMerge } from './images-repository';
import { readFactsRevision, runFactsTransaction } from './revision';
import {
  deleteConversationFtsDocumentWithinFactsTransaction,
  refreshConversationFtsDocumentWithinFactsTransaction,
  type SyncNosSqliteDatabase,
} from './schema';

type ConversationRow = Readonly<{
  id: number;
  source: string;
  conversation_key: string;
  source_type: string;
  title: string;
  url: string;
  author: string;
  published_at: string;
  list_source_key: string;
  list_site_key: string;
  last_captured_at: number;
  notion_page_id: string;
  feishu_doc_id: string;
  payload_json: string;
}>;

type ArticleCommentProjectionRow = Readonly<{
  id: number;
  conversation_id: number | null;
  parent_comment_id: number | null;
  canonical_url: string;
  payload_json: string;
}>;

type InsightConversationProjectionRow = Readonly<{
  id: number;
  source: string;
  conversation_key: string;
  source_type: string;
  title: string;
  url: string;
  last_captured_at: number;
  insight_message_count: unknown;
}>;

type SqliteConversationMergeResult = Readonly<{
  keptConversationId: number;
  removedConversationId: number;
  movedImageCache: number;
  movedMessages: number;
  merged: boolean;
}>;

type SqliteConversationDeleteResult = Readonly<{
  deletedConversations: number;
  deletedImageCache: number;
  deletedMappings: number;
  deletedMessages: number;
}>;

export type SqliteConversationReference = Readonly<{
  backendConversationId?: unknown;
  conversationKey?: unknown;
  source?: unknown;
}>;

const SQLITE_CONVERSATION_LIST_CURSOR_VERSION = 1;

export type SqliteConversationListScope = Readonly<{
  siteKey: string;
  sourceKey: string;
}>;

export type SqliteArticleUrlUpdateResult = Readonly<{
  conversationId: number;
  conversationKey: string;
  conversationSource: string;
  fromCanonicalUrl: string;
  merged: boolean;
  removedConversationId?: number;
  toCanonicalUrl: string;
}>;

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function staleReference(): never {
  throw new LocalDataContractError('STALE_REFERENCE');
}

function schemaMismatch(): never {
  throw new LocalDataContractError('SCHEMA_MISMATCH');
}

function normalizeListKey(value: unknown, fallback: string): string {
  const key = safeString(value).toLowerCase();
  return key || fallback;
}

function normalizeConversationListSiteFilterKey(value: unknown): string {
  const key = normalizeListKey(value, LIST_SITE_KEY_ALL);
  if (key === LIST_SITE_KEY_ALL || key === 'unknown') return key;
  return key.startsWith('domain:') ? key : `domain:${key}`;
}

function deriveListSiteKey(url: unknown): string {
  const text = safeString(url);
  if (!text) return 'unknown';
  try {
    const parsed = new URL(text);
    const protocol = safeString(parsed.protocol).toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return 'unknown';
    const host = normalizeListKey(parsed.hostname, '');
    return host ? `domain:${host}` : 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

function isArticlePayload(payload: Record<string, unknown>): boolean {
  return safeString(payload.sourceType).toLowerCase() === 'article';
}

function normalizeArticleConversationKey(value: unknown): string {
  const key = safeString(value);
  if (!key || !key.toLowerCase().startsWith('article:')) return key;
  const canonicalUrl = canonicalizeArticleUrl(key.slice('article:'.length));
  return canonicalUrl ? `article:${canonicalUrl}` : key;
}

function normalizeTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp === 0) return null;
  return Math.trunc(timestamp);
}

type SqliteConversationListCursor = Extract<ConversationListCursor, { id: number; lastCapturedAt: number }>;

function toComparableCursor(value: ConversationListCursor | null | undefined): SqliteConversationListCursor | null {
  if (!value || 'nativeCursor' in value) return null;
  const lastCapturedAt = Number(value.lastCapturedAt);
  const id = Number(value.id);
  if (!Number.isFinite(lastCapturedAt) || !Number.isFinite(id) || id <= 0) return null;
  return { lastCapturedAt, id };
}

function canonicalInputPayload(value: unknown): JsonRecord {
  return canonicalJsonRecord(value, ['id', 'commentThreadCount']);
}

function storedPayload(value: unknown): JsonRecord {
  return readCanonicalJsonRecord(value);
}

function asConversation(row: ConversationRow): Conversation {
  const payload = storedPayload(row.payload_json);
  return {
    ...payload,
    id: row.id,
    sourceType: row.source_type,
    source: row.source,
    conversationKey: row.conversation_key,
    title: row.title,
    url: row.url,
    author: row.author,
    publishedAt: row.published_at,
    listSourceKey: row.list_source_key,
    listSiteKey: row.list_site_key,
    lastCapturedAt: row.last_captured_at,
    notionPageId: row.notion_page_id,
    feishuDocId: row.feishu_doc_id,
  } as Conversation;
}

function asOpenTarget(row: ConversationRow): ConversationListOpenTarget {
  return {
    id: row.id,
    source: row.source,
    conversationKey: row.conversation_key,
    title: row.title,
    url: row.url,
    sourceType: row.source_type,
    lastCapturedAt: row.last_captured_at,
  };
}

function selectConversationRowById(database: SyncNosSqliteDatabase, id: number): ConversationRow | null {
  return (database.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined) ?? null;
}

function selectConversationRowBySourceAndKey(
  database: SyncNosSqliteDatabase,
  source: string,
  conversationKey: string,
): ConversationRow | null {
  return (
    (database
      .prepare('SELECT * FROM conversations WHERE source = ? AND conversation_key = ?')
      .get(source, conversationKey) as ConversationRow | undefined) ?? null
  );
}

function resolveConversationRowByReference(
  database: SyncNosSqliteDatabase,
  reference: SqliteConversationReference,
): ConversationRow {
  const source = safeString(reference?.source);
  const conversationKey = safeString(reference?.conversationKey);
  if (!source || !conversationKey) invalidArgument();
  const conversation = selectConversationRowBySourceAndKey(database, source, conversationKey);
  if (!conversation) staleReference();
  if (
    reference.backendConversationId !== undefined &&
    positiveId(reference.backendConversationId) !== conversation.id
  ) {
    staleReference();
  }
  return conversation;
}

function selectLegacyArticleConversationByUrl(database: SyncNosSqliteDatabase, url: string): ConversationRow | null {
  if (!url) return null;
  return (
    (database
      .prepare(
        `SELECT *
           FROM conversations
          WHERE source_type = 'article'
            AND (
              url = ?
              OR (substr(url, 1, length(?)) = ? AND substr(url, length(?) + 1, 1) = '#')
            )
          ORDER BY
            CASE WHEN source = 'web' AND conversation_key LIKE 'article:%' THEN 1 ELSE 0 END DESC,
            CASE WHEN notion_page_id <> '' THEN 1 ELSE 0 END DESC,
            last_captured_at DESC,
            id DESC
          LIMIT 1`,
      )
      .get(url, url, url, url) as ConversationRow | undefined) ?? null
  );
}

function sourceAndKeyForPayload(
  payload: Record<string, unknown>,
): Readonly<{ conversationKey: string; source: string; url: string }> {
  const source = safeString(payload.source);
  const sourceType = safeString(payload.sourceType);
  const article = sourceType.toLowerCase() === 'article' && source.toLowerCase() === 'web';
  const rawUrl = safeString(payload.url);
  const url = article ? canonicalizeArticleUrl(rawUrl) || rawUrl : rawUrl;
  const requestedKey = safeString(payload.conversationKey);
  const conversationKey = article
    ? normalizeArticleConversationKey((url && `article:${url}`) || requestedKey)
    : requestedKey;
  return Object.freeze({ conversationKey, source, url });
}

function findExistingConversationForPayload(
  database: SyncNosSqliteDatabase,
  payload: Record<string, unknown>,
): ConversationRow | null {
  const identity = sourceAndKeyForPayload(payload);
  if (identity.source && identity.conversationKey) {
    const direct = selectConversationRowBySourceAndKey(database, identity.source, identity.conversationKey);
    if (direct) return direct;
  }
  return isArticlePayload(payload)
    ? selectLegacyArticleConversationByUrl(database, canonicalizeArticleUrl(payload.url))
    : null;
}

function textFromPayloadOrExisting(payload: Record<string, unknown>, existing: JsonRecord, key: string): string {
  return safeString(payload[key]) || safeString(existing[key]);
}

function normalizeWarningFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeString(item)).filter(Boolean);
}

function buildConversationRecord(
  payload: JsonRecord,
  existing: ConversationRow | null,
): Readonly<{
  author: string;
  conversationKey: string;
  feishuDocId: string;
  lastCapturedAt: number;
  listSiteKey: string;
  listSourceKey: string;
  notionPageId: string;
  payloadJson: string;
  publishedAt: string;
  source: string;
  sourceType: string;
  title: string;
  url: string;
}> {
  const existingPayload = existing ? storedPayload(existing.payload_json) : {};
  const source = safeString(payload.source) || safeString(existing?.source);
  const sourceType = safeString(payload.sourceType) || safeString(existing?.source_type) || 'chat';
  const article = sourceType.toLowerCase() === 'article' && source.toLowerCase() === 'web';
  const urlCandidate = safeString(payload.url) || safeString(existing?.url);
  const url = article ? canonicalizeArticleUrl(urlCandidate) || urlCandidate : urlCandidate;
  const requestedKey = safeString(payload.conversationKey) || safeString(existing?.conversation_key);
  const conversationKey = article
    ? normalizeArticleConversationKey((url && `article:${url}`) || requestedKey)
    : requestedKey;
  if (!source || !conversationKey) invalidArgument();

  const listSourceKey = normalizeListKey(source, 'unknown');
  const derivedSiteKey = normalizeConversationListSiteFilterKey(deriveListSiteKey(url));
  const storedSiteKey = safeString(payload.listSiteKey) || safeString(existing?.list_site_key);
  const listSiteKey =
    derivedSiteKey !== 'unknown'
      ? derivedSiteKey
      : storedSiteKey
        ? normalizeConversationListSiteFilterKey(storedSiteKey)
        : 'unknown';
  const lastCapturedAt =
    normalizeTimestamp(payload.lastCapturedAt) ?? normalizeTimestamp(existing?.last_captured_at) ?? Date.now();
  const warningFlags = Array.isArray(payload.warningFlags)
    ? normalizeWarningFlags(payload.warningFlags)
    : normalizeWarningFlags(existingPayload.warningFlags);

  const nextPayload: Record<string, unknown> = {
    ...existingPayload,
    ...payload,
    sourceType,
    source,
    conversationKey,
    title: textFromPayloadOrExisting(payload, existingPayload, 'title'),
    url,
    author: textFromPayloadOrExisting(payload, existingPayload, 'author'),
    publishedAt: textFromPayloadOrExisting(payload, existingPayload, 'publishedAt'),
    warningFlags,
    notionPageId: textFromPayloadOrExisting(payload, existingPayload, 'notionPageId'),
    feishuDocId: textFromPayloadOrExisting(payload, existingPayload, 'feishuDocId'),
    lastCapturedAt,
    listSourceKey,
    listSiteKey,
  };
  delete nextPayload.id;
  delete nextPayload.commentThreadCount;

  return Object.freeze({
    author: safeString(nextPayload.author),
    conversationKey,
    feishuDocId: safeString(nextPayload.feishuDocId),
    lastCapturedAt,
    listSiteKey,
    listSourceKey,
    notionPageId: safeString(nextPayload.notionPageId),
    payloadJson: canonicalJsonText(nextPayload),
    publishedAt: safeString(nextPayload.publishedAt),
    source,
    sourceType,
    title: safeString(nextPayload.title),
    url,
  });
}

function writeConversationRecord(
  database: SyncNosSqliteDatabase,
  id: number,
  next: ReturnType<typeof buildConversationRecord>,
): ConversationRow {
  const result = database
    .prepare(
      `UPDATE conversations
          SET source = ?, conversation_key = ?, source_type = ?, title = ?, url = ?, author = ?, published_at = ?,
              list_source_key = ?, list_site_key = ?, last_captured_at = ?, notion_page_id = ?, feishu_doc_id = ?,
              payload_json = ?
        WHERE id = ?`,
    )
    .run(
      next.source,
      next.conversationKey,
      next.sourceType,
      next.title,
      next.url,
      next.author,
      next.publishedAt,
      next.listSourceKey,
      next.listSiteKey,
      next.lastCapturedAt,
      next.notionPageId,
      next.feishuDocId,
      next.payloadJson,
      id,
    );
  if (Number(result.changes) !== 1) schemaMismatch();
  const updated = selectConversationRowById(database, id);
  if (!updated) schemaMismatch();
  return updated;
}

function insertConversationRecord(
  database: SyncNosSqliteDatabase,
  next: ReturnType<typeof buildConversationRecord>,
): ConversationRow {
  const result = database
    .prepare(
      `INSERT INTO conversations (
         source, conversation_key, source_type, title, url, author, published_at, list_source_key, list_site_key,
         last_captured_at, notion_page_id, feishu_doc_id, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      next.source,
      next.conversationKey,
      next.sourceType,
      next.title,
      next.url,
      next.author,
      next.publishedAt,
      next.listSourceKey,
      next.listSiteKey,
      next.lastCapturedAt,
      next.notionPageId,
      next.feishuDocId,
      next.payloadJson,
    );
  const id = positiveId(result.lastInsertRowid);
  if (!id) schemaMismatch();
  const inserted = selectConversationRowById(database, id);
  if (!inserted) schemaMismatch();
  return inserted;
}

/** Uses P1's existing-wins merge policy inside the caller's single import transaction. */
export function upsertMigrationConversationWithinTransaction(
  database: SyncNosSqliteDatabase,
  value: unknown,
): Conversation {
  const incoming = canonicalInputPayload(value);
  const existing = findExistingConversationForPayload(database, incoming);
  const merged = canonicalInputPayload(
    mergeMigrationConversationPayload(existing ? storedPayload(existing.payload_json) : {}, incoming),
  );
  const next = buildConversationRecord(merged, existing);
  if (!existing) return asConversation(insertConversationRecord(database, next));
  migrateSyncMappingKeyWithinTransaction(database, {
    legacySource: existing.source,
    legacyConversationKey: existing.conversation_key,
    nextSource: next.source,
    nextConversationKey: next.conversationKey,
    fallbackNotionPageId: next.notionPageId,
  });
  return asConversation(writeConversationRecord(database, existing.id, next));
}

function upsertConversationWithinFactsTransaction(
  database: SyncNosSqliteDatabase,
  payload: ReturnType<typeof canonicalInputPayload>,
): Readonly<{ conversation: Conversation; isNew: boolean }> {
  const existing = findExistingConversationForPayload(database, payload);
  const next = buildConversationRecord(payload, existing);
  let stored: ConversationRow;
  if (existing) {
    migrateSyncMappingKeyWithinTransaction(database, {
      legacySource: existing.source,
      legacyConversationKey: existing.conversation_key,
      nextSource: next.source,
      nextConversationKey: next.conversationKey,
      fallbackNotionPageId: next.notionPageId,
    });
    stored = writeConversationRecord(database, existing.id, next);
  } else {
    stored = insertConversationRecord(database, next);
  }
  refreshConversationFtsDocumentWithinFactsTransaction(database, stored.id);
  return { conversation: asConversation(stored), isNew: !existing };
}

function upsertConversation(database: SyncNosSqliteDatabase, value: unknown): Conversation {
  const payload = canonicalInputPayload(value);
  return execute(
    () =>
      runFactsTransaction(database, () => upsertConversationWithinFactsTransaction(database, payload).conversation)
        .result,
  );
}

function saveConversationSnapshot(database: SyncNosSqliteDatabase, snapshot: ConversationCaptureSnapshot) {
  const payload = canonicalInputPayload(snapshot.conversation);
  const options: MessagePersistenceOptions = {
    ...(snapshot.mode === undefined ? {} : { mode: snapshot.mode }),
    ...(snapshot.diff === undefined ? {} : { diff: snapshot.diff }),
  };
  return execute(
    () =>
      runFactsTransaction(database, () => {
        const saved = upsertConversationWithinFactsTransaction(database, payload);
        const messages = syncMessagesWithinTransaction(database, saved.conversation.id, snapshot.messages, options);
        if (messages.upserted || messages.deleted) {
          refreshConversationFtsDocumentWithinFactsTransaction(database, saved.conversation.id);
        }
        return { ...saved, ...messages };
      }).result,
  );
}

function mergeText(keep: unknown, remove: unknown): string {
  return safeString(keep) || safeString(remove);
}

function mergeWarningFlags(keep: unknown, remove: unknown): string[] {
  return [...new Set([...normalizeWarningFlags(keep), ...normalizeWarningFlags(remove)])];
}

function mergeConversationPayload(
  keep: ConversationRow,
  remove: ConversationRow,
): ReturnType<typeof buildConversationRecord> {
  const keepPayload = storedPayload(keep.payload_json);
  const removePayload = storedPayload(remove.payload_json);
  const mergedPayload: JsonRecord = {
    ...removePayload,
    ...keepPayload,
    sourceType: mergeText(keep.source_type, remove.source_type) || 'chat',
    source: keep.source,
    conversationKey: keep.conversation_key,
    title: mergeText(keep.title, remove.title),
    url: mergeText(keep.url, remove.url),
    author: mergeText(keep.author, remove.author),
    publishedAt: mergeText(keep.published_at, remove.published_at),
    warningFlags: mergeWarningFlags(keepPayload.warningFlags, removePayload.warningFlags),
    notionPageId: mergeText(keep.notion_page_id, remove.notion_page_id),
    feishuDocId: mergeText(keep.feishu_doc_id, remove.feishu_doc_id),
    lastCapturedAt: Math.max(keep.last_captured_at, remove.last_captured_at, 0) || Date.now(),
  } as JsonRecord;
  return buildConversationRecord(mergedPayload, keep);
}

function unmergedConversationResult(
  keepConversationId: number,
  removeConversationId: number,
): SqliteConversationMergeResult {
  return Object.freeze({
    keptConversationId: keepConversationId,
    removedConversationId: removeConversationId,
    movedImageCache: 0,
    movedMessages: 0,
    merged: false,
  });
}

/** Runs inside a caller-owned facts transaction so compound operations cannot interleave a merge. */
export function mergeConversationsWithinTransaction(
  database: SyncNosSqliteDatabase,
  input: Readonly<{ keepConversationId: number; removeConversationId: number }>,
): SqliteConversationMergeResult {
  const keepConversationId = positiveId(input.keepConversationId);
  const removeConversationId = positiveId(input.removeConversationId);
  if (!keepConversationId || !removeConversationId) invalidArgument();
  if (keepConversationId === removeConversationId)
    return unmergedConversationResult(keepConversationId, removeConversationId);

  const keep = selectConversationRowById(database, keepConversationId);
  if (!keep) invalidArgument();
  const remove = selectConversationRowById(database, removeConversationId);
  if (!remove) return unmergedConversationResult(keepConversationId, removeConversationId);

  const merged = mergeConversationPayload(keep, remove);
  const movedMessages = moveMessagesForConversationMerge(database, { keepConversationId, removeConversationId });
  const movedImageCache = moveImagesForConversationMerge(database, { keepConversationId, removeConversationId });
  moveCommentsForConversationMerge(database, {
    keepConversationId,
    keepConversationSource: merged.source,
    keepConversationKey: merged.conversationKey,
    removeConversationId,
  });
  migrateSyncMappingKeyWithinTransaction(database, {
    legacySource: remove.source,
    legacyConversationKey: remove.conversation_key,
    nextSource: merged.source,
    nextConversationKey: merged.conversationKey,
    fallbackNotionPageId: merged.notionPageId,
  });
  writeConversationRecord(database, keepConversationId, merged);
  if (Number(database.prepare('DELETE FROM conversations WHERE id = ?').run(removeConversationId).changes) !== 1)
    schemaMismatch();
  deleteConversationFtsDocumentWithinFactsTransaction(database, removeConversationId);
  refreshConversationFtsDocumentWithinFactsTransaction(database, keepConversationId);
  return Object.freeze({
    keptConversationId: keepConversationId,
    removedConversationId: removeConversationId,
    movedImageCache,
    movedMessages,
    merged: true,
  });
}

function syncConversationMessagesByReference(
  database: SyncNosSqliteDatabase,
  reference: SqliteConversationReference,
  messages: unknown,
  options?: MessagePersistenceOptions,
) {
  return execute(
    () =>
      runFactsTransaction(database, () => {
        const conversation = resolveConversationRowByReference(database, reference);
        const result = syncMessagesWithinTransaction(database, conversation.id, messages, options);
        if (result.upserted || result.deleted) {
          refreshConversationFtsDocumentWithinFactsTransaction(database, conversation.id);
        }
        return result;
      }).result,
  );
}

/**
 * Resolves the stable article reference again inside the write transaction, then changes
 * its canonical URL without exposing a partial conversation/comment/mapping state.
 */
export function updateArticleConversationUrlWithinTransaction(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    confirmedConflict?: SqliteConversationReference;
    conversation: SqliteConversationReference;
    fromCanonicalUrl: unknown;
    toCanonicalUrl: unknown;
  }>,
): SqliteArticleUrlUpdateResult {
  const fromCanonicalUrl = canonicalizeArticleUrl(input.fromCanonicalUrl);
  const toCanonicalUrl = canonicalizeArticleUrl(input.toCanonicalUrl);
  if (!fromCanonicalUrl || !toCanonicalUrl) invalidArgument();

  const current = resolveConversationRowByReference(database, input.conversation);
  const currentCanonicalUrl = canonicalizeArticleUrl(current.url);
  if (
    safeString(current.source).toLowerCase() !== 'web' ||
    safeString(current.source_type).toLowerCase() !== 'article' ||
    !currentCanonicalUrl ||
    currentCanonicalUrl !== fromCanonicalUrl
  ) {
    staleReference();
  }
  if (fromCanonicalUrl === toCanonicalUrl) {
    if (input.confirmedConflict) staleReference();
    return Object.freeze({
      conversationId: current.id,
      conversationKey: current.conversation_key,
      conversationSource: current.source,
      fromCanonicalUrl,
      merged: false,
      toCanonicalUrl,
    });
  }

  const targetConversationKey = `article:${toCanonicalUrl}`;
  const conflict = selectConversationRowBySourceAndKey(database, 'web', targetConversationKey);
  if (conflict && conflict.id !== current.id) {
    if (!input.confirmedConflict) staleReference();
    const confirmed = resolveConversationRowByReference(database, input.confirmedConflict);
    if (confirmed.id !== conflict.id) staleReference();

    const merged = mergeConversationsWithinTransaction(database, {
      keepConversationId: conflict.id,
      removeConversationId: current.id,
    });
    if (!merged.merged) schemaMismatch();
    const kept = selectConversationRowById(database, conflict.id);
    if (!kept) schemaMismatch();
    const next = buildConversationRecord(
      {
        ...storedPayload(kept.payload_json),
        source: 'web',
        sourceType: 'article',
        conversationKey: targetConversationKey,
        url: toCanonicalUrl,
      } as JsonRecord,
      kept,
    );
    const updated = writeConversationRecord(database, kept.id, next);
    refreshConversationFtsDocumentWithinFactsTransaction(database, updated.id);
    return Object.freeze({
      conversationId: updated.id,
      conversationKey: updated.conversation_key,
      conversationSource: updated.source,
      fromCanonicalUrl,
      merged: true,
      removedConversationId: current.id,
      toCanonicalUrl,
    });
  }

  if (input.confirmedConflict) staleReference();
  const next = buildConversationRecord(
    {
      ...storedPayload(current.payload_json),
      source: 'web',
      sourceType: 'article',
      conversationKey: targetConversationKey,
      url: toCanonicalUrl,
    } as JsonRecord,
    current,
  );
  migrateSyncMappingKeyWithinTransaction(database, {
    legacySource: current.source,
    legacyConversationKey: current.conversation_key,
    nextSource: next.source,
    nextConversationKey: next.conversationKey,
    fallbackNotionPageId: next.notionPageId,
  });
  const updated = writeConversationRecord(database, current.id, next);
  refreshConversationFtsDocumentWithinFactsTransaction(database, updated.id);
  return Object.freeze({
    conversationId: updated.id,
    conversationKey: updated.conversation_key,
    conversationSource: updated.source,
    fromCanonicalUrl,
    merged: false,
    toCanonicalUrl,
  });
}

function emptyDeleteResult(): SqliteConversationDeleteResult {
  return Object.freeze({ deletedConversations: 0, deletedImageCache: 0, deletedMappings: 0, deletedMessages: 0 });
}

function deleteConversationRowsWithinTransaction(
  database: SyncNosSqliteDatabase,
  conversations: readonly ConversationRow[],
): SqliteConversationDeleteResult {
  if (!conversations.length) return emptyDeleteResult();
  const uniqueConversations = [
    ...new Map(conversations.map((conversation) => [conversation.id, conversation])).values(),
  ];
  const ids = uniqueConversations.map((conversation) => conversation.id);
  const deletedMessages = deleteMessagesForConversationIds(database, ids);
  const deletedMappings = deleteMappingsForConversationReferences(
    database,
    uniqueConversations.map((conversation) => ({
      source: conversation.source,
      conversationKey: conversation.conversation_key,
    })),
  );
  const deletedImageCache = deleteImagesForConversationIds(database, ids);
  detachCommentsForDeletedConversationIds(database, ids);
  let deletedConversations = 0;
  const statement = database.prepare('DELETE FROM conversations WHERE id = ?');
  for (const id of ids) deletedConversations += Number(statement.run(id).changes) || 0;
  for (const id of ids) deleteConversationFtsDocumentWithinFactsTransaction(database, id);
  return Object.freeze({ deletedConversations, deletedImageCache, deletedMappings, deletedMessages });
}

function deleteConversationsByIds(
  database: SyncNosSqliteDatabase,
  values: readonly unknown[],
): SqliteConversationDeleteResult {
  const ids = [...new Set(values.map(positiveId).filter((id): id is number => id !== null))];
  if (!ids.length) return emptyDeleteResult();
  return execute(() => {
    const existing = ids.map((id) => selectConversationRowById(database, id)).filter(Boolean) as ConversationRow[];
    if (!existing.length) return emptyDeleteResult();
    return runFactsTransaction(database, () => {
      const current = existing
        .map((conversation) => selectConversationRowById(database, conversation.id))
        .filter(Boolean) as ConversationRow[];
      return deleteConversationRowsWithinTransaction(database, current);
    }).result;
  });
}

function deleteConversationsByReferences(
  database: SyncNosSqliteDatabase,
  references: readonly SqliteConversationReference[],
): SqliteConversationDeleteResult {
  if (!Array.isArray(references) || !references.length) invalidArgument();
  return execute(
    () =>
      runFactsTransaction(database, () => {
        const conversations = references.map((reference) => resolveConversationRowByReference(database, reference));
        return deleteConversationRowsWithinTransaction(database, conversations);
      }).result,
  );
}

function queryFilters(query: ReturnType<typeof normalizeConversationListQuery>): Readonly<{
  parameters: unknown[];
  where: string[];
}> {
  const sourceKey = normalizeListKey(query.sourceKey, LIST_SOURCE_KEY_ALL);
  const siteKey = normalizeConversationListSiteFilterKey(query.siteKey);
  const where: string[] = [];
  const parameters: unknown[] = [];
  if (sourceKey !== LIST_SOURCE_KEY_ALL) {
    where.push('list_source_key = ?');
    parameters.push(sourceKey);
  }
  if (siteKey !== LIST_SITE_KEY_ALL) {
    where.push('list_site_key = ?');
    parameters.push(siteKey);
  }
  return Object.freeze({ parameters, where });
}

function sortFacetItems(items: Array<{ key: string; label: string; count: number }>): Array<{
  key: string;
  label: string;
  count: number;
}> {
  return items.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function readSummaryAndFacets(
  database: SyncNosSqliteDatabase,
  query: ReturnType<typeof normalizeConversationListQuery>,
): Readonly<{ facets: ConversationListFacets; summary: ConversationListSummary }> {
  const filters = queryFilters(query);
  const where = filters.where.length ? `WHERE ${filters.where.join(' AND ')}` : '';
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const summaryRow = database
    .prepare(
      `SELECT COUNT(*) AS total_count,
              SUM(CASE WHEN last_captured_at >= ? AND last_captured_at < ? THEN 1 ELSE 0 END) AS today_count
         FROM conversations ${where}`,
    )
    .get(todayStart.getTime(), tomorrowStart.getTime(), ...filters.parameters) as
    | { total_count?: unknown; today_count?: unknown }
    | undefined;
  const totalCount = Number(summaryRow?.total_count) || 0;
  const todayCount = Number(summaryRow?.today_count) || 0;
  const sourceRows = database
    .prepare('SELECT list_source_key AS key, COUNT(*) AS count FROM conversations GROUP BY list_source_key')
    .all() as Array<{ key?: unknown; count?: unknown }>;
  const sourceFilter = normalizeListKey(query.sourceKey, LIST_SOURCE_KEY_ALL);
  const siteFacetSourceScope = sourceFilter === LIST_SOURCE_KEY_ALL ? 'web' : sourceFilter;
  const siteRows = database
    .prepare(
      'SELECT list_site_key AS key, COUNT(*) AS count FROM conversations WHERE list_source_key = ? GROUP BY list_site_key',
    )
    .all(siteFacetSourceScope) as Array<{ key?: unknown; count?: unknown }>;

  const sources = sortFacetItems(
    sourceRows
      .map((row) => ({
        key: normalizeListKey(row.key, 'unknown'),
        label: normalizeListKey(row.key, 'unknown'),
        count: Number(row.count) || 0,
      }))
      .filter((row) => row.count > 0),
  );
  const sites = sortFacetItems(
    siteRows
      .map((row) => {
        const key = normalizeConversationListSiteFilterKey(row.key);
        return {
          key,
          label: key.startsWith('domain:') ? key.slice('domain:'.length) : key,
          count: Number(row.count) || 0,
        };
      })
      .filter((row) => row.count > 0),
  );
  return Object.freeze({ summary: { totalCount, todayCount }, facets: { sources, sites } });
}

function articleCommentThreadCount(database: SyncNosSqliteDatabase, conversation: ConversationRow): number {
  if (safeString(conversation.source_type).toLowerCase() !== 'article') return 0;
  const canonicalUrl = canonicalizeArticleUrl(conversation.url);
  const rows = database
    .prepare(
      `SELECT id, conversation_id, parent_comment_id, canonical_url, payload_json
         FROM article_comments
        WHERE conversation_id = ?${canonicalUrl ? ' OR (conversation_id IS NULL AND canonical_url = ?)' : ''}
        ORDER BY created_at ASC, id ASC`,
    )
    .all(...(canonicalUrl ? [conversation.id, canonicalUrl] : [conversation.id])) as ArticleCommentProjectionRow[];
  const comments = rows.map((row) => ({
    ...storedPayload(row.payload_json),
    id: row.id,
    conversationId: row.conversation_id,
    parentId: row.parent_comment_id,
    canonicalUrl: row.canonical_url,
  }));
  return computeArticleCommentThreadCount(parseArticleCommentDtos(comments));
}

function readInsightStats(database: SyncNosSqliteDatabase, input: InsightStatsRequestPayload): InsightFactsSnapshot {
  const rows = database
    .prepare(
      `SELECT c.id, c.source, c.conversation_key, c.source_type, c.title, c.url, c.last_captured_at,
              COALESCE(mc.message_count, 0) AS insight_message_count
         FROM conversations c
         LEFT JOIN (
           SELECT conversation_id, COUNT(*) AS message_count
             FROM messages
            GROUP BY conversation_id
         ) mc ON mc.conversation_id = c.id`,
    )
    .all() as InsightConversationProjectionRow[];
  const messageCounts = new Map<number, number>();
  const conversations: Conversation[] = [];
  for (const row of rows) {
    const count = Number(row.insight_message_count);
    messageCounts.set(row.id, Number.isSafeInteger(count) && count > 0 ? count : 0);
    conversations.push({
      id: row.id,
      source: row.source,
      conversationKey: row.conversation_key,
      sourceType: row.source_type,
      title: row.title,
      url: row.url,
      lastCapturedAt: row.last_captured_at,
    });
  }
  return buildInsightFactsSnapshot({ conversations, messageCounts }, input);
}

function readConversationListPage(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    cursor?: SqliteConversationListCursor | null;
    limit?: number | null;
    queryInput?: ConversationListQueryInput | null;
  }>,
): ConversationListPage<Conversation> {
  if (database.inTransaction) return readConversationListPageInSnapshot(database, input);
  return database.transaction(() => readConversationListPageInSnapshot(database, input))();
}

/**
 * Keeps Host cursor binding and repository filtering on the exact same normalized
 * source/site scope. A cursor must not be reused for an equivalent-looking but
 * differently normalized filter.
 */
export function normalizeSqliteConversationListQuery(
  queryInput?: ConversationListQueryInput | null,
  limit?: number | null,
): ReturnType<typeof normalizeConversationListQuery> {
  const fallbackLimit = Number(limit);
  const query = normalizeConversationListQuery({
    ...(queryInput || {}),
    ...(Number.isFinite(fallbackLimit) && fallbackLimit > 0 ? { limit: fallbackLimit } : null),
  });
  return Object.freeze({ ...query, siteKey: normalizeConversationListSiteFilterKey(query.siteKey) });
}

/** A cursor is bound to the normalized list filters so callers cannot reuse it across scopes. */
export function createSqliteConversationListScope(
  queryInput?: ConversationListQueryInput | null,
): SqliteConversationListScope {
  const query = normalizeSqliteConversationListQuery(queryInput);
  return Object.freeze({ sourceKey: query.sourceKey, siteKey: query.siteKey });
}

function cursorRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidArgument();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidArgument();
  return value as Record<string, unknown>;
}

function exactCursorKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalidArgument();
}

export function encodeSqliteConversationListCursor(
  cursor: ConversationListCursor,
  scope: SqliteConversationListScope,
): string {
  if ('nativeCursor' in cursor) invalidArgument();
  if (!Number.isSafeInteger(cursor.id) || cursor.id <= 0 || !Number.isFinite(cursor.lastCapturedAt)) invalidArgument();
  return Buffer.from(
    JSON.stringify({
      version: SQLITE_CONVERSATION_LIST_CURSOR_VERSION,
      sourceKey: scope.sourceKey,
      siteKey: scope.siteKey,
      lastCapturedAt: cursor.lastCapturedAt,
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeSqliteConversationListCursor(
  value: unknown,
  scope: SqliteConversationListScope,
): SqliteConversationListCursor {
  if (typeof value !== 'string' || !value) invalidArgument();
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, 'base64url');
    if (!bytes.byteLength || bytes.toString('base64url') !== value) invalidArgument();
  } catch (_error) {
    invalidArgument();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (_error) {
    invalidArgument();
  }
  const token = cursorRecord(parsed);
  exactCursorKeys(token, ['version', 'sourceKey', 'siteKey', 'lastCapturedAt', 'id']);
  if (
    token.version !== SQLITE_CONVERSATION_LIST_CURSOR_VERSION ||
    token.sourceKey !== scope.sourceKey ||
    token.siteKey !== scope.siteKey ||
    !Number.isSafeInteger(token.id) ||
    Number(token.id) <= 0 ||
    !Number.isFinite(token.lastCapturedAt)
  ) {
    invalidArgument();
  }
  return Object.freeze({ lastCapturedAt: Number(token.lastCapturedAt), id: Number(token.id) });
}

function readConversationListPageInSnapshot(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    cursor?: SqliteConversationListCursor | null;
    limit?: number | null;
    queryInput?: ConversationListQueryInput | null;
  }>,
): ConversationListPage<Conversation> {
  const normalizedQuery = normalizeSqliteConversationListQuery(input.queryInput, input.limit);
  const cursor = toComparableCursor(input.cursor);
  const filters = queryFilters(normalizedQuery);
  const where = [...filters.where];
  const parameters = [...filters.parameters];
  if (cursor) {
    where.push('(last_captured_at < ? OR (last_captured_at = ? AND id < ?))');
    parameters.push(cursor.lastCapturedAt, cursor.lastCapturedAt, cursor.id);
  }
  const rows = database
    .prepare(
      `SELECT * FROM conversations ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY last_captured_at DESC, id DESC
        LIMIT ?`,
    )
    .all(...parameters, normalizedQuery.limit + 1) as ConversationRow[];
  const hasMore = rows.length > normalizedQuery.limit;
  const pageRows = hasMore ? rows.slice(0, normalizedQuery.limit) : rows;
  const items = pageRows.map((row) => {
    const conversation = asConversation(row);
    if (safeString(row.source_type).toLowerCase() === 'article') {
      conversation.commentThreadCount = articleCommentThreadCount(database, row);
    }
    return conversation;
  });
  const tail = pageRows.at(-1) ?? null;
  const summaryData = readSummaryAndFacets(database, normalizedQuery);
  return {
    items,
    cursor: hasMore && tail ? { lastCapturedAt: tail.last_captured_at, id: tail.id } : null,
    hasMore,
    summary: summaryData.summary,
    facets: summaryData.facets,
    factsRevision: readFactsRevision(database),
  };
}

function execute<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw mapSqliteError(error);
  }
}

/** A short-lived Host session binds one database handle to its IDB-compatible facts repository. */
export function createConversationsRepository(database: SyncNosSqliteDatabase) {
  return Object.freeze({
    deleteConversationsByIds: (ids: readonly unknown[]) => deleteConversationsByIds(database, ids),
    deleteConversationsByReferences: (references: readonly SqliteConversationReference[]) =>
      deleteConversationsByReferences(database, references),
    findConversationById: (id: unknown): ConversationListOpenTarget | null => {
      const parsedId = positiveId(id);
      return parsedId
        ? execute(() => {
            const row = selectConversationRowById(database, parsedId);
            return row ? asOpenTarget(row) : null;
          })
        : null;
    },
    findConversationBySourceAndKey: (source: unknown, conversationKey: unknown): ConversationListOpenTarget | null => {
      const normalizedSource = safeString(source);
      const normalizedKey = safeString(conversationKey);
      if (!normalizedSource || !normalizedKey) return null;
      return execute(() => {
        const row = selectConversationRowBySourceAndKey(database, normalizedSource, normalizedKey);
        return row ? asOpenTarget(row) : null;
      });
    },
    getConversationById: (id: unknown): Conversation | null => {
      const parsedId = positiveId(id);
      return parsedId
        ? execute(() => {
            const row = selectConversationRowById(database, parsedId);
            return row ? asConversation(row) : null;
          })
        : null;
    },
    getConversationListBootstrap: (queryInput?: ConversationListQueryInput | null, limit?: number | null) =>
      execute(() => readConversationListPage(database, { queryInput, limit, cursor: null })),
    getConversationListPage: (
      queryInput: ConversationListQueryInput | null | undefined,
      cursor: SqliteConversationListCursor,
      limit?: number | null,
    ) => execute(() => readConversationListPage(database, { queryInput, limit, cursor })),
    getInsightStats: (input: InsightStatsRequestPayload) => execute(() => readInsightStats(database, input)),
    syncConversationMessagesByReference: (
      reference: SqliteConversationReference,
      messages: unknown,
      options?: MessagePersistenceOptions,
    ) => syncConversationMessagesByReference(database, reference, messages, options),
    saveConversationSnapshot: (snapshot: ConversationCaptureSnapshot) => saveConversationSnapshot(database, snapshot),
    upsertConversation: (payload: unknown) => upsertConversation(database, payload),
  });
}

export type ConversationsRepository = ReturnType<typeof createConversationsRepository>;
export type { SqliteConversationDeleteResult, SqliteConversationMergeResult };
