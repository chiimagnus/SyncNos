import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

import { nativeHostContract } from '@services/local-data/native-host-contract';

export const SYNCNOSCLI_RUNTIME_DIRECTORY_NAME = '.syncnoscli' as const;
export const SYNCNOSCLI_DATABASE_FILE_NAME = nativeHostContract.host.databaseRelativePath;
export const SYNCNOSCLI_RUNTIME_OWNER_MARKER_FILE_NAME = 'runtime-owner-v1.json' as const;
export const SYNCNOSCLI_NATIVE_HOST_LAUNCHER_CONFIG_FILE_NAME = 'native-host-launcher-v1.json' as const;
export const SYNCNOSCLI_LAUNCHER_UPDATE_INTENT_FILE_NAME = 'launcher-update-intent-v1.json' as const;
export const SYNCNOSCLI_REGISTRATION_UPDATE_INTENT_FILE_NAME = 'registration-update-intent-v1.json' as const;
export const SYNCNOSCLI_STAGING_DIRECTORY_NAME = 'staging' as const;
export const SYNCNOSCLI_UNIX_LAUNCHER_FILE_NAME = 'syncnos-native-host' as const;
export const SYNCNOSCLI_WINDOWS_LAUNCHER_FILE_NAME = 'syncnos-native-host.exe' as const;

export type SyncNosRuntimePlatform = 'darwin' | 'linux' | 'win32';

export type SyncNosRuntimePaths = Readonly<{
  databasePath: string;
  databaseShmPath: string;
  databaseWalPath: string;
  homeDirectory: string;
  launcherConfigPath: string;
  launcherConfigTemporaryPath: string;
  launcherPath: string;
  launcherUpdateIntentPath: string;
  launcherUpdateIntentTemporaryPath: string;
  launcherTemporaryPath: string;
  registrationUpdateIntentPath: string;
  registrationUpdateIntentTemporaryPath: string;
  platform: SyncNosRuntimePlatform;
  runtimeDirectory: string;
  runtimeOwnerMarkerPath: string;
  runtimeOwnerMarkerTemporaryPath: string;
  stagingDirectory: string;
}>;

export type SyncNosRuntimePathOwnership = 'runtime-owned-directory' | 'runtime-owned-file' | 'unknown' | 'user-data';

export class SyncNosRuntimePathError extends Error {
  constructor(readonly code: 'HOME_DIRECTORY_INVALID' | 'RUNTIME_PATH_INVALID' | 'UNSUPPORTED_PLATFORM') {
    super(
      code === 'UNSUPPORTED_PLATFORM'
        ? 'This platform is not supported by SyncNos CLI.'
        : 'Invalid SyncNos runtime path.',
    );
    this.name = 'SyncNosRuntimePathError';
  }
}

type RuntimePathApi = typeof posix;

function pathApi(platform: SyncNosRuntimePlatform): RuntimePathApi {
  return platform === 'win32' ? win32 : posix;
}

function parsePlatform(value: NodeJS.Platform): SyncNosRuntimePlatform {
  if (value === 'darwin' || value === 'linux' || value === 'win32') return value;
  throw new SyncNosRuntimePathError('UNSUPPORTED_PLATFORM');
}

function parseHomeDirectory(value: unknown, api: RuntimePathApi): string {
  if (typeof value !== 'string' || !value || !api.isAbsolute(value)) {
    throw new SyncNosRuntimePathError('HOME_DIRECTORY_INVALID');
  }
  return api.resolve(value);
}

function createSyncNosRuntimePaths(platform: SyncNosRuntimePlatform, homeDirectory: string): SyncNosRuntimePaths {
  const api = pathApi(platform);
  const runtimeDirectory = api.join(homeDirectory, SYNCNOSCLI_RUNTIME_DIRECTORY_NAME);
  const databasePath = api.join(runtimeDirectory, SYNCNOSCLI_DATABASE_FILE_NAME);
  return Object.freeze({
    platform,
    homeDirectory,
    runtimeDirectory,
    databasePath,
    databaseWalPath: `${databasePath}-wal`,
    databaseShmPath: `${databasePath}-shm`,
    runtimeOwnerMarkerPath: api.join(runtimeDirectory, SYNCNOSCLI_RUNTIME_OWNER_MARKER_FILE_NAME),
    runtimeOwnerMarkerTemporaryPath: api.join(runtimeDirectory, `${SYNCNOSCLI_RUNTIME_OWNER_MARKER_FILE_NAME}.next`),
    launcherConfigPath: api.join(runtimeDirectory, SYNCNOSCLI_NATIVE_HOST_LAUNCHER_CONFIG_FILE_NAME),
    launcherConfigTemporaryPath: api.join(runtimeDirectory, `${SYNCNOSCLI_NATIVE_HOST_LAUNCHER_CONFIG_FILE_NAME}.next`),
    launcherPath: api.join(
      runtimeDirectory,
      platform === 'win32' ? SYNCNOSCLI_WINDOWS_LAUNCHER_FILE_NAME : SYNCNOSCLI_UNIX_LAUNCHER_FILE_NAME,
    ),
    launcherUpdateIntentPath: api.join(runtimeDirectory, SYNCNOSCLI_LAUNCHER_UPDATE_INTENT_FILE_NAME),
    launcherUpdateIntentTemporaryPath: api.join(
      runtimeDirectory,
      `${SYNCNOSCLI_LAUNCHER_UPDATE_INTENT_FILE_NAME}.next`,
    ),
    launcherTemporaryPath: api.join(
      runtimeDirectory,
      `${platform === 'win32' ? SYNCNOSCLI_WINDOWS_LAUNCHER_FILE_NAME : SYNCNOSCLI_UNIX_LAUNCHER_FILE_NAME}.next`,
    ),
    registrationUpdateIntentPath: api.join(runtimeDirectory, SYNCNOSCLI_REGISTRATION_UPDATE_INTENT_FILE_NAME),
    registrationUpdateIntentTemporaryPath: api.join(
      runtimeDirectory,
      `${SYNCNOSCLI_REGISTRATION_UPDATE_INTENT_FILE_NAME}.next`,
    ),
    stagingDirectory: api.join(runtimeDirectory, SYNCNOSCLI_STAGING_DIRECTORY_NAME),
  });
}

