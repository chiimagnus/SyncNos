import { lstat as nodeLstat, readFile as nodeReadFile, realpath as nodeRealpath } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import {
  ensureNativeHostRegistrations,
  removeOwnedNativeHostRegistrations,
  resolveSyncNosCliPackageRoot,
  SYNCNOSCLI_PACKAGE_NAME,
  type EnsureNativeHostRegistrationsInput,
  type NativeHostRegistrationDependencies,
  type RemoveNativeHostRegistrationsInput,
} from './host-registration';
import { removeNativeHostLauncher, type RemoveNativeHostLauncherResult } from '../runtime/launcher';
import { assertSyncNosRuntimePaths, resolveSyncNosRuntimePaths, type SyncNosRuntimePaths } from '../runtime/paths';

type LifecyclePlatform = 'darwin' | 'linux' | 'win32';
type PathApi = typeof posix;

type LifecycleFileStatus = Readonly<{
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}>;

export type GlobalLifecycleInspection = Readonly<{
  packageRoot: string | null;
  reason:
    | 'global-layout'
    | 'global-flag-missing'
    | 'package-identity-invalid'
    | 'package-path-invalid'
    | 'package-source-invalid'
    | 'prefix-invalid';
}>;

export type LifecycleDependencies = Readonly<{
  ensureRegistrations?: (input: EnsureNativeHostRegistrationsInput) => Promise<unknown>;
  lstat?: (path: string) => Promise<LifecycleFileStatus>;
  readFile?: (path: string) => Promise<Buffer>;
  realpath?: (path: string) => Promise<string>;
  removeLauncher?: (input: Readonly<{ paths: SyncNosRuntimePaths }>) => Promise<RemoveNativeHostLauncherResult>;
  removeRegistrations?: (
    input: RemoveNativeHostRegistrationsInput,
  ) => Promise<Readonly<{ canRemoveLauncher: boolean; conflicts: readonly string[] }>>;
  writeDiagnostic?: (message: string) => void;
}>;

export type InspectGlobalLifecycleInput = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
  requireGlobalFlag?: boolean;
  requireRegistrySource?: boolean;
  dependencies?: Pick<LifecycleDependencies, 'lstat' | 'readFile' | 'realpath'>;
}>;

export type InspectGlobalCliInstallInput = Readonly<{
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
  dependencies?: Pick<LifecycleDependencies, 'lstat' | 'readFile' | 'realpath'>;
}>;

export type RunLifecycleInput = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
  registrationDependencies?: NativeHostRegistrationDependencies;
  dependencies?: LifecycleDependencies;
}>;

export type LifecycleResult = Readonly<{
  action: 'postinstall' | 'unregister' | 'unsupported';
  status: 'completed' | 'noop';
}>;

function pathApi(platform: LifecyclePlatform): PathApi {
  return platform === 'win32' ? win32 : posix;
}

function samePath(platform: LifecyclePlatform, left: string, right: string): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sameSegment(platform: LifecyclePlatform, left: string, right: string): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isSupportedPlatform(value: NodeJS.Platform): value is LifecyclePlatform {
  return value === 'darwin' || value === 'linux' || value === 'win32';
}

function runtimePaths(input: SyncNosRuntimePaths | undefined): SyncNosRuntimePaths | null {
  try {
    return assertSyncNosRuntimePaths(input ?? resolveSyncNosRuntimePaths());
  } catch (_error) {
    return null;
  }
}

function globalPackagePath(paths: SyncNosRuntimePaths, prefix: string): string | null {
  const api = pathApi(paths.platform);
  if (!prefix || !api.isAbsolute(prefix)) return null;
  const root = api.resolve(prefix);
  return paths.platform === 'win32'
    ? api.join(root, 'node_modules', '@chiimagnus', 'syncnoscli')
    : api.join(root, 'lib', 'node_modules', '@chiimagnus', 'syncnoscli');
}

function globalPrefixFromPackagePath(paths: SyncNosRuntimePaths, packageRoot: string): string | null {
  const api = pathApi(paths.platform);
  if (!packageRoot || !api.isAbsolute(packageRoot)) return null;
  const candidate = api.resolve(packageRoot);
  if (!sameSegment(paths.platform, api.basename(candidate), 'syncnoscli')) return null;
  const scopeDirectory = api.dirname(candidate);
  if (!sameSegment(paths.platform, api.basename(scopeDirectory), '@chiimagnus')) return null;
  const modulesDirectory = api.dirname(scopeDirectory);
  if (!sameSegment(paths.platform, api.basename(modulesDirectory), 'node_modules')) return null;
  const prefix =
    paths.platform === 'win32'
      ? api.dirname(modulesDirectory)
      : (() => {
          const libDirectory = api.dirname(modulesDirectory);
          return sameSegment(paths.platform, api.basename(libDirectory), 'lib') ? api.dirname(libDirectory) : '';
        })();
  const expected = globalPackagePath(paths, prefix);
  return expected && samePath(paths.platform, expected, candidate) ? prefix : null;
}

