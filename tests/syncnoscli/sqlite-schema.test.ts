import { describe, expect, it, vi } from 'vitest';

import { LocalDataContractError } from '@services/local-data/contracts';

import { loadBetterSqlite3 } from '../../packages/syncnoscli/src/sqlite/native-addon';
import { readFactsRevision, runFactsTransaction } from '../../packages/syncnoscli/src/sqlite/revision';
import {
  assertReadableSqliteSchema,
  getSqliteDatabaseUuid,
  getSqliteFtsCapability,
  migrateSqliteSchema,
  SQLITE_APPLICATION_ID,
  SQLITE_FACT_TABLE_NAMES,
  SQLITE_SCHEMA_VERSION,
  type SyncNosSqliteDatabase,
} from '../../packages/syncnoscli/src/sqlite/schema';

function memoryDatabase(): SyncNosSqliteDatabase {
  const addon = loadBetterSqlite3();
  return new addon.constructor(':memory:');
}

function expectLocalError(callback: () => void, code: LocalDataContractError['code']): void {
  let thrown: unknown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalDataContractError);
  expect((thrown as LocalDataContractError).code).toBe(code);
}

describe('SyncNos SQLite schema migration', () => {
  it('creates the five fact tables, meta identity, receipt/staging tables, and exact FTS capability idempotently', () => {
    const database = memoryDatabase();
    try {
      migrateSqliteSchema(database);
      migrateSqliteSchema(database);
      assertReadableSqliteSchema(database);

      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String((row as { name: unknown }).name));
      for (const table of [...SQLITE_FACT_TABLE_NAMES, 'meta', 'migration_receipts', 'staging_metadata']) {
        expect(tables).toContain(table);
      }
      expect(database.pragma('application_id', { simple: true })).toBe(SQLITE_APPLICATION_ID);
      expect(database.pragma('user_version', { simple: true })).toBe(SQLITE_SCHEMA_VERSION);
      expect(getSqliteDatabaseUuid(database)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(readFactsRevision(database)).toBe(0);
      expect(getSqliteFtsCapability(database)).toEqual({ available: true, reason: null });
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name = 'syncnos_fts_probe_v1'").get(),
      ).toBeUndefined();
      expect(database.prepare("SELECT sql FROM sqlite_master WHERE name = 'conversation_fts'").get()).toMatchObject({
        sql: expect.stringContaining("tokenize='trigram'"),
      });
    } finally {
      database.close();
    }
  });

  it('keeps facts schema transactional when FTS5/trigram probing is unavailable, without substituting a tokenizer or scan', () => {
    const database = memoryDatabase();
    const originalExec = database.exec.bind(database);
    const exec = vi.spyOn(database, 'exec').mockImplementation((sql: string) => {
      if (sql.includes("CREATE VIRTUAL TABLE syncnos_fts_probe_v1 USING fts5 (content, tokenize='trigram')")) {
        throw Object.assign(new Error('no such tokenizer: trigram'), { code: 'SQLITE_ERROR' });
      }
      return originalExec(sql);
    });
    try {
      migrateSqliteSchema(database);
      expect(getSqliteFtsCapability(database)).toMatchObject({ available: false });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'conversation_fts'").get()).toBeUndefined();
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name = 'syncnos_fts_probe_v1'").get(),
      ).toBeUndefined();
      expect(database.prepare('SELECT COUNT(*) AS count FROM conversations').get()).toMatchObject({ count: 0 });
      expect(readFactsRevision(database)).toBe(0);
    } finally {
      exec.mockRestore();
      database.close();
    }
  });

  it('rolls back a failed schema migration and rejects incompatible database identities', () => {
    const failedDatabase = memoryDatabase();
    const originalExec = failedDatabase.exec.bind(failedDatabase);
    const exec = vi.spyOn(failedDatabase, 'exec').mockImplementation((sql: string) => {
      if (sql.includes('CREATE TABLE conversations'))
        throw Object.assign(new Error('disk failure'), { code: 'SQLITE_IOERR' });
      return originalExec(sql);
    });
    try {
      expect(() => migrateSqliteSchema(failedDatabase)).toThrow('disk failure');
      expect(failedDatabase.prepare("SELECT name FROM sqlite_master WHERE name = 'meta'").get()).toBeUndefined();
    } finally {
      exec.mockRestore();
      failedDatabase.close();
    }

    const incompatibleDatabase = memoryDatabase();
    try {
      incompatibleDatabase.exec('PRAGMA application_id = 1;');
      expectLocalError(() => migrateSqliteSchema(incompatibleDatabase), 'SCHEMA_MISMATCH');
    } finally {
      incompatibleDatabase.close();
    }
  });

  it('bumps a revision exactly once after a committed facts mutation and never after rollback', () => {
    const database = memoryDatabase();
    try {
      migrateSqliteSchema(database);
      const committed = runFactsTransaction(database, () => {
        database
          .prepare('INSERT INTO conversations (source, conversation_key, payload_json) VALUES (?, ?, ?)')
          .run('chatgpt', 'conversation-a', '{"source":"chatgpt","conversationKey":"conversation-a"}');
        return 'ok';
      });
      expect(committed).toEqual({ result: 'ok', factsRevision: 1 });
      expect(readFactsRevision(database)).toBe(1);

      expect(() =>
        runFactsTransaction(database, () => {
          database
            .prepare('INSERT INTO conversations (source, conversation_key, payload_json) VALUES (?, ?, ?)')
            .run('chatgpt', 'conversation-b', '{"source":"chatgpt","conversationKey":"conversation-b"}');
          throw new Error('abort mutation');
        }),
      ).toThrow('abort mutation');
      expect(readFactsRevision(database)).toBe(1);
      expect(database.prepare('SELECT COUNT(*) AS count FROM conversations').get()).toMatchObject({ count: 1 });

      expectLocalError(() => runFactsTransaction(database, () => ({ then: () => undefined })), 'INVALID_ARGUMENT');
      expect(readFactsRevision(database)).toBe(1);
    } finally {
      database.close();
    }
  });
});
