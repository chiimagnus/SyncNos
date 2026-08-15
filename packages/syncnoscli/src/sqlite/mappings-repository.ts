import { mergeMigrationSyncMappingPayload } from '@services/local-data/facts-archive';
import { LocalDataContractError, type JsonValue } from '@services/local-data/contracts';
import type { Conversation } from '@services/conversations/domain/models';

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

type MappingRow = Readonly<{
  id: number;
  source: string;
  conversation_key: string;
  notion_page_id: string;
  updated_at: number;
  payload_json: string;
}>;

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

type StableConversationReference = Readonly<{
  conversationKey: string;
  source: string;
}>;

type SqliteConversationReference = Readonly<{
  backendConversationId?: unknown;
  conversationKey?: unknown;
  source?: unknown;
}>;

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function staleReference(): never {
  throw new LocalDataContractError('STALE_REFERENCE');
}

function execute<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw mapSqliteError(error);
  }
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function selectConversationById(database: SyncNosSqliteDatabase, id: number): ConversationRow | null {
  return (database.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined) ?? null;
}

function selectConversationByReference(
  database: SyncNosSqliteDatabase,
  reference: SqliteConversationReference,
): ConversationRow {
  const source = safeString(reference?.source);
  const conversationKey = safeString(reference?.conversationKey);
  if (!source || !conversationKey) invalidArgument();
  const conversation =
    (database
      .prepare('SELECT * FROM conversations WHERE source = ? AND conversation_key = ?')
      .get(source, conversationKey) as ConversationRow | undefined) ?? null;
  if (!conversation) staleReference();
  if (
    reference.backendConversationId !== undefined &&
    positiveId(reference.backendConversationId) !== conversation.id
  ) {
    staleReference();
  }
  return conversation;
}

function selectMappingByReference(
  database: SyncNosSqliteDatabase,
  source: string,
  conversationKey: string,
): MappingRow | null {
  return (
    (database
      .prepare('SELECT * FROM sync_mappings WHERE source = ? AND conversation_key = ?')
      .get(source, conversationKey) as MappingRow | undefined) ?? null
  );
}

