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
const META_FTS_REASON = 'fts_unavailable_reason';
const META_FTS_STATUS = 'fts_status';
const META_SCHEMA_VERSION = 'contract_schema_version';
const FTS_TABLE_NAME = 'conversation_fts';
const FTS_PROBE_TABLE_NAME = 'syncnos_fts_probe_v1';

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

function deleteMetaValue(database: SyncNosSqliteDatabase, key: string): void {
  database.prepare('DELETE FROM meta WHERE key = ?').run(key);
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
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
  setMetaValue(database, META_SCHEMA_VERSION, String(SQLITE_SCHEMA_VERSION));
}

function ftsFailureReason(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : '';
  const raw = typeof code === 'string' && code ? code : message || 'FTS5 or trigram is unavailable';
  let sanitized = '';
  for (const character of raw) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character;
    if (sanitized.length >= 240) break;
  }
  return sanitized || 'FTS5 or trigram is unavailable';
}

function rollbackSavepoint(database: SyncNosSqliteDatabase, name: string): void {
  database.exec(`ROLLBACK TO ${name}; RELEASE ${name};`);
}

function ftsTableUsesTrigram(database: SyncNosSqliteDatabase): boolean {
  const row = database
    .prepare<[string, string], { sql: string | null }>('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', FTS_TABLE_NAME);
  return Boolean(row?.sql && /tokenize\s*=\s*['"]trigram['"]/i.test(row.sql));
}

function markFtsUnavailable(database: SyncNosSqliteDatabase, error: unknown): void {
  setMetaValue(database, META_FTS_STATUS, 'unavailable');
  setMetaValue(database, META_FTS_REASON, ftsFailureReason(error));
}

/** The probe is rolled back so FTS support is capability data, never a second facts source. */
function ensureFtsCapability(database: SyncNosSqliteDatabase): void {
  try {
    database.exec('SAVEPOINT syncnos_fts_probe;');
    database.exec(`CREATE VIRTUAL TABLE ${FTS_PROBE_TABLE_NAME} USING fts5 (content, tokenize='trigram');`);
    rollbackSavepoint(database, 'syncnos_fts_probe');
  } catch (error) {
    markFtsUnavailable(database, error);
    return;
  }

  try {
    database.exec('SAVEPOINT syncnos_fts_create;');
    database.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE_NAME} USING fts5 (conversation_id UNINDEXED, title, body, tokenize='trigram');`,
    );
    if (!ftsTableUsesTrigram(database)) schemaMismatch();
    database.exec('RELEASE syncnos_fts_create;');
    setMetaValue(database, META_FTS_STATUS, 'available');
    deleteMetaValue(database, META_FTS_REASON);
  } catch (error) {
    rollbackSavepoint(database, 'syncnos_fts_create');
    markFtsUnavailable(database, error);
  }
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
    database.exec(`PRAGMA application_id = ${SQLITE_APPLICATION_ID};`);
    database.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION};`);
    initializeMeta(database);
    ensureFtsCapability(database);
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
  const ftsStatus = metaValue(database, META_FTS_STATUS);
  if (
    !databaseUuid ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(databaseUuid) ||
    !factsRevision ||
    !/^(0|[1-9][0-9]*)$/.test(factsRevision) ||
    !Number.isSafeInteger(Number(factsRevision)) ||
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
  if (status === 'available' && ftsTableUsesTrigram(database)) return Object.freeze({ available: true, reason: null });
  return Object.freeze({
    available: false,
    reason: metaValue(database, META_FTS_REASON) ?? 'FTS5 or trigram is unavailable',
  });
}

export function getSqliteDatabaseUuid(database: SyncNosSqliteDatabase): string {
  const value = metaValue(database, META_DATABASE_UUID);
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) schemaMismatch();
  return value;
}
