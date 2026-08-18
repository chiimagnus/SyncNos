import { lstat as nodeLstat, realpath as nodeRealpath } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SQLITE_SCHEMA_VERSION,
  LocalDataContractError,
  type CliDoctorActionReason,
  type CliDoctorActionStatus,
  type CliDoctorDatabaseState,
  type CliDoctorFilePermission,
  type CliDoctorLauncherState,
  type CliDoctorRecordedNodeState,
  type CliDoctorReport,
  type LocalDataErrorCode,
} from '@services/local-data/contracts';

import {
  ensureNativeHostRegistrations,
  getNativeHostRegistrationLocations,
  inspectNativeHostRegistrations,
  NativeHostRegistrationError,
  resolveSyncNosCliPackageRoot,
  type EnsureNativeHostRegistrationsInput,
  type InspectNativeHostRegistrationsInput,
  type NativeHostRegistrationInspection,
} from '../install/host-registration';
import {
  inspectGlobalCliInstall,
  type GlobalLifecycleInspection,
  type InspectGlobalCliInstallInput,
} from '../install/lifecycle';
import {
  inspectNativeHostLauncher,
  NativeHostLauncherError,
  type NativeHostLauncherOwnership,
} from '../runtime/launcher';
import { assertSyncNosRuntimePaths, resolveSyncNosRuntimePaths, type SyncNosRuntimePaths } from '../runtime/paths';
import {
  ensureOwnerOnlyDatabaseFiles,
  openReadOnly,
  type DatabaseOpenInput,
  type SyncNosSqliteHandle,
} from '../sqlite/database';
import { readFactsRevision } from '../sqlite/revision';

type DoctorFileStatus = Readonly<{
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  mode?: number;
  uid?: number;
}>;

type DoctorDependencies = Readonly<{
  ensureRegistrations?: (input: EnsureNativeHostRegistrationsInput) => Promise<unknown>;
  getuid?: (() => number) | undefined;
  inspectGlobalInstall?: (input: InspectGlobalCliInstallInput) => Promise<GlobalLifecycleInspection>;
  inspectLauncher?: (input: Readonly<{ paths: SyncNosRuntimePaths }>) => Promise<NativeHostLauncherOwnership | null>;
  inspectRegistrations?: (input: InspectNativeHostRegistrationsInput) => Promise<NativeHostRegistrationInspection>;
  lstat?: (path: string) => Promise<DoctorFileStatus>;
  openReadOnly?: (input: DatabaseOpenInput) => Promise<SyncNosSqliteHandle>;
  realpath?: (path: string) => Promise<string>;
  repairDatabasePermissions?: (paths: SyncNosRuntimePaths) => Promise<void>;
}>;

export type RunDoctorInput = Readonly<{
  currentProcessPath?: string;
  dependencies?: DoctorDependencies;
  fix?: boolean;
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
}>;

type ResolvedDoctorDependencies = Required<
  Pick<
    DoctorDependencies,
    | 'ensureRegistrations'
    | 'inspectGlobalInstall'
    | 'inspectLauncher'
    | 'inspectRegistrations'
    | 'lstat'
    | 'openReadOnly'
    | 'realpath'
    | 'repairDatabasePermissions'
  >
> &
  Readonly<{ getuid?: () => number }>;

type LstatResult = Readonly<{
  state: 'absent' | 'present' | 'unavailable';
  status: DoctorFileStatus | null;
}>;

type RuntimeSnapshot = CliDoctorReport['runtime'];

type DatabaseSnapshot = CliDoctorReport['database'];

type LauncherSnapshot = Readonly<{
  ownership: NativeHostLauncherOwnership | null;
  report: CliDoctorReport['launcher'];
}>;

type DoctorSnapshot = Readonly<{
  database: DatabaseSnapshot;
  launcher: LauncherSnapshot;
  registrations: NativeHostRegistrationInspection;
  runtime: RuntimeSnapshot;
}>;

