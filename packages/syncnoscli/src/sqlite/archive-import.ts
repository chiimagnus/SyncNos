import { Buffer } from 'node:buffer';

import {
  LocalDataContractError,
  parseMigrationId,
  parseMigrationStreamRequestPayload,
  parseOrderedFrameDigest,
  type MigrationId,
  type MigrationStreamRequestPayload,
} from '@services/local-data/contracts';
import {
  createMigrationFactReferenceValidator,
  decodeMigrationFactRecord,
  encodeCanonicalJson,
  verifyMigrationCommentFact,
  type MigrationCommentFact,
  type MigrationFactRecord,
} from '@services/local-data/facts-archive';
import {
  FACT_STREAM_KINDS,
  parseFactsManifest,
  type FactStreamKind,
  type FactsManifest,
} from '@services/local-data/facts-manifest';
import { OrderedFrameDigestAccumulator, sha256Hex, type DigestProvider } from '@services/local-data/digest';
import {
  NativeWireSessionReceiver,
  parseNativeWireFrame,
  type NativeWireFrame,
  type NativeWireRecordBeginFrame,
} from '@services/local-data/native-wire';

import { nodeDigestProvider } from '../runtime/node-digest';
import { writeMigrationCommentWithinTransaction } from './comments-repository';
import { upsertMigrationConversationWithinTransaction } from './conversations-repository';
import { mapSqliteError } from './database';
import { canonicalJsonText, positiveId, readCanonicalJsonRecord, safeString } from './fact-payload';
import { upsertMigrationImageWithinTransaction } from './images-repository';
import { upsertMigrationSyncMappingWithinTransaction } from './mappings-repository';
import {
  rewriteMigrationMessageAssetUrlsWithinTransaction,
  upsertMigrationMessageWithinTransaction,
} from './messages-repository';
import { bumpFactsRevision } from './revision';
import type { SyncNosSqliteDatabase } from './schema';

const MAX_RECEIPT_COMMENT_DIAGNOSTICS = 32;
const ASSET_URL_PATTERN = /syncnos-asset:\/\/(\d+)/gi;

type FactCounts = Record<FactStreamKind, number>;

type StagedRecordRow = Readonly<{
  kind: FactStreamKind;
  ordinal: number;
  record_blob: Uint8Array;
  source_local_id: string;
}>;

type StagedImageRow = StagedRecordRow &
  Readonly<{
    asset_byte_length: number;
    asset_bytes: Uint8Array;
  }>;

type CommentGroupRow = Readonly<{
  context_key: string;
  incoming_count: number;
  structural_digest: string;
  target_count: number;
}>;

type ExistingCommentRow = Readonly<{
  id: number;
  parent_comment_id: number | null;
}>;

type ActiveRecordSession = {
  completed: Readonly<{ bytes: Uint8Array; record: MigrationFactRecord }> | null;
  kind: 'record';
  recordBegin: NativeWireRecordBeginFrame | null;
  receiver: NativeWireSessionReceiver;
  sessionId: string;
};

type ActiveImageSession = {
  bytes: Uint8Array;
  kind: 'image';
  receiver: NativeWireSessionReceiver;
  sessionId: string;
};

type ActiveSession = ActiveRecordSession | ActiveImageSession;

type PendingImage = Readonly<{
  byteLength: number;
  sourceLocalId: string;
}>;

type StoredImportResult = Readonly<{
  commentAmbiguity: Readonly<{
    groupCount: number;
    samples: readonly Readonly<{
      code: 'ambiguous_comment_signature';
      incomingGroupCount: number;
      targetGroupCount: number;
    }>[];
  }>;
  factCounts: Readonly<FactCounts>;
  factsRevision: number;
  manifestDigest: string;
  migrationId: MigrationId;
}>;

type ImportStagedFactsOutcome = Readonly<{
  alreadyCommitted: boolean;
  result: StoredImportResult;
}>;

export type FactsArchiveImportResult = StoredImportResult &
  Readonly<{
    alreadyCommitted: boolean;
  }>;

export type StagedFactsImporter = Readonly<{
  abort: () => void;
  acceptFrame: (frame: unknown) => Promise<void>;
  cleanup: () => void;
  complete: (manifest: unknown) => Promise<FactsArchiveImportResult>;
}>;

export type CreateStagedFactsImporterInput = Readonly<{
  database: SyncNosSqliteDatabase;
  digestProvider?: DigestProvider;
  request: unknown;
}>;

function migrationValidationFailure(): never {
  throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
}

function receiptMismatch(): never {
  throw new LocalDataContractError('MIGRATION_RECEIPT_MISMATCH');
}

function busy(): never {
  throw new LocalDataContractError('BUSY');
}

function schemaMismatch(): never {
  throw new LocalDataContractError('SCHEMA_MISMATCH');
}

