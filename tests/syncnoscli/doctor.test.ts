import { access, chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SQLITE_SCHEMA_VERSION,
  LocalDataContractError,
} from '@services/local-data/contracts';

import { runDoctor, type RunDoctorInput } from '../../packages/syncnoscli/src/commands/doctor';
import { runCli } from '../../packages/syncnoscli/src/cli';
import {
  ensureNativeHostRegistrations,
  getNativeHostRegistrationLocations,
  type NativeHostRegistrationInspection,
} from '../../packages/syncnoscli/src/install/host-registration';
import type { GlobalLifecycleInspection } from '../../packages/syncnoscli/src/install/lifecycle';
import type { NativeHostLauncherOwnership } from '../../packages/syncnoscli/src/runtime/launcher';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';
import { openReadWriteForHost } from '../../packages/syncnoscli/src/sqlite/database';

const temporaryRoots: string[] = [];
const packageRoot = resolve(process.cwd(), 'packages/syncnoscli');

async function temporaryPaths() {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-doctor-'));
  temporaryRoots.push(root);
  return resolveSyncNosRuntimePaths({ platform: 'linux', homeDirectory: root });
}

function ownedLauncher(
  paths: ReturnType<typeof resolveSyncNosRuntimePaths>,
  nodePath = process.execPath,
): NativeHostLauncherOwnership {
  return Object.freeze({
    configDigest: 'a'.repeat(64),
    configPath: paths.launcherConfigPath,
    entrypointPath: join(packageRoot, 'dist', 'native-host.cjs'),
    launcherDigest: 'b'.repeat(64),
    launcherPath: paths.launcherPath,
    nodePath,
    ownerMarkerDigest: 'c'.repeat(64),
    ownerMarkerPath: paths.runtimeOwnerMarkerPath,
    packageDigest: 'd'.repeat(64),
    platform: 'linux',
    prebuiltDigest: null,
  });
}

function expectedDoctorRegistrations(
  paths: ReturnType<typeof resolveSyncNosRuntimePaths>,
  manifest: 'absent' | 'owned',
) {
  return getNativeHostRegistrationLocations(paths).map((location) => ({
    browser: location.browser,
    manifest,
    registry: 'not_applicable' as const,
    browserConnection: 'not_verified' as const,
  }));
}

function registrationInspection(
  paths: ReturnType<typeof resolveSyncNosRuntimePaths>,
  manifest: 'conflict' | 'owned',
): NativeHostRegistrationInspection {
  return Object.freeze({
    package: 'verified',
    packageEntrypoint: 'current',
    browsers: Object.freeze(
      getNativeHostRegistrationLocations(paths).map(({ browser }) =>
        Object.freeze({ browser, manifest, registry: 'not_applicable' as const }),
      ),
    ),
  });
}

function globalInstall(packageRootValue: string): GlobalLifecycleInspection {
  return Object.freeze({ packageRoot: packageRootValue, reason: 'global-layout' });
}

