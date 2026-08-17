import { describe, expect, it, vi } from 'vitest';

import { nativeHostContract } from '../../src/services/local-data/native-host-contract';
import {
  assertRuntimeOwnedFilePath,
  classifySyncNosRuntimePath,
  resolveSyncNosRuntimePaths,
  SyncNosRuntimePathError,
} from '../../packages/syncnoscli/src/runtime/paths';
import {
  ensureSyncNosRuntimeDirectory,
  SyncNosRuntimeFilesystemError,
  type RuntimeFileStatus,
} from '../../packages/syncnoscli/src/runtime/filesystem';

function fileStatus(input: {
  directory?: boolean;
  file?: boolean;
  mode?: number;
  symlink?: boolean;
  uid?: number;
}): RuntimeFileStatus {
  return {
    isDirectory: () => input.directory === true,
    isFile: () => input.file === true,
    isSymbolicLink: () => input.symlink === true,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.uid === undefined ? {} : { uid: input.uid }),
  };
}

function missing(): Error & { code: 'ENOENT' } {
  return Object.assign(new Error('missing'), { code: 'ENOENT' as const });
}

function expectPathError(callback: () => unknown, code: SyncNosRuntimePathError['code']): void {
  let thrown: unknown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(SyncNosRuntimePathError);
  expect((thrown as SyncNosRuntimePathError).code).toBe(code);
}