function publicImportError(error: unknown): LocalDataContractError {
  if (error instanceof LocalDataContractError) return error;
  return mapSqliteError(error);
}

/** A malformed in-session frame is an archive validation failure, not a caller argument error. */
function publicInboundFrameError(error: unknown): LocalDataContractError {
  if (error instanceof LocalDataContractError) {
    if (error.code === 'PROTOCOL_MISMATCH' || error.code === 'PAYLOAD_TOO_LARGE') return error;
    return new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
  }
  return mapSqliteError(error);
}

/** Staged facts have already crossed the public request boundary; invalid rows are migration failures. */
function publicCompletionError(error: unknown): LocalDataContractError {
  if (error instanceof LocalDataContractError && error.code === 'INVALID_ARGUMENT') {
    return new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
  }
  return publicImportError(error);
}

function emptyFactCounts(): FactCounts {
  return {
    conversations: 0,
    sync_mappings: 0,
    messages: 0,
    image_cache: 0,
    article_comments: 0,
  };
}

function safeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) migrationValidationFailure();
  return Number(value);
}

function safePositiveId(value: unknown): number {
  const id = positiveId(value);
  if (!id) migrationValidationFailure();
  return id;
}

function stagedBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength <= 0) migrationValidationFailure();
  return value;
}

function sameFactCounts(left: Readonly<FactCounts>, right: Readonly<FactCounts>): boolean {
  return FACT_STREAM_KINDS.every((kind) => left[kind] === right[kind]);
}

function factsManifestDigest(manifest: FactsManifest, provider: DigestProvider): Promise<string> {
  return sha256Hex(provider, encodeCanonicalJson(manifest).bytes);
}

function runStagingTransaction<T>(database: SyncNosSqliteDatabase, operation: () => T): T {
  if (database.inTransaction) busy();
  database.exec('BEGIN IMMEDIATE;');
  try {
    const result = operation();
    database.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch (_rollbackError) {
      // The pending operation did not commit; preserve the actionable failure.
    }
    throw error;
  }
}

