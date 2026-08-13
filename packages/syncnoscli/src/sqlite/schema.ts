import { randomUUID } from 'node:crypto';

import { LOCAL_DATA_SQLITE_SCHEMA_VERSION, LocalDataContractError } from '@services/local-data/contracts';

import type BetterSqlite3 from 'better-sqlite3';

export type SyncNosSqliteDatabase = BetterSqlite3.Database;

export const SQLITE_APPLICATION_ID = 1397969713;
export const SQLITE_SCHEMA_VERSION = LOCAL_DATA_SQLITE_SCHEMA_VERSION;

export const SQLITE_FACT_TABLE_NAMES = Object.freeze([
  'conversations',
  'sync_mappings',
  'messages',
  'image_cache',
  'article_comments',
] as const);

export type SqliteFtsCapability = Readonly<{
  available: boolean;
  reason: string | null;
}>;

const META_DATABASE_UUID = 'database_uuid';
const META_FACTS_REVISION = 'facts_revision';
const META_FTS_INDEX_STATUS = 'fts_index_status';
const META_FTS_STATUS = 'fts_status';
const META_SCHEMA_VERSION = 'contract_schema_version';
export const SQLITE_FTS_TABLE_NAME = 'conversation_fts';
const FTS_PROBE_TABLE_NAME = 'syncnos_fts_probe_v1';
const SQLITE_FTS_TABLE_SIGNATURE =
  "createvirtualtableconversation_ftsusingfts5(conversation_idunindexed,title,body,tokenize='trigram')";

type SqliteFtsIndexStatus = 'needs-rebuild' | 'ready';

function schemaMismatch(): never {
  throw new LocalDataContractError('SCHEMA_MISMATCH');
}

function scalarPragma(database: SyncNosSqliteDatabase, name: string): unknown {
  return database.pragma(name, { simple: true });
}

function tableExists(database: SyncNosSqliteDatabase, name: string): boolean {
  return Boolean(
    database.prepare('SELECT 1 AS present FROM sqlite_master WHERE type = ? AND name = ?').get('table', name),
  );
}

function userTableCount(database: SyncNosSqliteDatabase): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { count?: unknown } | undefined;
  const count = Number(row?.count);
  if (!Number.isSafeInteger(count) || count < 0) schemaMismatch();
  return count;
}

function metaValue(database: SyncNosSqliteDatabase, key: string): string | null {
  const row = database.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return null;
  return typeof row.value === 'string' ? row.value : schemaMismatch();
}

