import { spawn as nodeSpawn } from 'node:child_process';
import { chmod as nodeChmod, lstat as nodeLstat, mkdir as nodeMkdir } from 'node:fs/promises';
import { win32 } from 'node:path';

import { assertSyncNosRuntimePaths, type SyncNosRuntimePaths } from './paths';

export type RuntimeFileStatus = Readonly<{
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  mode?: number;
  uid?: number;
}>;

export type SpawnFileOptions = Readonly<{
  shell: false;
  stdio: 'ignore';
  windowsHide: true;
}>;

export type SpawnFileResult = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}>;

export type RuntimeFilesystemDependencies = Readonly<{
  chmod?: (path: string, mode: number) => Promise<void>;
  environment?: Readonly<Record<string, string | undefined>>;
  getuid?: (() => number) | undefined;
  lstat?: (path: string) => Promise<RuntimeFileStatus>;
  mkdir?: (path: string, options: Readonly<{ mode: number }>) => Promise<void>;
  spawnFile?: (file: string, argv: readonly string[], options: SpawnFileOptions) => Promise<SpawnFileResult>;
}>;

export type SyncNosRuntimeDirectoryResult = Readonly<{
  created: boolean;
  path: string;
}>;

export class SyncNosRuntimeFilesystemError extends Error {
  constructor(
    readonly code:
      | 'RUNTIME_DIRECTORY_INVALID'
      | 'RUNTIME_DIRECTORY_NOT_OWNED'
      | 'RUNTIME_DIRECTORY_SYMLINK'
      | 'RUNTIME_DIRECTORY_UNAVAILABLE'
      | 'WINDOWS_ATTRIB_FAILED'
      | 'WINDOWS_ATTRIB_INVALID'
      | 'WINDOWS_SYSTEM_ROOT_INVALID',
  ) {
    super(
      code.startsWith('WINDOWS_')
        ? 'SyncNos CLI could not safely configure its Windows runtime directory.'
        : 'SyncNos CLI could not safely use its runtime directory.',
    );
    this.name = 'SyncNosRuntimeFilesystemError';
  }
}

type ResolvedRuntimeFilesystemDependencies = Readonly<{
  chmod: (path: string, mode: number) => Promise<void>;
  environment: Readonly<Record<string, string | undefined>>;
  getuid?: () => number;
  lstat: (path: string) => Promise<RuntimeFileStatus>;
  mkdir: (path: string, options: Readonly<{ mode: number }>) => Promise<void>;
  spawnFile: (file: string, argv: readonly string[], options: SpawnFileOptions) => Promise<SpawnFileResult>;
}>;

const WINDOWS_ATTRIB_SPAWN_OPTIONS = Object.freeze({
  shell: false as const,
  stdio: 'ignore' as const,
  windowsHide: true as const,
});

function runtimeFilesystemFailure(code: SyncNosRuntimeFilesystemError['code']): never {
  throw new SyncNosRuntimeFilesystemError(code);
}

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code);
}

