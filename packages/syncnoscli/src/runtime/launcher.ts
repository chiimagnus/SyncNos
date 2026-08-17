import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod as nodeChmod,
  copyFile as nodeCopyFile,
  lstat as nodeLstat,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  rename as nodeRename,
  unlink as nodeUnlink,
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
export const SYNCNOSCLI_LAUNCHER_UPDATE_INTENT = 'syncnoscli-launcher-update-v1' as const;

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

type LauncherUpdateIntentTarget = Readonly<{
  newDigest: string;
  oldDigest: string | null;
}>;

type LauncherUpdateIntent = Readonly<{
  version: 1;
  ownerMarker: typeof SYNCNOSCLI_LAUNCHER_UPDATE_INTENT;
  platform: SyncNosRuntimePaths['platform'];
  config: LauncherUpdateIntentTarget;
  launcher: LauncherUpdateIntentTarget;
  runtimeOwnerMarker: LauncherUpdateIntentTarget;
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
  unlink?: (path: string) => Promise<void>;
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

/** The verified runtime binding consumed by registrar sidecars and safe uninstall. */
export type NativeHostLauncherOwnership = Readonly<{
  configDigest: string;
  configPath: string;
  entrypointPath: string;
  launcherDigest: string;
  launcherPath: string;
  nodePath: string;
  ownerMarkerDigest: string;
  ownerMarkerPath: string;
  packageDigest: string;
  platform: SyncNosRuntimePaths['platform'];
  prebuiltDigest: string | null;
}>;

export type RemoveNativeHostLauncherResult = Readonly<{ removed: boolean }>;

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

function decodeBase64Path(value: string): string {
  try {
    const decoded = UTF8_DECODER.decode(Buffer.from(base64Path(value), 'base64'));
    if (!decoded || decoded.includes('\0')) launcherFailure('LAUNCHER_CONFIG_INVALID');
    return decoded;
  } catch (_error) {
    launcherFailure('LAUNCHER_CONFIG_INVALID');
  }
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

function parseLauncherUpdateIntent(bytes: Uint8Array): LauncherUpdateIntent {
  try {
    const input = strictRecord(JSON.parse(UTF8_DECODER.decode(bytes)));
    exactKeys(input, ['version', 'ownerMarker', 'platform', 'config', 'launcher', 'runtimeOwnerMarker']);
    if (
      input.version !== 1 ||
      input.ownerMarker !== SYNCNOSCLI_LAUNCHER_UPDATE_INTENT ||
      (input.platform !== 'darwin' && input.platform !== 'linux' && input.platform !== 'win32')
    ) {
      launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
    }
    const target = (value: unknown): LauncherUpdateIntentTarget => {
      const record = strictRecord(value);
      exactKeys(record, ['newDigest', 'oldDigest']);
      return Object.freeze({
        newDigest: digest(record.newDigest),
        oldDigest: record.oldDigest === null ? null : digest(record.oldDigest),
      });
    };
    return Object.freeze({
      version: 1,
      ownerMarker: SYNCNOSCLI_LAUNCHER_UPDATE_INTENT,
      platform: input.platform,
      config: target(input.config),
      launcher: target(input.launcher),
      runtimeOwnerMarker: target(input.runtimeOwnerMarker),
    });
  } catch (_error) {
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
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
    unlink: input?.unlink ?? nodeUnlink,
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

async function inspectOwnedLauncher(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedDependencies,
): Promise<NativeHostLauncherOwnership | null> {
  const statuses = await Promise.all([
    lstatIfPresent(dependencies, paths.runtimeOwnerMarkerPath),
    lstatIfPresent(dependencies, paths.launcherConfigPath),
    lstatIfPresent(dependencies, paths.launcherPath),
  ]);
  if (statuses.every((status) => status === null)) return null;
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
  const api = pathApi(paths.platform);
  const nodePath = decodeBase64Path(config!.nodePathBase64);
  const entrypointPath = decodeBase64Path(config!.entrypointPathBase64);
  if (!api.isAbsolute(nodePath) || !api.isAbsolute(entrypointPath)) {
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
  return Object.freeze({
    configDigest: marker!.configDigest,
    configPath: paths.launcherConfigPath,
    entrypointPath,
    launcherDigest: marker!.launcherDigest,
    launcherPath: paths.launcherPath,
    nodePath,
    ownerMarkerDigest: sha256(markerBytes),
    ownerMarkerPath: paths.runtimeOwnerMarkerPath,
    packageDigest: marker!.packageDigest,
    platform: paths.platform,
    prebuiltDigest: marker!.prebuiltDigest,
  });
}

/** Reads the fixed runtime trio without creating it; malformed or partial state fails closed. */
export async function inspectNativeHostLauncher(
  input: Pick<EnsureNativeHostLauncherInput, 'dependencies' | 'paths'> = {},
): Promise<NativeHostLauncherOwnership | null> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  return await inspectOwnedLauncher(paths, resolveDependencies(input.dependencies));
}

async function assertTemporaryPathAbsent(
  paths: SyncNosRuntimePaths,
  path: string,
  dependencies: ResolvedDependencies,
): Promise<void> {
  assertRuntimeOwnedFilePath(paths, path);
  if (await lstatIfPresent(dependencies, path)) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
}

async function readOptionalOwnedFile(
  paths: SyncNosRuntimePaths,
  path: string,
  dependencies: ResolvedDependencies,
): Promise<Buffer | null> {
  assertRuntimeOwnedFilePath(paths, path);
  const status = await lstatIfPresent(dependencies, path);
  if (!status) return null;
  assertRegularFile(status, 'LAUNCHER_OWNERSHIP_INVALID');
  return await readVerifiedFile(dependencies, path, 'LAUNCHER_OWNERSHIP_INVALID');
}

async function unlinkOwnedRuntimeFile(
  paths: SyncNosRuntimePaths,
  path: string,
  dependencies: ResolvedDependencies,
): Promise<void> {
  assertRuntimeOwnedFilePath(paths, path);
  const status = await lstatIfPresent(dependencies, path);
  if (!status) return;
  assertRegularFile(status, 'LAUNCHER_OWNERSHIP_INVALID');
  try {
    await dependencies.unlink(path);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
}

async function stageWithBytes(
  paths: SyncNosRuntimePaths,
  temporary: string,
  contents: Buffer,
  mode: number,
  dependencies: ResolvedDependencies,
): Promise<void> {
  await assertTemporaryPathAbsent(paths, temporary, dependencies);
  try {
    await dependencies.writeFile(temporary, contents, { flag: 'wx', mode });
    if (paths.platform !== 'win32') await dependencies.chmod(temporary, mode);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
  const staged = await readVerifiedFile(dependencies, temporary, 'LAUNCHER_WRITE_FAILED');
  if (!staged.equals(contents)) launcherFailure('LAUNCHER_WRITE_FAILED');
}

async function stagePrebuilt(source: LauncherSource, dependencies: ResolvedDependencies): Promise<void> {
  if (!source.prebuiltPath || !source.config.prebuiltDigest) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
  const { paths } = source;
  await assertTemporaryPathAbsent(paths, paths.launcherTemporaryPath, dependencies);
  try {
    await dependencies.copyFile(source.prebuiltPath, paths.launcherTemporaryPath, fsConstants.COPYFILE_EXCL);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
  const staged = await readVerifiedFile(dependencies, paths.launcherTemporaryPath, 'LAUNCHER_WRITE_FAILED');
  if (sha256(staged) !== source.config.prebuiltDigest) launcherFailure('LAUNCHER_WRITE_FAILED');
}

async function commitStagedTarget(
  paths: SyncNosRuntimePaths,
  destination: string,
  temporary: string,
  expectedDigest: string,
  dependencies: ResolvedDependencies,
): Promise<void> {
  assertRuntimeOwnedFilePath(paths, destination);
  assertRuntimeOwnedFilePath(paths, temporary);
  const staged = await readOptionalOwnedFile(paths, temporary, dependencies);
  if (!staged || sha256(staged) !== expectedDigest) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  try {
    await dependencies.rename(temporary, destination);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
  const committed = await readVerifiedFile(dependencies, destination, 'LAUNCHER_WRITE_FAILED');
  if (sha256(committed) !== expectedDigest) launcherFailure('LAUNCHER_WRITE_FAILED');
}

async function recoverLauncherTarget(
  paths: SyncNosRuntimePaths,
  destination: string,
  temporary: string,
  target: LauncherUpdateIntentTarget,
  dependencies: ResolvedDependencies,
): Promise<void> {
  const current = await readOptionalOwnedFile(paths, destination, dependencies);
  const currentDigest = current ? sha256(current) : null;
  const staged = await readOptionalOwnedFile(paths, temporary, dependencies);
  const stagedDigest = staged ? sha256(staged) : null;

  if (currentDigest === target.newDigest) {
    if (stagedDigest !== null && stagedDigest !== target.newDigest) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
    if (stagedDigest !== null) await unlinkOwnedRuntimeFile(paths, temporary, dependencies);
    return;
  }
  if (currentDigest !== target.oldDigest || stagedDigest !== target.newDigest) {
    launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
  await commitStagedTarget(paths, destination, temporary, target.newDigest, dependencies);
}

async function prepareLauncherUpdateIntent(
  paths: SyncNosRuntimePaths,
  intent: LauncherUpdateIntent,
  dependencies: ResolvedDependencies,
): Promise<Buffer> {
  await assertTemporaryPathAbsent(paths, paths.launcherUpdateIntentPath, dependencies);
  const bytes = Buffer.from(JSON.stringify(intent), 'utf8');
  await stageWithBytes(paths, paths.launcherUpdateIntentTemporaryPath, bytes, 0o600, dependencies);
  return bytes;
}

async function commitLauncherUpdateIntent(
  paths: SyncNosRuntimePaths,
  expectedBytes: Buffer,
  dependencies: ResolvedDependencies,
): Promise<void> {
  const prepared = await readVerifiedFile(
    dependencies,
    paths.launcherUpdateIntentTemporaryPath,
    'LAUNCHER_OWNERSHIP_INVALID',
  );
  if (!prepared.equals(expectedBytes)) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  try {
    await dependencies.rename(paths.launcherUpdateIntentTemporaryPath, paths.launcherUpdateIntentPath);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
  const committed = await readVerifiedFile(dependencies, paths.launcherUpdateIntentPath, 'LAUNCHER_WRITE_FAILED');
  if (!committed.equals(expectedBytes)) launcherFailure('LAUNCHER_WRITE_FAILED');
}

async function assertNoUntrackedLauncherStages(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedDependencies,
): Promise<void> {
  for (const path of [
    paths.launcherConfigTemporaryPath,
    paths.launcherTemporaryPath,
    paths.runtimeOwnerMarkerTemporaryPath,
  ]) {
    if (await readOptionalOwnedFile(paths, path, dependencies)) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  }
}

async function rollbackPreparedLauncherTarget(
  paths: SyncNosRuntimePaths,
  destination: string,
  temporary: string,
  target: LauncherUpdateIntentTarget,
  dependencies: ResolvedDependencies,
): Promise<void> {
  const current = await readOptionalOwnedFile(paths, destination, dependencies);
  const currentDigest = current ? sha256(current) : null;
  if (currentDigest !== target.oldDigest) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  const staged = await readOptionalOwnedFile(paths, temporary, dependencies);
  if (!staged) return;
  if (sha256(staged) !== target.newDigest) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  await unlinkOwnedRuntimeFile(paths, temporary, dependencies);
}

/**
 * Completes only an update whose fixed intent proves every final file is still exactly the
 * previous owned generation or the staged next generation. Unknown bytes always fail closed.
 */
export async function recoverNativeHostLauncherUpdate(
  input: Pick<EnsureNativeHostLauncherInput, 'dependencies' | 'paths'> = {},
): Promise<boolean> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.dependencies);
  const [committedIntentBytes, preparedIntentBytes] = await Promise.all([
    readOptionalOwnedFile(paths, paths.launcherUpdateIntentPath, dependencies),
    readOptionalOwnedFile(paths, paths.launcherUpdateIntentTemporaryPath, dependencies),
  ]);
  if (!committedIntentBytes && !preparedIntentBytes) {
    await assertNoUntrackedLauncherStages(paths, dependencies);
    return false;
  }
  if (committedIntentBytes && preparedIntentBytes) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');

  const intentBytes = committedIntentBytes ?? preparedIntentBytes!;
  const intent = parseLauncherUpdateIntent(intentBytes);
  if (intent.platform !== paths.platform) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');

  if (preparedIntentBytes) {
    await rollbackPreparedLauncherTarget(
      paths,
      paths.launcherConfigPath,
      paths.launcherConfigTemporaryPath,
      intent.config,
      dependencies,
    );
    await rollbackPreparedLauncherTarget(
      paths,
      paths.launcherPath,
      paths.launcherTemporaryPath,
      intent.launcher,
      dependencies,
    );
    await rollbackPreparedLauncherTarget(
      paths,
      paths.runtimeOwnerMarkerPath,
      paths.runtimeOwnerMarkerTemporaryPath,
      intent.runtimeOwnerMarker,
      dependencies,
    );
    const recheckedPrepared = await readVerifiedFile(
      dependencies,
      paths.launcherUpdateIntentTemporaryPath,
      'LAUNCHER_OWNERSHIP_INVALID',
    );
    if (!recheckedPrepared.equals(intentBytes)) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
    await unlinkOwnedRuntimeFile(paths, paths.launcherUpdateIntentTemporaryPath, dependencies);
    return true;
  }

  await recoverLauncherTarget(
    paths,
    paths.launcherConfigPath,
    paths.launcherConfigTemporaryPath,
    intent.config,
    dependencies,
  );
  await recoverLauncherTarget(paths, paths.launcherPath, paths.launcherTemporaryPath, intent.launcher, dependencies);
  await recoverLauncherTarget(
    paths,
    paths.runtimeOwnerMarkerPath,
    paths.runtimeOwnerMarkerTemporaryPath,
    intent.runtimeOwnerMarker,
    dependencies,
  );
  const recheckedIntent = await readVerifiedFile(
    dependencies,
    paths.launcherUpdateIntentPath,
    'LAUNCHER_OWNERSHIP_INVALID',
  );
  if (!recheckedIntent.equals(intentBytes)) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  await unlinkOwnedRuntimeFile(paths, paths.launcherUpdateIntentPath, dependencies);
  return true;
}

/**
 * Installs only package-owned launcher files. It does not create, inspect, or delete the SQLite database.
 */
export async function ensureNativeHostLauncher(
  input: EnsureNativeHostLauncherInput = {},
): Promise<NativeHostLauncherResult> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.dependencies);
  await recoverNativeHostLauncherUpdate({ paths, dependencies: input.dependencies });
  const source = await loadLauncherSource(paths, input, dependencies);
  await dependencies.ensureRuntimeDirectory(paths);
  const existing = await inspectOwnedLauncher(paths, dependencies);

  const launcherDigest =
    paths.platform === 'win32'
      ? source.config.prebuiltDigest
      : source.launcherBytes
        ? sha256(source.launcherBytes)
        : null;
  if (!launcherDigest) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
  const ownerMarker = Buffer.from(
    JSON.stringify({
      version: 1,
      ownerMarker: SYNCNOSCLI_RUNTIME_OWNER_MARKER,
      platform: paths.platform,
      configDigest: sha256(source.configBytes),
      launcherDigest,
      packageDigest: source.config.packageDigest,
      prebuiltDigest: source.config.prebuiltDigest,
    } satisfies RuntimeOwnerMarker),
    'utf8',
  );
  const intent = Object.freeze({
    version: 1 as const,
    ownerMarker: SYNCNOSCLI_LAUNCHER_UPDATE_INTENT,
    platform: paths.platform,
    config: Object.freeze({ oldDigest: existing?.configDigest ?? null, newDigest: sha256(source.configBytes) }),
    launcher: Object.freeze({ oldDigest: existing?.launcherDigest ?? null, newDigest: launcherDigest }),
    runtimeOwnerMarker: Object.freeze({
      oldDigest: existing?.ownerMarkerDigest ?? null,
      newDigest: sha256(ownerMarker),
    }),
  } satisfies LauncherUpdateIntent);

  const intentBytes = await prepareLauncherUpdateIntent(paths, intent, dependencies);
  await stageWithBytes(paths, paths.launcherConfigTemporaryPath, source.configBytes, 0o600, dependencies);
  if (paths.platform === 'win32') {
    await stagePrebuilt(source, dependencies);
  } else {
    if (!source.launcherBytes) launcherFailure('LAUNCHER_ARTIFACT_INVALID');
    await stageWithBytes(paths, paths.launcherTemporaryPath, source.launcherBytes, 0o700, dependencies);
  }
  await stageWithBytes(paths, paths.runtimeOwnerMarkerTemporaryPath, ownerMarker, 0o600, dependencies);
  await commitLauncherUpdateIntent(paths, intentBytes, dependencies);
  await commitStagedTarget(
    paths,
    paths.launcherConfigPath,
    paths.launcherConfigTemporaryPath,
    intent.config.newDigest,
    dependencies,
  );
  await commitStagedTarget(
    paths,
    paths.launcherPath,
    paths.launcherTemporaryPath,
    intent.launcher.newDigest,
    dependencies,
  );
  await commitStagedTarget(
    paths,
    paths.runtimeOwnerMarkerPath,
    paths.runtimeOwnerMarkerTemporaryPath,
    intent.runtimeOwnerMarker.newDigest,
    dependencies,
  );
  await unlinkOwnedRuntimeFile(paths, paths.launcherUpdateIntentPath, dependencies);

  return Object.freeze({
    created: existing === null,
    platform: paths.platform,
    launcherPath: paths.launcherPath,
    configPath: paths.launcherConfigPath,
    ownerMarkerPath: paths.runtimeOwnerMarkerPath,
  });
}

async function removeVerifiedOwnedFile(
  paths: SyncNosRuntimePaths,
  path: string,
  expectedDigest: string,
  dependencies: ResolvedDependencies,
): Promise<void> {
  assertRuntimeOwnedFilePath(paths, path);
  const bytes = await readVerifiedFile(dependencies, path, 'LAUNCHER_OWNERSHIP_INVALID');
  if (sha256(bytes) !== expectedDigest) launcherFailure('LAUNCHER_OWNERSHIP_INVALID');
  try {
    await dependencies.unlink(path);
  } catch (_error) {
    launcherFailure('LAUNCHER_WRITE_FAILED');
  }
}

/**
 * Removes only the verified launcher trio. SQLite files, staging, and unknown contents
 * are deliberately left untouched; Host-owned staging is cleaned by its own marker path.
 */
export async function removeNativeHostLauncher(
  input: Pick<EnsureNativeHostLauncherInput, 'dependencies' | 'paths'> = {},
): Promise<RemoveNativeHostLauncherResult> {
  const paths = assertSyncNosRuntimePaths(input.paths ?? resolveSyncNosRuntimePaths());
  const dependencies = resolveDependencies(input.dependencies);
  const ownership = await inspectOwnedLauncher(paths, dependencies);
  if (!ownership) return Object.freeze({ removed: false });

  await removeVerifiedOwnedFile(paths, paths.launcherConfigPath, ownership.configDigest, dependencies);
  await removeVerifiedOwnedFile(paths, paths.launcherPath, ownership.launcherDigest, dependencies);
  await removeVerifiedOwnedFile(paths, paths.runtimeOwnerMarkerPath, ownership.ownerMarkerDigest, dependencies);
  return Object.freeze({ removed: true });
}
