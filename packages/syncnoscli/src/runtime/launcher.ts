import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod as nodeChmod,
  copyFile as nodeCopyFile,
  lstat as nodeLstat,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  rename as nodeRename,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import { posix, resolve as nodeResolve, win32 } from 'node:path';

import { ensureSyncNosRuntimeDirectory } from './filesystem';
import {
  assertRuntimeOwnedFilePath,
  assertSyncNosRuntimePaths,
  resolveSyncNosRuntimePaths,
  type SyncNosRuntimePaths,
} from './paths';

export const SYNCNOSCLI_RUNTIME_OWNER_MARKER = 'syncnoscli-runtime-v1' as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

type LauncherFileStatus = Readonly<{
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}>;

type LauncherConfig = Readonly<{
  version: 1;
  ownerMarker: typeof SYNCNOSCLI_RUNTIME_OWNER_MARKER;
  nodePathBase64: string;
  entrypointPathBase64: string;
  packageDigest: string;
  prebuiltDigest: string | null;
}>;

type RuntimeOwnerMarker = Readonly<{
  version: 1;
  ownerMarker: typeof SYNCNOSCLI_RUNTIME_OWNER_MARKER;
  platform: SyncNosRuntimePaths['platform'];
  configDigest: string;
  launcherDigest: string;
  packageDigest: string;
  prebuiltDigest: string | null;
}>;

type WindowsPrebuildManifest = Readonly<{
  version: 1;
  sourceSha256: string;
  artifacts: Readonly<{
    'win32-arm64': Readonly<{ file: 'win32-arm64/syncnos-native-host.exe'; sha256: string }>;
    'win32-x64': Readonly<{ file: 'win32-x64/syncnos-native-host.exe'; sha256: string }>;
  }>;
}>;

export type NativeHostLauncherErrorCode =
  | 'LAUNCHER_ARTIFACT_INVALID'
  | 'LAUNCHER_CONFIG_INVALID'
  | 'LAUNCHER_OWNERSHIP_INVALID'
  | 'LAUNCHER_WRITE_FAILED'
  | 'NODE_EXECUTABLE_INVALID'
  | 'UNSUPPORTED_PLATFORM';

export class NativeHostLauncherError extends Error {
  constructor(readonly code: NativeHostLauncherErrorCode) {
    super(
      code === 'UNSUPPORTED_PLATFORM'
        ? 'This Windows CPU is not supported by SyncNos CLI.'
        : 'SyncNos CLI could not safely prepare its Native Host launcher.',
    );
    this.name = 'NativeHostLauncherError';
  }
}

export type NativeHostLauncherDependencies = Readonly<{
  chmod?: (path: string, mode: number) => Promise<void>;
  copyFile?: (source: string, destination: string, flags: number) => Promise<void>;
  ensureRuntimeDirectory?: (paths: SyncNosRuntimePaths) => Promise<unknown>;
  lstat?: (path: string) => Promise<LauncherFileStatus>;
  readFile?: (path: string) => Promise<Buffer>;
  realpath?: (path: string) => Promise<string>;
  rename?: (source: string, destination: string) => Promise<void>;
  writeFile?: (path: string, contents: Uint8Array, options: Readonly<{ flag: 'wx'; mode: number }>) => Promise<void>;
}>;

export type EnsureNativeHostLauncherInput = Readonly<{
  arch?: string;
  dependencies?: NativeHostLauncherDependencies;
  entrypointPath?: string;
  nodePath?: string;
  packageRoot?: string;
  paths?: SyncNosRuntimePaths;
}>;

export type NativeHostLauncherResult = Readonly<{
  configPath: string;
  created: boolean;
  launcherPath: string;
  ownerMarkerPath: string;
  platform: SyncNosRuntimePaths['platform'];
}>;

type ResolvedDependencies = Required<NativeHostLauncherDependencies>;

type LauncherSource = Readonly<{
  config: LauncherConfig;
  configBytes: Buffer;
  launcherBytes: Buffer | null;
  paths: SyncNosRuntimePaths;
  prebuiltPath: string | null;
}>;

function launcherFailure(code: NativeHostLauncherErrorCode): never {
  throw new NativeHostLauncherError(code);
}