function beginStaging(database: SyncNosSqliteDatabase, request: MigrationStreamRequestPayload): void {
  runStagingTransaction(database, () => {
    const existing = database
      .prepare('SELECT migration_id FROM staging_metadata WHERE migration_id = ?')
      .get(request.migrationId);
    if (existing) throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
    const now = Date.now();
    database
      .prepare(
        `INSERT INTO staging_metadata (migration_id, protocol_version, schema_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(request.migrationId, request.protocolVersion, request.schemaVersion, now, now);
  });
}

function clearStaging(database: SyncNosSqliteDatabase, migrationId: MigrationId): void {
  runStagingTransaction(database, () => {
    database.prepare('DELETE FROM staging_comment_groups WHERE migration_id = ?').run(migrationId);
    database.prepare('DELETE FROM staging_conversation_identities WHERE migration_id = ?').run(migrationId);
    database.prepare('DELETE FROM staging_remaps WHERE migration_id = ?').run(migrationId);
    database.prepare('DELETE FROM staging_image_assets WHERE migration_id = ?').run(migrationId);
    database.prepare('DELETE FROM staging_records WHERE migration_id = ?').run(migrationId);
    database.prepare('DELETE FROM staging_metadata WHERE migration_id = ?').run(migrationId);
  });
}

function decodeStagedRecord(row: StagedRecordRow): MigrationFactRecord {
  const record = decodeMigrationFactRecord(stagedBytes(row.record_blob));
  if (record.kind !== row.kind || record.sourceLocalId !== row.source_local_id) migrationValidationFailure();
  return record;
}

function storeRemap(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
  kind: 'article_comments' | 'conversations' | 'image_cache' | 'messages',
  sourceLocalId: string,
  targetId: number,
): void {
  database
    .prepare(
      `INSERT INTO staging_remaps (migration_id, fact_kind, source_local_id, target_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run(migrationId, kind, sourceLocalId, safePositiveId(targetId));
}

function remappedId(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
  kind: 'article_comments' | 'conversations' | 'image_cache' | 'messages',
  sourceLocalId: string,
): number {
  const row = database
    .prepare(
      `SELECT target_id FROM staging_remaps
        WHERE migration_id = ? AND fact_kind = ? AND source_local_id = ?`,
    )
    .get(migrationId, kind, sourceLocalId) as { target_id?: unknown } | undefined;
  return safePositiveId(row?.target_id);
}

function receiptResult(value: unknown): StoredImportResult {
  try {
    const input = readCanonicalJsonRecord(value);
    const expected = ['commentAmbiguity', 'factCounts', 'factsRevision', 'manifestDigest', 'migrationId'];
    const actual = Object.keys(input).sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) schemaMismatch();
    const factCountsRecord = input.factCounts;
    if (!factCountsRecord || typeof factCountsRecord !== 'object' || Array.isArray(factCountsRecord)) schemaMismatch();
    const factCounts = emptyFactCounts();
    for (const kind of FACT_STREAM_KINDS) {
      const count = (factCountsRecord as Record<string, unknown>)[kind];
      if (!Number.isSafeInteger(count) || Number(count) < 0) schemaMismatch();
      factCounts[kind] = Number(count);
    }
    const ambiguity = input.commentAmbiguity;
    if (!ambiguity || typeof ambiguity !== 'object' || Array.isArray(ambiguity)) schemaMismatch();
    const ambiguityRecord = ambiguity as Record<string, unknown>;
    if (Object.keys(ambiguityRecord).sort().join(',') !== 'groupCount,samples') schemaMismatch();
    const groupCount = ambiguityRecord.groupCount;
    const samples = ambiguityRecord.samples;
    if (!Number.isSafeInteger(groupCount) || Number(groupCount) < 0 || !Array.isArray(samples)) schemaMismatch();
    if (samples.length > MAX_RECEIPT_COMMENT_DIAGNOSTICS || samples.length > Number(groupCount)) schemaMismatch();
    const parsedSamples = samples.map((sample) => {
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) schemaMismatch();
      const entry = sample as Record<string, unknown>;
      if (Object.keys(entry).sort().join(',') !== 'code,incomingGroupCount,targetGroupCount') schemaMismatch();
      if (
        entry.code !== 'ambiguous_comment_signature' ||
        !Number.isSafeInteger(entry.incomingGroupCount) ||
        Number(entry.incomingGroupCount) <= 1 ||
        !Number.isSafeInteger(entry.targetGroupCount) ||
        Number(entry.targetGroupCount) < 0
      ) {
        schemaMismatch();
      }
      return Object.freeze({
        code: 'ambiguous_comment_signature' as const,
        incomingGroupCount: Number(entry.incomingGroupCount),
        targetGroupCount: Number(entry.targetGroupCount),
      });
    });
    const factsRevision = input.factsRevision;
    if (!Number.isSafeInteger(factsRevision) || Number(factsRevision) < 0) schemaMismatch();
    return Object.freeze({
      commentAmbiguity: Object.freeze({ groupCount: Number(groupCount), samples: Object.freeze(parsedSamples) }),
      factCounts: Object.freeze(factCounts),
      factsRevision: Number(factsRevision),
      manifestDigest: parseOrderedFrameDigest(input.manifestDigest),
      migrationId: parseMigrationId(input.migrationId),
    });
  } catch (_error) {
    schemaMismatch();
  }
}

function assertImageAssetsComplete(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
  expectedCount: number,
): void {
  const row = database
    .prepare('SELECT COUNT(*) AS count FROM staging_image_assets WHERE migration_id = ?')
    .get(migrationId) as { count?: unknown } | undefined;
  if (safeCount(row?.count) !== expectedCount) migrationValidationFailure();
}

/** Reads one staging row at a time so a SQLite statement never remains open while facts mutate. */
function nextStagedRecord(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
  kind: FactStreamKind,
  afterOrdinal: number,
): StagedRecordRow | null {
  const row = database
    .prepare(
      `SELECT kind, ordinal, record_blob, source_local_id
         FROM staging_records
        WHERE migration_id = ? AND kind = ? AND ordinal > ?
        ORDER BY ordinal ASC
        LIMIT 1`,
    )
    .get(migrationId, kind, afterOrdinal) as StagedRecordRow | undefined;
  if (!row) return null;
  if (!Number.isSafeInteger(row.ordinal) || row.ordinal < 0) migrationValidationFailure();
  return row;
}

function importConversations(database: SyncNosSqliteDatabase, migrationId: MigrationId): void {
  let afterOrdinal = -1;
  for (;;) {
    const row = nextStagedRecord(database, migrationId, 'conversations', afterOrdinal);
    if (!row) break;
    afterOrdinal = row.ordinal;
    const record = decodeStagedRecord(row);
    if (record.kind !== 'conversations') migrationValidationFailure();
    const conversation = upsertMigrationConversationWithinTransaction(database, { ...record.payload });
    storeRemap(database, migrationId, 'conversations', record.sourceLocalId, conversation.id);
    const source = safeString(record.payload.source);
    const conversationKey = safeString(record.payload.conversationKey);
    if (!source || !conversationKey) migrationValidationFailure();
    database
      .prepare(
        `INSERT INTO staging_conversation_identities (migration_id, source, conversation_key, target_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(migration_id, source, conversation_key) DO UPDATE SET target_id = excluded.target_id`,
      )
      .run(migrationId, source, conversationKey, conversation.id);
  }
}

function normalizedMappingPayload(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const source = safeString(value.source);
  const conversationKey = safeString(value.conversationKey);
  if (!source || !conversationKey) migrationValidationFailure();
  const identity = database
    .prepare(
      `SELECT target_id
         FROM staging_conversation_identities
        WHERE migration_id = ? AND source = ? AND conversation_key = ?`,
    )
    .get(migrationId, source, conversationKey) as { target_id?: unknown } | undefined;
  if (!identity) return value;
  const conversation = database
    .prepare('SELECT source, conversation_key FROM conversations WHERE id = ?')
    .get(safePositiveId(identity.target_id)) as { conversation_key?: unknown; source?: unknown } | undefined;
  const targetSource = safeString(conversation?.source);
  const targetConversationKey = safeString(conversation?.conversation_key);
  if (!targetSource || !targetConversationKey) migrationValidationFailure();
  return { ...value, source: targetSource, conversationKey: targetConversationKey };
}

function importMappings(database: SyncNosSqliteDatabase, migrationId: MigrationId): void {
  let afterOrdinal = -1;
  for (;;) {
    const row = nextStagedRecord(database, migrationId, 'sync_mappings', afterOrdinal);
    if (!row) break;
    afterOrdinal = row.ordinal;
    const record = decodeStagedRecord(row);
    if (record.kind !== 'sync_mappings') migrationValidationFailure();
    upsertMigrationSyncMappingWithinTransaction(
      database,
      normalizedMappingPayload(database, migrationId, { ...record.payload }),
    );
  }
}

function importMessages(database: SyncNosSqliteDatabase, migrationId: MigrationId): void {
  let afterOrdinal = -1;
  for (;;) {
    const row = nextStagedRecord(database, migrationId, 'messages', afterOrdinal);
    if (!row) break;
    afterOrdinal = row.ordinal;
    const record = decodeStagedRecord(row);
    if (record.kind !== 'messages') migrationValidationFailure();
    const message = upsertMigrationMessageWithinTransaction(database, {
      conversationId: remappedId(database, migrationId, 'conversations', record.conversationSourceLocalId),
      payload: { ...record.payload },
    });
    if (message.rewritesImportedMarkdown) {
      storeRemap(database, migrationId, 'messages', record.sourceLocalId, message.id);
    }
  }
}

function importImages(database: SyncNosSqliteDatabase, migrationId: MigrationId): void {
  let afterOrdinal = -1;
  for (;;) {
    const recordRow = nextStagedRecord(database, migrationId, 'image_cache', afterOrdinal);
    if (!recordRow) break;
    afterOrdinal = recordRow.ordinal;
    const asset = database
      .prepare(
        `SELECT byte_length AS asset_byte_length, bytes AS asset_bytes
           FROM staging_image_assets
          WHERE migration_id = ? AND source_local_id = ?`,
      )
      .get(migrationId, recordRow.source_local_id) as
      | Readonly<{ asset_byte_length: number; asset_bytes: Uint8Array }>
      | undefined;
    if (!asset) migrationValidationFailure();
    const row: StagedImageRow = { ...recordRow, ...asset };
    const record = decodeStagedRecord(row);
    if (record.kind !== 'image_cache') migrationValidationFailure();
    const bytes = stagedBytes(row.asset_bytes);
    if (safeCount(row.asset_byte_length) !== record.byteLength || bytes.byteLength !== record.byteLength)
      migrationValidationFailure();
    const image = upsertMigrationImageWithinTransaction(database, {
      bytes,
      contentType: record.contentType,
      conversationId: remappedId(database, migrationId, 'conversations', record.conversationSourceLocalId),
      metadata: { ...record.payload },
    });
    storeRemap(database, migrationId, 'image_cache', record.sourceLocalId, image.id);
  }
}

function imageRewriteMaps(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
  markdown: string,
): Readonly<{ fallbackUrlByOldId: Map<number, string>; remap: Map<number, number> }> {
  const fallbackUrlByOldId = new Map<number, string>();
  const remap = new Map<number, number>();
  const seen = new Set<number>();
  ASSET_URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = ASSET_URL_PATTERN.exec(markdown)) !== null) {
    const oldId = Number(match[1]);
    if (!Number.isSafeInteger(oldId) || oldId <= 0 || seen.has(oldId)) continue;
    seen.add(oldId);
    const sourceLocalId = String(oldId);
    const remapRow = database
      .prepare(
        `SELECT target_id FROM staging_remaps
          WHERE migration_id = ? AND fact_kind = 'image_cache' AND source_local_id = ?`,
      )
      .get(migrationId, sourceLocalId) as { target_id?: unknown } | undefined;
    if (remapRow) {
      remap.set(oldId, safePositiveId(remapRow.target_id));
      continue;
    }
    const fallbackRow = database
      .prepare(
        `SELECT image_url FROM staging_records
          WHERE migration_id = ? AND kind = 'image_cache' AND source_local_id = ?`,
      )
      .get(migrationId, sourceLocalId) as { image_url?: unknown } | undefined;
    const fallback = safeString(fallbackRow?.image_url);
    if (fallback) fallbackUrlByOldId.set(oldId, fallback);
  }
  return Object.freeze({ fallbackUrlByOldId, remap });
}