function setMetaValue(database: SyncNosSqliteDatabase, key: string, value: string): void {
  database
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

function requiredTablesPresent(database: SyncNosSqliteDatabase): boolean {
  return (
    tableExists(database, 'meta') &&
    tableExists(database, 'migration_receipts') &&
    tableExists(database, 'staging_metadata') &&
    SQLITE_FACT_TABLE_NAMES.every((name) => tableExists(database, name))
  );
}

function migrationOne(database: SyncNosSqliteDatabase): void {
  database.exec(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'chat',
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      list_source_key TEXT NOT NULL DEFAULT 'unknown',
      list_site_key TEXT NOT NULL DEFAULT 'unknown',
      last_captured_at INTEGER NOT NULL DEFAULT 0,
      notion_page_id TEXT NOT NULL DEFAULT '',
      feishu_doc_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      UNIQUE (source, conversation_key)
    );
    CREATE INDEX conversations_by_last_captured_at_id
      ON conversations (last_captured_at DESC, id DESC);
    CREATE INDEX conversations_by_list_source_last_captured_at_id
      ON conversations (list_source_key, last_captured_at DESC, id DESC);
    CREATE INDEX conversations_by_list_source_site_last_captured_at_id
      ON conversations (list_source_key, list_site_key, last_captured_at DESC, id DESC);
    CREATE INDEX conversations_by_list_site_last_captured_at_id
      ON conversations (list_site_key, last_captured_at DESC, id DESC);
    CREATE INDEX conversations_by_article_source_url
      ON conversations (source_type, url);

    CREATE TABLE sync_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      notion_page_id TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      UNIQUE (source, conversation_key)
    );
    CREATE INDEX sync_mappings_by_notion_page_id ON sync_mappings (notion_page_id);

    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
      message_key TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'assistant',
      author_name TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      content_markdown TEXT NOT NULL DEFAULT '',
      sequence INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      UNIQUE (conversation_id, message_key)
    );
    CREATE INDEX messages_by_conversation_sequence ON messages (conversation_id, sequence, id);

    CREATE TABLE image_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
      url TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      bytes BLOB NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE (conversation_id, url)
    );
    CREATE INDEX image_cache_by_conversation ON image_cache (conversation_id);

    CREATE TABLE article_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NULL REFERENCES conversations(id) ON DELETE RESTRICT,
      parent_comment_id INTEGER NULL REFERENCES article_comments(id) ON DELETE RESTRICT,
      canonical_url TEXT NOT NULL,
      conversation_source TEXT NULL,
      conversation_key TEXT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      root_structural_digest TEXT NULL,
      structural_digest TEXT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX article_comments_by_canonical_url_created_at
      ON article_comments (canonical_url, created_at, id);
    CREATE INDEX article_comments_by_conversation_created_at
      ON article_comments (conversation_id, created_at, id);
    CREATE INDEX article_comments_by_structural_digest
      ON article_comments (canonical_url, conversation_source, conversation_key, structural_digest);

    CREATE TABLE migration_receipts (
      migration_id TEXT PRIMARY KEY,
      manifest_digest TEXT NOT NULL,
      protocol_version INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE staging_metadata (
      migration_id TEXT PRIMARY KEY,
      protocol_version INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      host_owner_token TEXT NULL,
      host_owner_pid INTEGER NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

/** Adds read-path indexes without changing the facts contract or rewriting facts. */
function ensureConversationIndexes(database: SyncNosSqliteDatabase): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS conversations_by_article_source_url
      ON conversations (source_type, url);
  `);
}

/**
 * Import staging is Host-owned bookkeeping, not a second facts source. Keeping it
 * outside the public facts table list lets an already-created v1 database gain the
 * bounded importer without changing its facts contract.
 */
function ensureImportStagingTables(database: SyncNosSqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS staging_records (
      migration_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('conversations', 'sync_mappings', 'messages', 'image_cache', 'article_comments')),
      source_local_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      record_blob BLOB NOT NULL,
      conversation_source_local_id TEXT NULL,
      parent_source_local_id TEXT NULL,
      comment_context_key TEXT NULL,
      comment_canonical_url TEXT NULL,
      comment_conversation_source TEXT NULL,
      comment_conversation_key TEXT NULL,
      root_structural_digest TEXT NULL,
      structural_digest TEXT NULL,
      image_url TEXT NULL,
      PRIMARY KEY (migration_id, kind, source_local_id),
      UNIQUE (migration_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS staging_records_by_migration_kind_ordinal
      ON staging_records (migration_id, kind, ordinal);
    CREATE INDEX IF NOT EXISTS staging_records_by_migration_comment_group
      ON staging_records (migration_id, comment_context_key, structural_digest);

    CREATE TABLE IF NOT EXISTS staging_image_assets (
      migration_id TEXT NOT NULL,
      source_local_id TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      bytes BLOB NOT NULL,
      PRIMARY KEY (migration_id, source_local_id)
    );

    CREATE TABLE IF NOT EXISTS staging_remaps (
      migration_id TEXT NOT NULL,
      fact_kind TEXT NOT NULL CHECK (fact_kind IN ('conversations', 'messages', 'image_cache', 'article_comments')),
      source_local_id TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      PRIMARY KEY (migration_id, fact_kind, source_local_id)
    );

    CREATE TABLE IF NOT EXISTS staging_conversation_identities (
      migration_id TEXT NOT NULL,
      source TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      PRIMARY KEY (migration_id, source, conversation_key)
    );

    CREATE TABLE IF NOT EXISTS staging_comment_groups (
      migration_id TEXT NOT NULL,
      context_key TEXT NOT NULL,
      structural_digest TEXT NOT NULL,
      incoming_count INTEGER NOT NULL,
      target_count INTEGER NOT NULL,
      PRIMARY KEY (migration_id, context_key, structural_digest)
    );
  `);
  const columns = database.prepare('PRAGMA table_info(staging_metadata)').all() as Array<{ name?: unknown }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('host_owner_token'))
    database.exec('ALTER TABLE staging_metadata ADD COLUMN host_owner_token TEXT NULL;');
  if (!names.has('host_owner_pid'))
    database.exec('ALTER TABLE staging_metadata ADD COLUMN host_owner_pid INTEGER NULL;');
}

