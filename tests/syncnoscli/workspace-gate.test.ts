import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

const workspaceWorkflows = [
  'webclipper-ci.yml',
  'syncnoscli-ci.yml',
  'syncnoscli-publish.yml',
  'webclipper-release.yml',
  'webclipper-prerelease.yml',
  'webclipper-cws-publish.yml',
  'webclipper-edge-publish.yml',
  'webclipper-amo-publish.yml',
];

const nonNpmPublishWorkflows = workspaceWorkflows.filter((name) => name !== 'syncnoscli-publish.yml');

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
    expect(ci).toContain('- .github/workflows/syncnoscli-ci.yml');
    expect(ci).toContain('run: npm run gate:ci');
    expect(ci).not.toContain('windows-native-host:');

    const cliCi = readWorkflow('syncnoscli-ci.yml');
    expect(cliCi).toContain('- .github/scripts/syncnoscli/**');
    expect(cliCi).toContain('- .github/workflows/syncnoscli-publish.yml');
    expect(cliCi).toContain('os: [ubuntu-latest, macos-latest, windows-latest]');
    expect(cliCi).toContain('npm run build:windows-host-shim --workspace=@chiimagnus/syncnoscli');
    expect(cliCi).toMatch(/SYNCNOSCLI_PACKED_INSTALL_E2E:\s*['"]1['"]/);
    expect(cliCi).toMatch(/SYNCNOSCLI_DISPOSABLE_RUNNER:\s*['"]1['"]/);
    expect(cliCi).toContain('tests/syncnoscli/packed-install.test.ts');
    expect(cliCi).not.toMatch(/rtk|\b(?:bash|sh)\b/);

    for (const workflow of nonNpmPublishWorkflows) {
      expect(readWorkflow(workflow)).not.toContain('npm publish');
    }
  });

  it('keeps npm publishing manual, approved, OIDC-only, and isolated from every normal workflow', () => {
    const publish = readWorkflow('syncnoscli-publish.yml');
    const triggerBlock = publish.slice(publish.indexOf('on:'), publish.indexOf('\nconcurrency:'));
    expect(triggerBlock).toContain('workflow_dispatch:');
    expect(triggerBlock).toContain('package_version:');
    expect(triggerBlock).toContain('confirmation:');
    expect(triggerBlock).not.toMatch(/pull_request:|push:|release:|schedule:|workflow_call:/);

    expect(publish).toContain("if(process.env.GITHUB_REF!=='refs/heads/main') process.exit(1)");
    expect(publish).toContain('environment: syncnoscli-npm-publish');
    expect(publish).toContain('id-token: write');
    expect(publish).toContain('npm install --global npm@11.18.0');
    expect(publish).toContain('node-version: 22.14.0');
    expect(publish).toContain('npm run build:syncnoscli');
    expect(publish).toContain('check-publish-readiness.mjs --offline');
    expect(publish).toContain('tests/syncnoscli/packed-install.test.ts');
    expect(publish).toContain('npm publish "$TARBALL" --dry-run --access public --tag latest');
    expect(publish).toContain('npm publish "$TARBALL" --provenance --access public --tag latest');
    expect(publish).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|npmrc/i);

    const publishLines = publish
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('run: npm publish'));
    expect(publishLines).toEqual([
      'run: npm publish "$TARBALL" --dry-run --access public --tag latest',
      'run: npm publish "$TARBALL" --provenance --access public --tag latest',
    ]);
  });
});
