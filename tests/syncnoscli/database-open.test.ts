import { access, chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDataContractError } from '@services/local-data/contracts';

import {
  mapSqliteError,
  openReadOnly,
  openReadWriteForHost,
  SQLITE_BUSY_TIMEOUT_MS,
} from '../../packages/syncnoscli/src/sqlite/database';
import {
  loadBetterSqlite3,
  NativeAddonError,
  resolveBetterSqlite3Target,
} from '../../packages/syncnoscli/src/sqlite/native-addon';
import { readFactsRevision } from '../../packages/syncnoscli/src/sqlite/revision';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];

async function temporaryPaths() {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-database-'));
  temporaryRoots.push(root);
  return resolveSyncNosRuntimePaths({ platform: 'darwin', homeDirectory: root });
}

function expectLocalError(error: unknown, code: LocalDataContractError['code']): void {
  expect(error).toBeInstanceOf(LocalDataContractError);
  expect((error as LocalDataContractError).code).toBe(code);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SyncNos SQLite native addon policy', () => {
  it('selects only explicit official platform exports and rejects unknown runtimes', () => {
    expect(
      resolveBetterSqlite3Target({
        arch: 'x64',
        platform: 'linux',
        processReport: () => ({ header: { glibcVersionRuntime: '2.39' } }),
      }),
    ).toBe('linux-x64');
    expect(
      resolveBetterSqlite3Target({
        arch: 'arm64',
        platform: 'linux',
        processReport: () => ({ header: {} }),
      }),
    ).toBe('linuxmusl-arm64');
    expect(() => resolveBetterSqlite3Target({ arch: 'ia32', platform: 'win32' })).toThrow(NativeAddonError);
    expect(() => resolveBetterSqlite3Target({ arch: 'x64', platform: 'freebsd' })).toThrow(NativeAddonError);
  });

  it('verifies the selected bundled binary before module loading and never falls back to package main', () => {
    const loaded = loadBetterSqlite3();
    const packageJsonPath = require.resolve('better-sqlite3/package.json');
    const packageRoot = dirname(realpathSync(packageJsonPath));
    const prebuildPath = join(packageRoot, 'prebuilds', `${loaded.target}.node`);
    const loadModule = vi.fn();

    expect(() =>
      loadBetterSqlite3({
        lstat: lstatSync,
        loadModule,
        readFile: (path) => (path === prebuildPath ? Buffer.from('tampered') : readFileSync(path)),
        realpath: realpathSync,
        resolveModule: require.resolve,
      }),
    ).toThrow(NativeAddonError);
    expect(loadModule).not.toHaveBeenCalled();

    const source = readFileSync(join(process.cwd(), 'packages/syncnoscli/src/sqlite/native-addon.ts'), 'utf8');
    expect(source).not.toContain("require('better-sqlite3')");
    expect(source).not.toMatch(/build\/(?:Debug|Release)|node-gyp|nativeBinding/);
  });
});

