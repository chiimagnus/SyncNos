import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const packageRoot = resolve(repoRoot, 'packages/syncnoscli');
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as Record<string, any>;
const rootPackageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as Record<string, any>;

describe('SyncNos CLI package contract', () => {
  it('keeps the published package narrow and pins its SQLite runtime', () => {
    expect(packageJson.name).toBe('@chiimagnus/syncnoscli');
    expect(packageJson.engines).toEqual({ node: '>=22' });
    expect(packageJson.bin).toEqual({ syncnoscli: 'dist/cli.cjs' });
    expect(packageJson.dependencies).toEqual({ 'better-sqlite3': '13.0.3' });
    expect(packageJson.files).toEqual(['dist/**', 'prebuilds/**', 'README.md']);
    expect(packageJson.files).not.toContain('src/**');
    expect(rootPackageJson.private).toBe(true);
    expect(rootPackageJson.workspaces).toEqual(['packages/*']);
  });

  it('builds a standalone help/version entry without source paths', () => {
    const binary = resolve(packageRoot, 'dist/cli.cjs');
    expect(existsSync(binary)).toBe(true);
    const built = readFileSync(binary, 'utf8');
    expect(built).not.toContain('../../src');

    expect(execFileSync(process.execPath, [binary, '--help'], { encoding: 'utf8' })).toContain('SyncNos CLI');
    expect(execFileSync(process.execPath, [binary, '--version'], { encoding: 'utf8' }).trim()).toBe(packageJson.version);
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
    expect(files).toContain('README.md');
    expect(files.some((file) => file.startsWith('src/') || file.startsWith('tests/'))).toBe(false);
    expect(files.some((file) => /(^|\/)([^/]*\.(?:sqlite|db)|\.env)$/i.test(file))).toBe(false);
  });
});