function initializeMeta(database: SyncNosSqliteDatabase): void {
  const existingDatabaseUuid = metaValue(database, META_DATABASE_UUID);
  if (
    existingDatabaseUuid !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(existingDatabaseUuid)
  ) {
    schemaMismatch();
  }
  setMetaValue(database, META_DATABASE_UUID, existingDatabaseUuid ?? randomUUID());
  const revision = metaValue(database, META_FACTS_REVISION);
  if (revision !== null && (!/^(0|[1-9][0-9]*)$/.test(revision) || !Number.isSafeInteger(Number(revision)))) {
    schemaMismatch();
  }
  setMetaValue(database, META_FACTS_REVISION, revision ?? '0');
  const ftsStatus = metaValue(database, META_FTS_STATUS);
  if (ftsStatus !== null && ftsStatus !== 'available' && ftsStatus !== 'unavailable') schemaMismatch();
  const ftsIndexStatus = metaValue(database, META_FTS_INDEX_STATUS);
  if (ftsIndexStatus !== null && ftsIndexStatus !== 'needs-rebuild' && ftsIndexStatus !== 'ready') schemaMismatch();
  setMetaValue(database, META_FTS_INDEX_STATUS, ftsIndexStatus ?? 'needs-rebuild');
  setMetaValue(database, META_SCHEMA_VERSION, String(SQLITE_SCHEMA_VERSION));
}

function rollbackSavepoint(database: SyncNosSqliteDatabase, name: string): void {
  database.exec(`ROLLBACK TO ${name}; RELEASE ${name};`);
}

/** The exact derived schema is the ownership proof before a recovery path may drop it. */
function hasVerifiedFtsTable(database: SyncNosSqliteDatabase): boolean {
  const row = database
    .prepare<[string, string], { sql: string | null }>('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', SQLITE_FTS_TABLE_NAME);
  return Boolean(row?.sql && row.sql.replaceAll(/\s+/g, '').toLowerCase() === SQLITE_FTS_TABLE_SIGNATURE);
}

function markFtsUnavailable(database: SyncNosSqliteDatabase): void {
  setMetaValue(database, META_FTS_INDEX_STATUS, 'needs-rebuild');
  setMetaValue(database, META_FTS_STATUS, 'unavailable');
}

function sqliteErrorCode(error: unknown): string {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
}

function isFtsLocalFailure(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  return code === 'SYNCNOS_FTS_LOCAL' || code.startsWith('SQLITE_ERROR') || code.startsWith('SQLITE_CONSTRAINT');
}

function ftsLocalFailure(message: string): Error {
  return Object.assign(new Error(message), { code: 'SYNCNOS_FTS_LOCAL' });
}

function runFtsSavepoint(database: SyncNosSqliteDatabase, name: string, operation: () => void): boolean {
  let started = false;
  try {
    database.exec(`SAVEPOINT ${name};`);
    started = true;
    operation();
    database.exec(`RELEASE ${name};`);
    return true;
  } catch (error) {
    if (started) rollbackSavepoint(database, name);
    if (!isFtsLocalFailure(error)) throw error;
    markFtsUnavailable(database);
    return false;
  }
}

/** The probe is rolled back so FTS support is capability data, never a second facts source. */
function probeFtsCapability(database: SyncNosSqliteDatabase): boolean {
  let started = false;
  try {
    database.exec('SAVEPOINT syncnos_fts_probe;');
    started = true;
    database.exec(`CREATE VIRTUAL TABLE ${FTS_PROBE_TABLE_NAME} USING fts5 (content, tokenize='trigram');`);
    rollbackSavepoint(database, 'syncnos_fts_probe');
    return true;
  } catch (error) {
    if (started) rollbackSavepoint(database, 'syncnos_fts_probe');
    if (!isFtsLocalFailure(error)) throw error;
    markFtsUnavailable(database);
    return false;
  }
}

