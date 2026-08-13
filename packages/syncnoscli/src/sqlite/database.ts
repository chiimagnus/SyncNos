import { chmod as nodeChmod, lstat as nodeLstat } from 'node:fs/promises';

import { LocalDataContractError, type LocalDataErrorCode } from '@services/local-data/contracts';

import { ensureSyncNosRuntimeDirectory } from '../runtime/filesystem';
import { assertSyncNosRuntimePaths, resolveSyncNosRuntimePaths, type SyncNosRuntimePaths } from '../runtime/paths';
import { loadBetterSqlite3, type LoadedBetterSqlite3 } from './native-addon';
import {
  assertReadableSqliteSchema,
  getSqliteFtsCapability,
  migrateSqliteSchema,
  type SqliteFtsCapability,
  type SyncNosSqliteDatabase,
} from './schema';

export const SQLITE_BUSY_TIMEOUT_MS = 3000;

type DatabaseFileStatus = Readonly<{
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  mode?: number;
  uid?: number;
}>;

export type SyncNosSqliteMode = 'read-only' | 'read-write';

export type SyncNosSqliteHandle = Readonly<{
  close: () => void;
  database: SyncNosSqliteDatabase;
  ftsCapability: SqliteFtsCapability;
  mode: SyncNosSqliteMode;
  paths: SyncNosRuntimePaths;
}>;

export type DatabaseOpenDependencies = Readonly<{
  chmod?: (path: string, mode: number) => Promise<void>;
  ensureRuntimeDirectory?: (paths: SyncNosRuntimePaths) => Promise<unknown>;
  getuid?: (() => number) | undefined;
  loadNativeAddon?: () => LoadedBetterSqlite3;
  lstat?: (path: string) => Promise<DatabaseFileStatus>;
}>;

export type DatabaseOpenInput = Readonly<{
  dependencies?: DatabaseOpenDependencies;
  paths?: SyncNosRuntimePaths;
}>;

type ResolvedDatabaseDependencies = Readonly<{
  chmod: (path: string, mode: number) => Promise<void>;
  ensureRuntimeDirectory: (paths: SyncNosRuntimePaths) => Promise<unknown>;
  getuid?: () => number;
  loadNativeAddon: () => LoadedBetterSqlite3;
  lstat: (path: string) => Promise<DatabaseFileStatus>;
}>;

function sqliteFailure(code: LocalDataErrorCode): never {
  throw new LocalDataContractError(code);
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code);
}

function sqliteCode(error: unknown): string {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
}

/** Maps native SQLite failures to the only public local-data error vocabulary. */
export function mapSqliteError(error: unknown, input: { readOnly?: boolean } = {}): LocalDataContractError {
  if (error instanceof LocalDataContractError) return error;
  const code = sqliteCode(error);
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) return new LocalDataContractError('BUSY');
  if (code.startsWith('SQLITE_SCHEMA')) return new LocalDataContractError('SCHEMA_MISMATCH');
  if (code === 'SQLITE_CANTOPEN' && input.readOnly) return new LocalDataContractError('DATABASE_NOT_INITIALIZED');
  if (
    code.startsWith('SQLITE_CORRUPT') ||
    code.startsWith('SQLITE_NOTADB') ||
    code.startsWith('SQLITE_IOERR') ||
    code.startsWith('SQLITE_FULL') ||
    code.startsWith('SQLITE_READONLY')
  ) {
    return new LocalDataContractError('JOURNAL_CORRUPT');
  }
  return new LocalDataContractError('INVALID_ARGUMENT');
}

function resolveDependencies(input: DatabaseOpenDependencies | undefined): ResolvedDatabaseDependencies {
  return Object.freeze({
    chmod: input?.chmod ?? nodeChmod,
    ensureRuntimeDirectory: input?.ensureRuntimeDirectory ?? ensureSyncNosRuntimeDirectory,
    getuid: input?.getuid ?? (typeof process.getuid === 'function' ? process.getuid.bind(process) : undefined),
    loadNativeAddon: input?.loadNativeAddon ?? loadBetterSqlite3,
    lstat: input?.lstat ?? nodeLstat,
  });
}