function pathApi(platform: SyncNosRuntimePaths['platform']): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

function samePath(platform: SyncNosRuntimePaths['platform'], left: string, right: string): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code);
}

function resolveDependencies(input: DoctorDependencies | undefined): ResolvedDoctorDependencies {
  return {
    ensureRegistrations: input?.ensureRegistrations ?? ensureNativeHostRegistrations,
    getuid: input?.getuid ?? (typeof process.getuid === 'function' ? process.getuid.bind(process) : undefined),
    inspectGlobalInstall: input?.inspectGlobalInstall ?? inspectGlobalCliInstall,
    inspectLauncher: input?.inspectLauncher ?? inspectNativeHostLauncher,
    inspectRegistrations: input?.inspectRegistrations ?? inspectNativeHostRegistrations,
    lstat: input?.lstat ?? nodeLstat,
    openReadOnly: input?.openReadOnly ?? openReadOnly,
    realpath: input?.realpath ?? nodeRealpath,
    repairDatabasePermissions: input?.repairDatabasePermissions ?? ensureOwnerOnlyDatabaseFiles,
  };
}

async function lstatIfPresent(dependencies: ResolvedDoctorDependencies, path: string): Promise<LstatResult> {
  try {
    return Object.freeze({ state: 'present' as const, status: await dependencies.lstat(path) });
  } catch (error) {
    return Object.freeze({
      state: isErrno(error, 'ENOENT') ? ('absent' as const) : ('unavailable' as const),
      status: null,
    });
  }
}

function unixPrivatePermission(
  status: DoctorFileStatus,
  dependencies: ResolvedDoctorDependencies,
  expectedMode: number,
): CliDoctorFilePermission {
  const uid = dependencies.getuid?.();
  if (!Number.isSafeInteger(uid) || uid! < 0 || status.uid !== uid || !Number.isSafeInteger(status.mode)) {
    return 'unavailable';
  }
  return (Number(status.mode) & 0o777) === expectedMode ? 'private' : 'insecure';
}

function filePermission(
  paths: SyncNosRuntimePaths,
  result: LstatResult,
  dependencies: ResolvedDoctorDependencies,
  kind: 'database' | 'runtime',
): CliDoctorFilePermission {
  if (result.state === 'absent') return 'not_present';
  if (result.state === 'unavailable') return 'unavailable';
  const status = result.status;
  if (!status || status.isSymbolicLink() || (kind === 'runtime' ? !status.isDirectory() : !status.isFile())) {
    return 'invalid';
  }
  if (paths.platform === 'win32') return 'platform_managed';
  return unixPrivatePermission(status, dependencies, kind === 'runtime' ? 0o700 : 0o600);
}

async function inspectRuntime(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedDoctorDependencies,
): Promise<RuntimeSnapshot> {
  const runtime = await lstatIfPresent(dependencies, paths.runtimeDirectory);
  const permissions = filePermission(paths, runtime, dependencies, 'runtime');
  if (runtime.state === 'absent') {
    return Object.freeze({ state: 'absent', permissions, staging: 'absent' });
  }
  if (runtime.state === 'unavailable') {
    return Object.freeze({ state: 'unavailable', permissions, staging: 'unavailable' });
  }
  if (permissions === 'invalid' || permissions === 'unavailable' || permissions === 'insecure') {
    return Object.freeze({ state: 'invalid', permissions, staging: 'unavailable' });
  }
  const staging = await lstatIfPresent(dependencies, paths.stagingDirectory);
  const stagingState =
    staging.state === 'absent'
      ? ('absent' as const)
      : staging.state === 'unavailable'
        ? ('unavailable' as const)
        : staging.status?.isDirectory() && !staging.status.isSymbolicLink()
          ? ('present' as const)
          : ('invalid' as const);
  return Object.freeze({ state: 'ready', permissions, staging: stagingState });
}

