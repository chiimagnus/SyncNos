import { access, mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getNativeHostRegistrationLocations,
  inspectNativeHostRegistrations,
} from '../../packages/syncnoscli/src/install/host-registration';
import {
  inspectGlobalCliInstall,
  inspectGlobalCliLifecycle,
  runLifecycle,
} from '../../packages/syncnoscli/src/install/lifecycle';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const temporaryRoots: string[] = [];
const REGISTRY_RESOLUTION = 'https://registry.npmjs.org/@chiimagnus/syncnoscli/-/syncnoscli-0.1.0.tgz';

async function createGlobalPackageFixture(): Promise<{
  packageRoot: string;
  paths: ReturnType<typeof resolveSyncNosRuntimePaths>;
  prefix: string;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'syncnoscli-lifecycle-'));
  temporaryRoots.push(root);
  const prefix = join(root, 'prefix');
  const packageRoot = join(prefix, 'lib', 'node_modules', '@chiimagnus', 'syncnoscli');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), '{"name":"@chiimagnus/syncnoscli","version":"0.1.0"}');
  await mkdir(join(root, 'home'));
  return {
    packageRoot,
    paths: resolveSyncNosRuntimePaths({ platform: 'linux', homeDirectory: join(root, 'home') }),
    prefix,
    root,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('SyncNos CLI npm lifecycle', () => {
  it('accepts only the non-link scoped npm global layout and the real global lifecycle flag for postinstall', async () => {
    const fixture = await createGlobalPackageFixture();
    const canonicalPackageRoot = await realpath(fixture.packageRoot);
    await expect(
      inspectGlobalCliLifecycle({
        environment: { npm_config_global: 'true', npm_config_prefix: fixture.prefix },
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toMatchObject({ packageRoot: canonicalPackageRoot, reason: 'global-layout' });
    await expect(
      inspectGlobalCliInstall({ packageRoot: fixture.packageRoot, paths: fixture.paths }),
    ).resolves.toMatchObject({ packageRoot: canonicalPackageRoot, reason: 'global-layout' });
    await expect(
      inspectGlobalCliLifecycle({
        environment: {
          npm_config_global: 'true',
          npm_config_prefix: fixture.prefix,
          npm_package_resolved: 'file:/tmp/syncnoscli-0.1.0.tgz',
        },
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
        requireRegistrySource: true,
      }),
    ).resolves.toEqual({ packageRoot: null, reason: 'package-source-invalid' });
    await expect(
      inspectGlobalCliLifecycle({
        environment: { npm_config_prefix: fixture.prefix },
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ packageRoot: null, reason: 'global-flag-missing' });

    const localAlias = join(fixture.root, 'local-alias');
    await symlink(fixture.packageRoot, localAlias, 'dir');
    await expect(
      inspectGlobalCliLifecycle({
        environment: { npm_config_global: 'true', npm_config_prefix: fixture.prefix },
        packageRoot: localAlias,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ packageRoot: null, reason: 'package-path-invalid' });
    await expect(inspectGlobalCliInstall({ packageRoot: localAlias, paths: fixture.paths })).resolves.toEqual({
      packageRoot: null,
      reason: 'package-path-invalid',
    });

    const linkedRoot = join(fixture.root, 'linked-package');
    await mkdir(linkedRoot);
    await writeFile(join(linkedRoot, 'package.json'), '{"name":"@chiimagnus/syncnoscli","version":"0.1.0"}');
    await rm(fixture.packageRoot, { force: true, recursive: true });
    await symlink(linkedRoot, fixture.packageRoot, 'dir');
    await expect(
      inspectGlobalCliLifecycle({
        environment: { npm_config_global: 'true', npm_config_prefix: fixture.prefix },
        packageRoot: linkedRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ packageRoot: null, reason: 'package-path-invalid' });
    await expect(inspectGlobalCliInstall({ packageRoot: linkedRoot, paths: fixture.paths })).resolves.toEqual({
      packageRoot: null,
      reason: 'package-path-invalid',
    });
  });

  it('does not mutate local/workspace-like installs even with a spoofed npm global environment', async () => {
    const fixture = await createGlobalPackageFixture();
    const localRoot = join(fixture.root, 'workspace', 'syncnoscli');
    await mkdir(localRoot, { recursive: true });
    await writeFile(join(localRoot, 'package.json'), '{"name":"@chiimagnus/syncnoscli","version":"0.1.0"}');
    const ensureRegistrations = vi.fn(async () => undefined);
    const removeRegistrations = vi.fn(async () => ({ canRemoveLauncher: true, conflicts: [] as string[] }));
    const removeLauncher = vi.fn(async () => ({ removed: true }));

    await expect(
      runLifecycle('postinstall', {
        dependencies: { ensureRegistrations },
        environment: {
          npm_config_global: 'true',
          npm_config_prefix: fixture.prefix,
          npm_package_resolved: REGISTRY_RESOLUTION,
        },
        packageRoot: localRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'postinstall', status: 'noop' });
    expect(ensureRegistrations).not.toHaveBeenCalled();

    await expect(
      runLifecycle('unregister', {
        dependencies: { removeLauncher, removeRegistrations },
        environment: {},
        packageRoot: localRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'unregister', status: 'noop' });
    expect(removeRegistrations).not.toHaveBeenCalled();
    expect(removeLauncher).not.toHaveBeenCalled();

    await expect(
      runLifecycle('postinstall', {
        dependencies: { ensureRegistrations },
        environment: {
          npm_config_global: 'true',
          npm_config_prefix: fixture.prefix,
          npm_package_resolved: 'file:/tmp/syncnoscli-0.1.0.tgz',
        },
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'postinstall', status: 'noop' });
    expect(ensureRegistrations).not.toHaveBeenCalled();
  });

  it('registers only after the global proof and explicitly unregisters proven global ownership without requiring the global flag', async () => {
    const fixture = await createGlobalPackageFixture();
    const canonicalPackageRoot = await realpath(fixture.packageRoot);
    const ensureRegistrations = vi.fn(async () => undefined);
    const removeRegistrations = vi.fn(async () => ({ canRemoveLauncher: true, conflicts: [] as string[] }));
    const removeLauncher = vi.fn(async () => ({ removed: true }));

    await expect(
      runLifecycle('postinstall', {
        dependencies: { ensureRegistrations },
        environment: {
          npm_config_global: 'true',
          npm_config_prefix: fixture.prefix,
          npm_package_resolved: REGISTRY_RESOLUTION,
        },
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'postinstall', status: 'completed' });
    expect(ensureRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ packageRoot: canonicalPackageRoot, paths: fixture.paths }),
    );

    await expect(
      runLifecycle('unregister', {
        dependencies: { removeLauncher, removeRegistrations },
        environment: {},
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'unregister', status: 'completed' });
    expect(removeRegistrations).toHaveBeenCalledWith(
      expect.objectContaining({ packageRoot: canonicalPackageRoot, paths: fixture.paths }),
    );
    expect(removeLauncher).toHaveBeenCalledWith({ paths: fixture.paths });
  });

  it('postinstall and unregister recover a proven interrupted registration generation through the real lifecycle path', async () => {
    const fixture = await createGlobalPackageFixture();
    await mkdir(join(fixture.packageRoot, 'dist'));
    await writeFile(join(fixture.packageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 0;');
    const environment = {
      npm_config_global: 'true',
      npm_config_prefix: fixture.prefix,
      npm_package_resolved: REGISTRY_RESOLUTION,
    };

    await expect(
      runLifecycle('postinstall', {
        environment,
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'postinstall', status: 'completed' });
    await writeFile(join(fixture.packageRoot, 'dist', 'native-host.cjs'), 'process.exitCode = 9;');
    const edgeOwner = getNativeHostRegistrationLocations(fixture.paths).find(
      (location) => location.browser === 'edge',
    )!.ownerPath;
    let injected = false;
    const writeDiagnostic = vi.fn();
    await expect(
      runLifecycle('postinstall', {
        dependencies: { writeDiagnostic },
        environment,
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
        registrationDependencies: {
          rename: async (source, destination) => {
            if (!injected && destination === edgeOwner) {
              injected = true;
              throw new Error('injected lifecycle registration interruption');
            }
            await rename(source, destination);
          },
        },
      }),
    ).resolves.toEqual({ action: 'postinstall', status: 'completed' });
    expect(writeDiagnostic).toHaveBeenCalledWith(
      'SyncNos CLI installed, but Native Host registration needs doctor --fix.',
    );
    await expect(access(fixture.paths.registrationUpdateIntentPath)).resolves.toBeUndefined();

    await expect(
      runLifecycle('postinstall', {
        environment,
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'postinstall', status: 'completed' });
    const inspection = await inspectNativeHostRegistrations({
      packageRoot: fixture.packageRoot,
      paths: fixture.paths,
    });
    const locations = getNativeHostRegistrationLocations(fixture.paths);
    expect(inspection.packageEntrypoint).toBe('current');
    expect(inspection.browsers.map((entry) => entry.browser)).toEqual(locations.map((location) => location.browser));
    expect(inspection.browsers.every((entry) => entry.manifest === 'owned')).toBe(true);
    await expect(access(fixture.paths.registrationUpdateIntentPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(
      runLifecycle('unregister', {
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'unregister', status: 'completed' });
    for (const location of getNativeHostRegistrationLocations(fixture.paths)) {
      await expect(access(location.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(location.ownerPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(access(fixture.paths.launcherPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves launcher and database cleanup alone when an owned registration cannot be proven', async () => {
    const fixture = await createGlobalPackageFixture();
    const removeLauncher = vi.fn(async () => ({ removed: true }));
    const writeDiagnostic = vi.fn();

    await expect(
      runLifecycle('unregister', {
        dependencies: {
          removeLauncher,
          removeRegistrations: async () => ({ canRemoveLauncher: false, conflicts: ['firefox-manifest'] }),
          writeDiagnostic,
        },
        environment: {},
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'unregister', status: 'completed' });
    expect(removeLauncher).not.toHaveBeenCalled();
    expect(writeDiagnostic).toHaveBeenCalledWith('SyncNos CLI left an unverified Native Host registration untouched.');

    await expect(
      runLifecycle('unregister', {
        dependencies: {
          removeLauncher,
          removeRegistrations: async () => ({ canRemoveLauncher: false, conflicts: [] }),
          writeDiagnostic,
        },
        environment: {},
        packageRoot: fixture.packageRoot,
        paths: fixture.paths,
      }),
    ).resolves.toEqual({ action: 'unregister', status: 'completed' });
    expect(removeLauncher).not.toHaveBeenCalled();
    expect(writeDiagnostic).toHaveBeenCalledWith(
      'SyncNos CLI left its launcher untouched because a complete registration could not be proven.',
    );
  });

  it('does not pretend npm can run a preuninstall lifecycle hook', async () => {
    await expect(runLifecycle('preuninstall')).resolves.toEqual({ action: 'unsupported', status: 'noop' });
  });
});