function createFtsTable(database: SyncNosSqliteDatabase): boolean {
  return runFtsSavepoint(database, 'syncnos_fts_create', () => {
    database.exec(
      `CREATE VIRTUAL TABLE ${SQLITE_FTS_TABLE_NAME} USING fts5 (conversation_id UNINDEXED, title, body, tokenize='trigram');`,
    );
    if (!hasVerifiedFtsTable(database)) throw ftsLocalFailure('conversation FTS table is not a verified trigram table');
  });
}

function recreateVerifiedFtsTable(database: SyncNosSqliteDatabase): boolean {
  return runFtsSavepoint(database, 'syncnos_fts_recreate', () => {
    if (!hasVerifiedFtsTable(database)) throw ftsLocalFailure('conversation FTS table ownership is not verified');
    database.exec(`DROP TABLE ${SQLITE_FTS_TABLE_NAME};`);
    database.exec(
      `CREATE VIRTUAL TABLE ${SQLITE_FTS_TABLE_NAME} USING fts5 (conversation_id UNINDEXED, title, body, tokenize='trigram');`,
    );
    if (!hasVerifiedFtsTable(database))
      throw ftsLocalFailure('conversation FTS table recreation did not preserve trigram');
  });
}

function verifyFtsTable(database: SyncNosSqliteDatabase): boolean {
  return runFtsSavepoint(database, 'syncnos_fts_verify', () => {
    database
      .prepare(`SELECT rowid FROM ${SQLITE_FTS_TABLE_NAME} WHERE ${SQLITE_FTS_TABLE_NAME} MATCH ? LIMIT 1`)
      .get('"syncnos-fts-healthcheck"');
  });
}

function markFtsAvailable(database: SyncNosSqliteDatabase): void {
  setMetaValue(database, META_FTS_STATUS, 'available');
}

/** Recreates only a verified owned index; a foreign/mismatched table is never dropped. */
function ensureFtsCapability(database: SyncNosSqliteDatabase): boolean {
  const status = metaValue(database, META_FTS_STATUS);
  const verifiedTable = hasVerifiedFtsTable(database);
  if (status === 'available' && verifiedTable && verifyFtsTable(database)) return true;

  if (!probeFtsCapability(database)) return false;
  if (verifiedTable) {
    if (!recreateVerifiedFtsTable(database)) return false;
  } else if (tableExists(database, SQLITE_FTS_TABLE_NAME)) {
    markFtsUnavailable(database);
    return false;
  } else if (!createFtsTable(database)) {
    return false;
  }
  setMetaValue(database, META_FTS_INDEX_STATUS, 'needs-rebuild');
  if (!verifyFtsTable(database)) return false;
  markFtsAvailable(database);
  return true;
}

function ftsIndexStatus(database: SyncNosSqliteDatabase): SqliteFtsIndexStatus | null {
  const value = metaValue(database, META_FTS_INDEX_STATUS);
  if (value === null) return null;
  if (value === 'needs-rebuild' || value === 'ready') return value;
  schemaMismatch();
}

function ftsIsReady(database: SyncNosSqliteDatabase): boolean {
  return (
    metaValue(database, META_FTS_STATUS) === 'available' &&
    ftsIndexStatus(database) === 'ready' &&
    hasVerifiedFtsTable(database)
  );
}

function assertFtsWriteTransaction(database: SyncNosSqliteDatabase): void {
  if (!database.inTransaction) throw new LocalDataContractError('INVALID_ARGUMENT');
}

type FtsDocument = Readonly<{
  body: string;
  conversationId: number;
  title: string;
}>;

