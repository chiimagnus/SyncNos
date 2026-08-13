import { createHash } from 'node:crypto';
import {
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  rename as nodeRename,
  unlink as nodeUnlink,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import { basename, posix, resolve as nodeResolve, win32 } from 'node:path';

import { nativeHostContract } from '@services/local-data/native-host-contract';

import {
  resolveVerifiedWindowsSystemExecutable,
  spawnFile,
  type RuntimeFileStatus,
  type SpawnFileOptions,
  type SpawnFileResult,
} from '../runtime/filesystem';
import {
  ensureNativeHostLauncher,
  inspectNativeHostLauncher,
  type NativeHostLauncherDependencies,
  type NativeHostLauncherOwnership,
} from '../runtime/launcher';
import { assertSyncNosRuntimePaths, resolveSyncNosRuntimePaths, type SyncNosRuntimePaths } from '../runtime/paths';

export const SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER = 'syncnoscli-native-host-registration-v1' as const;
export const SYNCNOSCLI_PACKAGE_NAME = '@chiimagnus/syncnoscli' as const;
export const SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE = 'SyncNosCliOwnerV1' as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const NATIVE_HOST_DESCRIPTION = 'SyncNos local data Native Host';
const WINDOWS_REGISTRY_VIEWS: readonly NativeHostRegistryView[] = Object.freeze(['32', '64']);
const NO_REGISTRY_VIEWS: readonly NativeHostRegistryView[] = Object.freeze([]);

export type NativeHostBrowser = 'chrome' | 'edge' | 'firefox';
type NativeHostRegistryView = '32' | '64';
type PathApi = typeof posix;

type RegistrationFileStatus = Pick<RuntimeFileStatus, 'isDirectory' | 'isFile' | 'isSymbolicLink'>;

type PackageIdentity = Readonly<{
  name: typeof SYNCNOSCLI_PACKAGE_NAME;
  root: string;
  version: string;
}>;

type NativeHostManifestLocation = Readonly<{
  browser: NativeHostBrowser;
  manifestPath: string;
  ownerPath: string;
  registryKey?: string;
}>;

type RegistrationOwnerRecord = Readonly<{
  browser: NativeHostBrowser;
  configDigest: string;
  launcherDigest: string;
  launcherPath: string;
  manifestDigest: string;
  ownerMarker: typeof SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER;
  packageDigest: string;
  packageName: typeof SYNCNOSCLI_PACKAGE_NAME;
  packageRoot: string;
  packageVersion: string;
  prebuiltDigest: string | null;
  version: 1;
}>;

type ExistingRegistration = Readonly<{
  ownerDigest: string;
  record: RegistrationOwnerRecord;
  state: 'owned';
}>;

type ExistingRegistrationState = ExistingRegistration | Readonly<{ state: 'absent' | 'conflict' }>;

export type WindowsRegistryReadResult =
  | Readonly<{ state: 'absent' }>
  | Readonly<{ state: 'present'; value: string }>
  | Readonly<{ state: 'unavailable' }>;

export type WindowsRegistryKeyResult = Readonly<{ state: 'absent' | 'present' | 'unavailable' }>;

export type WindowsRegistryAdapter = Readonly<{
  deleteValue: (
    input: Readonly<{ key: string; valueName: string | null; view: NativeHostRegistryView }>,
  ) => Promise<boolean>;
  readKey: (input: Readonly<{ key: string; view: NativeHostRegistryView }>) => Promise<WindowsRegistryKeyResult>;
  readValue: (
    input: Readonly<{ key: string; valueName: string | null; view: NativeHostRegistryView }>,
  ) => Promise<WindowsRegistryReadResult>;
  writeValue: (
    input: Readonly<{ key: string; value: string; valueName: string | null; view: NativeHostRegistryView }>,
  ) => Promise<void>;
}>;

export type NativeHostRegistrationDependencies = Readonly<{
  lstat?: (path: string) => Promise<RegistrationFileStatus>;
  mkdir?: (path: string, options: Readonly<{ mode: number; recursive: true }>) => Promise<void>;
  readFile?: (path: string) => Promise<Buffer>;
  realpath?: (path: string) => Promise<string>;
  rename?: (source: string, destination: string) => Promise<void>;
  unlink?: (path: string) => Promise<void>;
  windowsRegistry?: WindowsRegistryAdapter;
  writeFile?: (path: string, contents: Uint8Array, options: Readonly<{ flag: 'wx'; mode: number }>) => Promise<void>;
}>;

export type NativeHostRegistrationInspectionState = 'absent' | 'conflict' | 'owned' | 'unavailable';

export type NativeHostRegistrationInspection = Readonly<{
  browsers: readonly Readonly<{
    browser: NativeHostBrowser;
    manifest: NativeHostRegistrationInspectionState;
    registry: NativeHostRegistrationInspectionState | 'not_applicable';
  }>[];
  package: 'invalid' | 'unavailable' | 'verified';
  packageEntrypoint: 'current' | 'not_checked' | 'stale';
}>;

export type InspectNativeHostRegistrationsInput = Readonly<{
  launcherDependencies?: NativeHostLauncherDependencies;
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
  registrationDependencies?: NativeHostRegistrationDependencies;
}>;

export type EnsureNativeHostRegistrationsInput = Readonly<{
  arch?: string;
  launcherDependencies?: NativeHostLauncherDependencies;
  nodePath?: string;
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
  registrationDependencies?: NativeHostRegistrationDependencies;
}>;

export type NativeHostRegistrationResult = Readonly<{
  browsers: readonly Readonly<{
    browser: NativeHostBrowser;
    status: 'registered';
    verification: 'registration-written-not-browser-verified';
  }>[];
}>;

export type RemoveNativeHostRegistrationsInput = Readonly<{
  launcherDependencies?: NativeHostLauncherDependencies;
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
  registrationDependencies?: NativeHostRegistrationDependencies;
}>;

export type RemoveNativeHostRegistrationsResult = Readonly<{
  canRemoveLauncher: boolean;
  conflicts: readonly string[];
  removed: boolean;
}>;

export type OwnedFirefoxManifestInput = Readonly<{
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
  registrationDependencies?: NativeHostRegistrationDependencies;
}>;

export class NativeHostRegistrationError extends Error {
  constructor(
    readonly code:
      | 'PACKAGE_IDENTITY_INVALID'
      | 'REGISTRATION_CONFLICT'
      | 'REGISTRATION_UNAVAILABLE'
      | 'WINDOWS_REGISTRY_UNAVAILABLE',
  ) {
    super(
      code === 'REGISTRATION_CONFLICT'
        ? 'SyncNos CLI found a Native Host registration it does not own.'
        : 'SyncNos CLI could not safely update its Native Host registration.',
    );
    this.name = 'NativeHostRegistrationError';
  }
}

type ResolvedDependencies = Required<Omit<NativeHostRegistrationDependencies, 'windowsRegistry'>> &
  Pick<NativeHostRegistrationDependencies, 'windowsRegistry'>;

function registrationFailure(code: NativeHostRegistrationError['code']): never {
  throw new NativeHostRegistrationError(code);
}

function pathApi(platform: SyncNosRuntimePaths['platform']): PathApi {
  return platform === 'win32' ? win32 : posix;
}

function samePath(platform: SyncNosRuntimePaths['platform'], left: string, right: string): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code);
}