/** Resolves the only supported per-user data location; this is not a user-configurable path. */
export function resolveSyncNosRuntimePaths(
  input: Readonly<{ homeDirectory?: string; platform?: NodeJS.Platform }> = {},
): SyncNosRuntimePaths {
  const platform = parsePlatform(input.platform ?? process.platform);
  const homeDirectory = parseHomeDirectory(input.homeDirectory ?? homedir(), pathApi(platform));
  return createSyncNosRuntimePaths(platform, homeDirectory);
}

/** Re-derives every path before filesystem work so a caller cannot smuggle an arbitrary deletion target. */
export function assertSyncNosRuntimePaths(value: unknown): SyncNosRuntimePaths {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SyncNosRuntimePathError('RUNTIME_PATH_INVALID');
  const input = value as Partial<SyncNosRuntimePaths>;
  let platform: SyncNosRuntimePlatform;
  try {
    platform = parsePlatform(input.platform as NodeJS.Platform);
  } catch (_error) {
    throw new SyncNosRuntimePathError('RUNTIME_PATH_INVALID');
  }
  const homeDirectory = parseHomeDirectory(input.homeDirectory, pathApi(platform));
  const expected = createSyncNosRuntimePaths(platform, homeDirectory);
  for (const key of Object.keys(expected) as Array<keyof SyncNosRuntimePaths>) {
    if (input[key] !== expected[key]) throw new SyncNosRuntimePathError('RUNTIME_PATH_INVALID');
  }
  return expected;
}

function resolvedCandidatePath(paths: SyncNosRuntimePaths, candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  const api = pathApi(paths.platform);
  if (!api.isAbsolute(candidate)) return null;
  return api.resolve(candidate);
}

/** Database files are deliberately user data; only the fixed launcher support files are runtime-owned. */
export function classifySyncNosRuntimePath(pathsValue: unknown, candidate: unknown): SyncNosRuntimePathOwnership {
  const paths = assertSyncNosRuntimePaths(pathsValue);
  const resolved = resolvedCandidatePath(paths, candidate);
  if (!resolved) return 'unknown';
  if (resolved === paths.databasePath || resolved === paths.databaseWalPath || resolved === paths.databaseShmPath) {
    return 'user-data';
  }
  if (resolved === paths.runtimeDirectory || resolved === paths.stagingDirectory) return 'runtime-owned-directory';
  if (
    resolved === paths.launcherPath ||
    resolved === paths.launcherTemporaryPath ||
    resolved === paths.launcherConfigPath ||
    resolved === paths.launcherConfigTemporaryPath ||
    resolved === paths.launcherUpdateIntentPath ||
    resolved === paths.launcherUpdateIntentTemporaryPath ||
    resolved === paths.registrationUpdateIntentPath ||
    resolved === paths.registrationUpdateIntentTemporaryPath ||
    resolved === paths.runtimeOwnerMarkerPath ||
    resolved === paths.runtimeOwnerMarkerTemporaryPath
  ) {
    return 'runtime-owned-file';
  }
  return 'unknown';
}

/** A future cleanup call must first validate its marker; this guard also rejects the database and every unknown sibling. */
export function assertRuntimeOwnedFilePath(pathsValue: unknown, candidate: unknown): string {
  const paths = assertSyncNosRuntimePaths(pathsValue);
  const resolved = resolvedCandidatePath(paths, candidate);
  const api = pathApi(paths.platform);
  if (
    !resolved ||
    api.dirname(resolved) !== paths.runtimeDirectory ||
    classifySyncNosRuntimePath(paths, resolved) !== 'runtime-owned-file'
  ) {
    throw new SyncNosRuntimePathError('RUNTIME_PATH_INVALID');
  }
  return resolved;
}