function pathApi(platform: SyncNosRuntimePaths['platform']): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function strictRecord(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    launcherFailure('LAUNCHER_CONFIG_INVALID');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    launcherFailure('LAUNCHER_CONFIG_INVALID');
  }
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) launcherFailure('LAUNCHER_CONFIG_INVALID');
  return value;
}

function base64Path(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    launcherFailure('LAUNCHER_CONFIG_INVALID');
  }
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.toString('base64') !== value) launcherFailure('LAUNCHER_CONFIG_INVALID');
  try {
    const decoded = UTF8_DECODER.decode(bytes);
    if (!decoded || decoded.includes('\0')) launcherFailure('LAUNCHER_CONFIG_INVALID');
  } catch (_error) {
    launcherFailure('LAUNCHER_CONFIG_INVALID');
  }
  return value;
}

function parseLauncherConfig(bytes: Uint8Array): LauncherConfig {
  let value: unknown;
  try {
    value = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch (_error) {
    launcherFailure('LAUNCHER_CONFIG_INVALID');
  }
  const input = strictRecord(value);
  exactKeys(input, [
    'version',
    'ownerMarker',
    'nodePathBase64',
    'entrypointPathBase64',
    'packageDigest',
    'prebuiltDigest',
  ]);
  if (input.version !== 1 || input.ownerMarker !== SYNCNOSCLI_RUNTIME_OWNER_MARKER) {
    launcherFailure('LAUNCHER_CONFIG_INVALID');
  }
  if (input.prebuiltDigest !== null) digest(input.prebuiltDigest);
  return Object.freeze({
    version: 1,
    ownerMarker: SYNCNOSCLI_RUNTIME_OWNER_MARKER,
    nodePathBase64: base64Path(input.nodePathBase64),
    entrypointPathBase64: base64Path(input.entrypointPathBase64),
    packageDigest: digest(input.packageDigest),
    prebuiltDigest: input.prebuiltDigest as string | null,
  });
}

function parseRuntimeOwnerMarker(bytes: Uint8Array): RuntimeOwnerMarker {
  let value: unknown;
  try {
    value = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch (_error) {
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
  const input = strictRecord(value);
  exactKeys(input, [
    'version',
    'ownerMarker',
    'platform',
    'configDigest',
    'launcherDigest',
    'packageDigest',
    'prebuiltDigest',
  ]);
  if (
    input.version !== 1 ||
    input.ownerMarker !== SYNCNOSCLI_RUNTIME_OWNER_MARKER ||
    (input.platform !== 'darwin' && input.platform !== 'linux' && input.platform !== 'win32') ||
    (input.prebuiltDigest !== null && typeof input.prebuiltDigest !== 'string')
  ) {
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
  try {
    return Object.freeze({
      version: 1,
      ownerMarker: SYNCNOSCLI_RUNTIME_OWNER_MARKER,
      platform: input.platform,
      configDigest: digest(input.configDigest),
      launcherDigest: digest(input.launcherDigest),
      packageDigest: digest(input.packageDigest),
      prebuiltDigest: input.prebuiltDigest === null ? null : digest(input.prebuiltDigest),
    });
  } catch (error) {
    if (error instanceof NativeHostLauncherError) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
    throw error;
  }
}

function parseWindowsPrebuildManifest(bytes: Uint8Array): WindowsPrebuildManifest {
  try {
    const input = strictRecord(JSON.parse(UTF8_DECODER.decode(bytes)));
    exactKeys(input, ['version', 'sourceSha256', 'artifacts']);
    if (input.version !== 1) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
    const artifacts = strictRecord(input.artifacts);
    exactKeys(artifacts, ['win32-arm64', 'win32-x64']);

    const parseArtifact = (name: 'win32-arm64' | 'win32-x64') => {
      const artifact = strictRecord(artifacts[name]);
      exactKeys(artifact, ['file', 'sha256']);
      const expectedFile = `${name}/syncnos-native-host.exe`;
      if (artifact.file !== expectedFile) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
      return Object.freeze({ file: expectedFile, sha256: digest(artifact.sha256) });
    };

    return Object.freeze({
      version: 1,
      sourceSha256: digest(input.sourceSha256),
      artifacts: Object.freeze({
        'win32-arm64': parseArtifact('win32-arm64') as WindowsPrebuildManifest['artifacts']['win32-arm64'],
        'win32-x64': parseArtifact('win32-x64') as WindowsPrebuildManifest['artifacts']['win32-x64'],
      }),
    });
  } catch (_error) {
    launcherFailure('LAUNCHER_ARTIFACT_INVALID');
  }
}

function resolveDependencies(input: NativeHostLauncherDependencies | undefined): ResolvedDependencies {
  return {
    chmod: input?.chmod ?? nodeChmod,
    copyFile: input?.copyFile ?? nodeCopyFile,
    ensureRuntimeDirectory: input?.ensureRuntimeDirectory ?? ensureSyncNosRuntimeDirectory,
    lstat: input?.lstat ?? nodeLstat,
    readFile: input?.readFile ?? nodeReadFile,
    realpath: input?.realpath ?? nodeRealpath,
    rename: input?.rename ?? nodeRename,
    writeFile:
      input?.writeFile ??
      (async (path, contents, options) => {
        await nodeWriteFile(path, contents, options);
      }),
  };
}

async function lstatIfPresent(dependencies: ResolvedDependencies, path: string): Promise<LauncherFileStatus | null> {
  try {
    return await dependencies.lstat(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
}

function assertRegularFile(
  status: LauncherFileStatus | null,
  code: NativeHostLauncherErrorCode,
): asserts status is LauncherFileStatus {
  if (!status || status.isSymbolicLink() || !status.isFile()) launcherFailure(code);
}

async function readVerifiedFile(
  dependencies: ResolvedDependencies,
  path: string,
  code: NativeHostLauncherErrorCode,
): Promise<Buffer> {
  assertRegularFile(await lstatIfPresent(dependencies, path), code);
  let bytes: Buffer;
  try {
    bytes = await dependencies.readFile(path);
  } catch (_error) {
    launcherFailure(code);
  }
  assertRegularFile(await lstatIfPresent(dependencies, path), code);
  return bytes!;
}

async function realRegularFile(
  dependencies: ResolvedDependencies,
  api: typeof posix,
  path: string,
  code: NativeHostLauncherErrorCode,
): Promise<string> {
  let resolved: string;
  try {
    resolved = await dependencies.realpath(path);
  } catch (_error) {
    launcherFailure(code);
  }
  if (!api.isAbsolute(resolved!)) launcherFailure(code);
  assertRegularFile(await lstatIfPresent(dependencies, resolved!), code);
  return resolved!;
}

async function realDirectory(dependencies: ResolvedDependencies, api: typeof posix, path: string): Promise<string> {
  let resolved: string;
  try {
    resolved = await dependencies.realpath(path);
  } catch (_error) {
    launcherFailure('LAUNCHER_ARTIFACT_INVALID');
  }
  const status = await lstatIfPresent(dependencies, resolved!);
  if (!api.isAbsolute(resolved!) || !status || status.isSymbolicLink() || !status.isDirectory()) {
    launcherFailure('LAUNCHER_ARTIFACT_INVALID');
  }
  return resolved!;
}

function samePath(api: typeof posix, left: string, right: string): boolean {
  return api === win32 ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function ensurePackageEntrypoint(api: typeof posix, packageRoot: string, entrypointPath: string): void {
  const expected = api.join(packageRoot, 'dist', 'native-host.cjs');
  if (!samePath(api, expected, entrypointPath)) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
}

function encodePath(path: string): string {
  if (!path || path.includes('\0')) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
  return Buffer.from(path, 'utf8').toString('base64');
}

function quotePosixShell(path: string): string {
  return `'${path.replaceAll("'", "'\"'\"'")}'`;
}

function unixLauncherContents(nodePath: string, entrypointPath: string): Buffer {
  return Buffer.from(`#!/bin/sh\nexec ${quotePosixShell(nodePath)} ${quotePosixShell(entrypointPath)} "$@"\n`, 'utf8');
}

async function loadLauncherSource(
  paths: SyncNosRuntimePaths,
  input: EnsureNativeHostLauncherInput,
  dependencies: ResolvedDependencies,
): Promise<LauncherSource> {
  const api = pathApi(paths.platform);
  const packageRoot = await realDirectory(dependencies, api, input.packageRoot ?? nodeResolve(__dirname, '..'));
  const nodePath = await realRegularFile(
    dependencies,
    api,
    input.nodePath ?? process.execPath,
    'NODE_EXECUTABLE_INVALID',
  );
  const entrypointPath = await realRegularFile(
    dependencies,
    api,
    input.entrypointPath ?? api.join(packageRoot, 'dist', 'native-host.cjs'),
    'LAUNCHER_ARTIFACT_INVALID',
  );
  ensurePackageEntrypoint(api, packageRoot, entrypointPath);
  await readVerifiedFile(dependencies, api.join(packageRoot, 'package.json'), 'LAUNCHER_ARTIFACT_INVALID');
  const entrypointBytes = await readVerifiedFile(dependencies, entrypointPath, 'LAUNCHER_ARTIFACT_INVALID');

  let prebuiltPath: string | null = null;
  let prebuiltDigest: string | null = null;
  let launcherBytes: Buffer | null = null;
  if (paths.platform === 'win32') {
    const arch = input.arch ?? process.arch;
    if (arch !== 'x64' && arch !== 'arm64') launcherFailure('UNSUPPORTED_PLATFORM');
    const manifest = parseWindowsPrebuildManifest(
      await readVerifiedFile(
        dependencies,
        api.join(packageRoot, 'prebuilds', 'manifest.json'),
        'LAUNCHER_ARTIFACT_INVALID',
      ),
    );
    const artifact = manifest.artifacts[`win32-${arch}`];
    const expectedPrebuiltPath = api.join(packageRoot, 'prebuilds', artifact.file);
    prebuiltPath = await realRegularFile(dependencies, api, expectedPrebuiltPath, 'LAUNCHER_ARTIFACT_INVALID');
    if (!samePath(api, prebuiltPath, expectedPrebuiltPath)) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
    const prebuiltBytes = await readVerifiedFile(dependencies, prebuiltPath, 'LAUNCHER_ARTIFACT_INVALID');
    if (sha256(prebuiltBytes) !== artifact.sha256) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
    prebuiltDigest = artifact.sha256;
  } else {
    launcherBytes = unixLauncherContents(nodePath, entrypointPath);
  }

  const config = Object.freeze({
    version: 1 as const,
    ownerMarker: SYNCNOSCLI_RUNTIME_OWNER_MARKER,
    nodePathBase64: encodePath(nodePath),
    entrypointPathBase64: encodePath(entrypointPath),
    packageDigest: sha256(entrypointBytes),
    prebuiltDigest,
  });
  return Object.freeze({
    paths,
    prebuiltPath,
    launcherBytes,
    config,
    configBytes: Buffer.from(JSON.stringify(config), 'utf8'),
  });
}

async function inspectExistingLauncher(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedDependencies,
): Promise<'absent' | 'owned'> {
  const statuses = await Promise.all([
    lstatIfPresent(dependencies, paths.runtimeOwnerMarkerPath),
    lstatIfPresent(dependencies, paths.launcherConfigPath),
    lstatIfPresent(dependencies, paths.launcherPath),
  ]);
  if (statuses.every((status) => status === null)) return 'absent';
  if (statuses.some((status) => status === null)) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  for (const status of statuses) assertRegularFile(status, 'LAUNCHER_OWNERSHIP_INVALID');

  const [markerBytes, configBytes, launcherBytes] = await Promise.all([
    readVerifiedFile(dependencies, paths.runtimeOwnerMarkerPath, 'LAUNCHER_OWNERSHIP_INVALID'),
    readVerifiedFile(dependencies, paths.launcherConfigPath, 'LAUNCHER_OWNERSHIP_INVALID'),
    readVerifiedFile(dependencies, paths.launcherPath, 'LAUNCHER_OWNERSHIP_INVALID'),
  ]);
  let marker: RuntimeOwnerMarker;
  let config: LauncherConfig;
  try {
    marker = parseRuntimeOwnerMarker(markerBytes);
    config = parseLauncherConfig(configBytes);
  } catch (_error) {
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
  if (
    marker!.platform !== paths.platform ||
    marker!.configDigest !== sha256(configBytes) ||
    marker!.launcherDigest !== sha256(launcherBytes) ||
    marker!.packageDigest !== config!.packageDigest ||
    marker!.prebuiltDigest !== config!.prebuiltDigest
  ) {
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
  if (paths.platform === 'win32' && sha256(launcherBytes) !== config!.prebuiltDigest) {
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
  return 'owned';
}

async function assertTemporaryPathAbsent(
  paths: SyncNosRuntimePaths,
  path: string,
  dependencies: ResolvedDependencies,
): Promise<void> {
  assertRuntimeOwnedFilePath(paths, path);
  if (await lstatIfPresent(dependencies, path)) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
}

async function replaceWithBytes(
  paths: SyncNosRuntimePaths,
  destination: string,
  temporary: string,
  contents: Buffer,
  mode: number,
  dependencies: ResolvedDependencies,
): Promise<void> {
  assertRuntimeOwnedFilePath(paths, destination);
  await assertTemporaryPathAbsent(paths, temporary, dependencies);
  try {
    await dependencies.writeFile(temporary, contents, { flag: 'wx', mode });
    if (paths.platform !== 'win32') await dependencies.chmod(temporary, mode);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
  const temporaryBytes = await readVerifiedFile(dependencies, temporary, 'LAUNCHER_WRITE_FAILED');
  if (!temporaryBytes.equals(contents)) launcherFailure('LAUNCHER_WRITE_FAILED');
  try {
    await dependencies.rename(temporary, destination);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
  const destinationBytes = await readVerifiedFile(dependencies, destination, 'LAUNCHER_WRITE_FAILED');
  if (!destinationBytes.equals(contents)) launcherFailure('LAUNCHER_WRITE_FAILED');
}

async function replaceWithPrebuilt(source: LauncherSource, dependencies: ResolvedDependencies): Promise<Buffer> {
  if (!source.prebuiltPath || !source.config.prebuiltDigest) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
  const { paths } = source;
  assertRuntimeOwnedFilePath(paths, paths.launcherPath);
  await assertTemporaryPathAbsent(paths, paths.launcherTemporaryPath, dependencies);
  try {
    await dependencies.copyFile(source.prebuiltPath, paths.launcherTemporaryPath, fsConstants.COPYFILE_EXCL);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
  const temporaryBytes = await readVerifiedFile(dependencies, paths.launcherTemporaryPath, 'LAUNCHER_WRITE_FAILED');
  if (sha256(temporaryBytes) !== source.config.prebuiltDigest) launcherFailure('LAUNCHER_WRITE_FAILED');
  try {
    await dependencies.rename(paths.launcherTemporaryPath, paths.launcherPath);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
  const launcherBytes = await readVerifiedFile(dependencies, paths.launcherPath, 'LAUNCHER_WRITE_FAILED');
  if (sha256(launcherBytes) !== source.config.prebuiltDigest) launcherFailure('LAUNCHER_WRITE_FAILED');
  return launcherBytes;
}

/**
 * Installs only package-owned launcher files. It does not create, inspect, or delete the SQLite database.
 */
export async function ensureNativeHostLauncher(
  input: EnsureNativeHostLauncherInput = {},
): Promise<NativeHostLauncherResult> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.dependencies);
  const source = await loadLauncherSource(paths, input, dependencies);
  await dependencies.ensureRuntimeDirectory(paths);
  const existing = await inspectExistingLauncher(paths, dependencies);

  await replaceWithBytes(
    paths,
    paths.launcherConfigPath,
    paths.launcherConfigTemporaryPath,
    source.configBytes,
    0o600,
    dependencies,
  );
  const launcherBytes =
    paths.platform === 'win32'
      ? await replaceWithPrebuilt(source, dependencies)
      : await (async () => {
          const contents = source.launcherBytes;
          if (!contents) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
          await replaceWithBytes(paths, paths.launcherPath, paths.launcherTemporaryPath, contents, 0o700, dependencies);
          return contents;
        })();
  const ownerMarker = Buffer.from(
    JSON.stringify({
      version: 1,
      ownerMarker: SYNCNOSCLI_RUNTIME_OWNER_MARKER,
      platform: paths.platform,
      configDigest: sha256(source.configBytes),
      launcherDigest: sha256(launcherBytes),
      packageDigest: source.config.packageDigest,
      prebuiltDigest: source.config.prebuiltDigest,
    } satisfies RuntimeOwnerMarker),
    'utf8',
  );
  await replaceWithBytes(
    paths,
    paths.runtimeOwnerMarkerPath,
    paths.runtimeOwnerMarkerTemporaryPath,
    ownerMarker,
    0o600,
    dependencies,
  );

  return Object.freeze({
    created: existing === 'absent',
    platform: paths.platform,
    launcherPath: paths.launcherPath,
    configPath: paths.launcherConfigPath,
    ownerMarkerPath: paths.runtimeOwnerMarkerPath,
  });
}
