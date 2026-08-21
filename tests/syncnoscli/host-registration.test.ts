import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createWindowsRegistryAdapter,
  ensureNativeHostRegistrations,
  getNativeHostRegistrationLocations,
  inspectNativeHostRegistrations,
  isOwnedFirefoxNativeHostManifest,
  recoverNativeHostRegistrationUpdate,
  removeOwnedNativeHostRegistrations,
  SYNCNOSCLI_NATIVE_HOST_REGISTRATION_OWNER,
  SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE,
  type NativeHostBrowser,
  type NativeHostRegistrationDependencies,
  type WindowsRegistryAdapter,
} from '../../packages/syncnoscli/src/install/host-registration';
import {
  ensureNativeHostLauncher,
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

const CHROMIUM_ALLOWED_ORIGINS = [
  'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/',
  'chrome-extension://ijkpghlfmkbjcgafapjcjahaikmnjncl/',
] as const;
const FIREFOX_FAMILY = new Set<NativeHostBrowser>(['firefox', 'librewolf', 'waterfox', 'tor-browser']);

function locationByBrowser(
  locations: ReturnType<typeof getNativeHostRegistrationLocations>,
  browser: NativeHostBrowser,
) {
  const location = locations.find((candidate) => candidate.browser === browser);
  expect(location, `missing registration target: ${browser}`).toBeDefined();
  return location!;
}

async function createUnixFixture(platform: 'darwin' | 'linux' = 'linux'): Promise<{
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
    paths: resolveSyncNosRuntimePaths({ platform, homeDirectory: join(root, 'home') }),
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
      unlink,
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

function createUnixRegistrationMemoryFixture() {
  const paths = resolveSyncNosRuntimePaths({ platform: 'linux', homeDirectory: '/home/chii' });
  const packageRoot = '/opt/lib/node_modules/@chiimagnus/syncnoscli';
  const nodePath = '/usr/bin/node';
  const files = new Map<string, FakeEntry>([
    [packageRoot, { directory: true }],
    [`${packageRoot}/package.json`, { bytes: Buffer.from('{"name":"@chiimagnus/syncnoscli","version":"0.1.0"}') }],
    [`${packageRoot}/dist`, { directory: true }],
    [`${packageRoot}/dist/native-host.cjs`, { bytes: Buffer.from('process.exitCode = 0;') }],
    [nodePath, { bytes: Buffer.from('node') }],
  ]);
  return Object.freeze({
    files,
    nodePath,
    packageRoot,
    paths,
    ...createWindowsFilesystem(files),
  });
}

function createWindowsRegistrationFixture() {
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
  return Object.freeze({
    files,
    nodePath,
    packageRoot,
    paths,
    ...createWindowsFilesystem(files),
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SyncNos Native Host registration', () => {
  it('creates all stable Unix browser locations, binds Firefox to the current sidecar, and never creates SQLite', async () => {
    const fixture = await createUnixFixture();
    const locations = getNativeHostRegistrationLocations(fixture.paths);

    expect(locations.map((location) => location.browser)).toEqual([
      'chrome',
      'chrome-beta',
      'chrome-dev',
      'chrome-canary',
      'chrome-for-testing',
      'chromium',
      'edge',
      'edge-beta',
      'edge-dev',
      'brave',
      'vivaldi',
      'iridium',
      'helium',
      'firefox',
      'librewolf',
      'waterfox',
    ]);
    expect(locationByBrowser(locations, 'chrome').manifestPath).toBe(
      join(
        fixture.paths.homeDirectory,
        '.config',
        'google-chrome',
        'NativeMessagingHosts',
        'app.syncnos.localdata.json',
      ),
    );
    expect(locationByBrowser(locations, 'helium').manifestPath).toBe(
      join(
        fixture.paths.homeDirectory,
        '.config',
        'net.imput.helium',
        'NativeMessagingHosts',
        'app.syncnos.localdata.json',
      ),
    );
    expect(locations.every((location) => location.registryViews.length === 0)).toBe(true);

    const registration = await ensureNativeHostRegistrations({
      packageRoot: fixture.packageRoot,
      paths: fixture.paths,
    });
    expect(registration.browsers.map((browser) => browser.browser)).toEqual(
      locations.map((location) => location.browser),
    );
    expect(
      registration.browsers.every(
        (browser) =>
          browser.status === 'registered' && browser.verification === 'registration-written-not-browser-verified',
      ),
    ).toBe(true);

    for (const location of locations) {
      const manifest = JSON.parse(await readFile(location.manifestPath, 'utf8')) as Record<string, unknown>;
      expect(manifest.path).toBe(fixture.paths.launcherPath);
      if (FIREFOX_FAMILY.has(location.browser)) {
        expect(manifest.allowed_extensions).toEqual(['syncnos-webclipper@syncnos.app']);
        expect(manifest).not.toHaveProperty('allowed_origins');
      } else {
        expect(manifest.allowed_origins).toEqual(CHROMIUM_ALLOWED_ORIGINS);
        expect(manifest).not.toHaveProperty('allowed_extensions');
      }
    }
    await expect(Promise.all(locations.map((location) => readFile(location.ownerPath, 'utf8')))).resolves.toHaveLength(
      locations.length,
    );
    await expect(access(fixture.paths.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(
      isOwnedFirefoxNativeHostManifest(locationByBrowser(locations, 'firefox').manifestPath, {
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toBe(true);
    await expect(
      isOwnedFirefoxNativeHostManifest(`${locationByBrowser(locations, 'firefox').manifestPath}.spoofed`, {
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
      browsers: locations.map((location) => ({
        browser: location.browser,
        manifest: 'owned',
        registry: 'not_applicable',
      })),
    });
    await expect(
      isOwnedFirefoxNativeHostManifest(locationByBrowser(locations, 'firefox').manifestPath, {
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

  it('upgrades only provably-owned legacy single-store Chromium manifests to both official store IDs', async () => {
    const fixture = await createUnixFixture();
    await ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    const locations = getNativeHostRegistrationLocations(fixture.paths);

    for (const browser of ['chrome', 'edge'] as const) {
      const location = locationByBrowser(locations, browser);
      const legacyManifest = Buffer.from(
        JSON.stringify({
          name: 'app.syncnos.localdata',
          description: 'SyncNos local data Native Host',
          path: fixture.paths.launcherPath,
          type: 'stdio',
          allowed_origins: [
            browser === 'chrome'
              ? 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/'
              : 'chrome-extension://ijkpghlfmkbjcgafapjcjahaikmnjncl/',
          ],
        }),
        'utf8',
      );
      await writeFile(location.manifestPath, legacyManifest);
      const owner = JSON.parse(await readFile(location.ownerPath, 'utf8')) as Record<string, unknown>;
      owner.manifestDigest = sha256(legacyManifest);
      await writeFile(location.ownerPath, JSON.stringify(owner));
    }

    const before = await inspectNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    expect(before.browsers.find((entry) => entry.browser === 'chrome')?.manifest).toBe('conflict');
    expect(before.browsers.find((entry) => entry.browser === 'edge')?.manifest).toBe('conflict');

    await expect(
      ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({
      browsers: expect.arrayContaining([
        expect.objectContaining({ browser: 'chrome', status: 'registered' }),
        expect.objectContaining({ browser: 'edge', status: 'registered' }),
      ]),
    });

    for (const browser of ['chrome', 'edge'] as const) {
      const location = locationByBrowser(locations, browser);
      expect(JSON.parse(await readFile(location.manifestPath, 'utf8'))).toMatchObject({
        allowed_origins: CHROMIUM_ALLOWED_ORIGINS,
      });
    }
  });

  it('uses the Firefox manifest contract for macOS Tor and the Chromium contract for Arc and Helium', async () => {
    const fixture = await createUnixFixture('darwin');
    await ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    const locations = getNativeHostRegistrationLocations(fixture.paths);
    const tor = locationByBrowser(locations, 'tor-browser');
    const arc = locationByBrowser(locations, 'arc');
    const helium = locationByBrowser(locations, 'helium');

    expect(JSON.parse(await readFile(tor.manifestPath, 'utf8'))).toMatchObject({
      allowed_extensions: ['syncnos-webclipper@syncnos.app'],
    });
    for (const location of [arc, helium]) {
      expect(JSON.parse(await readFile(location.manifestPath, 'utf8'))).toMatchObject({
        allowed_origins: CHROMIUM_ALLOWED_ORIGINS,
      });
    }
    await expect(
      isOwnedFirefoxNativeHostManifest(tor.manifestPath, {
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toBe(true);
  });

  it('preserves a manifest when its versioned sidecar is missing or the pair was modified', async () => {
    const fixture = await createUnixFixture();
    await ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    const firefox = locationByBrowser(getNativeHostRegistrationLocations(fixture.paths), 'firefox');
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
      isOwnedFirefoxNativeHostManifest(
        locationByBrowser(getNativeHostRegistrationLocations(fixture.paths), 'firefox').manifestPath,
        {
          packageRoot: fixture.packageRoot,
          paths: fixture.paths,
        },
      ),
    ).resolves.toBe(false);
  });

  it('keeps macOS registration within the explicit supported Native Messaging locations', () => {
    const paths = resolveSyncNosRuntimePaths({ platform: 'darwin', homeDirectory: '/Users/chii' });
    expect(
      getNativeHostRegistrationLocations(paths).map((location) => [location.browser, location.manifestPath]),
    ).toEqual([
      [
        'chrome',
        '/Users/chii/Library/Application Support/Google/Chrome/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      [
        'chrome-beta',
        '/Users/chii/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      [
        'chrome-dev',
        '/Users/chii/Library/Application Support/Google/Chrome Dev/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      [
        'chrome-canary',
        '/Users/chii/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      [
        'chrome-for-testing',
        '/Users/chii/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      ['chromium', '/Users/chii/Library/Application Support/Chromium/NativeMessagingHosts/app.syncnos.localdata.json'],
      [
        'edge',
        '/Users/chii/Library/Application Support/Microsoft Edge/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      [
        'edge-beta',
        '/Users/chii/Library/Application Support/Microsoft Edge Beta/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      [
        'edge-dev',
        '/Users/chii/Library/Application Support/Microsoft Edge Dev/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      [
        'edge-canary',
        '/Users/chii/Library/Application Support/Microsoft Edge Canary/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      ['vivaldi', '/Users/chii/Library/Application Support/Vivaldi/NativeMessagingHosts/app.syncnos.localdata.json'],
      ['arc', '/Users/chii/Library/Application Support/Arc/User Data/NativeMessagingHosts/app.syncnos.localdata.json'],
      [
        'helium',
        '/Users/chii/Library/Application Support/net.imput.helium/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
      ['firefox', '/Users/chii/Library/Application Support/Mozilla/NativeMessagingHosts/app.syncnos.localdata.json'],
      [
        'tor-browser',
        '/Users/chii/Library/Application Support/TorBrowser-Data/Browser/Mozilla/NativeMessagingHosts/app.syncnos.localdata.json',
      ],
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
    const firefox = locationByBrowser(getNativeHostRegistrationLocations(fixture.paths), 'firefox');
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

  it('recovers an interrupted registration commit at every manifest and owner boundary without touching user data', async () => {
    const browsers: readonly NativeHostBrowser[] = [
      'chrome',
      'chrome-beta',
      'chrome-dev',
      'chrome-canary',
      'chrome-for-testing',
      'chromium',
      'edge',
      'edge-beta',
      'edge-dev',
      'brave',
      'vivaldi',
      'iridium',
      'helium',
      'firefox',
      'librewolf',
      'waterfox',
    ];
    for (const browser of browsers) {
      for (const kind of ['manifest', 'owner'] as const) {
        const fixture = createUnixRegistrationMemoryFixture();
        const locations = getNativeHostRegistrationLocations(fixture.paths);
        const location = locationByBrowser(locations, browser);
        const destination = kind === 'manifest' ? location.manifestPath : location.ownerPath;
        let injected = false;

        await expect(
          ensureNativeHostRegistrations({
            launcherDependencies: fixture.launcherDependencies,
            nodePath: fixture.nodePath,
            packageRoot: fixture.packageRoot,
            paths: fixture.paths,
            registrationDependencies: {
              ...fixture.registrationDependencies,
              rename: async (source, nextDestination) => {
                if (!injected && nextDestination === destination) {
                  injected = true;
                  throw new Error(`injected ${location.browser} ${kind} commit failure`);
                }
                await fixture.registrationDependencies.rename!(source, nextDestination);
              },
            },
          }),
        ).rejects.toMatchObject({ code: 'REGISTRATION_UNAVAILABLE' });
        expect(injected).toBe(true);
        expect(fixture.files.has(fixture.paths.registrationUpdateIntentPath)).toBe(true);

        await expect(
          ensureNativeHostRegistrations({
            launcherDependencies: fixture.launcherDependencies,
            nodePath: fixture.nodePath,
            packageRoot: fixture.packageRoot,
            paths: fixture.paths,
            registrationDependencies: fixture.registrationDependencies,
          }),
        ).resolves.toMatchObject({
          browsers: expect.arrayContaining([expect.objectContaining({ browser: location.browser })]),
        });
        const inspection = await inspectNativeHostRegistrations({
          launcherDependencies: fixture.launcherDependencies,
          packageRoot: fixture.packageRoot,
          paths: fixture.paths,
          registrationDependencies: fixture.registrationDependencies,
        });
        expect(inspection.browsers.map((entry) => entry.browser)).toEqual(locations.map((entry) => entry.browser));
        expect(inspection.browsers.every((entry) => entry.manifest === 'owned')).toBe(true);
        expect(fixture.files.has(fixture.paths.registrationUpdateIntentPath)).toBe(false);
        expect(fixture.files.has(fixture.paths.databasePath)).toBe(false);
      }
    }
  }, 15_000);

  it('refuses to overwrite a final registration file changed after the commit intent was published', async () => {
    const fixture = await createUnixFixture();
    const edge = locationByBrowser(getNativeHostRegistrationLocations(fixture.paths), 'edge');
    let injected = false;
    await expect(
      ensureNativeHostRegistrations({
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
        registrationDependencies: {
          rename: async (source, destination) => {
            if (!injected && destination === edge.manifestPath) {
              injected = true;
              throw new Error('injected edge manifest interruption');
            }
            await rename(source, destination);
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_UNAVAILABLE' });
    await expect(access(fixture.paths.registrationUpdateIntentPath)).resolves.toBeUndefined();

    await writeFile(edge.manifestPath, 'foreign manifest bytes');
    await expect(recoverNativeHostRegistrationUpdate({ paths: fixture.paths })).rejects.toMatchObject({
      code: 'REGISTRATION_CONFLICT',
    });
    await expect(readFile(edge.manifestPath, 'utf8')).resolves.toBe('foreign manifest bytes');
    await expect(access(fixture.paths.registrationUpdateIntentPath)).resolves.toBeUndefined();
  });

  it('rolls back only a proven prepared registration and preserves an untracked .next file', async () => {
    const fixture = await createUnixFixture();
    const edge = locationByBrowser(getNativeHostRegistrationLocations(fixture.paths), 'edge');
    await expect(
      ensureNativeHostRegistrations({
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
        registrationDependencies: {
          writeFile: async (path, contents, options) => {
            if (path === `${edge.ownerPath}.next`) throw new Error('injected registration staging failure');
            await writeFile(path, contents, options);
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_UNAVAILABLE' });
    await expect(access(fixture.paths.registrationUpdateIntentTemporaryPath)).resolves.toBeUndefined();
    await expect(recoverNativeHostRegistrationUpdate({ paths: fixture.paths })).resolves.toBe(true);

    for (const location of getNativeHostRegistrationLocations(fixture.paths)) {
      await expect(access(location.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(location.ownerPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(`${location.manifestPath}.next`)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(`${location.ownerPath}.next`)).rejects.toMatchObject({ code: 'ENOENT' });
    }

    const chrome = locationByBrowser(getNativeHostRegistrationLocations(fixture.paths), 'chrome');
    await mkdir(join(chrome.manifestPath, '..'), { recursive: true });
    await writeFile(`${chrome.manifestPath}.next`, 'unknown registration bytes');
    await expect(recoverNativeHostRegistrationUpdate({ paths: fixture.paths })).rejects.toMatchObject({
      code: 'REGISTRATION_CONFLICT',
    });
    await expect(readFile(`${chrome.manifestPath}.next`, 'utf8')).resolves.toBe('unknown registration bytes');
  });

  it('upgrades provably-owned stale registration sidecars after a launcher-only generation completed', async () => {
    const fixture = await createUnixFixture();
    await ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths });
    await writeFile(join(fixture.packageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 9;');
    await ensureNativeHostLauncher({ packageRoot: fixture.packageRoot, paths: fixture.paths });

    const staleInspection = await inspectNativeHostRegistrations({
      packageRoot: fixture.packageRoot,
      paths: fixture.paths,
    });
    expect(staleInspection.browsers.every((entry) => entry.manifest === 'conflict')).toBe(true);
    await expect(
      ensureNativeHostRegistrations({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({ browsers: expect.arrayContaining([expect.objectContaining({ browser: 'firefox' })]) });
    const currentInspection = await inspectNativeHostRegistrations({
      packageRoot: fixture.packageRoot,
      paths: fixture.paths,
    });
    expect(currentInspection.packageEntrypoint).toBe('current');
    expect(currentInspection.browsers.every((entry) => entry.manifest === 'owned')).toBe(true);
  });

  it('uses the supported browser registry keys across both Windows views and keeps manifests distinct', async () => {
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
    expect(locations.map((location) => location.browser)).toEqual(['chrome', 'chromium', 'edge', 'firefox']);
    expect(locations.every((location) => location.registryViews.join(',') === '32,64')).toBe(true);
    expect(values).toHaveLength(16);
    for (const location of locations) {
      for (const view of location.registryViews) {
        const registryProduct =
          location.browser === 'chrome'
            ? 'Google\\Chrome'
            : location.browser === 'chromium'
              ? 'Chromium'
              : location.browser === 'edge'
                ? 'Microsoft\\Edge'
                : 'Mozilla';
        const key = `HKCU\\Software\\${registryProduct}\\NativeMessagingHosts\\app.syncnos.localdata`;
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

  it('recovers every Windows registry value interruption and refuses an unknown target value', async () => {
    const createRegistry = (
      values: Map<string, string>,
      failureAt: number | null,
    ): Readonly<{ registry: WindowsRegistryAdapter; writes: () => number }> => {
      let writeCount = 0;
      let injected = false;
      const keyFor = (view: string, key: string, valueName: string | null) =>
        `${view}:${key}:${valueName ?? '(Default)'}`;
      return Object.freeze({
        writes: () => writeCount,
        registry: {
          readKey: async ({ key, view }) => ({
            state: [...values.keys()].some((entry) => entry.startsWith(`${view}:${key}:`)) ? 'present' : 'absent',
          }),
          readValue: async ({ key, valueName, view }) => {
            const value = values.get(keyFor(view, key, valueName));
            return value === undefined ? { state: 'absent' } : { state: 'present', value };
          },
          writeValue: async ({ key, value, valueName, view }) => {
            writeCount += 1;
            if (!injected && failureAt !== null && writeCount === failureAt) {
              injected = true;
              throw new Error(`injected registry write ${failureAt}`);
            }
            values.set(keyFor(view, key, valueName), value);
          },
          deleteValue: async ({ key, valueName, view }) => values.delete(keyFor(view, key, valueName)),
        },
      });
    };

    for (let failureAt = 1; failureAt <= 16; failureAt += 1) {
      const fixture = createWindowsRegistrationFixture();
      const values = new Map<string, string>();
      const injected = createRegistry(values, failureAt);
      const registrationDependencies = {
        ...fixture.registrationDependencies,
        windowsRegistry: injected.registry,
      };
      await expect(
        ensureNativeHostRegistrations({
          arch: 'x64',
          launcherDependencies: fixture.launcherDependencies,
          nodePath: fixture.nodePath,
          packageRoot: fixture.packageRoot,
          paths: fixture.paths,
          registrationDependencies,
        }),
      ).rejects.toThrow(`injected registry write ${failureAt}`);
      expect(injected.writes()).toBe(failureAt);
      expect(fixture.files.has(fixture.paths.registrationUpdateIntentPath)).toBe(true);

      await expect(
        ensureNativeHostRegistrations({
          arch: 'x64',
          launcherDependencies: fixture.launcherDependencies,
          nodePath: fixture.nodePath,
          packageRoot: fixture.packageRoot,
          paths: fixture.paths,
          registrationDependencies,
        }),
      ).resolves.toMatchObject({ browsers: expect.arrayContaining([expect.objectContaining({ browser: 'firefox' })]) });
      expect(fixture.files.has(fixture.paths.registrationUpdateIntentPath)).toBe(false);
      expect(values.size).toBe(16);
    }

    const tampered = createWindowsRegistrationFixture();
    const values = new Map<string, string>();
    const injected = createRegistry(values, 2);
    const registrationDependencies = {
      ...tampered.registrationDependencies,
      windowsRegistry: injected.registry,
    };
    await expect(
      ensureNativeHostRegistrations({
        arch: 'x64',
        launcherDependencies: tampered.launcherDependencies,
        nodePath: tampered.nodePath,
        packageRoot: tampered.packageRoot,
        paths: tampered.paths,
        registrationDependencies,
      }),
    ).rejects.toThrow('injected registry write 2');
    const chromeKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.syncnos.localdata';
    const ownerTarget = `32:${chromeKey}:${SYNCNOSCLI_WINDOWS_REGISTRY_OWNER_VALUE}`;
    values.set(ownerTarget, 'foreign-owner');
    await expect(
      recoverNativeHostRegistrationUpdate({ paths: tampered.paths, registrationDependencies }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_CONFLICT' });
    expect(values.get(ownerTarget)).toBe('foreign-owner');
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
