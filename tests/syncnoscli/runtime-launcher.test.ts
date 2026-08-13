import { createHash } from 'node:crypto';
import { access, lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureNativeHostLauncher,
  inspectNativeHostLauncher,
  NativeHostLauncherError,
  type NativeHostLauncherDependencies,
} from '../../packages/syncnoscli/src/runtime/launcher';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function createUnixFixture(): Promise<{
  packageRoot: string;
  paths: ReturnType<typeof resolveSyncNosRuntimePaths>;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-launcher-'));
  temporaryRoots.push(root);
  const packageRoot = join(root, 'package');
  await mkdir(join(packageRoot, 'dist'), { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), '{"name":"@chiimagnus/syncnoscli"}');
  await writeFile(join(packageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 0;');
  return {
    root,
    packageRoot,
    paths: resolveSyncNosRuntimePaths({ platform: 'linux', homeDirectory: root }),
  };
}

type FakeEntry = Readonly<{ bytes?: Buffer; directory?: boolean }>;

function createWindowsDependencies(files: Map<string, FakeEntry>): NativeHostLauncherDependencies {
  const status = (entry: FakeEntry) => ({
    isDirectory: () => entry.directory === true,
    isFile: () => entry.directory !== true,
    isSymbolicLink: () => false,
  });
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  return {
    ensureRuntimeDirectory: async (paths) => {
      files.set(paths.runtimeDirectory, { directory: true });
    },
    lstat: async (path) => {
      const entry = files.get(path);
      if (!entry) throw missing();
      return status(entry);
    },
    readFile: async (path) => {
      const entry = files.get(path);
      if (!entry || entry.directory || !entry.bytes) throw missing();
      return Buffer.from(entry.bytes);
    },
    realpath: async (path) => {
      if (!files.has(path)) throw missing();
      return path;
    },
    writeFile: async (path, contents, options) => {
      if (options.flag !== 'wx' || files.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      files.set(path, { bytes: Buffer.from(contents) });
    },
    copyFile: async (source, destination, flags) => {
      const entry = files.get(source);
      if (!entry?.bytes || files.has(destination) || flags === 0)
        throw Object.assign(new Error('copy'), { code: 'EEXIST' });
      files.set(destination, { bytes: Buffer.from(entry.bytes) });
    },
    rename: async (source, destination) => {
      const entry = files.get(source);
      if (!entry) throw missing();
      files.delete(source);
      files.set(destination, entry);
    },
    chmod: async () => undefined,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SyncNos Native Host launcher', () => {
  it('writes a private Unix exec wrapper and ownership-bound config without creating a database', async () => {
    const fixture = await createUnixFixture();
    const result = await ensureNativeHostLauncher({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    const nodePath = await realpath(process.execPath);
    const entrypointPath = await realpath(join(fixture.packageRoot, 'dist', 'native-host.cjs'));
    const launcher = await readFile(fixture.paths.launcherPath, 'utf8');
    const config = JSON.parse(await readFile(fixture.paths.launcherConfigPath, 'utf8')) as Record<string, unknown>;
    const marker = JSON.parse(await readFile(fixture.paths.runtimeOwnerMarkerPath, 'utf8')) as Record<string, unknown>;

    expect(result).toMatchObject({ created: true, launcherPath: fixture.paths.launcherPath, platform: 'linux' });
    expect(launcher).toBe(`#!/bin/sh\nexec '${nodePath}' '${entrypointPath}' "$@"\n`);
    expect((await lstat(fixture.paths.launcherPath)).mode & 0o777).toBe(0o700);
    expect(config).toMatchObject({
      version: 1,
      ownerMarker: 'syncnoscli-runtime-v1',
      nodePathBase64: Buffer.from(nodePath).toString('base64'),
      entrypointPathBase64: Buffer.from(entrypointPath).toString('base64'),
      prebuiltDigest: null,
    });
    expect(marker).toMatchObject({ ownerMarker: 'syncnoscli-runtime-v1', platform: 'linux' });
    await expect(inspectNativeHostLauncher({ paths: fixture.paths })).resolves.toMatchObject({
      nodePath,
      entrypointPath,
      configDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    await expect(access(fixture.paths.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      ensureNativeHostLauncher({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({
      created: false,
    });

    const quotedNodePath = join(fixture.root, "node's executable");
    await writeFile(quotedNodePath, 'node');
    await ensureNativeHostLauncher({
      nodePath: quotedNodePath,
      packageRoot: fixture.packageRoot,
      paths: fixture.paths,
    });
    const resolvedQuotedNodePath = await realpath(quotedNodePath);
    expect(await readFile(fixture.paths.launcherPath, 'utf8')).toContain(
      `exec '${resolvedQuotedNodePath.replaceAll("'", "'\"'\"'")}'`,
    );
  });

  it('preserves an unprovable existing launcher and rejects source paths before creating runtime files', async () => {
    const fixture = await createUnixFixture();
    await expect(
      ensureNativeHostLauncher({
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
        nodePath: join(fixture.root, 'missing-node'),
      }),
    ).rejects.toMatchObject({ code: 'NODE_EXECUTABLE_INVALID' } satisfies Partial<NativeHostLauncherError>);
    await expect(access(fixture.paths.runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' });

    await ensureNativeHostLauncher({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    await writeFile(fixture.paths.launcherConfigPath, '{}');
    await expect(
      ensureNativeHostLauncher({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).rejects.toMatchObject({
      code: 'LAUNCHER_OWNERSHIP_INVALID',
    } satisfies Partial<NativeHostLauncherError>);
    await expect(readFile(fixture.paths.launcherConfigPath, 'utf8')).resolves.toBe('{}');
  });

  it('copies only the manifest-pinned Windows PE shim and records its digest in the fixed config', async () => {
    const paths = resolveSyncNosRuntimePaths({ platform: 'win32', homeDirectory: 'C:\\Users\\chii' });
    const packageRoot = 'C:\\Program Files\\node_modules\\@chiimagnus\\syncnoscli';
    const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
    const entrypointPath = `${packageRoot}\\dist\\native-host.cjs`;
    const prebuiltPath = `${packageRoot}\\prebuilds\\win32-x64\\syncnos-native-host.exe`;
    const prebuiltBytes = Buffer.from('MZtest-shim');
    const manifest = Buffer.from(
      JSON.stringify({
        version: 1,
        sourceSha256: 'a'.repeat(64),
        artifacts: {
          'win32-arm64': { file: 'win32-arm64/syncnos-native-host.exe', sha256: 'b'.repeat(64) },
          'win32-x64': { file: 'win32-x64/syncnos-native-host.exe', sha256: sha256(prebuiltBytes) },
        },
      }),
    );
    const files = new Map<string, FakeEntry>([
      [packageRoot, { directory: true }],
      [`${packageRoot}\\package.json`, { bytes: Buffer.from('{}') }],
      [`${packageRoot}\\dist`, { directory: true }],
      [entrypointPath, { bytes: Buffer.from('host') }],
      [nodePath, { bytes: Buffer.from('node') }],
      [`${packageRoot}\\prebuilds\\manifest.json`, { bytes: manifest }],
      [`${packageRoot}\\prebuilds\\win32-x64`, { directory: true }],
      [prebuiltPath, { bytes: prebuiltBytes }],
    ]);

    const result = await ensureNativeHostLauncher({
      arch: 'x64',
      dependencies: createWindowsDependencies(files),
      nodePath,
      packageRoot,
      paths,
    });
    const rawConfig = files.get(paths.launcherConfigPath)?.bytes?.toString('utf8') ?? '';
    const config = JSON.parse(rawConfig) as Record<string, unknown>;

    expect(result).toMatchObject({ created: true, launcherPath: paths.launcherPath, platform: 'win32' });
    expect(files.get(paths.launcherPath)?.bytes).toEqual(prebuiltBytes);
    expect(config).toMatchObject({
      ownerMarker: 'syncnoscli-runtime-v1',
      nodePathBase64: Buffer.from(nodePath).toString('base64'),
      entrypointPathBase64: Buffer.from(entrypointPath).toString('base64'),
      prebuiltDigest: sha256(prebuiltBytes),
    });
    expect(rawConfig).toMatch(/^\{"version":1,"ownerMarker":"syncnoscli-runtime-v1","nodePathBase64":"/);
    expect(files.has(paths.databasePath)).toBe(false);

    files.set(`${packageRoot}\\prebuilds\\manifest.json`, { bytes: Buffer.from('{}') });
    await expect(
      ensureNativeHostLauncher({
        arch: 'x64',
        dependencies: createWindowsDependencies(files),
        nodePath,
        packageRoot,
        paths: resolveSyncNosRuntimePaths({ platform: 'win32', homeDirectory: 'C:\\Users\\other' }),
      }),
    ).rejects.toMatchObject({ code: 'LAUNCHER_ARTIFACT_INVALID' } satisfies Partial<NativeHostLauncherError>);

    await expect(
      ensureNativeHostLauncher({
        arch: 'ia32',
        dependencies: createWindowsDependencies(files),
        nodePath,
        packageRoot,
        paths,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM' } satisfies Partial<NativeHostLauncherError>);
  });
});