function readFtsDocument(database: SyncNosSqliteDatabase, conversationId: number): FtsDocument | null {
  const conversation = database.prepare('SELECT id, title FROM conversations WHERE id = ?').get(conversationId) as
    | Readonly<{ id?: unknown; title?: unknown }>
    | undefined;
  if (!conversation) return null;
  if (
    !Number.isSafeInteger(conversation.id) ||
    Number(conversation.id) <= 0 ||
    typeof conversation.title !== 'string'
  ) {
    schemaMismatch();
  }
  const messages = database
    .prepare(
      `SELECT content_text, content_markdown
         FROM messages
        WHERE conversation_id = ?
        ORDER BY sequence ASC, id ASC`,
    )
    .all(conversation.id) as Array<Readonly<{ content_markdown?: unknown; content_text?: unknown }>>;
  const body = messages
    .map((message) => {
      if (typeof message.content_text !== 'string' || typeof message.content_markdown !== 'string') schemaMismatch();
      return message.content_text || message.content_markdown;
    })
    .join('\n');
  return Object.freeze({ body, conversationId: Number(conversation.id), title: conversation.title });
}

function rebuildVerifiedFtsIndex(database: SyncNosSqliteDatabase): boolean {
  const rebuilt = runFtsSavepoint(database, 'syncnos_fts_rebuild', () => {
    database.prepare(`DELETE FROM ${SQLITE_FTS_TABLE_NAME}`).run();
    const nextConversation = database.prepare('SELECT id FROM conversations WHERE id > ? ORDER BY id ASC LIMIT 1');
    const insertDocument = database.prepare(
      `INSERT INTO ${SQLITE_FTS_TABLE_NAME} (conversation_id, title, body) VALUES (?, ?, ?)`,
    );
    let afterConversationId = 0;
    for (;;) {
      const row = nextConversation.get(afterConversationId) as Readonly<{ id?: unknown }> | undefined;
      if (!row) break;
      if (!Number.isSafeInteger(row.id) || Number(row.id) <= afterConversationId) schemaMismatch();
      afterConversationId = Number(row.id);
      const document = readFtsDocument(database, afterConversationId);
      if (!document) schemaMismatch();
      insertDocument.run(document.conversationId, document.title, document.body);
    }
  });
  if (rebuilt) setMetaValue(database, META_FTS_INDEX_STATUS, 'ready');
  return rebuilt;
}

/** Reprobes/rebuilds only in an already authorized schema or facts transaction. */
export function ensureSqliteFtsIndexWithinFactsTransaction(database: SyncNosSqliteDatabase): boolean {
  assertFtsWriteTransaction(database);
  if (!ensureFtsCapability(database)) return false;
  if (ftsIndexStatus(database) === 'ready') return true;
  return rebuildVerifiedFtsIndex(database);
}

/** Rebuilds the verified derived index without retrying a failure from this transaction. */
export function rebuildSqliteFtsIndexWithinFactsTransaction(database: SyncNosSqliteDatabase): boolean {
  assertFtsWriteTransaction(database);
  if (metaValue(database, META_FTS_STATUS) !== 'available' || !hasVerifiedFtsTable(database)) return false;
  return rebuildVerifiedFtsIndex(database);
}

/**
 * ponytail: one refresh rebuilds one conversation body in O(the conversation's message count).
 * Upgrade to a per-message index plus grouping only if profiling proves this write path hot.
 */
export function refreshConversationFtsDocumentWithinFactsTransaction(
  database: SyncNosSqliteDatabase,
  conversationId: number,
): void {
  assertFtsWriteTransaction(database);
  if (!ftsIsReady(database)) return;
  const document = readFtsDocument(database, conversationId);
  const refreshed = runFtsSavepoint(database, 'syncnos_fts_refresh', () => {
    database.prepare(`DELETE FROM ${SQLITE_FTS_TABLE_NAME} WHERE conversation_id = ?`).run(conversationId);
    if (document) {
      database
        .prepare(`INSERT INTO ${SQLITE_FTS_TABLE_NAME} (conversation_id, title, body) VALUES (?, ?, ?)`)
        .run(document.conversationId, document.title, document.body);
    }
  });
  if (refreshed) setMetaValue(database, META_FTS_INDEX_STATUS, 'ready');
}

export function deleteConversationFtsDocumentWithinFactsTransaction(
  database: SyncNosSqliteDatabase,
  conversationId: number,
): void {
  assertFtsWriteTransaction(database);
  if (!ftsIsReady(database)) return;
  const deleted = runFtsSavepoint(database, 'syncnos_fts_delete', () => {
    database.prepare(`DELETE FROM ${SQLITE_FTS_TABLE_NAME} WHERE conversation_id = ?`).run(conversationId);
  });
  if (deleted) setMetaValue(database, META_FTS_INDEX_STATUS, 'ready');
}