function rewriteMessages(database: SyncNosSqliteDatabase, migrationId: MigrationId): void {
  let afterSourceLocalId = '0';
  for (;;) {
    const row = database
      .prepare(
        `SELECT r.source_local_id, r.target_id, m.content_markdown
           FROM staging_remaps r
           JOIN messages m ON m.id = r.target_id
          WHERE r.migration_id = ?
            AND r.fact_kind = 'messages'
            AND CAST(r.source_local_id AS INTEGER) > CAST(? AS INTEGER)
          ORDER BY CAST(r.source_local_id AS INTEGER) ASC
          LIMIT 1`,
      )
      .get(migrationId, afterSourceLocalId) as
      | Readonly<{ content_markdown: unknown; source_local_id: string; target_id: unknown }>
      | undefined;
    if (!row) break;
    afterSourceLocalId = row.source_local_id;
    const markdown = typeof row.content_markdown === 'string' ? row.content_markdown : migrationValidationFailure();
    const maps = imageRewriteMaps(database, migrationId, markdown);
    if (!maps.remap.size && !maps.fallbackUrlByOldId.size && !markdown.includes('syncnos-asset://')) continue;
    rewriteMigrationMessageAssetUrlsWithinTransaction(database, {
      fallbackUrlByOldId: maps.fallbackUrlByOldId,
      messageId: safePositiveId(row.target_id),
      remap: maps.remap,
    });
  }
}