function doctorInput(
  paths: ReturnType<typeof resolveSyncNosRuntimePaths>,
  dependencies: NonNullable<RunDoctorInput['dependencies']>,
): RunDoctorInput {
  return { paths, packageRoot, dependencies };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SyncNos doctor', () => {
  it('reports a missing database without creating the runtime directory, facts database, or launcher', async () => {
    const paths = await temporaryPaths();

    const report = await runDoctor({ paths, packageRoot });

    expect(report).toMatchObject({
      contract: { protocolVersion: LOCAL_DATA_PROTOCOL_VERSION, schemaVersion: LOCAL_DATA_SQLITE_SCHEMA_VERSION },
      runtime: { state: 'absent', permissions: 'not_present', staging: 'absent' },
      database: {
        state: 'not_initialized',
        reason: 'DATABASE_NOT_INITIALIZED',
        filePermissions: 'not_present',
        schemaVersion: null,
      },
      launcher: { state: 'absent', configDigest: null, prebuiltDigest: null },
    });
    expect(report.registrations).toEqual(expectedDoctorRegistrations(paths, 'absent'));
    await expect(access(paths.runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(paths.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads an initialized database without changing its bytes and reports its schema, revision, and FTS capability', async () => {
    const paths = await temporaryPaths();
    const writable = await openReadWriteForHost({ paths });
    writable.close();
    const before = await readFile(paths.databasePath);

    const report = await runDoctor({ paths, packageRoot });

    expect(report.database).toMatchObject({
      state: 'ready',
      reason: null,
      filePermissions: 'private',
      schemaVersion: LOCAL_DATA_SQLITE_SCHEMA_VERSION,
      factsRevision: 0,
      fts: { available: true, reason: null },
    });
    await expect(readFile(paths.databasePath)).resolves.toEqual(before);
  });

  it('does not resolve or open a database child when the runtime parent is a symlink', async () => {
    const paths = await temporaryPaths();
    const foreignDirectory = join(paths.homeDirectory, 'foreign-runtime');
    await mkdir(foreignDirectory);
    await writeFile(join(foreignDirectory, 'syncnos.sqlite'), 'foreign data');
    await symlink(foreignDirectory, paths.runtimeDirectory);
    const openReadOnly = vi.fn(async () => {
      throw new Error('must not open');
    });

    const report = await runDoctor(
      doctorInput(paths, {
        inspectLauncher: async () => null,
        inspectRegistrations: async () => registrationInspection(paths, 'owned'),
        openReadOnly,
      }),
    );

    expect(openReadOnly).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      runtime: { state: 'invalid', permissions: 'invalid' },
      database: { state: 'invalid', reason: 'JOURNAL_CORRUPT', filePermissions: 'unavailable' },
    });
  });

  it('reports a locked existing database as structured busy diagnostics without trying to repair it', async () => {
    const paths = await temporaryPaths();
    const writable = await openReadWriteForHost({ paths });
    writable.close();

    const report = await runDoctor(
      doctorInput(paths, {
        inspectLauncher: async () => ownedLauncher(paths),
        inspectRegistrations: async () => registrationInspection(paths, 'owned'),
        openReadOnly: async () => {
          throw new LocalDataContractError('BUSY');
        },
      }),
    );

    expect(report.database).toEqual({
      state: 'busy',
      reason: 'BUSY',
      filePermissions: 'private',
      schemaVersion: null,
      factsRevision: null,
      fts: null,
    });
  });

  it('redacts an owned stale Node path and never leaks the private runtime root', async () => {
    const paths = await temporaryPaths();
    await mkdir(paths.runtimeDirectory, { mode: 0o700 });
    await mkdir(paths.stagingDirectory);
    const staleNodePath = join(paths.homeDirectory, 'versions', 'missing-node');

    const report = await runDoctor(
      doctorInput(paths, {
        inspectLauncher: async () => ownedLauncher(paths, staleNodePath),
        inspectRegistrations: async () => registrationInspection(paths, 'owned'),
      }),
    );

    expect(report.launcher).toMatchObject({
      state: 'stale',
      recordedNode: { state: 'missing', path: '~/versions/missing-node', matchesCurrentProcess: null },
    });
    expect(report.runtime.staging).toBe('present');
    expect(JSON.stringify(report)).not.toContain(paths.homeDirectory);
  });

  it('uses --fix only after a direct global-layout proof, repairs Native Host state, and leaves the database absent', async () => {
    const paths = await temporaryPaths();
    const globalPackageRoot = join(paths.homeDirectory, 'prefix', 'lib', 'node_modules', '@chiimagnus', 'syncnoscli');
    await mkdir(join(globalPackageRoot, 'dist'), { recursive: true });
    await writeFile(join(globalPackageRoot, 'package.json'), '{"name":"@chiimagnus/syncnoscli","version":"0.1.0"}');
    await writeFile(join(globalPackageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 0;');

    const report = await runDoctor({
      paths,
      packageRoot: globalPackageRoot,
      fix: true,
    });

    expect(report.actions).toContainEqual({ name: 'native_host', status: 'repaired', reason: null });
    expect(report.launcher.state).toBe('ready');
    expect(report.registrations).toEqual(expectedDoctorRegistrations(paths, 'owned'));
    expect(report.database).toMatchObject({ state: 'not_initialized', filePermissions: 'not_present' });
    await expect(access(paths.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('doctor --fix completes a proven interrupted registration generation instead of treating it as a permanent conflict', async () => {
    const paths = await temporaryPaths();
    const globalPackageRoot = join(paths.homeDirectory, 'prefix', 'lib', 'node_modules', '@chiimagnus', 'syncnoscli');
    await mkdir(join(globalPackageRoot, 'dist'), { recursive: true });
    await writeFile(join(globalPackageRoot, 'package.json'), '{"name":"@chiimagnus/syncnoscli","version":"0.1.0"}');
    await writeFile(join(globalPackageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 0;');
    const edgeOwner = getNativeHostRegistrationLocations(paths).find(
      (location) => location.browser === 'edge',
    )!.ownerPath;
    let injected = false;

    await expect(
      ensureNativeHostRegistrations({
        packageRoot: globalPackageRoot,
        paths,
        registrationDependencies: {
          rename: async (source, destination) => {
            if (!injected && destination === edgeOwner) {
              injected = true;
              throw new Error('injected doctor registration interruption');
            }
            await rename(source, destination);
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_UNAVAILABLE' });
    await expect(access(paths.registrationUpdateIntentPath)).resolves.toBeUndefined();

    const report = await runDoctor({ paths, packageRoot: globalPackageRoot, fix: true });
    expect(report.actions).toContainEqual({ name: 'native_host', status: 'repaired', reason: null });
    expect(report.registrations).toEqual(expectedDoctorRegistrations(paths, 'owned'));
    await expect(access(paths.registrationUpdateIntentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses --fix from an unproven package layout and preserves non-owned state', async () => {
    const paths = await temporaryPaths();
    const ensureRegistrations = vi.fn(async () => undefined);

    const report = await runDoctor({
      ...doctorInput(paths, {
        ensureRegistrations,
        inspectGlobalInstall: async () => Object.freeze({ packageRoot: null, reason: 'package-path-invalid' }),
        inspectLauncher: async () => null,
        inspectRegistrations: async () => ({
          ...registrationInspection(paths, 'conflict'),
          packageEntrypoint: 'not_checked' as const,
        }),
      }),
      fix: true,
    });

    expect(ensureRegistrations).not.toHaveBeenCalled();
    expect(report.actions).toContainEqual({
      name: 'native_host',
      status: 'refused',
      reason: 'global_install_not_verified',
    });
    await expect(access(paths.runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('repairs only an existing owner-only database file mode and never opens a write connection', async () => {
    const paths = await temporaryPaths();
    const writable = await openReadWriteForHost({ paths });
    writable.close();
    await chmod(paths.databasePath, 0o644);
    const repairDatabasePermissions = vi.fn(async () => {
      await chmod(paths.databasePath, 0o600);
    });

    const report = await runDoctor({
      ...doctorInput(paths, {
        inspectGlobalInstall: async () => globalInstall(packageRoot),
        inspectLauncher: async () => ownedLauncher(paths),
        inspectRegistrations: async () => registrationInspection(paths, 'owned'),
        repairDatabasePermissions,
      }),
      fix: true,
    });

    expect(repairDatabasePermissions).toHaveBeenCalledWith(paths);
    expect(report.actions).toContainEqual({ name: 'database_permissions', status: 'repaired', reason: null });
    expect(report.database).toMatchObject({ state: 'ready', filePermissions: 'private', factsRevision: 0 });
  });

  it('detects and repairs insecure WAL/SHM permissions even when the main database is already private', async () => {
    const paths = await temporaryPaths();
    const writable = await openReadWriteForHost({ paths });
    try {
      await access(paths.databaseWalPath);
      await access(paths.databaseShmPath);
      await chmod(paths.databasePath, 0o600);
      await chmod(paths.databaseWalPath, 0o644);
      await chmod(paths.databaseShmPath, 0o644);

      const before = await runDoctor(
        doctorInput(paths, {
          inspectLauncher: async () => ownedLauncher(paths),
          inspectRegistrations: async () => registrationInspection(paths, 'owned'),
          openReadOnly: vi.fn(async () => {
            throw new Error('must not open an insecure database set');
          }),
        }),
      );
      expect(before.database).toMatchObject({ state: 'invalid', filePermissions: 'insecure' });

      const report = await runDoctor({
        ...doctorInput(paths, {
          inspectGlobalInstall: async () => globalInstall(packageRoot),
          inspectLauncher: async () => ownedLauncher(paths),
          inspectRegistrations: async () => registrationInspection(paths, 'owned'),
        }),
        fix: true,
      });

      expect(report.actions).toContainEqual({ name: 'database_permissions', status: 'repaired', reason: null });
      expect(report.database).toMatchObject({ state: 'ready', filePermissions: 'private' });
      expect((await lstat(paths.databasePath)).mode & 0o777).toBe(0o600);
      expect((await lstat(paths.databaseWalPath)).mode & 0o777).toBe(0o600);
      expect((await lstat(paths.databaseShmPath)).mode & 0o777).toBe(0o600);
    } finally {
      writable.close();
    }
  });

  it('treats a WAL sidecar symlink as invalid instead of attempting an owner-permission repair', async () => {
    const paths = await temporaryPaths();
    const writable = await openReadWriteForHost({ paths });
    writable.close();
    await rm(paths.databaseWalPath, { force: true });
    const foreignWal = join(paths.homeDirectory, 'foreign-wal');
    await writeFile(foreignWal, 'foreign');
    await symlink(foreignWal, paths.databaseWalPath);
    const repairDatabasePermissions = vi.fn(async () => undefined);

    const report = await runDoctor({
      ...doctorInput(paths, {
        inspectGlobalInstall: async () => globalInstall(packageRoot),
        inspectLauncher: async () => ownedLauncher(paths),
        inspectRegistrations: async () => registrationInspection(paths, 'owned'),
        repairDatabasePermissions,
      }),
      fix: true,
    });

    expect(report.database).toMatchObject({ state: 'invalid', filePermissions: 'invalid' });
    expect(report.actions).toContainEqual({
      name: 'database_permissions',
      status: 'not_needed',
      reason: 'database_permissions_invalid',
    });
    expect(repairDatabasePermissions).not.toHaveBeenCalled();
  });

  it('emits the versioned JSON envelope for doctor and rejects unknown doctor flags without text-only errors', async () => {
    const chunks: string[] = [];
    const stdout = { write: (chunk: string) => (chunks.push(chunk), true) };
    const report = Object.freeze({ checked: true });

    await expect(runCli(['doctor'], { stdout, runDoctor: async () => report })).resolves.toBe(0);
    expect(JSON.parse(chunks.join(''))).toMatchObject({
      ok: true,
      requestId: 'cli:doctor',
      data: report,
    });

    chunks.length = 0;
    await expect(runCli(['doctor', '--unsafe'], { stdout })).resolves.toBe(2);
    expect(JSON.parse(chunks.join(''))).toMatchObject({
      ok: false,
      requestId: 'cli:doctor',
      error: { code: 'INVALID_ARGUMENT' },
    });
  });
});
