import { LocalDataContractError, type CliFactsRequest } from '@services/local-data/contracts';

import { mapSqliteError, openReadOnly, type DatabaseOpenInput } from '../sqlite/database';
import { readFactsRevision } from '../sqlite/revision';
import type { SyncNosSqliteDatabase } from '../sqlite/schema';

type StatsCliRequest = Extract<CliFactsRequest, Readonly<{ command: 'STATS' }>>;

type CountsRow = Readonly<{
  article_comments?: unknown;
  conversations?: unknown;
  image_cache?: unknown;
  messages?: unknown;
  sync_mappings?: unknown;
}>;

export type RunStatsInput = Readonly<{
  database?: DatabaseOpenInput;
  openReadOnly?: typeof openReadOnly;
  request: StatsCliRequest;
}>;

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new LocalDataContractError('SCHEMA_MISMATCH');
  return Number(value);
}

function readStats(database: SyncNosSqliteDatabase) {
  try {
    const row = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM conversations) AS conversations,
           (SELECT COUNT(*) FROM messages) AS messages,
           (SELECT COUNT(*) FROM sync_mappings) AS sync_mappings,
           (SELECT COUNT(*) FROM image_cache) AS image_cache,
           (SELECT COUNT(*) FROM article_comments) AS article_comments`,
      )
      .get() as CountsRow | undefined;
    return Object.freeze({
      counts: Object.freeze({
        articleComments: count(row?.article_comments),
        conversations: count(row?.conversations),
        imageCache: count(row?.image_cache),
        messages: count(row?.messages),
        syncMappings: count(row?.sync_mappings),
      }),
      factsRevision: readFactsRevision(database),
    });
  } catch (error) {
    throw mapSqliteError(error, { readOnly: true });
  }
}

/** Reports fixed fact-table aggregates without opening a write connection or exposing database paths. */
export async function runStats(input: RunStatsInput): Promise<unknown> {
  let handle: Awaited<ReturnType<typeof openReadOnly>> | null = null;
  try {
    handle = await (input.openReadOnly ?? openReadOnly)(input.database);
    return readStats(handle.database);
  } finally {
    try {
      handle?.close();
    } catch (_error) {
      // The one-shot command has no reusable handle after its result is determined.
    }
  }
}