function asConversation(row: ConversationRow): Conversation {
  const payload = readCanonicalJsonRecord(row.payload_json);
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

function asMapping(row: MappingRow): Record<string, unknown> {
  return {
    ...readCanonicalJsonRecord(row.payload_json),
    id: row.id,
    source: row.source,
    conversationKey: row.conversation_key,
    notionPageId: row.notion_page_id,
    updatedAt: row.updated_at,
  };
}

function referenceFromConversation(row: ConversationRow): StableConversationReference {
  const source = safeString(row.source);
  const conversationKey = safeString(row.conversation_key);
  if (!source || !conversationKey) invalidArgument();
  return Object.freeze({ source, conversationKey });
}

function mergedNestedRecord(existing: unknown, incoming: unknown): Record<string, JsonValue> | null {
  const incomingRecord = object(incoming);
  if (!incomingRecord) return null;
  const existingRecord = object(existing) ?? {};
  const next: Record<string, JsonValue> = { ...(existingRecord as Record<string, JsonValue>) };
  for (const [key, value] of Object.entries(incomingRecord)) {
    const normalizedKey = safeString(key);
    if (!normalizedKey) continue;
    const oldSection = object(existingRecord[normalizedKey]) ?? {};
    const newSection = object(value) ?? {};
    next[normalizedKey] = {
      ...(oldSection as Record<string, JsonValue>),
      ...(newSection as Record<string, JsonValue>),
    };
  }
  return next;
}

function mappingPayload(
  existing: MappingRow | null,
  incoming: Record<string, unknown>,
  reference: StableConversationReference,
  fallbackNotionPageId: string,
): Readonly<{
  notionPageId: string;
  payloadJson: string;
  updatedAt: number;
}> {
  const existingPayload = existing ? readCanonicalJsonRecord(existing.payload_json) : {};
  const merged = {
    ...existingPayload,
    ...incoming,
    source: reference.source,
    conversationKey: reference.conversationKey,
  } as Record<string, unknown>;
  const notionPageId = safeString(merged.notionPageId) || safeString(existing?.notion_page_id) || fallbackNotionPageId;
  const updatedAt = finiteNumber(merged.updatedAt) ?? Date.now();
  merged.notionPageId = notionPageId;
  merged.updatedAt = updatedAt;
  delete merged.id;
  return Object.freeze({ notionPageId, updatedAt, payloadJson: canonicalJsonText(merged) });
}

function writeMapping(
  database: SyncNosSqliteDatabase,
  existing: MappingRow | null,
  reference: StableConversationReference,
  payload: Readonly<{ notionPageId: string; payloadJson: string; updatedAt: number }>,
): MappingRow {
  if (existing) {
    database
      .prepare(
        `UPDATE sync_mappings
            SET source = ?, conversation_key = ?, notion_page_id = ?, updated_at = ?, payload_json = ?
          WHERE id = ?`,
      )
      .run(
        reference.source,
        reference.conversationKey,
        payload.notionPageId,
        payload.updatedAt,
        payload.payloadJson,
        existing.id,
      );
    const updated = database.prepare('SELECT * FROM sync_mappings WHERE id = ?').get(existing.id) as
      | MappingRow
      | undefined;
    if (!updated) invalidArgument();
    return updated;
  }
  const result = database
    .prepare(
      `INSERT INTO sync_mappings (source, conversation_key, notion_page_id, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(reference.source, reference.conversationKey, payload.notionPageId, payload.updatedAt, payload.payloadJson);
  const id = positiveId(result.lastInsertRowid);
  if (!id) invalidArgument();
  const inserted = database.prepare('SELECT * FROM sync_mappings WHERE id = ?').get(id) as MappingRow | undefined;
  if (!inserted) invalidArgument();
  return inserted;
}

/** Uses P1's cursor-aware mapping merge inside the archive import transaction. */
export function upsertMigrationSyncMappingWithinTransaction(database: SyncNosSqliteDatabase, value: unknown): number {
  const incoming = canonicalJsonRecord(value, ['id']) as Record<string, unknown>;
  const source = safeString(incoming.source);
  const conversationKey = safeString(incoming.conversationKey);
  if (!source || !conversationKey) invalidArgument();
  const reference = Object.freeze({ source, conversationKey });
  const existing = selectMappingByReference(database, source, conversationKey);
  const merged = mergeMigrationSyncMappingPayload(
    existing ? readCanonicalJsonRecord(existing.payload_json) : {},
    incoming,
  );
  const row = writeMapping(
    database,
    existing,
    reference,
    mappingPayload(existing, merged, reference, safeString(merged.notionPageId)),
  );
  return row.id;
}

function updateConversationPayload(
  database: SyncNosSqliteDatabase,
  conversation: ConversationRow,
  patch: Record<string, unknown>,
): ConversationRow {
  const payload = { ...readCanonicalJsonRecord(conversation.payload_json), ...patch } as Record<string, unknown>;
  const notionPageId = safeString(payload.notionPageId);
  const feishuDocId = safeString(payload.feishuDocId);
  payload.notionPageId = notionPageId;
  payload.feishuDocId = feishuDocId;
  const nextPayload = canonicalJsonText(payload);
  database
    .prepare('UPDATE conversations SET notion_page_id = ?, feishu_doc_id = ?, payload_json = ? WHERE id = ?')
    .run(notionPageId, feishuDocId, nextPayload, conversation.id);
  const updated = selectConversationById(database, conversation.id);
  if (!updated) invalidArgument();
  return updated;
}

function rawMappingMergePayload(
  target: MappingRow | null,
  legacy: MappingRow | null,
  reference: StableConversationReference,
  fallbackNotionPageId: string,
): Readonly<{ notionPageId: string; payloadJson: string; updatedAt: number }> {
  const targetPayload = target ? readCanonicalJsonRecord(target.payload_json) : {};
  const legacyPayload = legacy ? readCanonicalJsonRecord(legacy.payload_json) : {};
  const merged = mergeMigrationSyncMappingPayload(targetPayload, legacyPayload) as Record<string, unknown>;
  return mappingPayload(target, merged, reference, fallbackNotionPageId);
}

/**
 * Runs inside a caller-owned facts transaction. The target mapping keeps its cursor
 * anchor; P1's conservative merge only fills compatible provider metadata.
 */
export function migrateSyncMappingKeyWithinTransaction(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    fallbackNotionPageId?: unknown;
    legacyConversationKey: unknown;
    legacySource: unknown;
    nextConversationKey: unknown;
    nextSource: unknown;
  }>,
): void {
  const nextSource = safeString(input.nextSource);
  const nextConversationKey = safeString(input.nextConversationKey);
  if (!nextSource || !nextConversationKey) return;
  const reference = Object.freeze({ source: nextSource, conversationKey: nextConversationKey });
  const legacySource = safeString(input.legacySource);
  const legacyConversationKey = safeString(input.legacyConversationKey);
  const fallbackNotionPageId = safeString(input.fallbackNotionPageId);
  const target = selectMappingByReference(database, nextSource, nextConversationKey);
  if (legacySource === nextSource && legacyConversationKey === nextConversationKey) {
    if (!target) return;
    writeMapping(database, target, reference, rawMappingMergePayload(target, null, reference, fallbackNotionPageId));
    return;
  }
  if (!legacySource || !legacyConversationKey) {
    if (!target) return;
    writeMapping(database, target, reference, rawMappingMergePayload(target, null, reference, fallbackNotionPageId));
    return;
  }
  const legacy = selectMappingByReference(database, legacySource, legacyConversationKey);
  if (!legacy) {
    if (!target) return;
    writeMapping(database, target, reference, rawMappingMergePayload(target, null, reference, fallbackNotionPageId));
    return;
  }
  if (!target) {
    writeMapping(database, legacy, reference, rawMappingMergePayload(legacy, null, reference, fallbackNotionPageId));
    return;
  }
  writeMapping(database, target, reference, rawMappingMergePayload(target, legacy, reference, fallbackNotionPageId));
  database.prepare('DELETE FROM sync_mappings WHERE id = ?').run(legacy.id);
}

export function deleteMappingsForConversationReferences(
  database: SyncNosSqliteDatabase,
  references: readonly StableConversationReference[],
): number {
  const statement = database.prepare('DELETE FROM sync_mappings WHERE source = ? AND conversation_key = ?');
  let deleted = 0;
  for (const reference of references)
    deleted += Number(statement.run(reference.source, reference.conversationKey).changes) || 0;
  return deleted;
}

function getSyncMappingByConversation(database: SyncNosSqliteDatabase, value: unknown) {
  const id = positiveId(value);
  if (!id) return null;
  return execute(() => {
    const conversation = selectConversationById(database, id);
    if (!conversation) return null;
    const reference = referenceFromConversation(conversation);
    const mapping = selectMappingByReference(database, reference.source, reference.conversationKey);
    return Object.freeze({ conversation: asConversation(conversation), mapping: mapping ? asMapping(mapping) : null });
  });
}

function patchSyncMapping(database: SyncNosSqliteDatabase, value: unknown, rawPatch: unknown): true {
  const id = positiveId(value);
  if (!id || !object(rawPatch)) invalidArgument();
  const patch = canonicalJsonRecord(rawPatch, ['id', 'source', 'conversationKey']) as Record<string, unknown>;
  return execute(
    () =>
      runFactsTransaction(database, () => {
        let conversation = selectConversationById(database, id);
        if (!conversation) invalidArgument();
        return patchSyncMappingForConversation(database, conversation, patch);
      }).result,
  );
}

function patchSyncMappingForConversation(
  database: SyncNosSqliteDatabase,
  initialConversation: ConversationRow,
  patch: Record<string, unknown>,
): true {
  let conversation = initialConversation;
  const reference = referenceFromConversation(conversation);
  const existing = selectMappingByReference(database, reference.source, reference.conversationKey);
  const existingPayload = existing ? readCanonicalJsonRecord(existing.payload_json) : {};
  const notionSections = mergedNestedRecord(existingPayload.notionSections, patch.notionSections);
  if (notionSections) patch.notionSections = notionSections;
  else delete patch.notionSections;
  const payload = mappingPayload(existing, patch, reference, safeString(conversation.notion_page_id));
  const mapping = writeMapping(database, existing, reference, payload);
  const nextFeishuDocId = safeString((asMapping(mapping) as Record<string, unknown>).feishuDocId);
  if (nextFeishuDocId && nextFeishuDocId !== safeString(conversation.feishu_doc_id)) {
    conversation = updateConversationPayload(database, conversation, { feishuDocId: nextFeishuDocId });
  }
  return true;
}

function patchSyncMappingByReference(
  database: SyncNosSqliteDatabase,
  reference: SqliteConversationReference,
  rawPatch: unknown,
): true {
  if (!object(rawPatch)) invalidArgument();
  const patch = canonicalJsonRecord(rawPatch, ['id', 'source', 'conversationKey']) as Record<string, unknown>;
  return execute(
    () =>
      runFactsTransaction(database, () =>
        patchSyncMappingForConversation(database, selectConversationByReference(database, reference), patch),
      ).result,
  );
}

function setConversationNotionPageId(
  database: SyncNosSqliteDatabase,
  value: unknown,
  notionPageId: unknown,
  meta?: Readonly<{ notionPageUrl?: unknown; notionWorkspaceSlug?: unknown }>,
): true {
  const id = positiveId(value);
  if (!id) invalidArgument();
  const pageId = safeString(notionPageId);
  const pageUrl = safeString(meta?.notionPageUrl);
  const workspaceSlug = safeString(meta?.notionWorkspaceSlug);
  return execute(
    () =>
      runFactsTransaction(database, () => {
        const conversation = selectConversationById(database, id);
        if (!conversation) invalidArgument();
        return setConversationNotionPageIdForConversation(database, conversation, pageId, pageUrl, workspaceSlug);
      }).result,
  );
}

function setConversationNotionPageIdForConversation(
  database: SyncNosSqliteDatabase,
  initialConversation: ConversationRow,
  pageId: string,
  pageUrl: string,
  workspaceSlug: string,
): true {
  const conversation = updateConversationPayload(database, initialConversation, {
    notionPageId: pageId,
    ...(pageUrl ? { notionPageUrl: pageUrl } : null),
    ...(workspaceSlug ? { notionWorkspaceSlug: workspaceSlug } : null),
  });
  const reference = referenceFromConversation(conversation);
  const existing = selectMappingByReference(database, reference.source, reference.conversationKey);
  writeMapping(
    database,
    existing,
    reference,
    mappingPayload(
      existing,
      {
        notionPageId: pageId,
        ...(pageUrl ? { notionPageUrl: pageUrl } : null),
        ...(workspaceSlug ? { notionWorkspaceSlug: workspaceSlug } : null),
        updatedAt: Date.now(),
      },
      reference,
      pageId,
    ),
  );
  return true;
}

function setConversationNotionPageIdByReference(
  database: SyncNosSqliteDatabase,
  reference: SqliteConversationReference,
  notionPageId: unknown,
  meta?: Readonly<{ notionPageUrl?: unknown; notionWorkspaceSlug?: unknown }>,
): true {
  const pageId = safeString(notionPageId);
  const pageUrl = safeString(meta?.notionPageUrl);
  const workspaceSlug = safeString(meta?.notionWorkspaceSlug);
  return execute(
    () =>
      runFactsTransaction(database, () =>
        setConversationNotionPageIdForConversation(
          database,
          selectConversationByReference(database, reference),
          pageId,
          pageUrl,
          workspaceSlug,
        ),
      ).result,
  );
}

function setSyncCursor(
  database: SyncNosSqliteDatabase,
  value: unknown,
  input: Readonly<{
    lastSyncedAt?: unknown;
    lastSyncedMessageKey?: unknown;
    lastSyncedMessageUpdatedAt?: unknown;
    lastSyncedSequence?: unknown;
    notionSectionCursors?: Record<string, unknown>;
    notionSectionDigests?: Record<string, unknown>;
    notionSections?: Record<string, unknown>;
  }>,
): true {
  const id = positiveId(value);
  if (!id || !object(input)) invalidArgument();
  return execute(
    () =>
      runFactsTransaction(database, () => {
        const conversation = selectConversationById(database, id);
        if (!conversation) invalidArgument();
        return setSyncCursorForConversation(database, conversation, input);
      }).result,
  );
}

type SyncCursorInput = Parameters<typeof setSyncCursor>[2];

function setSyncCursorForConversation(
  database: SyncNosSqliteDatabase,
  conversation: ConversationRow,
  input: SyncCursorInput,
): true {
  const reference = referenceFromConversation(conversation);
  const existing = selectMappingByReference(database, reference.source, reference.conversationKey);
  const existingPayload = existing ? readCanonicalJsonRecord(existing.payload_json) : {};
  const notionSections = mergedNestedRecord(existingPayload.notionSections, input.notionSections);
  const notionSectionCursors = mergedNestedRecord(existingPayload.notionSectionCursors, input.notionSectionCursors);
  const notionSectionDigests = mergedNestedRecord(existingPayload.notionSectionDigests, input.notionSectionDigests);
  const payload = mappingPayload(
    existing,
    {
      lastSyncedMessageKey: safeString(input.lastSyncedMessageKey),
      lastSyncedSequence: finiteNumber(input.lastSyncedSequence),
      lastSyncedAt: finiteNumber(input.lastSyncedAt) ?? Date.now(),
      lastSyncedMessageUpdatedAt: finiteNumber(input.lastSyncedMessageUpdatedAt),
      ...(notionSections ? { notionSections } : null),
      ...(notionSectionCursors ? { notionSectionCursors } : null),
      ...(notionSectionDigests ? { notionSectionDigests } : null),
      updatedAt: Date.now(),
    },
    reference,
    safeString(conversation.notion_page_id),
  );
  writeMapping(database, existing, reference, payload);
  return true;
}

function setSyncCursorByReference(
  database: SyncNosSqliteDatabase,
  reference: SqliteConversationReference,
  input: SyncCursorInput,
): true {
  if (!object(input)) invalidArgument();
  return execute(
    () =>
      runFactsTransaction(database, () =>
        setSyncCursorForConversation(database, selectConversationByReference(database, reference), input),
      ).result,
  );
}

function clearSyncCursor(database: SyncNosSqliteDatabase, value: unknown): true {
  const id = positiveId(value);
  if (!id) invalidArgument();
  return execute(() => {
    const conversation = selectConversationById(database, id);
    if (!conversation) invalidArgument();
    const reference = referenceFromConversation(conversation);
    const existing = selectMappingByReference(database, reference.source, reference.conversationKey);
    if (!existing) return true;
    return runFactsTransaction(database, () => {
      writeMapping(
        database,
        existing,
        reference,
        mappingPayload(
          existing,
          {
            lastSyncedMessageKey: '',
            lastSyncedSequence: null,
            lastSyncedAt: null,
            lastSyncedMessageUpdatedAt: null,
            updatedAt: Date.now(),
          },
          reference,
          safeString(conversation.notion_page_id),
        ),
      );
      return true as const;
    }).result;
  });
}

function clearSyncCursorByReference(database: SyncNosSqliteDatabase, reference: SqliteConversationReference): true {
  return execute(() => {
    const initialConversation = selectConversationByReference(database, reference);
    const initialReference = referenceFromConversation(initialConversation);
    if (!selectMappingByReference(database, initialReference.source, initialReference.conversationKey)) return true;
    return runFactsTransaction(database, () => {
      const conversation = selectConversationByReference(database, reference);
      const stableReference = referenceFromConversation(conversation);
      const existing = selectMappingByReference(database, stableReference.source, stableReference.conversationKey);
      if (!existing) return true as const;
      writeMapping(
        database,
        existing,
        stableReference,
        mappingPayload(
          existing,
          {
            lastSyncedMessageKey: '',
            lastSyncedSequence: null,
            lastSyncedAt: null,
            lastSyncedMessageUpdatedAt: null,
            updatedAt: Date.now(),
          },
          stableReference,
          safeString(conversation.notion_page_id),
        ),
      );
      return true as const;
    }).result;
  });
}

/** One SQLite handle hosts all provider mapping operations for the short-lived Host invocation. */
export function createMappingsRepository(database: SyncNosSqliteDatabase) {
  return Object.freeze({
    clearSyncCursor: (conversationId: unknown) => clearSyncCursor(database, conversationId),
    clearSyncCursorByReference: (reference: SqliteConversationReference) =>
      clearSyncCursorByReference(database, reference),
    getSyncMappingByConversation: (conversationId: unknown) => getSyncMappingByConversation(database, conversationId),
    patchSyncMapping: (conversationId: unknown, patch: unknown) => patchSyncMapping(database, conversationId, patch),
    patchSyncMappingByReference: (reference: SqliteConversationReference, patch: unknown) =>
      patchSyncMappingByReference(database, reference, patch),
    setConversationNotionPageId: (
      conversationId: unknown,
      notionPageId: unknown,
      meta?: Readonly<{ notionPageUrl?: unknown; notionWorkspaceSlug?: unknown }>,
    ) => setConversationNotionPageId(database, conversationId, notionPageId, meta),
    setConversationNotionPageIdByReference: (
      reference: SqliteConversationReference,
      notionPageId: unknown,
      meta?: Readonly<{ notionPageUrl?: unknown; notionWorkspaceSlug?: unknown }>,
    ) => setConversationNotionPageIdByReference(database, reference, notionPageId, meta),
    setSyncCursor: (conversationId: unknown, input: Parameters<typeof setSyncCursor>[2]) =>
      setSyncCursor(database, conversationId, input),
    setSyncCursorByReference: (reference: SqliteConversationReference, input: SyncCursorInput) =>
      setSyncCursorByReference(database, reference, input),
  });
}

export type MappingsRepository = ReturnType<typeof createMappingsRepository>;
