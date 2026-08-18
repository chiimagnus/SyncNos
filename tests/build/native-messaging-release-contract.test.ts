import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import rawContract from '../../src/services/local-data/native-host-contract.json';
import { parseNativeHostContract } from '../../src/services/local-data/native-host-contract';

const repoRoot = resolve(__dirname, '../..');
const fixtureRoot = resolve(repoRoot, '.output/release-contract');
const checker = resolve(repoRoot, '.github/scripts/webclipper/check-store-identity.mjs');
const packager = resolve(repoRoot, '.github/scripts/webclipper/package-release-assets.mjs');
const contract = parseNativeHostContract(rawContract);
const releaseFixturesAvailable = ['chrome', 'edge', 'firefox'].every((target) =>
  existsSync(resolve(fixtureRoot, target, 'manifest.json')),
);
const finalFixtureIt = releaseFixturesAvailable ? it : it.skip;

function manifest(target: 'chrome' | 'edge' | 'firefox'): Record<string, any> {
  const path = resolve(fixtureRoot, target, 'manifest.json');
  expect(existsSync(path), `${target} final fixture missing; run npm run build:release-contract-fixtures`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

function recursiveFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path).replaceAll('\\', '/'));
    }
  };
  visit(root);
  return files.sort();
}

function workflow(name: string): string {
  return readFileSync(resolve(repoRoot, '.github/workflows', name), 'utf8');
}