function strictRecord(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    registrationFailure('REGISTRATION_CONFLICT');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    registrationFailure('REGISTRATION_CONFLICT');
  }
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || /[\r\n]/.test(value)) {
    registrationFailure('REGISTRATION_CONFLICT');
  }
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) registrationFailure('REGISTRATION_CONFLICT');
  return value;
}

function parseBrowser(value: unknown): NativeHostBrowser {
  if (value === 'chrome' || value === 'edge' || value === 'firefox') return value;
  registrationFailure('REGISTRATION_CONFLICT');
}

function parseOwnerRecord(bytes: Uint8Array): RegistrationOwnerRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch (_error) {
    registrationFailure('REGISTRATION_CONFLICT');
  }
  const input = strictRecord(parsed);
  exactKeys(input, [
    'version',
    'ownerMarker',
    'browser',
    'manifestDigest',
    'launcherPath',
    'launcherDigest',
    'configDigest',
    'packageName',
    'packageVersion',
    'packageRoot',
    'packageDigest',
    'prebuiltDigest',
  ]);
  if (
    input.version !== 1 ||
    input.ownerMarker !== SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER ||
    input.packageName !== SYNCNOSCLI_PACKAGE_NAME ||
    (input.prebuiltDigest !== null && typeof input.prebuiltDigest !== 'string')
  ) {
    registrationFailure('REGISTRATION_CONFLICT');
  }
  return Object.freeze({
    version: 1,
    ownerMarker: SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER,
    browser: parseBrowser(input.browser),
    manifestDigest: digest(input.manifestDigest),
    launcherPath: nonEmptyString(input.launcherPath),
    launcherDigest: digest(input.launcherDigest),
    configDigest: digest(input.configDigest),
    packageName: SYNCNOSCLI_PACKAGE_NAME,
    packageVersion: nonEmptyString(input.packageVersion),
    packageRoot: nonEmptyString(input.packageRoot),
    packageDigest: digest(input.packageDigest),
    prebuiltDigest: input.prebuiltDigest === null ? null : digest(input.prebuiltDigest),
  });
}

export function resolveSyncNosCliPackageRoot(): string {
  const moduleDirectory = basename(__dirname);
  return moduleDirectory === 'dist' ? nodeResolve(__dirname, '..') : nodeResolve(__dirname, '..', '..');
}

function resolveDependencies(input: NativeHostRegistrationDependencies | undefined): ResolvedDependencies {
  return {
    lstat: input?.lstat ?? nodeLstat,
    mkdir:
      input?.mkdir ??
      (async (path, options) => {
        await nodeMkdir(path, options);
      }),
    readFile: input?.readFile ?? nodeReadFile,
    realpath: input?.realpath ?? nodeRealpath,
    rename: input?.rename ?? nodeRename,
    unlink: input?.unlink ?? nodeUnlink,
    writeFile:
      input?.writeFile ??
      (async (path, contents, options) => {
        await nodeWriteFile(path, contents, options);
      }),
    windowsRegistry: input?.windowsRegistry,
  };
}

