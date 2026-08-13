import { LocalDataContractError } from '@services/local-data/contracts';

import { ensureSqliteFtsIndexWithinFactsTransaction, readSqliteMeta, type SyncNosSqliteDatabase } from './schema';

const FACTS_REVISION_META_KEY = 'facts_revision';

function invalidRevision(): never {
  throw new LocalDataContractError('SCHEMA_MISMATCH');
}

export function readFactsRevision(database: SyncNosSqliteDatabase): number {
  const value = readSqliteMeta(database, FACTS_REVISION_META_KEY);
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) invalidRevision();
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) invalidRevision();
  return revision;
}

/** Must run inside the facts transaction after every data mutation has succeeded. */
export function bumpFactsRevision(database: SyncNosSqliteDatabase): number {
  const current = readFactsRevision(database);
  if (current >= Number.MAX_SAFE_INTEGER) invalidRevision();
  const next = current + 1;
  database.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(next), FACTS_REVISION_META_KEY);
  return next;
}

/**
 * A facts mutation gets one immediate SQLite transaction and exactly one revision bump.
 * The revision is written before COMMIT, so a failed commit cannot publish a phantom revision.
 */
export function runFactsTransaction<T>(
  database: SyncNosSqliteDatabase,
  operation: () => T,
): Readonly<{
  factsRevision: number;
  result: T;
}> {
  if (database.inTransaction) throw new LocalDataContractError('BUSY');
  database.exec('BEGIN IMMEDIATE;');
  try {
    // A facts write is the next authorized chance to recover a derived FTS index.
    // A local FTS fault is contained by its savepoint; a base database fault still aborts this transaction.
    ensureSqliteFtsIndexWithinFactsTransaction(database);
    const result = operation();
    if (result && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
      throw new LocalDataContractError('INVALID_ARGUMENT');
    }
    const factsRevision = bumpFactsRevision(database);
    database.exec('COMMIT;');
    return Object.freeze({ result, factsRevision });
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch (_rollbackError) {
      // SQLite already aborted the transaction; preserve the actionable original error.
    }
    throw error;
  }
}