function resolveDependencies(
  input: Pick<LifecycleDependencies, 'lstat' | 'readFile' | 'realpath'> | undefined,
): Required<Pick<LifecycleDependencies, 'lstat' | 'readFile' | 'realpath'>> {
  return {
    lstat: input?.lstat ?? nodeLstat,
    readFile: input?.readFile ?? nodeReadFile,
    realpath: input?.realpath ?? nodeRealpath,
  };
}

async function regularDirectory(dependencies: ReturnType<typeof resolveDependencies>, path: string): Promise<boolean> {
  try {
    const status = await dependencies.lstat(path);
    return status.isDirectory() && !status.isSymbolicLink();
  } catch (_error) {
    return false;
  }
}

async function packageVersionIfIdentityMatches(
  dependencies: ReturnType<typeof resolveDependencies>,
  paths: SyncNosRuntimePaths,
  packageRoot: string,
): Promise<string | null> {
  try {
    const bytes = await dependencies.readFile(pathApi(paths.platform).join(packageRoot, 'package.json'));
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as {
      name?: unknown;
      version?: unknown;
    };
    return value?.name === SYNCNOSCLI_PACKAGE_NAME &&
      typeof value.version === 'string' &&
      value.version.trim().length > 0
      ? value.version
      : null;
  } catch (_error) {
    return null;
  }
}

async function inspectGlobalCliPackage(
  paths: SyncNosRuntimePaths,
  expected: string,
  candidate: string,
  dependencies: ReturnType<typeof resolveDependencies>,
): Promise<GlobalLifecycleInspection> {
  const api = pathApi(paths.platform);
  if (
    !api.isAbsolute(candidate) ||
    !(await regularDirectory(dependencies, expected)) ||
    !(await regularDirectory(dependencies, candidate))
  ) {
    return Object.freeze({ packageRoot: null, reason: 'package-path-invalid' });
  }
  try {
    const [expectedRealPath, candidateRealPath] = await Promise.all([
      dependencies.realpath(expected),
      dependencies.realpath(candidate),
    ]);
    if (!samePath(paths.platform, expectedRealPath, candidateRealPath)) {
      return Object.freeze({ packageRoot: null, reason: 'package-path-invalid' });
    }
    const packageVersion = await packageVersionIfIdentityMatches(dependencies, paths, candidateRealPath);
    if (!packageVersion) return Object.freeze({ packageRoot: null, reason: 'package-identity-invalid' });
    return Object.freeze({ packageRoot: candidateRealPath, reason: 'global-layout' });
  } catch (_error) {
    return Object.freeze({ packageRoot: null, reason: 'package-path-invalid' });
  }
}

function registryPackageResolutionMatches(
  environment: Readonly<Record<string, string | undefined>>,
  version: string,
): boolean {
  try {
    const resolved = new URL(environment.npm_package_resolved ?? '');
    const registry = new URL(environment.npm_config_registry ?? 'https://registry.npmjs.org/');
    if (
      resolved.protocol !== 'https:' ||
      registry.protocol !== 'https:' ||
      resolved.origin !== registry.origin ||
      resolved.search ||
      resolved.hash ||
      resolved.username ||
      resolved.password
    ) {
      return false;
    }
    const basePath = registry.pathname.endsWith('/') ? registry.pathname : `${registry.pathname}/`;
    return resolved.pathname === `${basePath}@chiimagnus/syncnoscli/-/syncnoscli-${encodeURIComponent(version)}.tgz`;
  } catch (_error) {
    return false;
  }
}

/**
 * Accepts only npm's actual scoped global layout. A linked package is rejected before
 * realpath comparison so npm link cannot impersonate a global install.
 */
export async function inspectGlobalCliLifecycle(
  input: InspectGlobalLifecycleInput = {},
): Promise<GlobalLifecycleInspection> {
  const paths = runtimePaths(input.paths);
  if (!paths || !isSupportedPlatform(paths.platform)) {
    return Object.freeze({ packageRoot: null, reason: 'package-path-invalid' });
  }
  const environment = input.environment ?? process.env;
  if (input.requireGlobalFlag !== false && environment.npm_config_global !== 'true') {
    return Object.freeze({ packageRoot: null, reason: 'global-flag-missing' });
  }
  const expected = globalPackagePath(paths, environment.npm_config_prefix?.trim() ?? '');
  if (!expected) return Object.freeze({ packageRoot: null, reason: 'prefix-invalid' });
  const dependencies = resolveDependencies(input.dependencies);
  const candidate = input.packageRoot ?? resolveSyncNosCliPackageRoot();
  const inspection = await inspectGlobalCliPackage(paths, expected, candidate, dependencies);
  if (!inspection.packageRoot || input.requireRegistrySource !== true) return inspection;
  const packageVersion = await packageVersionIfIdentityMatches(dependencies, paths, inspection.packageRoot);
  return packageVersion && registryPackageResolutionMatches(environment, packageVersion)
    ? inspection
    : Object.freeze({ packageRoot: null, reason: 'package-source-invalid' });
}