async function lstatIfPresent(
  dependencies: ResolvedDependencies,
  path: string,
): Promise<RegistrationFileStatus | null> {
  try {
    return await dependencies.lstat(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    registrationFailure('REGISTRATION_UNAVAILABLE');
  }
}

function assertRegularFile(status: RegistrationFileStatus | null): asserts status is RegistrationFileStatus {
  if (!status || status.isSymbolicLink() || !status.isFile()) registrationFailure('REGISTRATION_CONFLICT');
}

function assertDirectory(status: RegistrationFileStatus | null): asserts status is RegistrationFileStatus {
  if (!status || status.isSymbolicLink() || !status.isDirectory()) registrationFailure('REGISTRATION_CONFLICT');
}

async function readVerifiedFile(dependencies: ResolvedDependencies, path: string): Promise<Buffer> {
  assertRegularFile(await lstatIfPresent(dependencies, path));
  let bytes: Buffer;
  try {
    bytes = await dependencies.readFile(path);
  } catch (_error) {
    registrationFailure('REGISTRATION_UNAVAILABLE');
  }
  assertRegularFile(await lstatIfPresent(dependencies, path));
  return bytes!;
}

async function readPackageIdentity(
  paths: SyncNosRuntimePaths,
  packageRoot: string | undefined,
  dependencies: ResolvedDependencies,
): Promise<PackageIdentity> {
  const api = pathApi(paths.platform);
  const candidate = packageRoot ?? resolveSyncNosCliPackageRoot();
  let root: string;
  try {
    root = await dependencies.realpath(candidate);
  } catch (_error) {
    registrationFailure('PACKAGE_IDENTITY_INVALID');
  }
  if (!api.isAbsolute(root!)) registrationFailure('PACKAGE_IDENTITY_INVALID');
  assertDirectory(await lstatIfPresent(dependencies, root!));
  let packageJson: Record<string, unknown>;
  try {
    packageJson = strictRecord(
      JSON.parse(UTF8_DECODER.decode(await readVerifiedFile(dependencies, api.join(root!, 'package.json')))),
    );
  } catch (error) {
    if (error instanceof NativeHostRegistrationError) throw error;
    registrationFailure('PACKAGE_IDENTITY_INVALID');
  }
  if (packageJson.name !== SYNCNOSCLI_PACKAGE_NAME) registrationFailure('PACKAGE_IDENTITY_INVALID');
  const version = nonEmptyString(packageJson.version);
  return Object.freeze({ name: SYNCNOSCLI_PACKAGE_NAME, root: root!, version });
}

async function packageEntrypointMatchesLauncher(
  paths: SyncNosRuntimePaths,
  packageIdentity: PackageIdentity,
  launcher: NativeHostLauncherOwnership,
  dependencies: ResolvedDependencies,
): Promise<boolean> {
  try {
    const api = pathApi(paths.platform);
    const expectedEntrypoint = api.join(packageIdentity.root, 'dist', 'native-host.cjs');
    if (!samePath(paths.platform, launcher.entrypointPath, expectedEntrypoint)) return false;
    const entrypoint = await readVerifiedFile(dependencies, expectedEntrypoint);
    return sha256(entrypoint) === launcher.packageDigest;
  } catch (_error) {
    return false;
  }
}

function nativeHostManifestLocations(pathsValue: unknown): readonly NativeHostManifestLocation[] {
  const paths = assertSyncNosRuntimePaths(pathsValue);
  const api = pathApi(paths.platform);
  const hostFileName = `${nativeHostContract.host.name}.json`;
  const ownerFileName = `${nativeHostContract.host.name}.owner-v1.json`;
  if (paths.platform === 'darwin') {
    return Object.freeze([
      {
        browser: 'chrome',
        manifestPath: api.join(
          paths.homeDirectory,
          'Library',
          'Application Support',
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          hostFileName,
        ),
        ownerPath: api.join(
          paths.homeDirectory,
          'Library',
          'Application Support',
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          ownerFileName,
        ),
      },
      {
        browser: 'edge',
        manifestPath: api.join(
          paths.homeDirectory,
          'Library',
          'Application Support',
          'Microsoft Edge',
          'NativeMessagingHosts',
          hostFileName,
        ),
        ownerPath: api.join(
          paths.homeDirectory,
          'Library',
          'Application Support',
          'Microsoft Edge',
          'NativeMessagingHosts',
          ownerFileName,
        ),
      },
      {
        browser: 'firefox',
        manifestPath: api.join(
          paths.homeDirectory,
          'Library',
          'Application Support',
          'Mozilla',
          'NativeMessagingHosts',
          hostFileName,
        ),
        ownerPath: api.join(
          paths.homeDirectory,
          'Library',
          'Application Support',
          'Mozilla',
          'NativeMessagingHosts',
          ownerFileName,
        ),
      },
    ]);
  }
  if (paths.platform === 'linux') {
    return Object.freeze([
      {
        browser: 'chrome',
        manifestPath: api.join(paths.homeDirectory, '.config', 'google-chrome', 'NativeMessagingHosts', hostFileName),
        ownerPath: api.join(paths.homeDirectory, '.config', 'google-chrome', 'NativeMessagingHosts', ownerFileName),
      },
      {
        browser: 'edge',
        manifestPath: api.join(paths.homeDirectory, '.config', 'microsoft-edge', 'NativeMessagingHosts', hostFileName),
        ownerPath: api.join(paths.homeDirectory, '.config', 'microsoft-edge', 'NativeMessagingHosts', ownerFileName),
      },
      {
        browser: 'firefox',
        manifestPath: api.join(paths.homeDirectory, '.mozilla', 'native-messaging-hosts', hostFileName),
        ownerPath: api.join(paths.homeDirectory, '.mozilla', 'native-messaging-hosts', ownerFileName),
      },
    ]);
  }
  return Object.freeze([
    {
      browser: 'chrome',
      manifestPath: api.join(paths.runtimeDirectory, 'native-host-chrome-v1.json'),
      ownerPath: api.join(paths.runtimeDirectory, 'native-host-chrome-owner-v1.json'),
      registryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${nativeHostContract.host.name}`,
    },
    {
      browser: 'edge',
      manifestPath: api.join(paths.runtimeDirectory, 'native-host-edge-v1.json'),
      ownerPath: api.join(paths.runtimeDirectory, 'native-host-edge-owner-v1.json'),
      registryKey: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${nativeHostContract.host.name}`,
    },
    {
      browser: 'firefox',
      manifestPath: api.join(paths.runtimeDirectory, 'native-host-firefox-v1.json'),
      ownerPath: api.join(paths.runtimeDirectory, 'native-host-firefox-owner-v1.json'),
      registryKey: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${nativeHostContract.host.name}`,
    },
  ]);
}

/** Exposes only the fixed per-user registrar targets; no browser discovery is performed. */
export function getNativeHostRegistrationLocations(pathsValue: unknown): readonly Readonly<{
  browser: NativeHostBrowser;
  manifestPath: string;
  ownerPath: string;
  registryViews: readonly NativeHostRegistryView[];
}>[] {
  const paths = assertSyncNosRuntimePaths(pathsValue);
  return Object.freeze(
    nativeHostManifestLocations(paths).map((location) =>
      Object.freeze({
        browser: location.browser,
        manifestPath: location.manifestPath,
        ownerPath: location.ownerPath,
        registryViews: paths.platform === 'win32' ? WINDOWS_REGISTRY_VIEWS : NO_REGISTRY_VIEWS,
      }),
    ),
  );
}

function manifestBytes(location: NativeHostManifestLocation, launcherPath: string): Buffer {
  const base = {
    name: nativeHostContract.host.name,
    description: NATIVE_HOST_DESCRIPTION,
    path: launcherPath,
    type: 'stdio' as const,
  };
  const manifest =
    location.browser === 'firefox'
      ? { ...base, allowed_extensions: [nativeHostContract.browsers.firefox.allowedExtension] }
      : { ...base, allowed_origins: [nativeHostContract.browsers[location.browser].origin] };
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}

function parseManifest(bytes: Uint8Array, location: NativeHostManifestLocation, launcherPath: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch (_error) {
    registrationFailure('REGISTRATION_CONFLICT');
  }
  const input = strictRecord(parsed);
  const allowedKey = location.browser === 'firefox' ? 'allowed_extensions' : 'allowed_origins';
  exactKeys(input, ['name', 'description', 'path', 'type', allowedKey]);
  if (
    input.name !== nativeHostContract.host.name ||
    input.description !== NATIVE_HOST_DESCRIPTION ||
    input.path !== launcherPath ||
    input.type !== 'stdio' ||
    !Array.isArray(input[allowedKey]) ||
    input[allowedKey].length !== 1
  ) {
    registrationFailure('REGISTRATION_CONFLICT');
  }
  const allowed = input[allowedKey][0];
  const expected =
    location.browser === 'firefox'
      ? nativeHostContract.browsers.firefox.allowedExtension
      : nativeHostContract.browsers[location.browser].origin;
  if (allowed !== expected) registrationFailure('REGISTRATION_CONFLICT');
}

function ownerRecord(
  location: NativeHostManifestLocation,
  manifest: Uint8Array,
  launcher: NativeHostLauncherOwnership,
  packageIdentity: PackageIdentity,
): RegistrationOwnerRecord {
  return Object.freeze({
    version: 1,
    ownerMarker: SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER,
    browser: location.browser,
    manifestDigest: sha256(manifest),
    launcherPath: launcher.launcherPath,
    launcherDigest: launcher.launcherDigest,
    configDigest: launcher.configDigest,
    packageName: packageIdentity.name,
    packageVersion: packageIdentity.version,
    packageRoot: packageIdentity.root,
    packageDigest: launcher.packageDigest,
    prebuiltDigest: launcher.prebuiltDigest,
  });
}

function sameLauncherBinding(record: RegistrationOwnerRecord, launcher: NativeHostLauncherOwnership): boolean {
  return (
    record.launcherPath === launcher.launcherPath &&
    record.launcherDigest === launcher.launcherDigest &&
    record.configDigest === launcher.configDigest &&
    record.packageDigest === launcher.packageDigest &&
    record.prebuiltDigest === launcher.prebuiltDigest
  );
}

async function inspectRegistration(
  paths: SyncNosRuntimePaths,
  location: NativeHostManifestLocation,
  packageIdentity: PackageIdentity,
  launcher: NativeHostLauncherOwnership | null,
  dependencies: ResolvedDependencies,
): Promise<ExistingRegistrationState> {
  const [manifestStatus, ownerStatus] = await Promise.all([
    lstatIfPresent(dependencies, location.manifestPath),
    lstatIfPresent(dependencies, location.ownerPath),
  ]);
  if (!manifestStatus && !ownerStatus) return Object.freeze({ state: 'absent' as const });
  if (!manifestStatus || !ownerStatus) return Object.freeze({ state: 'conflict' as const });
  try {
    assertRegularFile(manifestStatus);
    assertRegularFile(ownerStatus);
    const [manifest, owner] = await Promise.all([
      readVerifiedFile(dependencies, location.manifestPath),
      readVerifiedFile(dependencies, location.ownerPath),
    ]);
    const record = parseOwnerRecord(owner);
    if (
      record.browser !== location.browser ||
      record.manifestDigest !== sha256(manifest) ||
      !samePath(paths.platform, record.launcherPath, paths.launcherPath) ||
      !samePath(paths.platform, record.packageRoot, packageIdentity.root)
    ) {
      return Object.freeze({ state: 'conflict' as const });
    }
    parseManifest(manifest, location, paths.launcherPath);
    if (launcher && !sameLauncherBinding(record, launcher)) return Object.freeze({ state: 'conflict' as const });
    return Object.freeze({ state: 'owned' as const, ownerDigest: sha256(owner), record });
  } catch (error) {
    if (error instanceof NativeHostRegistrationError && error.code === 'REGISTRATION_UNAVAILABLE') throw error;
    return Object.freeze({ state: 'conflict' as const });
  }
}

async function ensureManifestDirectory(
  paths: SyncNosRuntimePaths,
  location: NativeHostManifestLocation,
  dependencies: ResolvedDependencies,
): Promise<void> {
  const api = pathApi(paths.platform);
  const directory = api.dirname(location.manifestPath);
  try {
    await dependencies.mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (_error) {
    registrationFailure('REGISTRATION_UNAVAILABLE');
  }
  assertDirectory(await lstatIfPresent(dependencies, directory));
}

async function replaceOwnedFile(
  destination: string,
  contents: Buffer,
  mode: number,
  dependencies: ResolvedDependencies,
): Promise<void> {
  const temporary = `${destination}.next`;
  if (await lstatIfPresent(dependencies, temporary)) registrationFailure('REGISTRATION_CONFLICT');
  try {
    await dependencies.writeFile(temporary, contents, { flag: 'wx', mode });
  } catch (_error) {
    registrationFailure('REGISTRATION_UNAVAILABLE');
  }
  const written = await readVerifiedFile(dependencies, temporary);
  if (!written.equals(contents)) registrationFailure('REGISTRATION_UNAVAILABLE');
  try {
    await dependencies.rename(temporary, destination);
  } catch (_error) {
    registrationFailure('REGISTRATION_UNAVAILABLE');
  }
  const replaced = await readVerifiedFile(dependencies, destination);
  if (!replaced.equals(contents)) registrationFailure('REGISTRATION_UNAVAILABLE');
}

function registryOutputValue(result: SpawnFileResult): string | null {
  if (result.exitCode !== 0 || result.signal !== null || !result.stdout) return null;
  const lines = result.stdout
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.reverse()) {
    const marker = line.indexOf('REG_SZ');
    if (marker < 0) continue;
    return line.slice(marker + 'REG_SZ'.length).trim();
  }
  return null;
}

function definitelyMissingRegistryValue(result: SpawnFileResult): boolean {
  if (result.exitCode !== 1 || result.signal !== null) return false;
  const diagnostic = result.stderr?.toString('utf8').toLowerCase() ?? '';
  return (
    diagnostic.includes('unable to find') || diagnostic.includes('cannot find') || diagnostic.includes('not found')
  );
}

type WindowsRegistryAdapterDependencies = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  lstat?: (path: string) => Promise<RuntimeFileStatus>;
  spawnFile?: (file: string, argv: readonly string[], options: SpawnFileOptions) => Promise<SpawnFileResult>;
}>;

/** Uses only a verified System32 reg.exe with separated argv; no shell or PATH fallback exists. */
export function createWindowsRegistryAdapter(input: WindowsRegistryAdapterDependencies = {}): WindowsRegistryAdapter {
  const run = input.spawnFile ?? spawnFile;
  const options = Object.freeze({ shell: false as const, stdio: 'pipe' as const, windowsHide: true as const });
  const resolveReg = async () => {
    try {
      return await resolveVerifiedWindowsSystemExecutable('reg.exe', {
        environment: input.environment,
        lstat: input.lstat,
      });
    } catch (_error) {
      registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
    }
  };
  const readValue = async (
    request: Readonly<{ key: string; valueName: string | null; view: NativeHostRegistryView }>,
  ) => {
    const reg = await resolveReg();
    let result: SpawnFileResult;
    try {
      result = await run(
        reg!,
        Object.freeze([
          'query',
          request.key,
          ...(request.valueName === null ? (['/ve'] as const) : (['/v', request.valueName] as const)),
          `/reg:${request.view}`,
        ]),
        options,
      );
    } catch (_error) {
      registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
    }
    const value = registryOutputValue(result!);
    if (value !== null) return Object.freeze({ state: 'present' as const, value });
    if (definitelyMissingRegistryValue(result!)) return Object.freeze({ state: 'absent' as const });
    return Object.freeze({ state: 'unavailable' as const });
  };
  const readKey = async (request: Readonly<{ key: string; view: NativeHostRegistryView }>) => {
    const reg = await resolveReg();
    let result: SpawnFileResult;
    try {
      result = await run(reg!, Object.freeze(['query', request.key, `/reg:${request.view}`]), options);
    } catch (_error) {
      registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
    }
    if (result!.exitCode === 0 && result!.signal === null) return Object.freeze({ state: 'present' as const });
    if (definitelyMissingRegistryValue(result!)) return Object.freeze({ state: 'absent' as const });
    return Object.freeze({ state: 'unavailable' as const });
  };
  const writeValue = async (
    request: Readonly<{ key: string; value: string; valueName: string | null; view: NativeHostRegistryView }>,
  ) => {
    if (!request.value || /[\0\r\n]/.test(request.value)) registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
    const reg = await resolveReg();
    let result: SpawnFileResult;
    try {
      result = await run(
        reg!,
        Object.freeze([
          'add',
          request.key,
          ...(request.valueName === null ? (['/ve'] as const) : (['/v', request.valueName] as const)),
          '/t',
          'REG_SZ',
          '/d',
          request.value,
          '/f',
          `/reg:${request.view}`,
        ]),
        options,
      );
    } catch (_error) {
      registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
    }
    if (result!.exitCode !== 0 || result!.signal !== null) registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
  };
  const deleteValue = async (
    request: Readonly<{ key: string; valueName: string | null; view: NativeHostRegistryView }>,
  ) => {
    const reg = await resolveReg();
    let result: SpawnFileResult;
    try {
      result = await run(
        reg!,
        Object.freeze([
          'delete',
          request.key,
          ...(request.valueName === null ? (['/ve'] as const) : (['/v', request.valueName] as const)),
          '/f',
          `/reg:${request.view}`,
        ]),
        options,
      );
    } catch (_error) {
      registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
    }
    if (result!.exitCode === 0 && result!.signal === null) return true;
    if (definitelyMissingRegistryValue(result!)) return false;
    registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
  };
  return Object.freeze({ deleteValue, readKey, readValue, writeValue });
}

type ExistingRegistryState = Readonly<{ state: 'absent' | 'owned' | 'conflict' }>;

async function inspectRegistryRegistration(
  location: NativeHostManifestLocation,
  registration: ExistingRegistrationState,
  registry: WindowsRegistryAdapter,
): Promise<ExistingRegistryState> {
  if (!location.registryKey) registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
  for (const view of ['32', '64'] as const) {
    const [key, manifestValue, ownerValue] = await Promise.all([
      registry.readKey({ key: location.registryKey, view }),
      registry.readValue({ key: location.registryKey, valueName: null, view }),
      registry.readValue({ key: location.registryKey, valueName: SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE, view }),
    ]);
    if (key.state === 'unavailable' || manifestValue.state === 'unavailable' || ownerValue.state === 'unavailable') {
      registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
    }
    if (registration.state === 'absent') {
      if (key.state === 'absent' && manifestValue.state === 'absent' && ownerValue.state === 'absent') continue;
      return Object.freeze({ state: 'conflict' as const });
    }
    if (
      key.state !== 'present' ||
      manifestValue.state !== 'present' ||
      ownerValue.state !== 'present' ||
      manifestValue.value !== location.manifestPath ||
      ownerValue.value !== SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER
    ) {
      return Object.freeze({ state: 'conflict' as const });
    }
  }
  return Object.freeze({ state: registration.state === 'owned' ? ('owned' as const) : ('absent' as const) });
}

function inspectionState(state: ExistingRegistrationState): NativeHostRegistrationInspectionState {
  return state.state;
}

function unavailableRegistrationInspection(
  paths: SyncNosRuntimePaths,
  packageState: NativeHostRegistrationInspection['package'],
): NativeHostRegistrationInspection {
  return Object.freeze({
    package: packageState,
    packageEntrypoint: 'not_checked' as const,
    browsers: Object.freeze(
      nativeHostManifestLocations(paths).map((location) =>
        Object.freeze({
          browser: location.browser,
          manifest: 'unavailable' as const,
          registry: paths.platform === 'win32' ? ('unavailable' as const) : ('not_applicable' as const),
        }),
      ),
    ),
  });
}

/**
 * Reads the fixed registration targets without creating directories, files, registry
 * values, a launcher, or a database. Browser reachability remains intentionally unknown.
 */
export async function inspectNativeHostRegistrations(
  input: InspectNativeHostRegistrationsInput = {},
): Promise<NativeHostRegistrationInspection> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.registrationDependencies);
  let packageIdentity: PackageIdentity;
  try {
    packageIdentity = await readPackageIdentity(paths, input.packageRoot, dependencies);
  } catch (error) {
    return unavailableRegistrationInspection(
      paths,
      error instanceof NativeHostRegistrationError && error.code === 'PACKAGE_IDENTITY_INVALID'
        ? 'invalid'
        : 'unavailable',
    );
  }

  let launcher: NativeHostLauncherOwnership | null = null;
  try {
    launcher = await inspectNativeHostLauncher({ paths, dependencies: input.launcherDependencies });
  } catch (_error) {
    // The launcher has its own diagnostic; manifest ownership can still be observed without it.
  }
  const locations = nativeHostManifestLocations(paths);
  const manifests = await Promise.all(
    locations.map(async (location) => {
      try {
        return await inspectRegistration(paths, location, packageIdentity, launcher, dependencies);
      } catch (_error) {
        return null;
      }
    }),
  );
  const packageEntrypoint = launcher
    ? (await packageEntrypointMatchesLauncher(paths, packageIdentity, launcher, dependencies))
      ? ('current' as const)
      : ('stale' as const)
    : ('not_checked' as const);

  let registry: WindowsRegistryAdapter | null = null;
  if (paths.platform === 'win32') {
    try {
      registry = dependencies.windowsRegistry ?? createWindowsRegistryAdapter();
    } catch (_error) {
      registry = null;
    }
  }
  const browsers = await Promise.all(
    locations.map(async (location, index) => {
      const manifest = manifests[index];
      let registryState: NativeHostRegistrationInspectionState | 'not_applicable' = 'not_applicable';
      if (paths.platform === 'win32') {
        if (!registry || !manifest) {
          registryState = 'unavailable';
        } else {
          try {
            registryState = (await inspectRegistryRegistration(location, manifest, registry)).state;
          } catch (_error) {
            registryState = 'unavailable';
          }
        }
      }
      return Object.freeze({
        browser: location.browser,
        manifest: manifest ? inspectionState(manifest) : ('unavailable' as const),
        registry: registryState,
      });
    }),
  );
  return Object.freeze({
    package: 'verified',
    packageEntrypoint,
    browsers: Object.freeze(browsers),
  });
}

async function writeRegistryRegistration(
  location: NativeHostManifestLocation,
  registry: WindowsRegistryAdapter,
): Promise<void> {
  if (!location.registryKey) registrationFailure('WINDOWS_REGISTRY_UNAVAILABLE');
  for (const view of ['32', '64'] as const) {
    await registry.writeValue({ key: location.registryKey, valueName: null, value: location.manifestPath, view });
    await registry.writeValue({
      key: location.registryKey,
      valueName: SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE,
      value: SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER,
      view,
    });
  }
}

async function writeManifestRegistration(
  paths: SyncNosRuntimePaths,
  location: NativeHostManifestLocation,
  packageIdentity: PackageIdentity,
  launcher: NativeHostLauncherOwnership,
  dependencies: ResolvedDependencies,
): Promise<void> {
  await ensureManifestDirectory(paths, location, dependencies);
  const manifest = manifestBytes(location, launcher.launcherPath);
  const owner = Buffer.from(JSON.stringify(ownerRecord(location, manifest, launcher, packageIdentity)), 'utf8');
  await replaceOwnedFile(location.manifestPath, manifest, 0o644, dependencies);
  await replaceOwnedFile(location.ownerPath, owner, 0o600, dependencies);
}

/**
 * Creates exactly the stable per-user Chrome, Edge, and Firefox registrations. It never
 * probes a browser and reports registration only, not a verified browser connection.
 */
export async function ensureNativeHostRegistrations(
  input: EnsureNativeHostRegistrationsInput = {},
): Promise<NativeHostRegistrationResult> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.registrationDependencies);
  const packageIdentity = await readPackageIdentity(paths, input.packageRoot, dependencies);
  const locations = nativeHostManifestLocations(paths);
  const previousLauncher = await inspectNativeHostLauncher({ paths, dependencies: input.launcherDependencies });
  const existing = await Promise.all(
    locations.map((location) => inspectRegistration(paths, location, packageIdentity, previousLauncher, dependencies)),
  );
  if (
    existing.some((state) => state.state === 'conflict') ||
    (!previousLauncher && existing.some((state) => state.state === 'owned'))
  ) {
    registrationFailure('REGISTRATION_CONFLICT');
  }

  const registry = paths.platform === 'win32' ? (dependencies.windowsRegistry ?? createWindowsRegistryAdapter()) : null;
  if (registry) {
    const registryStates = await Promise.all(
      locations.map((location, index) => inspectRegistryRegistration(location, existing[index]!, registry)),
    );
    if (registryStates.some((state) => state.state === 'conflict')) registrationFailure('REGISTRATION_CONFLICT');
  }

  await ensureNativeHostLauncher({
    arch: input.arch,
    dependencies: input.launcherDependencies,
    nodePath: input.nodePath,
    packageRoot: packageIdentity.root,
    paths,
  });
  const launcher = await inspectNativeHostLauncher({ paths, dependencies: input.launcherDependencies });
  if (!launcher) registrationFailure('REGISTRATION_UNAVAILABLE');

  await Promise.all(
    locations.map((location) => writeManifestRegistration(paths, location, packageIdentity, launcher, dependencies)),
  );
  if (registry) {
    for (const location of locations) {
      await writeRegistryRegistration(location, registry);
    }
  }
  return Object.freeze({
    browsers: Object.freeze(
      locations.map((location) =>
        Object.freeze({
          browser: location.browser,
          status: 'registered' as const,
          verification: 'registration-written-not-browser-verified' as const,
        }),
      ),
    ),
  });
}

async function removeVerifiedFile(
  location: NativeHostManifestLocation,
  registration: ExistingRegistration,
  paths: SyncNosRuntimePaths,
  packageIdentity: PackageIdentity,
  launcher: NativeHostLauncherOwnership,
  dependencies: ResolvedDependencies,
): Promise<void> {
  const current = await inspectRegistration(paths, location, packageIdentity, launcher, dependencies);
  if (current.state !== 'owned' || current.ownerDigest !== registration.ownerDigest)
    registrationFailure('REGISTRATION_CONFLICT');
  try {
    await dependencies.unlink(location.manifestPath);
    await dependencies.unlink(location.ownerPath);
  } catch (_error) {
    registrationFailure('REGISTRATION_UNAVAILABLE');
  }
}

async function removeRegistryRegistration(
  location: NativeHostManifestLocation,
  registration: ExistingRegistration,
  registry: WindowsRegistryAdapter,
): Promise<void> {
  const current = await inspectRegistryRegistration(location, registration, registry);
  if (current.state !== 'owned' || !location.registryKey) registrationFailure('REGISTRATION_CONFLICT');
  for (const view of ['32', '64'] as const) {
    await registry.deleteValue({ key: location.registryKey, valueName: null, view });
    await registry.deleteValue({ key: location.registryKey, valueName: SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE, view });
  }
}

/** Removes only registrations whose exact manifest, sidecar, runtime, and package binding still match. */
export async function removeOwnedNativeHostRegistrations(
  input: RemoveNativeHostRegistrationsInput = {},
): Promise<RemoveNativeHostRegistrationsResult> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.registrationDependencies);
  const packageIdentity = await readPackageIdentity(paths, input.packageRoot, dependencies);
  const launcher = await inspectNativeHostLauncher({ paths, dependencies: input.launcherDependencies });
  const locations = nativeHostManifestLocations(paths);
  if (!launcher || !(await packageEntrypointMatchesLauncher(paths, packageIdentity, launcher, dependencies))) {
    const anyFile = await Promise.all(
      locations.flatMap((location) => [
        lstatIfPresent(dependencies, location.manifestPath),
        lstatIfPresent(dependencies, location.ownerPath),
      ]),
    );
    return Object.freeze({
      canRemoveLauncher: false,
      conflicts: Object.freeze(anyFile.some(Boolean) ? ['launcher-missing'] : []),
      removed: false,
    });
  }
  const states = await Promise.all(
    locations.map((location) => inspectRegistration(paths, location, packageIdentity, launcher, dependencies)),
  );
  const conflicts = locations
    .filter((_, index) => states[index]?.state === 'conflict')
    .map((location) => `${location.browser}-manifest`);
  if (conflicts.length > 0)
    return Object.freeze({ canRemoveLauncher: false, conflicts: Object.freeze(conflicts), removed: false });
  for (const state of states) {
    if (state.state === 'owned' && state.record.packageVersion !== packageIdentity.version) {
      return Object.freeze({ canRemoveLauncher: false, conflicts: Object.freeze(['package-version']), removed: false });
    }
  }

  const registry = paths.platform === 'win32' ? (dependencies.windowsRegistry ?? createWindowsRegistryAdapter()) : null;
  if (registry) {
    const registryStates = await Promise.all(
      locations.map((location, index) => inspectRegistryRegistration(location, states[index]!, registry)),
    );
    const registryConflicts = locations
      .filter((_, index) => registryStates[index]?.state === 'conflict')
      .map((location) => `${location.browser}-registry`);
    if (registryConflicts.length > 0)
      return Object.freeze({ canRemoveLauncher: false, conflicts: Object.freeze(registryConflicts), removed: false });
    for (let index = 0; index < locations.length; index += 1) {
      const state = states[index]!;
      if (state.state === 'owned') await removeRegistryRegistration(locations[index]!, state, registry);
    }
  }
  for (let index = 0; index < locations.length; index += 1) {
    const state = states[index]!;
    if (state.state === 'owned')
      await removeVerifiedFile(locations[index]!, state, paths, packageIdentity, launcher, dependencies);
  }
  return Object.freeze({
    canRemoveLauncher: states.every((state) => state.state === 'owned'),
    conflicts: Object.freeze([]),
    removed: states.some((state) => state.state === 'owned'),
  });
}

/** Native Host launch validation uses this exact current Firefox manifest proof before reading stdin. */
export async function isOwnedFirefoxNativeHostManifest(
  manifestPath: string,
  input: OwnedFirefoxManifestInput = {},
): Promise<boolean> {
  try {
    const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
    const dependencies = resolveDependencies(input.registrationDependencies);
    const packageIdentity = await readPackageIdentity(paths, input.packageRoot, dependencies);
    const launcher = await inspectNativeHostLauncher({ paths });
    if (!launcher) return false;
    if (!(await packageEntrypointMatchesLauncher(paths, packageIdentity, launcher, dependencies))) return false;
    const location = nativeHostManifestLocations(paths).find((candidate) => candidate.browser === 'firefox');
    if (!location || !samePath(paths.platform, manifestPath, location.manifestPath)) return false;
    const state = await inspectRegistration(paths, location, packageIdentity, launcher, dependencies);
    return state.state === 'owned' && state.record.packageVersion === packageIdentity.version;
  } catch (_error) {
    return false;
  }
}