function assertSchemaIdentity(database: SyncNosSqliteDatabase, allowFreshDatabase: boolean): number {
  const applicationId = Number(scalarPragma(database, 'application_id'));
  const userVersion = Number(scalarPragma(database, 'user_version'));
  if (
    !Number.isSafeInteger(applicationId) ||
    !Number.isSafeInteger(userVersion) ||
    applicationId < 0 ||
    userVersion < 0
  ) {
    schemaMismatch();
  }
  if (applicationId !== 0 && applicationId !== SQLITE_APPLICATION_ID) schemaMismatch();
  if (userVersion > SQLITE_SCHEMA_VERSION) schemaMismatch();
  if (!allowFreshDatabase && (applicationId !== SQLITE_APPLICATION_ID || userVersion !== SQLITE_SCHEMA_VERSION)) {
    schemaMismatch();
  }
  if (applicationId === 0 && userTableCount(database) > 0) schemaMismatch();
  return userVersion;
}

/** Runs ordered, transactional schema migrations. Only the write Host path may call this. */
export function migrateSqliteSchema(database: SyncNosSqliteDatabase): void {
  const currentVersion = assertSchemaIdentity(database, true);
  if (currentVersion === SQLITE_SCHEMA_VERSION && !requiredTablesPresent(database)) schemaMismatch();
  database.exec('BEGIN IMMEDIATE;');
  try {
    if (currentVersion < 1) migrationOne(database);
    ensureConversationIndexes(database);
    ensureImportStagingTables(database);
    database.exec(`PRAGMA application_id = ${SQLITE_APPLICATION_ID};`);
    database.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION};`);
    initializeMeta(database);
    ensureSqliteFtsIndexWithinFactsTransaction(database);
    database.exec('COMMIT;');
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch (_rollbackError) {
      // The original failure is more actionable and no partial schema is accepted.
    }
    throw error;
  }
}

/** Verifies a read-only connection without changing its schema, meta rows, or FTS state. */
export function assertReadableSqliteSchema(database: SyncNosSqliteDatabase): void {
  assertSchemaIdentity(database, false);
  if (!requiredTablesPresent(database)) schemaMismatch();
  if (metaValue(database, META_SCHEMA_VERSION) !== String(SQLITE_SCHEMA_VERSION)) schemaMismatch();
  const databaseUuid = metaValue(database, META_DATABASE_UUID);
  const factsRevision = metaValue(database, META_FACTS_REVISION);
  const indexStatus = ftsIndexStatus(database);
  const ftsStatus = metaValue(database, META_FTS_STATUS);
  if (
    !databaseUuid ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(databaseUuid) ||
    !factsRevision ||
    !/^(0|[1-9][0-9]*)$/.test(factsRevision) ||
    !Number.isSafeInteger(Number(factsRevision)) ||
    (indexStatus !== null && indexStatus !== 'needs-rebuild' && indexStatus !== 'ready') ||
    (ftsStatus !== 'available' && ftsStatus !== 'unavailable')
  ) {
    schemaMismatch();
  }
}

export function readSqliteMeta(database: SyncNosSqliteDatabase, key: string): string | null {
  return metaValue(database, key);
}

export function getSqliteFtsCapability(database: SyncNosSqliteDatabase): SqliteFtsCapability {
  const status = metaValue(database, META_FTS_STATUS);
  if (status === 'available' && ftsIndexStatus(database) === 'ready' && hasVerifiedFtsTable(database)) {
    return Object.freeze({ available: true, reason: null });
  }
  return Object.freeze({
    available: false,
    reason: status === 'available' ? 'FTS index needs rebuilding' : 'FTS5 or trigram is unavailable',
  });
}

export function getSqliteDatabaseUuid(database: SyncNosSqliteDatabase): string {
  const value = metaValue(database, META_DATABASE_UUID);
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) schemaMismatch();
  return value;
}
