import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createWindowsRegistryAdapter,
  ensureNativeHostRegistrations,
  getNativeHostRegistrationLocations,
  inspectNativeHostRegistrations,
  isOwnedFirefoxNativeHostManifest,
  removeOwnedNativeHostRegistrations,
  SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER,
  SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE,
  type NativeHostRegistrationDependencies,
  type WindowsRegistryAdapter,
} from '../../packages/syncnoscli/src/install/host-registration';
import {
  removeNativeHostLauncher,
  type NativeHostLauncherDependencies,
} from '../../packages/syncnoscli/src/runtime/launcher';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];

function missing(): Error & { code: 'ENOENT' } {
  return Object.assign(new Error('missing'), { code: 'ENOENT' as const });
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function createUnixFixture(): Promise<{
  packageRoot: string;
  paths: ReturnType<typeof resolveSyncNosRuntimePaths>;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-registration-'));
  temporaryRoots.push(root);
  const packageRoot = join(root, 'prefix', 'lib', 'node_modules', '@chiimagnus', 'syncnoscli');
  await mkdir(join(packageRoot, 'dist'), { recursive: true });
  await mkdir(join(root, 'home'));
  await writeFile(join(packageRoot, 'package.json'), '{"name":"@chiimagnus/syncnoscli","version":"0.1.0"}');
  await writeFile(join(packageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 0;');
  return {
    packageRoot,
    paths: resolveSyncNosRuntimePaths({ platform: 'linux', homeDirectory: join(root, 'home') }),
    root,
  };
}

type FakeEntry = Readonly<{ bytes?: Buffer; directory?: boolean }>;

function fakeStatus(entry: FakeEntry) {
  return {
    isDirectory: () => entry.directory === true,
    isFile: () => entry.directory !== true,
    isSymbolicLink: () => false,
  };
}

function createWindowsFilesystem(files: Map<string, FakeEntry>): {
  launcherDependencies: NativeHostLauncherDependencies;
  registrationDependencies: NativeHostRegistrationDependencies;
} {
  const lstat = async (path: string) => {
    const entry = files.get(path);
    if (!entry) throw missing();
    return fakeStatus(entry);
  };
  const readFile = async (path: string) => {
    const entry = files.get(path);
    if (!entry?.bytes) throw missing();
    return Buffer.from(entry.bytes);
  };
  const writeFile = async (path: string, contents: Uint8Array, options: Readonly<{ flag: 'wx'; mode: number }>) => {
    if (options.flag !== 'wx' || files.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    files.set(path, { bytes: Buffer.from(contents) });
  };
  const rename = async (source: string, destination: string) => {
    const entry = files.get(source);
    if (!entry) throw missing();
    files.delete(source);
    files.set(destination, entry);
  };
  const mkdir = async (path: string) => {
    files.set(path, { directory: true });
  };
  const unlink = async (path: string) => {
    if (!files.delete(path)) throw missing();
  };
  return {
    launcherDependencies: {
      ensureRuntimeDirectory: async (paths) => {
        files.set(paths.runtimeDirectory, { directory: true });
      },
      lstat,
      readFile,
      realpath: async (path) => {
        if (!files.has(path)) throw missing();
        return path;
      },
      writeFile,
      rename,
      copyFile: async (source, destination) => {
        const entry = files.get(source);
        if (!entry?.bytes || files.has(destination)) throw Object.assign(new Error('copy'), { code: 'EEXIST' });
        files.set(destination, { bytes: Buffer.from(entry.bytes) });
      },
      chmod: async () => undefined,
    },
    registrationDependencies: {
      lstat,
      readFile,
      realpath: async (path) => {
        if (!files.has(path)) throw missing();
        return path;
      },
      writeFile,
      rename,
      mkdir,
      unlink,
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SyncNos Native Host registration', () => {
  it('creates all stable Unix browser locations, binds Firefox to the current sidecar, and never creates SQLite', async () => {
    const fixture = await createUnixFixture();
    const locations = getNativeHostRegistrationLocations(fixture.paths);

    expect(locations).toMatchObject([
      {
        browser: 'chrome',
        manifestPath: join(
          fixture.paths.homeDirectory,
          '.config',
          'google-chrome',
          'NativeMessagingHosts',
          'app.syncnos.localdata.json',
        ),
      },
      {
        browser: 'edge',
        manifestPath: join(
          fixture.paths.homeDirectory,
          '.config',
          'microsoft-edge',
          'NativeMessagingHosts',
          'app.syncnos.localdata.json',
        ),
      },
      {
        browser: 'firefox',
        manifestPath: join(
          fixture.paths.homeDirectory,
          '.mozilla',
          'native-messaging-hosts',
          'app.syncnos.localdata.json',
        ),
      },
    ]);
    expect(locations.every((location) => location.registryViews.length === 0)).toBe(true);

    await expect(
      ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({
      browsers: [
        { browser: 'chrome', status: 'registered', verification: 'registration-written-not-browser-verified' },
        { browser: 'edge', status: 'registered', verification: 'registration-written-not-browser-verified' },
        { browser: 'firefox', status: 'registered', verification: 'registration-written-not-browser-verified' },
      ],
    });

    const manifests = await Promise.all(locations.map((location) => readFile(location.manifestPath, 'utf8')));
    expect(JSON.parse(manifests[0]!)).toMatchObject({
      allowed_origins: ['chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/'],
      path: fixture.paths.launcherPath,
    });
    expect(JSON.parse(manifests[1]!)).toMatchObject({
      allowed_origins: ['chrome-extension://ijkpghlfmkbjcgafapjcjahaikmnjncl/'],
      path: fixture.paths.launcherPath,
    });
    expect(JSON.parse(manifests[2]!)).toMatchObject({
      allowed_extensions: ['syncnos-webclipper@syncnos.app'],
      path: fixture.paths.launcherPath,
    });
    await expect(Promise.all(locations.map((location) => readFile(location.ownerPath, 'utf8')))).resolves.toHaveLength(
      3,
    );
    await expect(access(fixture.paths.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(
      isOwnedFirefoxNativeHostManifest(locations[2]!.manifestPath, {
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toBe(true);
    await expect(
      isOwnedFirefoxNativeHostManifest(`${locations[2]!.manifestPath}.spoofed`, {
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toBe(false);
    await writeFile(join(fixture.packageRoot, 'dist', 'native-host.cjs'), 'tampered host');
    await expect(
      inspectNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({
      package: 'verified',
      packageEntrypoint: 'stale',
      browsers: [
        { browser: 'chrome', manifest: 'owned', registry: 'not_applicable' },
        { browser: 'edge', manifest: 'owned', registry: 'not_applicable' },
        { browser: 'firefox', manifest: 'owned', registry: 'not_applicable' },
      ],
    });
    await expect(
      isOwnedFirefoxNativeHostManifest(locations[2]!.manifestPath, {
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toBe(false);
    await writeFile(join(fixture.packageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 0;');
    await expect(
      ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({
      browsers: expect.arrayContaining([expect.objectContaining({ browser: 'chrome', status: 'registered' })]),
    });
  });

  it('preserves a manifest when its versioned sidecar is missing or the pair was modified', async () => {
    const fixture = await createUnixFixture();
    await ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    const firefox = getNativeHostRegistrationLocations(fixture.paths)[2]!;
    const before = await readFile(firefox.manifestPath, 'utf8');
    await rm(firefox.ownerPath);

    await expect(
      ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_CONFLICT' });
    await expect(readFile(firefox.manifestPath, 'utf8')).resolves.toBe(before);
    await expect(
      removeOwnedNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({ conflicts: ['firefox-manifest'], removed: false });
    await expect(readFile(firefox.manifestPath, 'utf8')).resolves.toBe(before);
  });

  it('does not treat a rehashed owned launcher config as current when its entrypoint leaves the package', async () => {
    const fixture = await createUnixFixture();
    await ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    const alternateEntrypoint = join(fixture.root, 'alternate-native-host.cjs');
    await writeFile(alternateEntrypoint, 'process.exitCode = 0;');

    const config = JSON.parse(await readFile(fixture.paths.launcherConfigPath, 'utf8')) as Record<string, unknown>;
    config.entrypointPathBase64 = Buffer.from(alternateEntrypoint, 'utf8').toString('base64');
    const configBytes = Buffer.from(JSON.stringify(config), 'utf8');
    await writeFile(fixture.paths.launcherConfigPath, configBytes);

    const marker = JSON.parse(await readFile(fixture.paths.runtimeOwnerMarkerPath, 'utf8')) as Record<string, unknown>;
    marker.configDigest = sha256(configBytes);
    await writeFile(fixture.paths.runtimeOwnerMarkerPath, JSON.stringify(marker));
    for (const location of getNativeHostRegistrationLocations(fixture.paths)) {
      const owner = JSON.parse(await readFile(location.ownerPath, 'utf8')) as Record<string, unknown>;
      owner.configDigest = sha256(configBytes);
      await writeFile(location.ownerPath, JSON.stringify(owner));
    }

    await expect(
      inspectNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({ package: 'verified', packageEntrypoint: 'stale' });
    await expect(
      isOwnedFirefoxNativeHostManifest(getNativeHostRegistrationLocations(fixture.paths)[2]!.manifestPath, {
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toBe(false);
  });

  it('keeps macOS registration strictly within the three stable user manifest folders', () => {
    const paths = resolveSyncNosRuntimePaths({ platform: 'darwin', homeDirectory: '/Users/chii' });
    expect(getNativeHostRegistrationLocations(paths).map((location) => location.manifestPath)).toEqual([
      '/Users/chii/Library/Application Support/Google/Chrome/NativeMessagingHosts/app.syncnos.localdata.json',
      '/Users/chii/Library/Application Support/Microsoft Edge/NativeMessagingHosts/app.syncnos.localdata.json',
      '/Users/chii/Library/Application Support/Mozilla/NativeMessagingHosts/app.syncnos.localdata.json',
    ]);
  });

  it('never authorizes launcher deletion when no complete owned registration remains', async () => {
    const fixture = await createUnixFixture();
    await ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    const locations = getNativeHostRegistrationLocations(fixture.paths);
    await Promise.all(locations.flatMap((location) => [rm(location.manifestPath), rm(location.ownerPath)]));

    await expect(
      removeOwnedNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toEqual({ canRemoveLauncher: false, conflicts: [], removed: false });
    await expect(access(fixture.paths.launcherPath)).resolves.toBeUndefined();
  });

  it('upgrades a verifiable previous package record and deletes only proven runtime files on uninstall', async () => {
    const fixture = await createUnixFixture();
    await ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    await writeFile(join(fixture.packageRoot, 'package.json'), '{"name":"@chiimagnus/syncnoscli","version":"0.2.0"}');
    await writeFile(join(fixture.packageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 1;');
    await expect(
      ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({ browsers: expect.arrayContaining([expect.objectContaining({ browser: 'firefox' })]) });
    const firefox = getNativeHostRegistrationLocations(fixture.paths)[2]!;
    expect(JSON.parse(await readFile(firefox.ownerPath, 'utf8'))).toMatchObject({ packageVersion: '0.2.0' });

    await writeFile(fixture.paths.databasePath, 'user facts');
    await writeFile(join(fixture.paths.runtimeDirectory, 'user-kept.txt'), 'do not remove');
    await mkdir(fixture.paths.stagingDirectory);
    await expect(
      removeOwnedNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toEqual({ canRemoveLauncher: true, conflicts: [], removed: true });
    await expect(removeNativeHostLauncher({ paths: fixture.paths })).resolves.toEqual({ removed: true });
    await expect(access(fixture.paths.databasePath)).resolves.toBeUndefined();
    await expect(access(join(fixture.paths.runtimeDirectory, 'user-kept.txt'))).resolves.toBeUndefined();
    await expect(access(fixture.paths.launcherPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(fixture.paths.stagingDirectory)).resolves.toBeUndefined();
  });

  it('uses three browser keys across both Windows registry views and keeps browser manifests distinct', async () => {
    const paths = resolveSyncNosRuntimePaths({ platform: 'win32', homeDirectory: 'C:\\Users\\chii' });
    const packageRoot = 'C:\\Program Files\\node_modules\\@chiimagnus\\syncnoscli';
    const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
    const prebuilt = Buffer.from('MZ syncnos native host');
    const files = new Map<string, FakeEntry>([
      [packageRoot, { directory: true }],
      [`${packageRoot}\\package.json`, { bytes: Buffer.from('{"name":"@chiimagnus/syncnoscli","version":"0.1.0"}') }],
      [`${packageRoot}\\dist`, { directory: true }],
      [`${packageRoot}\\dist\\native-host.cjs`, { bytes: Buffer.from('native host') }],
      [nodePath, { bytes: Buffer.from('node') }],
      [
        `${packageRoot}\\prebuilds\\manifest.json`,
        {
          bytes: Buffer.from(
            JSON.stringify({
              version: 1,
              sourceSha256: 'a'.repeat(64),
              artifacts: {
                'win32-arm64': { file: 'win32-arm64/syncnos-native-host.exe', sha256: 'b'.repeat(64) },
                'win32-x64': { file: 'win32-x64/syncnos-native-host.exe', sha256: sha256(prebuilt) },
              },
            }),
          ),
        },
      ],
      [`${packageRoot}\\prebuilds\\win32-x64`, { directory: true }],
      [`${packageRoot}\\prebuilds\\win32-x64\\syncnos-native-host.exe`, { bytes: prebuilt }],
    ]);
    const { launcherDependencies, registrationDependencies } = createWindowsFilesystem(files);
    const values = new Map<string, string>();
    const registry: WindowsRegistryAdapter = {
      readKey: async ({ key, view }) => ({
        state: [...values.keys()].some((entry) => entry.startsWith(`${view}:${key}:`)) ? 'present' : 'absent',
      }),
      readValue: async ({ key, valueName, view }) => {
        const value = values.get(`${view}:${key}:${valueName ?? '(Default)'}`);
        return value === undefined ? { state: 'absent' } : { state: 'present', value };
      },
      writeValue: async ({ key, value, valueName, view }) => {
        values.set(`${view}:${key}:${valueName ?? '(Default)'}`, value);
      },
      deleteValue: async ({ key, valueName, view }) => values.delete(`${view}:${key}:${valueName ?? '(Default)'}`),
    };

    const chromeKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.syncnos.localdata';
    values.set(`32:${chromeKey}:ForeignValue`, 'keep');
    await expect(
      ensureNativeHostRegistrations({
        arch: 'x64',
        launcherDependencies,
        nodePath,
        packageRoot,
        paths,
        registrationDependencies: { ...registrationDependencies, windowsRegistry: registry },
      }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_CONFLICT' });
    expect(files.has(paths.launcherPath)).toBe(false);
    values.clear();

    await ensureNativeHostRegistrations({
      arch: 'x64',
      launcherDependencies,
      nodePath,
      packageRoot,
      paths,
      registrationDependencies: { ...registrationDependencies, windowsRegistry: registry },
    });

    const locations = getNativeHostRegistrationLocations(paths);
    expect(locations).toHaveLength(3);
    expect(locations.every((location) => location.registryViews.join(',') === '32,64')).toBe(true);
    expect(values).toHaveLength(12);
    for (const location of locations) {
      for (const view of location.registryViews) {
        const key = `HKCU\\Software\\${location.browser === 'chrome' ? 'Google\\Chrome' : location.browser === 'edge' ? 'Microsoft\\Edge' : 'Mozilla'}\\NativeMessagingHosts\\app.syncnos.localdata`;
        expect(values.get(`${view}:${key}:(Default)`)).toBe(location.manifestPath);
        expect(values.get(`${view}:${key}:${SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE}`)).toBe(
          SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER,
        );
      }
      expect(files.get(location.manifestPath)?.bytes?.toString('utf8')).toContain(
        location.browser === 'firefox' ? 'allowed_extensions' : 'allowed_origins',
      );
    }
    expect([...values.keys()].some((key) => key.endsWith(`:${SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE}`))).toBe(true);
    values.delete(`32:${chromeKey}:${SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE}`);
    await expect(
      ensureNativeHostRegistrations({
        arch: 'x64',
        launcherDependencies,
        nodePath,
        packageRoot,
        paths,
        registrationDependencies: { ...registrationDependencies, windowsRegistry: registry },
      }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_CONFLICT' });
  });

  it('uses only verified System32 reg.exe and exact separated argv', async () => {
    const calls: Array<Readonly<{ argv: readonly string[]; file: string; options: unknown }>> = [];
    const adapter = createWindowsRegistryAdapter({
      environment: { PATH: 'C:\\evil', SystemRoot: 'C:\\Windows' },
      lstat: async (path) => {
        if (path === 'C:\\Windows\\System32\\reg.exe') return fakeStatus({ bytes: Buffer.from('reg') });
        throw missing();
      },
      spawnFile: async (file, argv, options) => {
        calls.push({ file, argv, options });
        if (argv[0] === 'query') {
          return {
            exitCode: 1,
            signal: null,
            stderr: Buffer.from('ERROR: The system was unable to find the specified registry key or value.'),
            stdout: Buffer.alloc(0),
          };
        }
        return { exitCode: 0, signal: null, stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) };
      },
    });

    await expect(
      adapter.readKey({
        key: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.syncnos.localdata',
        view: '32',
      }),
    ).resolves.toEqual({ state: 'absent' });
    await expect(
      adapter.readValue({
        key: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.syncnos.localdata',
        valueName: null,
        view: '32',
      }),
    ).resolves.toEqual({ state: 'absent' });
    await adapter.writeValue({
      key: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.syncnos.localdata',
      value: 'C:\\Users\\chii\\.syncnoscli\\native-host-chrome-v1.json',
      valueName: SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE,
      view: '64',
    });

    expect(calls).toEqual([
      {
        file: 'C:\\Windows\\System32\\reg.exe',
        argv: ['query', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.syncnos.localdata', '/reg:32'],
        options: { shell: false, stdio: 'pipe', windowsHide: true },
      },
      {
        file: 'C:\\Windows\\System32\\reg.exe',
        argv: [
          'query',
          'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.syncnos.localdata',
          '/ve',
          '/reg:32',
        ],
        options: { shell: false, stdio: 'pipe', windowsHide: true },
      },
      {
        file: 'C:\\Windows\\System32\\reg.exe',
        argv: [
          'add',
          'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.syncnos.localdata',
          '/v',
          SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE,
          '/t',
          'REG_SZ',
          '/d',
          'C:\\Users\\chii\\.syncnoscli\\native-host-chrome-v1.json',
          '/f',
          '/reg:64',
        ],
        options: { shell: false, stdio: 'pipe', windowsHide: true },
      },
    ]);

    const blocked = createWindowsRegistryAdapter({
      environment: { PATH: 'C:\\evil', SystemRoot: 'C:\\Windows' },
      lstat: async (path) => {
        if (path === 'C:\\evil\\reg.exe') return fakeStatus({ bytes: Buffer.from('fake') });
        throw missing();
      },
    });
    await expect(
      blocked.readValue({ key: 'HKCU\\Software\\Mozilla', valueName: null, view: '32' }),
    ).rejects.toMatchObject({ code: 'WINDOWS_REGISTRY_UNAVAILABLE' });
  });
});