function prepareCommentGroups(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
): StoredImportResult['commentAmbiguity'] {
  database
    .prepare(
      `INSERT INTO staging_comment_groups (
         migration_id, context_key, structural_digest, incoming_count, target_count
       )
       SELECT s.migration_id,
              s.comment_context_key,
              s.structural_digest,
              COUNT(*),
              (
                SELECT COUNT(*)
                  FROM article_comments c
                 WHERE c.canonical_url = s.comment_canonical_url
                   AND c.conversation_source IS s.comment_conversation_source
                   AND c.conversation_key IS s.comment_conversation_key
                   AND c.structural_digest = s.structural_digest
              )
         FROM staging_records s
        WHERE s.migration_id = ?
          AND s.kind = 'article_comments'
        GROUP BY s.migration_id, s.comment_context_key, s.structural_digest`,
    )
    .run(migrationId);
  let groupCount = 0;
  const samples: Array<{
    code: 'ambiguous_comment_signature';
    incomingGroupCount: number;
    targetGroupCount: number;
  }> = [];
  const statement = database.prepare(
    `SELECT context_key, structural_digest, incoming_count, target_count
       FROM staging_comment_groups
      WHERE migration_id = ?
      ORDER BY context_key ASC, structural_digest ASC`,
  );
  for (const group of statement.iterate(migrationId) as Iterable<CommentGroupRow>) {
    const incomingGroupCount = safeCount(group.incoming_count);
    const targetGroupCount = safeCount(group.target_count);
    if (incomingGroupCount > 1 || targetGroupCount > 1) {
      groupCount += 1;
      if (samples.length < MAX_RECEIPT_COMMENT_DIAGNOSTICS) {
        samples.push({ code: 'ambiguous_comment_signature', incomingGroupCount, targetGroupCount });
      }
    }
  }
  return Object.freeze({ groupCount, samples: Object.freeze(samples) });
}

function commentGroup(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
  record: MigrationCommentFact,
): CommentGroupRow {
  const contextKey = encodeCanonicalJson(record.archiveIdentity.context).text;
  const row = database
    .prepare(
      `SELECT context_key, structural_digest, incoming_count, target_count
         FROM staging_comment_groups
        WHERE migration_id = ? AND context_key = ? AND structural_digest = ?`,
    )
    .get(migrationId, contextKey, record.archiveIdentity.structuralDigest) as CommentGroupRow | undefined;
  if (!row) migrationValidationFailure();
  return row;
}

function existingCommentForGroup(
  database: SyncNosSqliteDatabase,
  record: MigrationCommentFact,
): ExistingCommentRow | null {
  const context = record.archiveIdentity.context;
  const row = database
    .prepare(
      `SELECT id, parent_comment_id
         FROM article_comments
        WHERE canonical_url = ?
          AND conversation_source IS ?
          AND conversation_key IS ?
          AND structural_digest = ?`,
    )
    .get(
      context.canonicalUrl,
      context.conversation?.source ?? null,
      context.conversation?.conversationKey ?? null,
      record.archiveIdentity.structuralDigest,
    ) as ExistingCommentRow | undefined;
  return row ?? null;
}