/** Runs one exact executable and argv vector; callers cannot opt into shell parsing. */
export async function spawnFile(
  file: string,
  argv: readonly string[],
  options: SpawnFileOptions,
): Promise<SpawnFileResult> {
  return await new Promise<SpawnFileResult>((resolve, reject) => {
    const child = nodeSpawn(file, [...argv], options);
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function resolveDependencies(input: RuntimeFilesystemDependencies | undefined): ResolvedRuntimeFilesystemDependencies {
  return {
    lstat: input?.lstat ?? nodeLstat,
    mkdir: input?.mkdir ?? nodeMkdir,
    chmod: input?.chmod ?? nodeChmod,
    getuid: input?.getuid ?? (typeof process.getuid === 'function' ? process.getuid.bind(process) : undefined),
    environment: input?.environment ?? process.env,
    spawnFile: input?.spawnFile ?? spawnFile,
  };
}

async function lstatIfPresent(
  dependencies: ResolvedRuntimeFilesystemDependencies,
  path: string,
): Promise<RuntimeFileStatus | null> {
  try {
    return await dependencies.lstat(path);
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return null;
    runtimeFilesystemFailure('RUNTIME_DIRECTORY_UNAVAILABLE');
  }
}

function assertDirectory(
  status: RuntimeFileStatus,
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedRuntimeFilesystemDependencies,
): void {
  if (status.isSymbolicLink()) runtimeFilesystemFailure('RUNTIME_DIRECTORY_SYMLINK');
  if (!status.isDirectory()) runtimeFilesystemFailure('RUNTIME_DIRECTORY_INVALID');
  if (paths.platform === 'win32') return;

  const expectedUid = dependencies.getuid?.();
  if (!Number.isSafeInteger(expectedUid) || expectedUid! < 0 || status.uid !== expectedUid) {
    runtimeFilesystemFailure('RUNTIME_DIRECTORY_NOT_OWNED');
  }
}

function unixMode(status: RuntimeFileStatus): number {
  if (!Number.isSafeInteger(status.mode)) runtimeFilesystemFailure('RUNTIME_DIRECTORY_INVALID');
  return Number(status.mode) & 0o777;
}

async function assertAndRepairUnixDirectory(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedRuntimeFilesystemDependencies,
  status: RuntimeFileStatus,
): Promise<void> {
  assertDirectory(status, paths, dependencies);
  if (unixMode(status) !== 0o700) {
    try {
      await dependencies.chmod(paths.runtimeDirectory, 0o700);
    } catch (_error) {
      runtimeFilesystemFailure('RUNTIME_DIRECTORY_UNAVAILABLE');
    }
  }
  const repaired = await lstatIfPresent(dependencies, paths.runtimeDirectory);
  if (!repaired) runtimeFilesystemFailure('RUNTIME_DIRECTORY_UNAVAILABLE');
  assertDirectory(repaired, paths, dependencies);
  if (unixMode(repaired) !== 0o700) runtimeFilesystemFailure('RUNTIME_DIRECTORY_INVALID');
}

function windowsAttribPath(environment: Readonly<Record<string, string | undefined>>): string {
  const systemRoot = environment.SystemRoot?.trim();
  if (!systemRoot || !win32.isAbsolute(systemRoot)) runtimeFilesystemFailure('WINDOWS_SYSTEM_ROOT_INVALID');
  const root = win32.resolve(systemRoot);
  const attribPath = win32.resolve(root, 'System32', 'attrib.exe');
  if (win32.dirname(attribPath).toLowerCase() !== win32.join(root, 'System32').toLowerCase()) {
    runtimeFilesystemFailure('WINDOWS_SYSTEM_ROOT_INVALID');
  }
  return attribPath;
}

async function markWindowsDirectoryHidden(
  paths: SyncNosRuntimePaths,
  dependencies: ResolvedRuntimeFilesystemDependencies,
): Promise<void> {
  const attribPath = windowsAttribPath(dependencies.environment);
  const attrib = await lstatIfPresent(dependencies, attribPath);
  if (!attrib || attrib.isSymbolicLink() || !attrib.isFile()) runtimeFilesystemFailure('WINDOWS_ATTRIB_INVALID');

  const result = await dependencies
    .spawnFile(attribPath, Object.freeze(['+H', paths.runtimeDirectory]), WINDOWS_ATTRIB_SPAWN_OPTIONS)
    .catch(() => runtimeFilesystemFailure('WINDOWS_ATTRIB_FAILED'));
  if (result.exitCode !== 0 || result.signal !== null) runtimeFilesystemFailure('WINDOWS_ATTRIB_FAILED');

  const rechecked = await lstatIfPresent(dependencies, paths.runtimeDirectory);
  if (!rechecked) runtimeFilesystemFailure('RUNTIME_DIRECTORY_UNAVAILABLE');
  assertDirectory(rechecked, paths, dependencies);
}

/**
 * Creates only the fixed per-user dot directory. It never creates a database,
 * rewrites Windows ACLs, or accepts an alternate location.
 */
export async function ensureSyncNosRuntimeDirectory(
  pathsValue: unknown,
  input: RuntimeFilesystemDependencies = {},
): Promise<SyncNosRuntimeDirectoryResult> {
  const paths = assertSyncNosRuntimePaths(pathsValue);
  const dependencies = resolveDependencies(input);
  let status = await lstatIfPresent(dependencies, paths.runtimeDirectory);
  let created = false;
  if (!status) {
    try {
      await dependencies.mkdir(paths.runtimeDirectory, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (!isErrnoCode(error, 'EEXIST')) runtimeFilesystemFailure('RUNTIME_DIRECTORY_UNAVAILABLE');
    }
    status = await lstatIfPresent(dependencies, paths.runtimeDirectory);
  }
  if (!status) runtimeFilesystemFailure('RUNTIME_DIRECTORY_UNAVAILABLE');

  if (paths.platform === 'win32') {
    assertDirectory(status, paths, dependencies);
    await markWindowsDirectoryHidden(paths, dependencies);
  } else {
    await assertAndRepairUnixDirectory(paths, dependencies, status);
  }
  return Object.freeze({ created, path: paths.runtimeDirectory });
}
