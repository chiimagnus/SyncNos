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
} from '../../cli/package.mjs';

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

  it('validates release core independently from packaging prerelease versions', () => {
    expect(assertReleaseCoreMatchesWxt('1.13.2-rc1', '1.13.2')).toBe(true);
    expect(() => assertReleaseCoreMatchesWxt('1.13.3-rc1', '1.13.2')).toThrow(/does not match/);
    expect(resolveCliPackageVersion({ explicitVersion: '1.13.3-rc1', wxtVersion: '1.13.2' })).toBe('1.13.3-rc1');
    expect(() => resolveCliPackageVersion({ explicitVersion: 'v1.13.2', wxtVersion: '1.13.2' })).toThrow(
      /Invalid npm semver/,
    );
  });

  it('copies the canonical RPC contract byte-for-byte into an isolated staging package', async () => {
    const stagingDir = join(await tempDir('syncnos-cli-stage-'), 'package');
    const prepared = await prepareCliPackage({ repoRoot: REPO_ROOT, stagingDir, version: '1.13.3-rc1' });
    expect(prepared.packageVersion).toBe('1.13.3-rc1');
    const [canonical, staged, packageJson] = await Promise.all([
      readFile(prepared.canonicalContractPath),
      readFile(prepared.stagedContractPath),
      readFile(prepared.packageJsonPath, 'utf8').then(JSON.parse),
    ]);
    expect(staged.equals(canonical)).toBe(true);
    expect(packageJson).toMatchObject({
      name: 'syncnos-cli',
      version: '1.13.3-rc1',
      private: true,
      bin: { syncnos: './syncnos.mjs' },
      dependencies: {},
    });
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
    expect(packed.tarballPath).toBe(join(outDir, 'syncnos-cli-1.13.3-rc1.tgz'));

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

    const installedPackageDir = join(prefix, 'lib', 'node_modules', 'syncnos-cli');
    const [installedContract, canonicalContract, installedPackage] = await Promise.all([
      readFile(join(installedPackageDir, 'cli-rpc-contract.json')),
      readFile(join(REPO_ROOT, 'src/services/protocols/cli-rpc-contract.json')),
      readFile(join(installedPackageDir, 'package.json'), 'utf8').then(JSON.parse),
    ]);
    expect(installedContract.equals(canonicalContract)).toBe(true);
    expect(installedPackage.version).toBe('1.13.3-rc1');
    expect(installedPackage.version).not.toBe('2003.08.20');
  });
});