function importComments(
  database: SyncNosSqliteDatabase,
  migrationId: MigrationId,
): StoredImportResult['commentAmbiguity'] {
  const ambiguity = prepareCommentGroups(database, migrationId);
  let rootsAfterOrdinal = -1;
  let repliesAfterOrdinal = -1;
  for (const rootPass of [true, false]) {
    for (;;) {
      const row = database
        .prepare(
          `SELECT kind, ordinal, record_blob, source_local_id
             FROM staging_records
            WHERE migration_id = ?
              AND kind = 'article_comments'
              AND ${rootPass ? 'parent_source_local_id IS NULL' : 'parent_source_local_id IS NOT NULL'}
              AND ordinal > ?
            ORDER BY ordinal ASC
            LIMIT 1`,
        )
        .get(migrationId, rootPass ? rootsAfterOrdinal : repliesAfterOrdinal) as StagedRecordRow | undefined;
      if (!row) break;
      if (rootPass) rootsAfterOrdinal = row.ordinal;
      else repliesAfterOrdinal = row.ordinal;
      const record = decodeStagedRecord(row);
      if (record.kind !== 'article_comments') migrationValidationFailure();
      const conversationId = record.conversationSourceLocalId
        ? remappedId(database, migrationId, 'conversations', record.conversationSourceLocalId)
        : null;
      const parentId = record.parentSourceLocalId
        ? remappedId(database, migrationId, 'article_comments', record.parentSourceLocalId)
        : null;
      const group = commentGroup(database, migrationId, record);
      const mergeAllowed = safeCount(group.incoming_count) === 1 && safeCount(group.target_count) === 1;
      const existing = mergeAllowed ? existingCommentForGroup(database, record) : null;
      const existingCommentId = existing && existing.parent_comment_id === parentId ? existing.id : null;
      const commentId = writeMigrationCommentWithinTransaction(database, {
        conversationId,
        existingCommentId,
        parentId,
        record,
      });
      storeRemap(database, migrationId, 'article_comments', record.sourceLocalId, commentId);
    }
  }
  return ambiguity;
}