function checkerResult(browser: 'chrome' | 'edge' | 'firefox', evidence: string) {
  return spawnSync(process.execPath, [checker, `--browser=${browser}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, STORE_EXTENSION_ID: evidence },
  });
}

function expectCheckerBeforeUpload(source: string, checkerNeedle: string, uploadNeedle: string): void {
  const checkerIndex = source.indexOf(checkerNeedle);
  const uploadIndex = source.indexOf(uploadNeedle);
  expect(checkerIndex).toBeGreaterThanOrEqual(0);
  expect(uploadIndex).toBeGreaterThan(checkerIndex);
}

function workflowStepContaining(source: string, needle: string): string {
  const needleIndex = source.indexOf(needle);
  expect(needleIndex).toBeGreaterThanOrEqual(0);
  const stepStart = source.lastIndexOf('      - name:', needleIndex);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const nextStep = source.indexOf('\n      - name:', needleIndex);
  const blankLine = source.indexOf('\n\n', needleIndex);
  const candidates = [nextStep, blankLine].filter((index) => index >= 0);
  const stepEnd = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(stepStart, stepEnd);
}

describe('native messaging release artifact contract', () => {
  finalFixtureIt('validates final release manifests without inventing Chromium runtime identity', () => {
    const chrome = manifest('chrome');
    const edge = manifest('edge');
    const firefox = manifest('firefox');

    for (const [target, value] of [
      ['chrome', chrome],
      ['edge', edge],
      ['firefox', firefox],
    ] as const) {
      expect(value.manifest_version, target).toBe(3);
      expect(value.permissions, target).toContain('nativeMessaging');
      expect(value.key, `${target} release manifest must not pin a dev/store key`).toBeUndefined();
    }
    expect(chrome.browser_specific_settings?.gecko).toBeUndefined();
    expect(edge.browser_specific_settings?.gecko).toBeUndefined();
    expect(firefox.browser_specific_settings?.gecko).toMatchObject({
      id: contract.browsers.firefox.geckoId,
      strict_min_version: contract.browsers.firefox.strictMinVersion,
    });
    expect(firefox.browser_specific_settings.gecko.id).toBe(contract.browsers.firefox.allowedExtension);
    expect(contract.browsers.chrome.origin).toBe(`chrome-extension://${contract.browsers.chrome.runtimeId}/`);
    expect(contract.browsers.edge.origin).toBe(`chrome-extension://${contract.browsers.edge.runtimeId}/`);
    expect(contract.browsers.chrome.runtimeId).not.toBe(contract.browsers.edge.runtimeId);
  });

  finalFixtureIt('keeps CLI/native-host delivery artifacts out of every browser release fixture', () => {
    for (const target of ['chrome', 'edge', 'firefox'] as const) {
      const files = recursiveFiles(resolve(fixtureRoot, target));
      expect(files.some((file) => /(?:^|\/)(?:syncnoscli|prebuilds)(?:\/|$)/i.test(file)), target).toBe(false);
      expect(files.some((file) => /\.(?:tgz|node|exe|sqlite|db)$/i.test(file)), target).toBe(false);
    }
  });

  it('uses one silent checker for exact Chrome, Edge, and Firefox store identity evidence', () => {
    const cases = [
      ['chrome', contract.browsers.chrome.runtimeId],
      ['edge', contract.browsers.edge.runtimeId],
      ['firefox', contract.browsers.firefox.geckoId],
    ] as const;
    for (const [browser, identity] of cases) {
      const accepted = checkerResult(browser, identity);
      expect(accepted.status, browser).toBe(0);
      expect(accepted.stdout.trim(), browser).toBe('[identity] ok');
      expect(accepted.stderr, browser).toBe('');
      expect(accepted.stdout).not.toContain(identity);

      const swapped = checkerResult(browser, cases.find(([other]) => other !== browser)![1]);
      expect(swapped.status, browser).not.toBe(0);
      expect(`${swapped.stdout}${swapped.stderr}`).not.toContain(identity);
      expect(`${swapped.stdout}${swapped.stderr}`).not.toContain(cases.find(([other]) => other !== browser)![1]);

      const missing = spawnSync(process.execPath, [checker, `--browser=${browser}`], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, STORE_EXTENSION_ID: '' },
      });
      expect(missing.status, browser).not.toBe(0);
    }
  });

  it('wires each store checker before upload without treating Edge product GUID as runtime identity', () => {
    const cws = workflow('webclipper-cws-publish.yml');
    const edge = workflow('webclipper-edge-publish.yml');
    const amo = workflow('webclipper-amo-publish.yml');

    expectCheckerBeforeUpload(cws, '--browser=chrome', 'publish-cws.mjs');
    expectCheckerBeforeUpload(edge, '--browser=edge', 'publish-edge.mjs');
    expectCheckerBeforeUpload(amo, '--browser=firefox', 'publish-amo.mjs');

    expect(cws).toMatch(/STORE_EXTENSION_ID:\s*\$\{\{ secrets\.CWS_EXTENSION_ID \}\}/);
    expect(edge).toMatch(/STORE_EXTENSION_ID:\s*\$\{\{ vars\.EDGE_EXTENSION_ID \}\}/);
    expect(amo).toMatch(/STORE_EXTENSION_ID:\s*\$\{\{ secrets\.AMO_ADDON_ID \}\}/);
    expect(edge).toContain('EDGE_ADDONS_PRODUCT_ID: ${{ secrets.EDGE_ADDONS_PRODUCT_ID }}');
    const edgeCheckerStep = workflowStepContaining(edge, '--browser=edge');
    expect(edgeCheckerStep).not.toContain('EDGE_ADDONS_PRODUCT_ID');
    expect(edgeCheckerStep).not.toContain('secrets.EDGE_EXTENSION_ID');
  });

  it('builds final release-contract fixtures before the discoverable test suite in clean gates', () => {
    const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const gateName of ['gate', 'gate:ci']) {
      const gate = rootPackage.scripts[gateName]!;
      expect(gate).toContain('npm run build:release-contract-fixtures');
      expect(gate.indexOf('npm run build:release-contract-fixtures')).toBeLessThan(gate.indexOf('npm run test'));
    }
  });

  it('keeps release identity immutable and browser release workflows CLI-publish-free', () => {
    const packagerSource = readFileSync(packager, 'utf8');
    expect(packagerSource).toMatch(/--gecko-id/);
    expect(packagerSource).toContain('Firefox identity overrides are not allowed for release artifacts');
    expect(packagerSource).toContain('FIREFOX_EXTENSION_ID');
    expect(packagerSource).not.toMatch(/process\.env\.(?:CHROME|EDGE)_EXTENSION_ID/);

    for (const name of ['webclipper-release.yml', 'webclipper-prerelease.yml']) {
      const source = workflow(name);
      expect(source).not.toContain('npm run build:syncnoscli');
      expect(source).not.toContain('npm run pack:syncnoscli');
      expect(source).not.toContain('npm publish');
      expect(source).not.toMatch(/syncnoscli.*(?:zip|xpi)|(?:zip|xpi).*syncnoscli/i);
    }

    const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as { version: string };
    const cliPackage = JSON.parse(readFileSync(resolve(repoRoot, 'packages/syncnoscli/package.json'), 'utf8')) as {
      version: string;
    };
    expect(rootPackage.version).not.toBe('');
    expect(cliPackage.version).not.toBe('');
    expect(cliPackage.version).not.toBe(rootPackage.version);
  });

  it('rejects release-time Firefox identity override arguments and environments', () => {
    const argument = spawnSync(process.execPath, [packager, '--target=firefox', '--fixture', '--gecko-id=dev@example'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(argument.status).not.toBe(0);

    const environment = spawnSync(process.execPath, [packager, '--target=firefox', '--fixture'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, FIREFOX_EXTENSION_ID: 'dev@example' },
    });
    expect(environment.status).not.toBe(0);
  });
});