/**
 * Verifies a directly invoked CLI from its own non-symlink global layout. Unlike an
 * npm lifecycle hook, this intentionally does not depend on transient npm env vars.
 */
export async function inspectGlobalCliInstall(
  input: InspectGlobalCliInstallInput = {},
): Promise<GlobalLifecycleInspection> {
  const paths = runtimePaths(input.paths);
  if (!paths || !isSupportedPlatform(paths.platform)) {
    return Object.freeze({ packageRoot: null, reason: 'package-path-invalid' });
  }
  const candidate = input.packageRoot ?? resolveSyncNosCliPackageRoot();
  const prefix = globalPrefixFromPackagePath(paths, candidate);
  if (!prefix) return Object.freeze({ packageRoot: null, reason: 'package-path-invalid' });
  const expected = globalPackagePath(paths, prefix);
  if (!expected) return Object.freeze({ packageRoot: null, reason: 'package-path-invalid' });
  return await inspectGlobalCliPackage(paths, expected, candidate, resolveDependencies(input.dependencies));
}

function diagnostic(input: RunLifecycleInput, message: string): void {
  (input.dependencies?.writeDiagnostic ?? ((value) => process.stderr.write(`${value}\n`)))(message);
}

async function runPostinstall(input: RunLifecycleInput): Promise<LifecycleResult> {
  const paths = runtimePaths(input.paths);
  if (!paths) return Object.freeze({ action: 'postinstall', status: 'noop' });
  const inspection = await inspectGlobalCliLifecycle({
    dependencies: input.dependencies,
    environment: input.environment,
    packageRoot: input.packageRoot,
    paths,
    requireGlobalFlag: true,
    requireRegistrySource: true,
  });
  if (!inspection.packageRoot) return Object.freeze({ action: 'postinstall', status: 'noop' });
  try {
    await (input.dependencies?.ensureRegistrations ?? ensureNativeHostRegistrations)({
      packageRoot: inspection.packageRoot,
      paths,
      registrationDependencies: input.registrationDependencies,
    });
    return Object.freeze({ action: 'postinstall', status: 'completed' });
  } catch (_error) {
    diagnostic(input, 'SyncNos CLI installed, but Native Host registration needs doctor --fix.');
    return Object.freeze({ action: 'postinstall', status: 'completed' });
  }
}

async function runUnregister(input: RunLifecycleInput): Promise<LifecycleResult> {
  const paths = runtimePaths(input.paths);
  if (!paths) return Object.freeze({ action: 'unregister', status: 'noop' });
  const inspection = await inspectGlobalCliInstall({
    dependencies: input.dependencies,
    packageRoot: input.packageRoot,
    paths,
  });
  if (!inspection.packageRoot) return Object.freeze({ action: 'unregister', status: 'noop' });
  try {
    const registration = await (input.dependencies?.removeRegistrations ?? removeOwnedNativeHostRegistrations)({
      packageRoot: inspection.packageRoot,
      paths,
      registrationDependencies: input.registrationDependencies,
    });
    if (registration.conflicts.length > 0) {
      diagnostic(input, 'SyncNos CLI left an unverified Native Host registration untouched.');
      return Object.freeze({ action: 'unregister', status: 'completed' });
    }
    if (!registration.canRemoveLauncher) {
      diagnostic(input, 'SyncNos CLI left its launcher untouched because a complete registration could not be proven.');
      return Object.freeze({ action: 'unregister', status: 'completed' });
    }
    await (input.dependencies?.removeLauncher ?? removeNativeHostLauncher)({ paths });
    return Object.freeze({ action: 'unregister', status: 'completed' });
  } catch (_error) {
    diagnostic(input, 'SyncNos CLI left Native Host files untouched because ownership could not be verified.');
    return Object.freeze({ action: 'unregister', status: 'completed' });
  }
}

/** postinstall and explicit unregister are fail-safe; ambiguous ownership deliberately no-ops. */
export async function runLifecycle(
  action: string | undefined = process.env.npm_lifecycle_event,
  input: RunLifecycleInput = {},
): Promise<LifecycleResult> {
  if (action === 'postinstall') return await runPostinstall(input);
  if (action === 'unregister') return await runUnregister(input);
  return Object.freeze({ action: 'unsupported', status: 'noop' });
}

if (require.main === module) {
  void runLifecycle(process.argv[2]).then(() => {
    process.exitCode = 0;
  });
}
