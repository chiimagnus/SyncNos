import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LOCAL_DATA_PROTOCOL_VERSION } from '@services/local-data/contracts';

const repoRoot = resolve(__dirname, '../..');
const packageRoot = resolve(repoRoot, 'packages/syncnoscli');
const sqlitePackageRoot = resolve(repoRoot, 'node_modules/better-sqlite3');
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as Record<string, any>;
const rootPackageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as Record<string, any>;
const publishReadinessScript = resolve(repoRoot, '.github/scripts/syncnoscli/check-publish-readiness.mjs');

const SQLITE_PREBUILD_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'linuxmusl-arm64',
  'linuxmusl-x64',
  'win32-arm64',
  'win32-x64',
] as const;

describe('SyncNos CLI package contract', () => {
  it('keeps the published package narrow and pins its SQLite runtime', () => {
    expect(packageJson.name).toBe('@chiimagnus/syncnoscli');
    expect(packageJson.engines).toEqual({ node: '>=22' });
    expect(packageJson.bin).toEqual({ syncnoscli: 'dist/cli.cjs' });
    expect(packageJson.dependencies).toEqual({ 'better-sqlite3': '13.0.3' });
    expect(packageJson.files).toEqual(['dist/**', 'prebuilds/**', 'README.md', 'README.zh-CN.md']);
    expect(packageJson.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/chiimagnus/SyncNos.git',
    });
    expect(packageJson.publishConfig).toEqual({
      access: 'public',
      provenance: true,
      registry: 'https://registry.npmjs.org/',
      tag: 'latest',
    });
    expect(packageJson.files).not.toContain('src/**');
    expect(packageJson.scripts).toMatchObject({
      postinstall: expect.stringContaining('dist/lifecycle.cjs'),
      prepack: 'node build.mjs',
      unregister: 'node dist/lifecycle.cjs unregister',
    });
    expect(packageJson.scripts).not.toHaveProperty('preuninstall');
    expect(rootPackageJson.private).toBe(true);
    expect(rootPackageJson.workspaces).toEqual(['packages/*']);
  });

  it('keeps offline publish readiness exact and fail-closed for version/confirmation mismatches', () => {
    const expectedConfirmation = `PUBLISH ${packageJson.name}@${packageJson.version}`;
    const accepted = execFileSync(
      process.execPath,
      [
        publishReadinessScript,
        '--offline',
        `--expected-version=${packageJson.version}`,
        `--confirmation=${expectedConfirmation}`,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(accepted).toContain(`ready ${packageJson.name}@${packageJson.version}`);

    for (const argv of [
      ['--offline', '--expected-version=999.999.999'],
      ['--offline', `--expected-version=${packageJson.version}`, '--confirmation=PUBLISH wrong@0.0.0'],
    ]) {
      const rejected = spawnSync(process.execPath, [publishReadinessScript, ...argv], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      expect(rejected.status).not.toBe(0);
      expect(`${rejected.stdout}${rejected.stderr}`).not.toMatch(/token|credential|auth/i);
    }

    const source = readFileSync(publishReadinessScript, 'utf8');
    expect(source).not.toMatch(/fetch\(|https\.request|NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
  });

  it('builds a standalone help/version entry without source paths', () => {
    const binary = resolve(packageRoot, 'dist/cli.cjs');
    expect(existsSync(binary)).toBe(true);
    const built = readFileSync(binary, 'utf8');
    expect(built).not.toContain('../../src');

    const help = execFileSync(process.execPath, [binary, '--help'], { encoding: 'utf8' });
    expect(help).toContain('SyncNos CLI');
    expect(help).toContain(`Protocol envelope: v${LOCAL_DATA_PROTOCOL_VERSION}`);
    expect(execFileSync(process.execPath, [binary, '--version'], { encoding: 'utf8' }).trim()).toBe(
      packageJson.version,
    );
  });

  it('uses bundled SQLite prebuilds without an install-time source build', () => {
    const sqlitePackagePath = resolve(sqlitePackageRoot, 'package.json');
    expect(existsSync(sqlitePackagePath)).toBe(true);

    const sqlitePackage = JSON.parse(readFileSync(sqlitePackagePath, 'utf8')) as Record<string, any>;
    expect(sqlitePackage.version).toBe('13.0.3');
    expect(sqlitePackage.gypfile).toBe(false);
    expect(sqlitePackage.scripts ?? {}).not.toHaveProperty('preinstall');
    expect(sqlitePackage.scripts ?? {}).not.toHaveProperty('install');
    expect(sqlitePackage.scripts ?? {}).not.toHaveProperty('postinstall');
    for (const target of SQLITE_PREBUILD_TARGETS) {
      expect(existsSync(resolve(sqlitePackageRoot, 'prebuilds', `${target}.node`))).toBe(true);
    }
  });

  it('packs no source, tests, SQLite files, or credentials', () => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const output = execFileSync(npmCommand, ['pack', '--workspace=@chiimagnus/syncnoscli', '--dry-run', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const packed = JSON.parse(output) as Array<{ files?: Array<{ path?: string }> }>;
    const files = packed[0]?.files?.map((file) => String(file.path || '')) || [];

    expect(files).toContain('dist/cli.cjs');
    expect(files).toContain('dist/lifecycle.cjs');
    expect(files).toContain('README.md');
    expect(files).toContain('README.zh-CN.md');
    expect(files.some((file) => file.startsWith('src/') || file.startsWith('tests/'))).toBe(false);
    expect(files.some((file) => /(^|\/)([^/]*\.(?:sqlite|db)|\.env)$/i.test(file))).toBe(false);
  });
});