describe('SyncNos CLI runtime paths', () => {
  it('uses the canonical contract database name in one fixed hidden path on every supported operating system', () => {
    expect(nativeHostContract.host.databaseRelativePath).toBe('syncnos.sqlite');
    expect(resolveSyncNosRuntimePaths({ platform: 'darwin', homeDirectory: '/Users/chii' })).toMatchObject({
      runtimeDirectory: '/Users/chii/.syncnoscli',
      databasePath: '/Users/chii/.syncnoscli/syncnos.sqlite',
      databaseWalPath: '/Users/chii/.syncnoscli/syncnos.sqlite-wal',
      databaseShmPath: '/Users/chii/.syncnoscli/syncnos.sqlite-shm',
    });
    expect(resolveSyncNosRuntimePaths({ platform: 'linux', homeDirectory: '/home/chii' }).databasePath).toBe(
      '/home/chii/.syncnoscli/syncnos.sqlite',
    );
    expect(resolveSyncNosRuntimePaths({ platform: 'win32', homeDirectory: 'D:\\Users\\chii' })).toMatchObject({
      runtimeDirectory: 'D:\\Users\\chii\\.syncnoscli',
      databasePath: 'D:\\Users\\chii\\.syncnoscli\\syncnos.sqlite',
    });
    expectPathError(
      () => resolveSyncNosRuntimePaths({ platform: 'linux', homeDirectory: 'relative' }),
      'HOME_DIRECTORY_INVALID',
    );
    expectPathError(
      () => resolveSyncNosRuntimePaths({ platform: 'freebsd', homeDirectory: '/home/chii' }),
      'UNSUPPORTED_PLATFORM',
    );
  });

  it('creates and repairs a Unix directory to current-user 0700 without accepting links or wrong owners', async () => {
    const paths = resolveSyncNosRuntimePaths({ platform: 'darwin', homeDirectory: '/Users/chii' });
    let exists = false;
    let mode = 0o755;
    const mkdir = vi.fn(async () => {
      exists = true;
    });
    const chmod = vi.fn(async (_path: string, nextMode: number) => {
      mode = nextMode;
    });
    const lstat = vi.fn(async (path: string) => {
      if (path !== paths.runtimeDirectory || !exists) throw missing();
      return fileStatus({ directory: true, mode: 0o40000 | mode, uid: 501 });
    });

    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat,
        mkdir,
        chmod,
        getuid: () => 501,
      }),
    ).resolves.toEqual({ created: true, path: paths.runtimeDirectory });
    expect(mkdir).toHaveBeenCalledWith(paths.runtimeDirectory, { mode: 0o700 });
    expect(chmod).toHaveBeenCalledWith(paths.runtimeDirectory, 0o700);
    expect(mode).toBe(0o700);

    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat: async () => fileStatus({ directory: true, mode: 0o40700, uid: 502 }),
        getuid: () => 501,
      }),
    ).rejects.toMatchObject({ code: 'RUNTIME_DIRECTORY_NOT_OWNED' } satisfies Partial<SyncNosRuntimeFilesystemError>);
    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat: async () => fileStatus({ directory: true, mode: 0o40700, uid: 501, symlink: true }),
        getuid: () => 501,
      }),
    ).rejects.toMatchObject({ code: 'RUNTIME_DIRECTORY_SYMLINK' } satisfies Partial<SyncNosRuntimeFilesystemError>);
    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat: async () => fileStatus({ file: true, mode: 0o100700, uid: 501 }),
        getuid: () => 501,
      }),
    ).rejects.toMatchObject({ code: 'RUNTIME_DIRECTORY_INVALID' } satisfies Partial<SyncNosRuntimeFilesystemError>);
  });

  it('uses only verified System32 attrib.exe with one fixed argv vector on Windows', async () => {
    const paths = resolveSyncNosRuntimePaths({ platform: 'win32', homeDirectory: 'C:\\Users\\chii' });
    const attribPath = 'C:\\Windows\\System32\\attrib.exe';
    const lstat = vi.fn(async (path: string) => {
      if (path === paths.runtimeDirectory) return fileStatus({ directory: true });
      if (path === attribPath) return fileStatus({ file: true });
      throw missing();
    });
    const spawnFile = vi.fn(async () => ({ exitCode: 0, signal: null }));
    const chmod = vi.fn(async () => undefined);

    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat,
        chmod,
        environment: { SystemRoot: 'C:\\Windows' },
        spawnFile,
      }),
    ).resolves.toEqual({ created: false, path: paths.runtimeDirectory });
    expect(lstat.mock.calls.map(([path]) => path)).toEqual([
      paths.runtimeDirectory,
      attribPath,
      paths.runtimeDirectory,
    ]);
    expect(spawnFile).toHaveBeenCalledWith(attribPath, ['+H', paths.runtimeDirectory], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(chmod).not.toHaveBeenCalled();

    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat,
        environment: { SystemRoot: 'C:\\Windows' },
        spawnFile: async () => ({ exitCode: 1, signal: null }),
      }),
    ).rejects.toMatchObject({ code: 'WINDOWS_ATTRIB_FAILED' } satisfies Partial<SyncNosRuntimeFilesystemError>);
    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat,
        environment: {},
        spawnFile,
      }),
    ).rejects.toMatchObject({ code: 'WINDOWS_SYSTEM_ROOT_INVALID' } satisfies Partial<SyncNosRuntimeFilesystemError>);
    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat,
        environment: { SystemRoot: 'relative' },
        spawnFile,
      }),
    ).rejects.toMatchObject({ code: 'WINDOWS_SYSTEM_ROOT_INVALID' } satisfies Partial<SyncNosRuntimeFilesystemError>);
    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat: async (path) =>
          path === paths.runtimeDirectory ? fileStatus({ directory: true }) : fileStatus({ file: true, symlink: true }),
        environment: { SystemRoot: 'C:\\Windows' },
        spawnFile,
      }),
    ).rejects.toMatchObject({ code: 'WINDOWS_ATTRIB_INVALID' } satisfies Partial<SyncNosRuntimeFilesystemError>);
  });

  it('creates a Windows runtime directory without ACL rewriting and rejects an invalid post-attrib recheck', async () => {
    const paths = resolveSyncNosRuntimePaths({ platform: 'win32', homeDirectory: 'C:\\Users\\chii' });
    const attribPath = 'C:\\Windows\\System32\\attrib.exe';
    let exists = false;
    const mkdir = vi.fn(async () => {
      exists = true;
    });
    const chmod = vi.fn(async () => undefined);
    const lstat = vi.fn(async (path: string) => {
      if (path === paths.runtimeDirectory) {
        if (!exists) throw missing();
        return fileStatus({ directory: true });
      }
      if (path === attribPath) return fileStatus({ file: true });
      throw missing();
    });

    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat,
        mkdir,
        chmod,
        environment: { SystemRoot: 'C:\\Windows' },
        spawnFile: async () => ({ exitCode: 0, signal: null }),
      }),
    ).resolves.toEqual({ created: true, path: paths.runtimeDirectory });
    expect(mkdir).toHaveBeenCalledWith(paths.runtimeDirectory, { mode: 0o700 });
    expect(chmod).not.toHaveBeenCalled();

    let runtimeLstatCalls = 0;
    await expect(
      ensureSyncNosRuntimeDirectory(paths, {
        lstat: async (path) => {
          if (path === attribPath) return fileStatus({ file: true });
          if (path === paths.runtimeDirectory) {
            runtimeLstatCalls += 1;
            return runtimeLstatCalls === 2 ? fileStatus({ file: true }) : fileStatus({ directory: true });
          }
          throw missing();
        },
        environment: { SystemRoot: 'C:\\Windows' },
        spawnFile: async () => ({ exitCode: 0, signal: null }),
      }),
    ).rejects.toMatchObject({ code: 'RUNTIME_DIRECTORY_INVALID' } satisfies Partial<SyncNosRuntimeFilesystemError>);
  });

  it('never classifies the database or unknown sibling files as runtime-owned cleanup targets', () => {
    const paths = resolveSyncNosRuntimePaths({ platform: 'linux', homeDirectory: '/home/chii' });
    expect(classifySyncNosRuntimePath(paths, paths.databasePath)).toBe('user-data');
    expect(classifySyncNosRuntimePath(paths, paths.databaseWalPath)).toBe('user-data');
    expect(classifySyncNosRuntimePath(paths, paths.databaseShmPath)).toBe('user-data');
    expect(classifySyncNosRuntimePath(paths, paths.launcherPath)).toBe('runtime-owned-file');
    expect(classifySyncNosRuntimePath(paths, paths.stagingDirectory)).toBe('runtime-owned-directory');
    expect(classifySyncNosRuntimePath(paths, '/home/chii/.syncnoscli/unknown.txt')).toBe('unknown');
    expect(assertRuntimeOwnedFilePath(paths, paths.launcherConfigPath)).toBe(paths.launcherConfigPath);
    expectPathError(() => assertRuntimeOwnedFilePath(paths, paths.databasePath), 'RUNTIME_PATH_INVALID');
    expectPathError(
      () => classifySyncNosRuntimePath({ ...paths, databasePath: '/tmp/syncnos.sqlite' }, paths.launcherPath),
      'RUNTIME_PATH_INVALID',
    );
  });
});
