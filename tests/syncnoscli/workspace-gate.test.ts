import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

const workspaceWorkflows = [
  'webclipper-ci.yml',
  'webclipper-release.yml',
  'webclipper-prerelease.yml',
  'webclipper-cws-publish.yml',
  'webclipper-edge-publish.yml',
  'webclipper-amo-publish.yml',
];

function readWorkflow(name: string): string {
  return readFileSync(resolve(repoRoot, '.github/workflows', name), 'utf8');
}

describe('SyncNos CLI workspace gate', () => {
  it('runs the CLI checks inside the protected root gate', () => {
    const gate = packageJson.scripts?.['gate:ci'] || '';
    expect(gate).toContain('npm run compile:syncnoscli');
    expect(gate).toContain('npm run test:syncnoscli');
    expect(gate).toContain('npm run build:syncnoscli');
    expect(gate).toContain('npm run pack:syncnoscli');
    expect(gate.indexOf('npm run build:syncnoscli')).toBeLessThan(gate.indexOf('npm run test:syncnoscli'));
  });

  it('uses Node 22 for every workflow that installs the workspace', () => {
    for (const workflow of workspaceWorkflows) {
      const source = readWorkflow(workflow);
      expect(source).toContain('run: npm ci');
      expect(source).toMatch(/node-version:\s*22/);
      expect(source).not.toMatch(/node-version:\s*20/);
    }
  });

  it('wakes pull-request CI for CLI and shared-contract changes without publishing npm', () => {
    const ci = readWorkflow('webclipper-ci.yml');
    expect(ci).toContain('- packages/**');
    expect(ci).toContain('- src/services/local-data/**');
    expect(ci).toContain('- package-lock.json');
    expect(ci).toContain('run: npm run gate:ci');
    expect(ci).toContain('windows-native-host:');
    expect(ci).toContain('runs-on: windows-latest');
    expect(ci).toContain('run: npm run build:syncnoscli');
    expect(ci).toContain('tests/syncnoscli/windows-native-host-runtime.test.ts');

    for (const workflow of workspaceWorkflows) {
      expect(readWorkflow(workflow)).not.toContain('npm publish');
    }
  });
});
