import { LocalDataContractError } from '@services/local-data/contracts';
import { computeArticleCommentThreadCount } from '@services/comments/domain/comment-metrics';
import { parseArticleCommentDtos } from '@services/comments/domain/comment-dto';
import {
  LIST_SITE_KEY_ALL,
  LIST_SOURCE_KEY_ALL,
  normalizeConversationListQuery,
  type ConversationListQueryInput,
} from '@services/conversations/domain/list-query';
import type { Conversation } from '@services/conversations/domain/models';
import type {
  ConversationListCursor,
  ConversationListFacets,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListSummary,
} from '@services/conversations/domain/list-pagination';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

import { mapSqliteError } from './database';
import {
  canonicalJsonRecord,
  canonicalJsonText,
  positiveId,
  readCanonicalJsonRecord,
  safeString,
  type JsonRecord,
} from './fact-payload';
import { deleteMappingsForConversationReferences, migrateSyncMappingKeyWithinTransaction } from './mappings-repository';
import { deleteMessagesForConversationIds, moveMessagesForConversationMerge } from './messages-repository';
import { runFactsTransaction } from './revision';
import type { SyncNosSqliteDatabase } from './schema';

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

type SqliteConversationMergeResult = Readonly<{
  keptConversationId: number;
  removedConversationId: number;
  movedImageCache: number;
  movedMessages: number;
  merged: boolean;
}>;

type SqliteConversationDeleteResult = Readonly<{
  deletedConversations: number;
  deletedMappings: number;
  deletedMessages: number;
}>;

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
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