describe('SyncNos SQLite open policy', () => {
  it('keeps read-only missing-database commands side-effect free', async () => {
    const paths = await temporaryPaths();
    const loadNativeAddon = vi.fn(() => {
      throw new NativeAddonError();
    });
    await expect(openReadOnly({ paths })).rejects.toSatisfy((error: unknown) => {
      expectLocalError(error, 'DATABASE_NOT_INITIALIZED');
      return true;
    });
    await expect(openReadOnly({ paths, dependencies: { loadNativeAddon } })).rejects.toSatisfy((error: unknown) => {
      expectLocalError(error, 'DATABASE_NOT_INITIALIZED');
      return true;
    });
    expect(loadNativeAddon).not.toHaveBeenCalled();
    await expect(access(paths.runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(paths.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a runtime-directory symlink before loading an addon or resolving its database child', async () => {
    const paths = await temporaryPaths();
    const foreignDirectory = join(paths.homeDirectory, 'foreign-runtime');
    await mkdir(foreignDirectory);
    await writeFile(join(foreignDirectory, 'syncnos.sqlite'), 'not SyncNos data');
    await symlink(foreignDirectory, paths.runtimeDirectory);
    const loadNativeAddon = vi.fn(() => {
      throw new NativeAddonError();
    });

    await expect(openReadOnly({ paths, dependencies: { loadNativeAddon } })).rejects.toSatisfy((error: unknown) => {
      expectLocalError(error, 'JOURNAL_CORRUPT');
      return true;
    });
    expect(loadNativeAddon).not.toHaveBeenCalled();
  });

  it('opens the one write path with WAL/schema then serves the same database read-only', async () => {
    const paths = await temporaryPaths();
    const writable = await openReadWriteForHost({ paths });
    expect(writable.mode).toBe('read-write');
    expect(writable.database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(writable.database.pragma('busy_timeout', { simple: true })).toBe(SQLITE_BUSY_TIMEOUT_MS);
    expect(readFactsRevision(writable.database)).toBe(0);
    expect(writable.ftsCapability.available).toBe(true);
    writable.close();

    expect((await lstat(paths.runtimeDirectory)).mode & 0o777).toBe(0o700);
    expect((await lstat(paths.databasePath)).mode & 0o777).toBe(0o600);
    const readonly = await openReadOnly({ paths });
    expect(readonly.mode).toBe('read-only');
    expect(readonly.database.prepare('SELECT COUNT(*) AS count FROM conversations').get()).toMatchObject({ count: 0 });
    readonly.close();
  });

  it('validates the addon before creating a runtime directory and repairs only owner-owned Unix DB modes on writes', async () => {
    const paths = await temporaryPaths();
    const ensureRuntimeDirectory = vi.fn(async () => undefined);
    await expect(
      openReadWriteForHost({
        paths,
        dependencies: {
          ensureRuntimeDirectory,
          loadNativeAddon: () => {
            throw new NativeAddonError();
          },
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectLocalError(error, 'UNSUPPORTED_PLATFORM');
      return true;
    });
    expect(ensureRuntimeDirectory).not.toHaveBeenCalled();

    const writable = await openReadWriteForHost({ paths });
    writable.close();
    await chmod(paths.databasePath, 0o644);
    await expect(openReadOnly({ paths })).rejects.toSatisfy((error: unknown) => {
      expectLocalError(error, 'JOURNAL_CORRUPT');
      return true;
    });
    const repaired = await openReadWriteForHost({ paths });
    repaired.close();
    expect((await lstat(paths.databasePath)).mode & 0o777).toBe(0o600);
  });

  it('rejects insecure WAL/SHM sidecars before loading the native addon on read-only opens', async () => {
    const paths = await temporaryPaths();
    const writable = await openReadWriteForHost({ paths });
    writable.close();
    await writeFile(paths.databaseWalPath, 'sidecar');
    await writeFile(paths.databaseShmPath, 'sidecar');
    await chmod(paths.databaseWalPath, 0o644);
    await chmod(paths.databaseShmPath, 0o644);
    const loadNativeAddon = vi.fn(() => {
      throw new NativeAddonError();
    });

    await expect(openReadOnly({ paths, dependencies: { loadNativeAddon } })).rejects.toSatisfy((error: unknown) => {
      expectLocalError(error, 'JOURNAL_CORRUPT');
      return true;
    });
    expect(loadNativeAddon).not.toHaveBeenCalled();
  });

  it('maps SQLite operational failures to public structured codes', () => {
    expect(mapSqliteError({ code: 'SQLITE_BUSY' }).code).toBe('BUSY');
    expect(mapSqliteError({ code: 'SQLITE_LOCKED' }).code).toBe('BUSY');
    expect(mapSqliteError({ code: 'SQLITE_CANTOPEN' }, { readOnly: true }).code).toBe('DATABASE_NOT_INITIALIZED');
    expect(mapSqliteError({ code: 'SQLITE_CORRUPT' }).code).toBe('JOURNAL_CORRUPT');
    expect(mapSqliteError({ code: 'SQLITE_SCHEMA' }).code).toBe('SCHEMA_MISMATCH');
  });
});