function databaseStateForError(
  error: unknown,
): Readonly<{ reason: LocalDataErrorCode; state: CliDoctorDatabaseState }> {
  const code = error instanceof LocalDataContractError ? error.code : 'INVALID_ARGUMENT';
  switch (code) {
    case 'DATABASE_NOT_INITIALIZED':
      return Object.freeze({ state: 'not_initialized', reason: code });
    case 'BUSY':
      return Object.freeze({ state: 'busy', reason: code });
    case 'UNSUPPORTED_PLATFORM':
      return Object.freeze({ state: 'unsupported', reason: code });
    case 'JOURNAL_CORRUPT':
    case 'SCHEMA_MISMATCH':
      return Object.freeze({ state: 'invalid', reason: code });
    default:
      return Object.freeze({ state: 'unavailable', reason: code });
  }
}

async function databaseFilePermissions(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedDoctorDependencies,
): Promise<CliDoctorFilePermission> {
  const database = await lstatIfPresent(dependencies, paths.databasePath);
  const primary = filePermission(paths, database, dependencies, 'database');
  if (primary !== 'private' && primary !== 'platform_managed') return primary;

  const sidecars = await Promise.all(
    [paths.databaseWalPath, paths.databaseShmPath].map(async (path) =>
      filePermission(paths, await lstatIfPresent(dependencies, path), dependencies, 'database'),
    ),
  );
  const present = sidecars.filter((permission) => permission !== 'not_present');
  if (present.includes('invalid')) return 'invalid';
  if (present.includes('unavailable')) return 'unavailable';
  if (present.includes('insecure')) return 'insecure';
  return primary;
}

async function inspectDatabase(
  paths: SyncNosRuntimePaths,
  runtime: RuntimeSnapshot,
  dependencies: ResolvedDoctorDependencies,
): Promise<DatabaseSnapshot> {
  if (runtime.state === 'absent') {
    return Object.freeze({
      state: 'not_initialized',
      reason: 'DATABASE_NOT_INITIALIZED',
      filePermissions: 'not_present',
      schemaVersion: null,
      factsRevision: null,
      fts: null,
    });
  }
  if (runtime.state === 'unavailable') {
    return Object.freeze({
      state: 'unavailable',
      reason: null,
      filePermissions: 'unavailable',
      schemaVersion: null,
      factsRevision: null,
      fts: null,
    });
  }
  if (runtime.state === 'invalid') {
    return Object.freeze({
      state: 'invalid',
      reason: 'JOURNAL_CORRUPT',
      filePermissions: 'unavailable',
      schemaVersion: null,
      factsRevision: null,
      fts: null,
    });
  }
  const filePermissions = await databaseFilePermissions(paths, dependencies);
  if (filePermissions === 'not_present') {
    return Object.freeze({
      state: 'not_initialized',
      reason: 'DATABASE_NOT_INITIALIZED',
      filePermissions,
      schemaVersion: null,
      factsRevision: null,
      fts: null,
    });
  }
  if (filePermissions === 'unavailable') {
    return Object.freeze({
      state: 'unavailable',
      reason: null,
      filePermissions,
      schemaVersion: null,
      factsRevision: null,
      fts: null,
    });
  }
  if (filePermissions === 'invalid' || filePermissions === 'insecure') {
    return Object.freeze({
      state: 'invalid',
      reason: 'JOURNAL_CORRUPT',
      filePermissions,
      schemaVersion: null,
      factsRevision: null,
      fts: null,
    });
  }

  let handle: SyncNosSqliteHandle | null = null;
  try {
    handle = await dependencies.openReadOnly({ paths });
    return Object.freeze({
      state: 'ready',
      reason: null,
      filePermissions,
      schemaVersion: LOCAL_DATA_SQLITE_SCHEMA_VERSION,
      factsRevision: readFactsRevision(handle.database),
      fts: Object.freeze({ ...handle.ftsCapability }),
    });
  } catch (error) {
    const state = databaseStateForError(error);
    return Object.freeze({
      state: state.state,
      reason: state.reason,
      filePermissions,
      schemaVersion: null,
      factsRevision: null,
      fts: null,
    });
  } finally {
    try {
      handle?.close();
    } catch (_error) {
      // Diagnostics are complete; a failed close cannot make this process retain a reusable handle.
    }
  }
}