function toComparableCursor(value: ConversationListCursor | null | undefined): ConversationListCursor | null {
  if (!value) return null;
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

function upsertConversation(database: SyncNosSqliteDatabase, value: unknown): Conversation {
  const payload = canonicalInputPayload(value);
  return execute(
    () =>
      runFactsTransaction(database, () => {
        const existing = findExistingConversationForPayload(database, payload);
        const next = buildConversationRecord(payload, existing);
        if (existing) {
          migrateSyncMappingKeyWithinTransaction(database, {
            legacySource: existing.source,
            legacyConversationKey: existing.conversation_key,
            nextSource: next.source,
            nextConversationKey: next.conversationKey,
            fallbackNotionPageId: next.notionPageId,
          });
          database
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
              existing.id,
            );
          const updated = selectConversationRowById(database, existing.id);
          if (!updated) schemaMismatch();
          return asConversation(updated);
        }

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
        return asConversation(inserted);
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

function mergeConversationsByIds(
  database: SyncNosSqliteDatabase,
  input: Readonly<{ keepConversationId: number; removeConversationId: number }>,
): SqliteConversationMergeResult {
  const keepConversationId = positiveId(input.keepConversationId);
  const removeConversationId = positiveId(input.removeConversationId);
  if (!keepConversationId || !removeConversationId) invalidArgument();
  if (keepConversationId === removeConversationId) {
    return Object.freeze({
      keptConversationId: keepConversationId,
      removedConversationId: removeConversationId,
      movedImageCache: 0,
      movedMessages: 0,
      merged: false,
    });
  }

  return execute(() => {
    const keep = selectConversationRowById(database, keepConversationId);
    if (!keep) invalidArgument();
    const remove = selectConversationRowById(database, removeConversationId);
    if (!remove) {
      return Object.freeze({
        keptConversationId: keepConversationId,
        removedConversationId: removeConversationId,
        movedImageCache: 0,
        movedMessages: 0,
        merged: false,
      });
    }
    return runFactsTransaction(database, () => {
      const merged = mergeConversationPayload(keep, remove);
      const movedMessages = moveMessagesForConversationMerge(database, {
        keepConversationId,
        removeConversationId,
      });
      migrateSyncMappingKeyWithinTransaction(database, {
        legacySource: remove.source,
        legacyConversationKey: remove.conversation_key,
        nextSource: keep.source,
        nextConversationKey: keep.conversation_key,
        fallbackNotionPageId: merged.notionPageId,
      });
      database
        .prepare(
          `UPDATE conversations
              SET source = ?, conversation_key = ?, source_type = ?, title = ?, url = ?, author = ?, published_at = ?,
                  list_source_key = ?, list_site_key = ?, last_captured_at = ?, notion_page_id = ?, feishu_doc_id = ?,
                  payload_json = ?
            WHERE id = ?`,
        )
        .run(
          merged.source,
          merged.conversationKey,
          merged.sourceType,
          merged.title,
          merged.url,
          merged.author,
          merged.publishedAt,
          merged.listSourceKey,
          merged.listSiteKey,
          merged.lastCapturedAt,
          merged.notionPageId,
          merged.feishuDocId,
          merged.payloadJson,
          keepConversationId,
        );
      database.prepare('DELETE FROM conversations WHERE id = ?').run(removeConversationId);
      return Object.freeze({
        keptConversationId: keepConversationId,
        removedConversationId: removeConversationId,
        movedImageCache: 0,
        movedMessages,
        merged: true,
      });
    }).result;
  });
}

function deleteConversationsByIds(
  database: SyncNosSqliteDatabase,
  values: readonly unknown[],
): SqliteConversationDeleteResult {
  const ids = [...new Set(values.map(positiveId).filter((id): id is number => id !== null))];
  if (!ids.length) return Object.freeze({ deletedConversations: 0, deletedMappings: 0, deletedMessages: 0 });
  return execute(() => {
    const existing = ids.filter((id) => selectConversationRowById(database, id));
    if (!existing.length) return Object.freeze({ deletedConversations: 0, deletedMappings: 0, deletedMessages: 0 });
    return runFactsTransaction(database, () => {
      const conversations = existing
        .map((id) => selectConversationRowById(database, id))
        .filter(Boolean) as ConversationRow[];
      const deletedMessages = deleteMessagesForConversationIds(
        database,
        conversations.map((conversation) => conversation.id),
      );
      const deletedMappings = deleteMappingsForConversationReferences(
        database,
        conversations.map((conversation) => ({
          source: conversation.source,
          conversationKey: conversation.conversation_key,
        })),
      );
      let deletedConversations = 0;
      const statement = database.prepare('DELETE FROM conversations WHERE id = ?');
      for (const id of existing) deletedConversations += Number(statement.run(id).changes) || 0;
      return Object.freeze({ deletedConversations, deletedMappings, deletedMessages });
    }).result;
  });
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

function readConversationListPage(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    cursor?: ConversationListCursor | null;
    limit?: number | null;
    queryInput?: ConversationListQueryInput | null;
  }>,
): ConversationListPage<Conversation> {
  if (database.inTransaction) return readConversationListPageInSnapshot(database, input);
  return database.transaction(() => readConversationListPageInSnapshot(database, input))();
}

function readConversationListPageInSnapshot(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    cursor?: ConversationListCursor | null;
    limit?: number | null;
    queryInput?: ConversationListQueryInput | null;
  }>,
): ConversationListPage<Conversation> {
  const fallbackLimit = Number(input.limit);
  const query = normalizeConversationListQuery({
    ...(input.queryInput || {}),
    ...(Number.isFinite(fallbackLimit) && fallbackLimit > 0 ? { limit: fallbackLimit } : null),
  });
  const normalizedQuery = { ...query, siteKey: normalizeConversationListSiteFilterKey(query.siteKey) };
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
      cursor: ConversationListCursor,
      limit?: number | null,
    ) => execute(() => readConversationListPage(database, { queryInput, limit, cursor })),
    mergeConversationsByIds: (input: Readonly<{ keepConversationId: number; removeConversationId: number }>) =>
      mergeConversationsByIds(database, input),
    upsertConversation: (payload: unknown) => upsertConversation(database, payload),
  });
}

export type ConversationsRepository = ReturnType<typeof createConversationsRepository>;
export type { SqliteConversationDeleteResult, SqliteConversationMergeResult };
