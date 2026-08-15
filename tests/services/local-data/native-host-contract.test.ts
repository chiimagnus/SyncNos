import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { nativeHostContract, parseNativeHostContract } from '@services/local-data/native-host-contract';
import { resolveManifest } from '../../../wxt.config';

const repoRoot = resolve(__dirname, '../../..');
const releasePackager = resolve(repoRoot, '.github/scripts/webclipper/package-release-assets.mjs');
const zenPackager = resolve(repoRoot, '.github/scripts/webclipper/package-zen-xpi.mjs');

describe('native host contract', () => {
  it('owns the exact three official extension identities', () => {
    expect(nativeHostContract.host).toMatchObject({
      name: 'app.syncnos.localdata',
      protocolVersion: 1,
      schemaVersion: 1,
      databaseRelativePath: 'syncnos.sqlite',
      nativeManifestVersion: 1,
      manifestFormat: 'native-messaging-v1',
    });
    expect(nativeHostContract.browsers.chrome).toEqual({
      runtimeId: 'hmgjflllphdffeocddjjcfllifhejpok',
      origin: 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/',
    });
    expect(nativeHostContract.browsers.edge).toEqual({
      runtimeId: 'ijkpghlfmkbjcgafapjcjahaikmnjncl',
      origin: 'chrome-extension://ijkpghlfmkbjcgafapjcjahaikmnjncl/',
    });
    expect(nativeHostContract.browsers.firefox).toEqual({
      geckoId: 'syncnos-webclipper@syncnos.app',
      allowedExtension: 'syncnos-webclipper@syncnos.app',
      strictMinVersion: '142.0',
    });
    expect(nativeHostContract.browsers.safari.localDataSupported).toBe(false);
  });

  it('exposes one deeply immutable runtime identity snapshot', () => {
    const parsed = parseNativeHostContract(structuredClone(nativeHostContract));

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.host)).toBe(true);
    expect(Object.isFrozen(parsed.browsers)).toBe(true);
    expect(Object.isFrozen(parsed.browsers.chrome)).toBe(true);
    expect(Object.isFrozen(parsed.browsers.edge)).toBe(true);
    expect(Object.isFrozen(parsed.browsers.firefox)).toBe(true);
    expect(Object.isFrozen(parsed.browsers.safari)).toBe(true);
    expect(Reflect.set(parsed.browsers.chrome, 'runtimeId', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(parsed.browsers.chrome.runtimeId).toBe(nativeHostContract.browsers.chrome.runtimeId);
  });

  it('rejects wildcard, duplicate, and malformed identity fields', () => {
    const wildcard = structuredClone(nativeHostContract);
    wildcard.browsers.chrome.origin = 'chrome-extension://*/';
    expect(() => parseNativeHostContract(wildcard)).toThrow('exact extension origin');

    const duplicate = structuredClone(nativeHostContract);
    duplicate.browsers.edge = structuredClone(duplicate.browsers.chrome);
    expect(() => parseNativeHostContract(duplicate)).toThrow('must be distinct');

    const malformedGecko = structuredClone(nativeHostContract);
    malformedGecko.browsers.firefox.geckoId = 'dev-extension';
    expect(() => parseNativeHostContract(malformedGecko)).toThrow('Firefox identity');

    const safariEnabled = structuredClone(nativeHostContract);
    safariEnabled.browsers.safari.localDataSupported = true;
    expect(() => parseNativeHostContract(safariEnabled)).toThrow('Safari local data');
  });

  it('writes the canonical Gecko identity only to Firefox manifests', () => {
    const firefoxManifest = resolveManifest({ browser: 'firefox' } as Parameters<typeof resolveManifest>[0]) as Record<
      string,
      any
    >;
    const chromeManifest = resolveManifest({ browser: 'chrome' } as Parameters<typeof resolveManifest>[0]) as Record<
      string,
      any
    >;
    const safariManifest = resolveManifest({ browser: 'safari' } as Parameters<typeof resolveManifest>[0]) as Record<
      string,
      any
    >;

    expect(firefoxManifest.browser_specific_settings?.gecko).toMatchObject({
      id: nativeHostContract.browsers.firefox.geckoId,
      strict_min_version: nativeHostContract.browsers.firefox.strictMinVersion,
    });
    expect(firefoxManifest).not.toHaveProperty('key');
    expect(chromeManifest).not.toHaveProperty('browser_specific_settings');
    expect(chromeManifest).not.toHaveProperty('key');
    expect(safariManifest).not.toHaveProperty('browser_specific_settings');
  });

  it('enables Native Messaging only for Chrome, Edge, and Firefox', () => {
    for (const browser of ['chrome', 'edge', 'firefox'] as const) {
      const manifest = resolveManifest({ browser } as Parameters<typeof resolveManifest>[0]) as Record<string, any>;
      expect(manifest.permissions).toContain('nativeMessaging');
    }
    const safariManifest = resolveManifest({ browser: 'safari' } as Parameters<typeof resolveManifest>[0]) as Record<
      string,
      any
    >;
    expect(safariManifest.permissions).not.toContain('nativeMessaging');
  });

  it('rejects release-time Gecko overrides before a browser build starts', () => {
    const argumentOverride = spawnSync(
      process.execPath,
      [releasePackager, '--target=firefox', '--gecko-id=dev@example.test'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );
    expect(argumentOverride.status).not.toBe(0);
    expect(`${argumentOverride.stdout}${argumentOverride.stderr}`).toContain('overrides are not allowed');

    const environmentOverride = spawnSync(process.execPath, [releasePackager, '--target=firefox'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, FIREFOX_EXTENSION_ID: 'dev@example.test' },
    });
    expect(environmentOverride.status).not.toBe(0);
    expect(`${environmentOverride.stdout}${environmentOverride.stderr}`).toContain('not allowed for release artifacts');
  });

  it('keeps the Zen-only override without a second Gecko identity default', () => {
    const source = readFileSync(zenPackager, 'utf8');
    expect(source).toContain('FIREFOX_EXTENSION_ID');
    expect(source).toContain('native-host-contract.json');
    expect(source).not.toContain("'syncnos-webclipper@syncnos.app'");
  });
});