function redactPath(paths: SyncNosRuntimePaths, value: string): string {
  const api = pathApi(paths.platform);
  const normalized = api.resolve(value);
  const relative = api.relative(paths.homeDirectory, normalized);
  if (relative === '') return '~';
  if (relative && !relative.startsWith('..') && !api.isAbsolute(relative)) {
    return `~/${relative.replaceAll('\\', '/')}`;
  }
  return `<external>/${api.basename(normalized)}`;
}

async function inspectRecordedNode(
  paths: SyncNosRuntimePaths,
  launcher: NativeHostLauncherOwnership | null,
  currentProcessPath: string,
  dependencies: ResolvedDoctorDependencies,
): Promise<CliDoctorReport['launcher']['recordedNode']> {
  if (!launcher) return Object.freeze({ path: null, state: 'not_recorded', matchesCurrentProcess: null });
  const path = redactPath(paths, launcher.nodePath);
  let resolvedNodePath: string;
  try {
    resolvedNodePath = await dependencies.realpath(launcher.nodePath);
  } catch (error) {
    return Object.freeze({
      path,
      state: isErrno(error, 'ENOENT')
        ? ('missing' as CliDoctorRecordedNodeState)
        : ('unavailable' as CliDoctorRecordedNodeState),
      matchesCurrentProcess: null,
    });
  }
  const status = await lstatIfPresent(dependencies, resolvedNodePath);
  if (status.state === 'absent') return Object.freeze({ path, state: 'missing', matchesCurrentProcess: null });
  if (status.state === 'unavailable') return Object.freeze({ path, state: 'unavailable', matchesCurrentProcess: null });
  if (!status.status || status.status.isSymbolicLink() || !status.status.isFile()) {
    return Object.freeze({ path, state: 'invalid', matchesCurrentProcess: null });
  }
  try {
    const current = await dependencies.realpath(currentProcessPath);
    return Object.freeze({
      path,
      state: 'available',
      matchesCurrentProcess: samePath(paths.platform, resolvedNodePath, current),
    });
  } catch (_error) {
    return Object.freeze({ path, state: 'available', matchesCurrentProcess: null });
  }
}

async function inspectLauncher(
  paths: SyncNosRuntimePaths,
  currentProcessPath: string,
  dependencies: ResolvedDoctorDependencies,
): Promise<LauncherSnapshot> {
  let ownership: NativeHostLauncherOwnership | null;
  try {
    ownership = await dependencies.inspectLauncher({ paths });
  } catch (_error) {
    return Object.freeze({
      ownership: null,
      report: Object.freeze({
        state: 'invalid' as CliDoctorLauncherState,
        configDigest: null,
        prebuiltDigest: null,
        entrypoint: 'not_checked' as const,
        recordedNode: Object.freeze({ path: null, state: 'not_recorded' as const, matchesCurrentProcess: null }),
      }),
    });
  }
  const recordedNode = await inspectRecordedNode(paths, ownership, currentProcessPath, dependencies);
  return Object.freeze({
    ownership,
    report: Object.freeze({
      state: ownership ? ('ready' as CliDoctorLauncherState) : ('absent' as CliDoctorLauncherState),
      configDigest: ownership?.configDigest ?? null,
      prebuiltDigest: ownership?.prebuiltDigest ?? null,
      entrypoint: 'not_checked' as const,
      recordedNode,
    }),
  });
}