async function lstatIfPresent(
  dependencies: ResolvedDatabaseDependencies,
  path: string,
): Promise<DatabaseFileStatus | null> {
  try {
    return await dependencies.lstat(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    sqliteFailure('JOURNAL_CORRUPT');
  }
}

function assertOwnedUnixFile(
  paths: SyncNosRuntimePaths,
  status: DatabaseFileStatus,
  dependencies: ResolvedDatabaseDependencies,
): void {
  if (paths.platform === 'win32') return;
  const uid = dependencies.getuid?.();
  if (!Number.isSafeInteger(uid) || uid! < 0 || status.uid !== uid) sqliteFailure('JOURNAL_CORRUPT');
}

function assertDatabaseFile(
  paths: SyncNosRuntimePaths,
  status: DatabaseFileStatus,
  dependencies: ResolvedDatabaseDependencies,
): void {
  if (status.isSymbolicLink() || !status.isFile()) sqliteFailure('JOURNAL_CORRUPT');
  assertOwnedUnixFile(paths, status, dependencies);
}

async function assertReadableDatabaseFile(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedDatabaseDependencies,
): Promise<void> {
  const status = await lstatIfPresent(dependencies, paths.databasePath);
  if (!status) sqliteFailure('DATABASE_NOT_INITIALIZED');
  assertDatabaseFile(paths, status, dependencies);
  if (paths.platform !== 'win32' && (Number(status.mode) & 0o777) !== 0o600) sqliteFailure('JOURNAL_CORRUPT');
}

/** The read path must reject a swapped runtime parent before it ever resolves the DB child. */
async function assertReadableRuntimeDirectory(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedDatabaseDependencies,
): Promise<void> {
  const status = await lstatIfPresent(dependencies, paths.runtimeDirectory);
  if (!status) sqliteFailure('DATABASE_NOT_INITIALIZED');
  if (status.isSymbolicLink() || !status.isDirectory()) sqliteFailure('JOURNAL_CORRUPT');
  assertOwnedUnixFile(paths, status, dependencies);
  if (paths.platform !== 'win32' && (Number(status.mode) & 0o777) !== 0o700) sqliteFailure('JOURNAL_CORRUPT');
}

/** Rechecks the database sidecars after a write path creates or updates WAL state. */
export async function ensureOwnerOnlyDatabaseFiles(
  pathsValue: unknown,
  input: DatabaseOpenDependencies = {},
): Promise<void> {
  const paths = assertSyncNosRuntimePaths(pathsValue);
  const dependencies = resolveDependencies(input);
  for (const path of [paths.databasePath, paths.databaseWalPath, paths.databaseShmPath]) {
    const status = await lstatIfPresent(dependencies, path);
    if (!status) {
      if (path === paths.databasePath) sqliteFailure('JOURNAL_CORRUPT');
      continue;
    }
    assertDatabaseFile(paths, status, dependencies);
    if (paths.platform !== 'win32' && (Number(status.mode) & 0o777) !== 0o600) {
      try {
        await dependencies.chmod(path, 0o600);
      } catch (_error) {
        sqliteFailure('JOURNAL_CORRUPT');
      }
      const repaired = await lstatIfPresent(dependencies, path);
      if (!repaired) sqliteFailure('JOURNAL_CORRUPT');
      assertDatabaseFile(paths, repaired, dependencies);
      if ((Number(repaired.mode) & 0o777) !== 0o600) sqliteFailure('JOURNAL_CORRUPT');
    }
  }
}

function configureReadOnlyConnection(database: SyncNosSqliteDatabase): void {
  database.pragma('foreign_keys = ON');
  database.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
}

function configureWriteConnection(database: SyncNosSqliteDatabase): void {
  configureReadOnlyConnection(database);
  const journalMode = String(database.pragma('journal_mode = WAL', { simple: true })).toLowerCase();
  if (journalMode !== 'wal') {
    const error = Object.assign(new Error('SQLite refused WAL mode'), { code: 'SQLITE_IOERR' });
    throw error;
  }
  database.pragma('synchronous = NORMAL');
}

function createHandle(
  database: SyncNosSqliteDatabase,
  paths: SyncNosRuntimePaths,
  mode: SyncNosSqliteMode,
): SyncNosSqliteHandle {
  return Object.freeze({
    database,
    paths,
    mode,
    ftsCapability: getSqliteFtsCapability(database),
    close: () => {
      if (database.open) database.close();
    },
  });
}

function createDatabase(
  addon: LoadedBetterSqlite3,
  paths: SyncNosRuntimePaths,
  options: { readonly: boolean; fileMustExist: boolean },
): SyncNosSqliteDatabase {
  return new addon.constructor(paths.databasePath, {
    readonly: options.readonly,
    fileMustExist: options.fileMustExist,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });
}

/** Opens an existing local database without creating the runtime directory, DB, WAL, or schema. */
export async function openReadOnly(input: DatabaseOpenInput = {}): Promise<SyncNosSqliteHandle> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.dependencies);
  let database: SyncNosSqliteDatabase | null = null;
  try {
    await assertReadableRuntimeDirectory(paths, dependencies);
    await assertReadableDatabaseFile(paths, dependencies);
    const addon = dependencies.loadNativeAddon();
    database = createDatabase(addon, paths, { readonly: true, fileMustExist: true });
    configureReadOnlyConnection(database);
    assertReadableSqliteSchema(database);
    return createHandle(database, paths, 'read-only');
  } catch (error) {
    try {
      database?.close();
    } catch (_closeError) {
      // Preserve the structured failure that made the handle unusable.
    }
    throw mapSqliteError(error, { readOnly: true });
  }
}

/** The only database open path allowed to initialize, migrate, or change SQLite state for the Native Host. */
export async function openReadWriteForHost(input: DatabaseOpenInput = {}): Promise<SyncNosSqliteHandle> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.dependencies);
  let database: SyncNosSqliteDatabase | null = null;
  try {
    const addon = dependencies.loadNativeAddon();
    await dependencies.ensureRuntimeDirectory(paths);
    const existing = await lstatIfPresent(dependencies, paths.databasePath);
    if (existing) assertDatabaseFile(paths, existing, dependencies);
    database = createDatabase(addon, paths, { readonly: false, fileMustExist: false });
    configureWriteConnection(database);
    migrateSqliteSchema(database);
    await ensureOwnerOnlyDatabaseFiles(paths, input.dependencies);
    return createHandle(database, paths, 'read-write');
  } catch (error) {
    try {
      database?.close();
    } catch (_closeError) {
      // Preserve the structured failure that made the handle unusable.
    }
    throw mapSqliteError(error);
  }
}
