import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertReleaseCoreMatchesWxt,
  packageCli,
  prepareCliPackage,
  readWxtManifestVersion,
  resolveCliPackageVersion,
  semverCore,
} from '../../cli/package.mjs';
import { assertReleaseOrder, parseReleaseTag } from '../../scripts/cli-release.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

async function tempDir(prefix: string) {
  return await mkdtemp(join(tmpdir(), prefix));
}

describe('CLI package staging', () => {
  it('uses WXT manifest.version as the local fallback and never root package version', async () => {
    const wxtVersion = await readWxtManifestVersion({ repoRoot: REPO_ROOT });
    const wxtSource = await readFile(join(REPO_ROOT, 'wxt.config.ts'), 'utf8');
    const sourceVersion = wxtSource.match(/\bversion:\s*['"]([^'"]+)['"]/)?.[1];
    expect(wxtVersion).toBe(sourceVersion);
    expect(resolveCliPackageVersion({ explicitVersion: null, wxtVersion })).toBe(wxtVersion);
    const rootPackage = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(rootPackage.version).toBe('2003.08.20');
    expect(wxtVersion).not.toBe(rootPackage.version);

    const localStage = await prepareCliPackage({
      repoRoot: REPO_ROOT,
      stagingDir: join(await tempDir('syncnos-cli-local-stage-'), 'package'),
    });
    expect(localStage.packageVersion).toBe(wxtVersion);
  });

  it('validates release core independently from packaging prerelease versions', async () => {
    const wxtVersion = await readWxtManifestVersion({ repoRoot: REPO_ROOT });
    const wxtCore = semverCore(wxtVersion);
    const [major, minor, patch] = wxtCore.split('.').map(Number);
    const matchingPrerelease = `${wxtCore}-rc1`;
    const mismatchingPrerelease = `${major}.${minor}.${patch + 1}-rc1`;

    expect(assertReleaseCoreMatchesWxt(matchingPrerelease, wxtVersion)).toBe(true);
    expect(() => assertReleaseCoreMatchesWxt(mismatchingPrerelease, wxtVersion)).toThrow(/does not match/);
    expect(resolveCliPackageVersion({ explicitVersion: mismatchingPrerelease, wxtVersion })).toBe(
      mismatchingPrerelease,
    );
    expect(() => resolveCliPackageVersion({ explicitVersion: `v${wxtCore}`, wxtVersion })).toThrow(
      /Invalid npm semver/,
    );

    await expect(
      packageCli({
        repoRoot: REPO_ROOT,
        stagingDir: join(await tempDir('syncnos-cli-release-mismatch-'), 'package'),
        version: mismatchingPrerelease,
        checkOnly: true,
        requireWxtCoreMatch: true,
      }),
    ).rejects.toMatchObject({ code: 'release_version_mismatch' });

    await expect(
      packageCli({
        repoRoot: REPO_ROOT,
        stagingDir: join(await tempDir('syncnos-cli-release-match-'), 'package'),
        version: matchingPrerelease,
        checkOnly: true,
        requireWxtCoreMatch: true,
      }),
    ).resolves.toMatchObject({ packageVersion: matchingPrerelease, wxtVersion });
  });

  it('maps release tags to npm channels and rejects release-order regressions', () => {
    expect(parseReleaseTag('v1.15.0')).toMatchObject({
      version: '1.15.0',
      channel: 'stable',
      npmDistTag: 'latest',
      githubPrerelease: false,
    });
    expect(parseReleaseTag('v1.16.0-beta.2')).toMatchObject({
      version: '1.16.0-beta.2',
      channel: 'beta',
      npmDistTag: 'beta',
      githubPrerelease: true,
    });
    expect(assertReleaseOrder('1.16.0-rc1', { latest: '1.15.0', beta: '1.16.0-beta.4' })).toBe(true);
    expect(() => assertReleaseOrder('1.16.0-beta.5', { rc: '1.16.0-rc1' })).toThrow(/must be newer/);
    expect(() => parseReleaseTag('v1.16.0-dev1')).toThrow(/unsupported release version/);
  });

  it('publishes npm from the canonical tag release workflow before creating GitHub Release', async () => {
    const source = await readFile(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(source).toMatch(
      /uses: actions\/checkout@v6\s+with:\s+ref: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref \}\}/,
    );
    expect(source).toContain('id-token: write');
    expect(source).toContain('uses: actions/setup-node@v6');
    expect(source).toContain("node-version: '24'");
    expect(source).toContain("registry-url: 'https://registry.npmjs.org'");
    expect(source).toContain('package-manager-cache: false');
    expect(source).toContain('name: Publish SyncNos CLI to npm');
    expect(source).toContain('npm publish "$cli_tgz" --access public --tag "$NPM_DIST_TAG"');
    expect(source).toContain('name: Verify npm publication');
    expect(source).toContain('npm_already_published=true');
    expect(source).not.toContain('NPM_TOKEN');
    expect(source.indexOf('name: Smoke install packaged SyncNos CLI')).toBeLessThan(
      source.indexOf('name: Publish SyncNos CLI to npm'),
    );
    expect(source.indexOf('name: Publish SyncNos CLI to npm')).toBeLessThan(
      source.indexOf('name: Verify npm publication'),
    );
    expect(source.indexOf('name: Verify npm publication')).toBeLessThan(
      source.indexOf('name: Publish stable GitHub Release'),
    );
  });

  it('copies the canonical RPC contract byte-for-byte into an isolated staging package', async () => {
    const stagingDir = join(await tempDir('syncnos-cli-stage-'), 'package');
    const prepared = await prepareCliPackage({ repoRoot: REPO_ROOT, stagingDir, version: '1.13.3-rc1' });
    expect(prepared.packageVersion).toBe('1.13.3-rc1');
    const [
      canonical,
      staged,
      packageJson,
      stagedLicense,
      sourceLicense,
      stagedReadme,
      sourceReadme,
      stagedReadmeZh,
      sourceReadmeZh,
    ] = await Promise.all([
      readFile(prepared.canonicalContractPath),
      readFile(prepared.stagedContractPath),
      readFile(prepared.packageJsonPath, 'utf8').then(JSON.parse),
      readFile(join(prepared.stagingDir, 'LICENSE')),
      readFile(join(REPO_ROOT, 'LICENSE.APGLv3')),
      readFile(join(prepared.stagingDir, 'README.md')),
      readFile(join(REPO_ROOT, 'README.md')),
      readFile(join(prepared.stagingDir, 'README.zh-CN.md')),
      readFile(join(REPO_ROOT, 'README.zh-CN.md')),
    ]);
    expect(staged.equals(canonical)).toBe(true);
    expect(stagedLicense.equals(sourceLicense)).toBe(true);
    expect(stagedReadme.equals(sourceReadme)).toBe(true);
    expect(stagedReadmeZh.equals(sourceReadmeZh)).toBe(true);
    expect(packageJson).toMatchObject({
      name: '@chiimagnus/syncnos',
      version: '1.13.3-rc1',
      license: 'AGPL-3.0-only',
      repository: { type: 'git', url: 'https://github.com/chiimagnus/SyncNos.git' },
      publishConfig: { access: 'public' },
      bin: { syncnos: './syncnos.mjs' },
      dependencies: {},
    });
    expect(packageJson.private).toBeUndefined();
  });

  it('npm-packs, installs globally into a temp prefix, and runs packaged help/capabilities/doctor', async () => {
    const workspace = await tempDir('syncnos-cli-pack-');
    const stagingDir = join(workspace, 'staging');
    const outDir = join(workspace, 'out');
    const prefix = join(workspace, 'prefix');
    const homeDir = join(workspace, 'home');
    const runtimeRoot = join(workspace, 'tmp');
    await Promise.all([mkdir(homeDir, { recursive: true }), mkdir(runtimeRoot, { recursive: true })]);
    const packed = await packageCli({
      repoRoot: REPO_ROOT,
      stagingDir,
      outDir,
      version: '1.13.3-rc1',
    });
    expect(packed.tarballPath).toBe(join(outDir, 'chiimagnus-syncnos-1.13.3-rc1.tgz'));

    execFileSync('npm', ['install', '-g', packed.tarballPath!, '--prefix', prefix, '--ignore-scripts'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const binPath = process.platform === 'win32' ? join(prefix, 'syncnos.cmd') : join(prefix, 'bin', 'syncnos');
    const env = { ...process.env, HOME: homeDir, TMPDIR: runtimeRoot };
    const help = execFileSync(binPath, ['--help'], { encoding: 'utf8', env });
    expect(help).toContain('Usage: syncnos');

    const capabilities = JSON.parse(execFileSync(binPath, ['capabilities'], { encoding: 'utf8', env }));
    expect(capabilities.ok).toBe(true);
    expect(capabilities.data.protocolVersion).toBe(1);

    const status = spawnSync(binPath, ['status'], { encoding: 'utf8', env });
    expect(status.status).toBe(4);
    expect(JSON.parse(status.stdout)).toMatchObject({
      ok: false,
      error: { code: 'extension_unreachable' },
    });

    const doctor = JSON.parse(execFileSync(binPath, ['doctor'], { encoding: 'utf8', env }));
    expect(doctor.ok).toBe(true);

    const installedPackageDir = join(prefix, 'lib', 'node_modules', '@chiimagnus', 'syncnos');
    const [installedContract, canonicalContract, installedPackage, installedReadme, installedReadmeZh] =
      await Promise.all([
        readFile(join(installedPackageDir, 'cli-rpc-contract.json')),
        readFile(join(REPO_ROOT, 'src/services/protocols/cli-rpc-contract.json')),
        readFile(join(installedPackageDir, 'package.json'), 'utf8').then(JSON.parse),
        readFile(join(installedPackageDir, 'README.md')),
        readFile(join(installedPackageDir, 'README.zh-CN.md')),
      ]);
    expect(installedContract.equals(canonicalContract)).toBe(true);
    expect(installedReadme.equals(await readFile(join(REPO_ROOT, 'README.md')))).toBe(true);
    expect(installedReadmeZh.equals(await readFile(join(REPO_ROOT, 'README.zh-CN.md')))).toBe(true);
    expect(installedPackage.version).toBe('1.13.3-rc1');
    expect(installedPackage.version).not.toBe('2003.08.20');
  });
});