function unavailableRegistrations(paths: SyncNosRuntimePaths): NativeHostRegistrationInspection {
  return Object.freeze({
    package: 'unavailable',
    packageEntrypoint: 'not_checked',
    browsers: Object.freeze(
      getNativeHostRegistrationLocations(paths).map(({ browser }) =>
        Object.freeze({
          browser,
          manifest: 'unavailable' as const,
          registry: paths.platform === 'win32' ? ('unavailable' as const) : ('not_applicable' as const),
        }),
      ),
    ),
  });
}

async function collectDoctorSnapshot(
  paths: SyncNosRuntimePaths,
  packageRoot: string,
  currentProcessPath: string,
  dependencies: ResolvedDoctorDependencies,
): Promise<DoctorSnapshot> {
  const runtime = await inspectRuntime(paths, dependencies);
  const [database, launcher, registrations] = await Promise.all([
    inspectDatabase(paths, runtime, dependencies),
    inspectLauncher(paths, currentProcessPath, dependencies),
    dependencies.inspectRegistrations({ packageRoot, paths }).catch(() => unavailableRegistrations(paths)),
  ]);
  const launcherState: CliDoctorLauncherState =
    launcher.report.state === 'ready' &&
    (registrations.packageEntrypoint === 'stale' ||
      launcher.report.recordedNode.state !== 'available' ||
      launcher.report.recordedNode.matchesCurrentProcess !== true)
      ? 'stale'
      : launcher.report.state;
  return Object.freeze({
    runtime,
    database,
    registrations,
    launcher: Object.freeze({
      ownership: launcher.ownership,
      report: Object.freeze({ ...launcher.report, state: launcherState, entrypoint: registrations.packageEntrypoint }),
    }),
  });
}

function needsNativeHostRepair(snapshot: DoctorSnapshot): boolean {
  return (
    snapshot.runtime.state !== 'ready' ||
    snapshot.launcher.report.state !== 'ready' ||
    snapshot.registrations.package !== 'verified' ||
    snapshot.registrations.packageEntrypoint !== 'current' ||
    snapshot.registrations.browsers.some(
      (browser) =>
        browser.manifest !== 'owned' || (browser.registry !== 'not_applicable' && browser.registry !== 'owned'),
    )
  );
}

function nativeHostActionForError(error: unknown): Readonly<{
  reason: Exclude<CliDoctorActionReason, null>;
  status: CliDoctorActionStatus;
}> {
  if (error instanceof NativeHostRegistrationError && error.code === 'REGISTRATION_CONFLICT') {
    return Object.freeze({ status: 'refused', reason: 'native_host_conflict' });
  }
  if (error instanceof NativeHostLauncherError || error instanceof NativeHostRegistrationError) {
    return Object.freeze({ status: 'refused', reason: 'native_host_invalid' });
  }
  return Object.freeze({ status: 'failed', reason: 'native_host_unavailable' });
}

function action(
  name: CliDoctorReport['actions'][number]['name'],
  status: CliDoctorActionStatus,
  reason: CliDoctorActionReason,
): CliDoctorReport['actions'][number] {
  return Object.freeze({ name, status, reason });
}

function databasePermissionNotNeeded(snapshot: DoctorSnapshot): CliDoctorReport['actions'][number] {
  return action(
    'database_permissions',
    'not_needed',
    snapshot.database.state === 'busy'
      ? 'database_busy'
      : snapshot.database.state === 'not_initialized'
        ? 'database_not_initialized'
        : snapshot.database.filePermissions === 'invalid'
          ? 'database_permissions_invalid'
          : snapshot.database.filePermissions === 'unavailable'
            ? 'database_permissions_unavailable'
            : null,
  );
}

function reportFromSnapshot(
  snapshot: DoctorSnapshot,
  actions: readonly CliDoctorReport['actions'][number][],
): CliDoctorReport {
  return Object.freeze({
    contract: Object.freeze({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SQLITE_SCHEMA_VERSION,
    }),
    runtime: snapshot.runtime,
    launcher: snapshot.launcher.report,
    registrations: Object.freeze(
      snapshot.registrations.browsers.map((browser) =>
        Object.freeze({ ...browser, browserConnection: 'not_verified' as const }),
      ),
    ),
    database: snapshot.database,
    actions: Object.freeze(actions),
  });
}