function importStagedFacts(
  database: SyncNosSqliteDatabase,
  input: Readonly<{ manifest: FactsManifest; manifestDigest: string; migrationId: MigrationId }>,
): ImportStagedFactsOutcome {
  if (database.inTransaction) busy();
  database.exec('BEGIN IMMEDIATE;');
  try {
    const receipt = database
      .prepare(
        `SELECT manifest_digest, protocol_version, schema_version, result_json
           FROM migration_receipts
          WHERE migration_id = ?`,
      )
      .get(input.migrationId) as
      | Readonly<{
          manifest_digest: unknown;
          protocol_version: unknown;
          result_json: unknown;
          schema_version: unknown;
        }>
      | undefined;
    if (receipt) {
      if (
        receipt.manifest_digest !== input.manifestDigest ||
        receipt.protocol_version !== input.manifest.protocolVersion ||
        receipt.schema_version !== input.manifest.schemaVersion
      ) {
        receiptMismatch();
      }
      const result = receiptResult(receipt.result_json);
      if (result.migrationId !== input.migrationId || result.manifestDigest !== input.manifestDigest) schemaMismatch();
      database.exec('COMMIT;');
      return Object.freeze({ alreadyCommitted: true, result });
    }

    importConversations(database, input.migrationId);
    importMappings(database, input.migrationId);
    importMessages(database, input.migrationId);
    importImages(database, input.migrationId);
    rewriteMessages(database, input.migrationId);
    const commentAmbiguity = importComments(database, input.migrationId);
    const factsRevision = bumpFactsRevision(database);
    const result: StoredImportResult = Object.freeze({
      commentAmbiguity,
      factCounts: Object.freeze({ ...input.manifest.factCounts }),
      factsRevision,
      manifestDigest: input.manifestDigest,
      migrationId: input.migrationId,
    });
    database
      .prepare(
        `INSERT INTO migration_receipts (
           migration_id, manifest_digest, protocol_version, schema_version, result_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.migrationId,
        input.manifestDigest,
        input.manifest.protocolVersion,
        input.manifest.schemaVersion,
        canonicalJsonText(result),
        Date.now(),
      );
    database.exec('COMMIT;');
    return Object.freeze({ alreadyCommitted: false, result });
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch (_rollbackError) {
      // SQLite may have rolled back the failed statement; retain the original cause.
    }
    throw error;
  }
}

class FactsImporter {
  #active: ActiveSession | null = null;
  #closed = false;
  #completed: FactsArchiveImportResult | null = null;
  #failed = false;
  #finalized = false;
  #nextManifestSequence = 0;
  #nextRecordOrdinal = 0;
  #operationInFlight = false;
  #pendingImage: PendingImage | null = null;
  #stagedFactCounts = emptyFactCounts();
  #streamBytes = emptyFactCounts();
  #referenceValidator = createMigrationFactReferenceValidator();

  private constructor(
    private readonly database: SyncNosSqliteDatabase,
    private readonly request: MigrationStreamRequestPayload,
    private readonly provider: DigestProvider,
    private readonly digest: OrderedFrameDigestAccumulator,
  ) {}

  static async create(input: CreateStagedFactsImporterInput): Promise<FactsImporter> {
    const request = parseMigrationStreamRequestPayload(input.request);
    const provider = input.digestProvider ?? nodeDigestProvider;
    const digest = await OrderedFrameDigestAccumulator.create(provider);
    beginStaging(input.database, request);
    return new FactsImporter(input.database, request, provider, digest);
  }

  #assertOpen(): void {
    if (this.#closed || this.#failed || this.#completed) migrationValidationFailure();
  }

  async #withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#operationInFlight) busy();
    this.#operationInFlight = true;
    try {
      return await operation();
    } finally {
      this.#operationInFlight = false;
    }
  }

  #releaseStaging(): void {
    try {
      clearStaging(this.database, this.request.migrationId);
    } catch (_error) {
      // A failed stream must never hide its validation failure behind best-effort cleanup.
    }
  }

  #fail(): void {
    this.#active = null;
    this.#pendingImage = null;
    this.#failed = true;
    this.#releaseStaging();
  }

  async #appendManifestFrame(kind: FactStreamKind, byteLength: number, digest: string): Promise<void> {
    if (this.#nextManifestSequence >= Number.MAX_SAFE_INTEGER) migrationValidationFailure();
    const bytes = safeCount(byteLength);
    if (!bytes || this.#streamBytes[kind] > Number.MAX_SAFE_INTEGER - bytes) migrationValidationFailure();
    await this.digest.append({ sequence: this.#nextManifestSequence++, byteLength: bytes, digest });
    this.#streamBytes[kind] += bytes;
  }

  #stageRecord(record: MigrationFactRecord, bytes: Uint8Array): void {
    this.#referenceValidator.add(record);
    if (this.#stagedFactCounts[record.kind] >= Number.MAX_SAFE_INTEGER) migrationValidationFailure();
    const common = {
      conversationSourceLocalId:
        record.kind === 'messages' || record.kind === 'image_cache' ? record.conversationSourceLocalId : null,
      imageUrl: record.kind === 'image_cache' ? safeString(record.payload.url) || null : null,
      parentSourceLocalId: record.kind === 'article_comments' ? record.parentSourceLocalId : null,
    };
    const comment = record.kind === 'article_comments' ? record : null;
    runStagingTransaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO staging_records (
             migration_id, kind, source_local_id, ordinal, record_blob, conversation_source_local_id, parent_source_local_id,
             comment_context_key, comment_canonical_url, comment_conversation_source, comment_conversation_key,
             root_structural_digest, structural_digest, image_url
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.request.migrationId,
          record.kind,
          record.sourceLocalId,
          this.#nextRecordOrdinal,
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          common.conversationSourceLocalId,
          common.parentSourceLocalId,
          comment ? encodeCanonicalJson(comment.archiveIdentity.context).text : null,
          comment?.archiveIdentity.context.canonicalUrl ?? null,
          comment?.archiveIdentity.context.conversation?.source ?? null,
          comment?.archiveIdentity.context.conversation?.conversationKey ?? null,
          comment?.archiveIdentity.rootStructuralDigest ?? null,
          comment?.archiveIdentity.structuralDigest ?? null,
          common.imageUrl,
        );
      this.database
        .prepare('UPDATE staging_metadata SET updated_at = ? WHERE migration_id = ?')
        .run(Date.now(), this.request.migrationId);
    });
    this.#stagedFactCounts[record.kind] += 1;
    this.#nextRecordOrdinal += 1;
    if (record.kind === 'image_cache') {
      this.#pendingImage = Object.freeze({ byteLength: record.byteLength, sourceLocalId: record.sourceLocalId });
    }
  }

  #stageImage(bytes: Uint8Array): void {
    const pending = this.#pendingImage;
    if (!pending || bytes.byteLength !== pending.byteLength) migrationValidationFailure();
    runStagingTransaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO staging_image_assets (migration_id, source_local_id, byte_length, bytes)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          this.request.migrationId,
          pending.sourceLocalId,
          pending.byteLength,
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        );
      this.database
        .prepare('UPDATE staging_metadata SET updated_at = ? WHERE migration_id = ?')
        .run(Date.now(), this.request.migrationId);
    });
    this.#pendingImage = null;
  }

  async #startSession(frame: NativeWireFrame): Promise<void> {
    if (frame.type !== 'begin') migrationValidationFailure();
    if (this.#pendingImage) {
      if (frame.operation !== 'migration-image-asset' || frame.declaredTotalBytes !== this.#pendingImage.byteLength)
        migrationValidationFailure();
      const receiver = await NativeWireSessionReceiver.create(frame.sessionId, this.provider);
      await receiver.accept(frame);
      this.#active = {
        bytes: new Uint8Array(frame.declaredTotalBytes),
        kind: 'image',
        receiver,
        sessionId: frame.sessionId,
      };
      return;
    }
    if (frame.operation !== 'migration-fact-record') migrationValidationFailure();
    const receiver = await NativeWireSessionReceiver.create(frame.sessionId, this.provider);
    await receiver.accept(frame);
    this.#active = { completed: null, kind: 'record', recordBegin: null, receiver, sessionId: frame.sessionId };
  }

  async #acceptFrame(frameValue: unknown): Promise<void> {
    this.#assertOpen();
    const frame = parseNativeWireFrame(frameValue);
    if (!this.#active) {
      await this.#startSession(frame);
      return;
    }
    const active = this.#active;
    if (frame.sessionId !== active.sessionId) {
      // NativeWireSessionReceiver performs the same check; avoid accepting an interleaved session before it can mutate staging.
      migrationValidationFailure();
    }
    const event = await active.receiver.accept(frame);
    if (active.kind === 'record' && frame.type === 'record-begin') {
      active.recordBegin = frame;
    }
    if (active.kind === 'record' && frame.type === 'record-json') {
      const kind = active.recordBegin?.kind;
      if (!kind) migrationValidationFailure();
      await this.#appendManifestFrame(kind, frame.byteLength, frame.chunkDigest);
    }
    if (active.kind === 'image' && event?.kind === 'data') {
      active.bytes.set(event.bytes, event.frame.offset);
      await this.#appendManifestFrame('image_cache', event.frame.byteLength, event.frame.sliceDigest);
    }
    if (active.kind === 'record' && event?.kind === 'record') {
      const record = decodeMigrationFactRecord(event.record.bytes);
      if (
        !active.recordBegin ||
        record.kind !== active.recordBegin.kind ||
        record.sourceLocalId !== active.recordBegin.sourceLocalId
      ) {
        migrationValidationFailure();
      }
      if (record.kind === 'article_comments') await verifyMigrationCommentFact(record, this.provider);
      active.completed = Object.freeze({ bytes: event.record.bytes, record });
    }
    if (frame.type !== 'terminal') return;
    if (!event || event.kind !== 'terminal' || event.terminalFrame.status !== 'ok') migrationValidationFailure();
    if (active.kind === 'record') {
      if (!active.completed) migrationValidationFailure();
      this.#stageRecord(active.completed.record, active.completed.bytes);
    } else {
      this.#stageImage(active.bytes);
    }
    this.#active = null;
  }

  async acceptFrame(frame: unknown): Promise<void> {
    return await this.#withExclusive(async () => {
      try {
        await this.#acceptFrame(frame);
      } catch (error) {
        this.#fail();
        throw publicInboundFrameError(error);
      }
    });
  }

  async #complete(manifestValue: unknown): Promise<FactsArchiveImportResult> {
    this.#assertOpen();
    if (this.#active || this.#pendingImage || this.#finalized) migrationValidationFailure();
    this.#finalized = true;
    const manifest = parseFactsManifest(manifestValue);
    if (manifest.migrationId !== this.request.migrationId) migrationValidationFailure();
    if (
      manifest.protocolVersion !== this.request.protocolVersion ||
      manifest.schemaVersion !== this.request.schemaVersion ||
      !sameFactCounts(this.#stagedFactCounts, manifest.factCounts) ||
      !sameFactCounts(this.#streamBytes, manifest.streamBytes) ||
      manifest.orderedFrameDigest !== this.digest.finalize()
    ) {
      migrationValidationFailure();
    }
    this.#referenceValidator.finalize();
    assertImageAssetsComplete(this.database, this.request.migrationId, this.#stagedFactCounts.image_cache);
    const manifestDigest = await factsManifestDigest(manifest, this.provider);
    const outcome = importStagedFacts(this.database, {
      manifest,
      manifestDigest,
      migrationId: this.request.migrationId,
    });
    this.#completed = Object.freeze({ ...outcome.result, alreadyCommitted: outcome.alreadyCommitted });
    return this.#completed;
  }

  async complete(manifest: unknown): Promise<FactsArchiveImportResult> {
    return await this.#withExclusive(async () => {
      if (this.#completed) return this.#completed;
      try {
        return await this.#complete(manifest);
      } catch (error) {
        this.#fail();
        throw publicCompletionError(error);
      }
    });
  }

  abort(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#active = null;
    this.#pendingImage = null;
    this.#releaseStaging();
  }

  cleanup(): void {
    this.abort();
  }
}

export async function createStagedFactsImporter(input: CreateStagedFactsImporterInput): Promise<StagedFactsImporter> {
  try {
    const importer = await FactsImporter.create(input);
    return Object.freeze({
      abort: () => importer.abort(),
      acceptFrame: async (frame: unknown) => await importer.acceptFrame(frame),
      cleanup: () => importer.cleanup(),
      complete: async (manifest: unknown) => await importer.complete(manifest),
    });
  } catch (error) {
    throw publicImportError(error);
  }
}