/**
 * Inspects the fixed runtime without creating it. `--fix` is deliberately limited to
 * proven global CLI-owned runtime files and owner-only permission repair of an existing DB.
 */
export async function runDoctor(input: RunDoctorInput = {}): Promise<CliDoctorReport> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const packageRoot = input.packageRoot ?? resolveSyncNosCliPackageRoot();
  const currentProcessPath = input.currentProcessPath ?? process.execPath;
  const dependencies = resolveDependencies(input.dependencies);
  let snapshot = await collectDoctorSnapshot(paths, packageRoot, currentProcessPath, dependencies);
  let nativeHostAction = action('native_host', 'not_requested', null);
  let databasePermissionAction = action('database_permissions', 'not_requested', null);
  if (!input.fix) return reportFromSnapshot(snapshot, [nativeHostAction, databasePermissionAction]);

  const needsNativeRepair = needsNativeHostRepair(snapshot);
  const needsDatabasePermissionRepair = snapshot.database.filePermissions === 'insecure';
  if (!needsNativeRepair) nativeHostAction = action('native_host', 'not_needed', null);
  if (!needsDatabasePermissionRepair) databasePermissionAction = databasePermissionNotNeeded(snapshot);
  if (!needsNativeRepair && !needsDatabasePermissionRepair) {
    return reportFromSnapshot(snapshot, [nativeHostAction, databasePermissionAction]);
  }

  let globalInstall: GlobalLifecycleInspection;
  try {
    globalInstall = await dependencies.inspectGlobalInstall({ packageRoot, paths });
  } catch (_error) {
    globalInstall = Object.freeze({ packageRoot: null, reason: 'package-path-invalid' });
  }
  if (!globalInstall.packageRoot) {
    if (needsNativeRepair) nativeHostAction = action('native_host', 'refused', 'global_install_not_verified');
    if (needsDatabasePermissionRepair) {
      databasePermissionAction = action('database_permissions', 'refused', 'global_install_not_verified');
    }
    return reportFromSnapshot(snapshot, [nativeHostAction, databasePermissionAction]);
  }

  if (needsNativeRepair) {
    try {
      await dependencies.ensureRegistrations({ packageRoot: globalInstall.packageRoot, paths });
      nativeHostAction = action('native_host', 'repaired', null);
    } catch (error) {
      const result = nativeHostActionForError(error);
      nativeHostAction = action('native_host', result.status, result.reason);
    }
  }
  if (nativeHostAction.status === 'repaired') {
    snapshot = await collectDoctorSnapshot(paths, packageRoot, currentProcessPath, dependencies);
    if (snapshot.database.filePermissions !== 'insecure') {
      databasePermissionAction = databasePermissionNotNeeded(snapshot);
    }
  }
  if (snapshot.database.filePermissions === 'insecure') {
    if (snapshot.database.state === 'busy') {
      databasePermissionAction = action('database_permissions', 'refused', 'database_busy');
    } else {
      try {
        await dependencies.repairDatabasePermissions(paths);
        databasePermissionAction = action('database_permissions', 'repaired', null);
      } catch (_error) {
        databasePermissionAction = action('database_permissions', 'failed', 'database_permissions_unavailable');
      }
    }
  }
  snapshot = await collectDoctorSnapshot(paths, packageRoot, currentProcessPath, dependencies);
  if (nativeHostAction.status === 'repaired' && needsNativeHostRepair(snapshot)) {
    nativeHostAction = action('native_host', 'failed', 'native_host_unavailable');
  }
  if (databasePermissionAction.status === 'repaired' && snapshot.database.filePermissions !== 'private') {
    databasePermissionAction = action('database_permissions', 'failed', 'database_permissions_unavailable');
  }
  return reportFromSnapshot(snapshot, [nativeHostAction, databasePermissionAction]);
}
