import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CHROME_PRODUCTION_EXTENSION_ID,
  EDGE_PRODUCTION_EXTENSION_ID,
  FIREFOX_PRODUCTION_EXTENSION_ID,
  buildNativeHostManifest,
  discoverInstalledBrowsers,
  listBrowserDefinitions,
  resolveBrowserTarget,
  resolveRegistrationTargets,
} from '../../cli/browser-targets.mjs';
import { contract } from '../../cli/native-host.mjs';

describe('CLI browser target catalog', () => {
  it('covers mainstream and long-tail browser products', () => {
    const ids = listBrowserDefinitions().map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'chrome',
        'chrome-for-testing',
        'chromium',
        'edge',
        'brave',
        'vivaldi',
        'arc',
        'helium',
        'opera',
        'iridium',
        'yandex',
        'slimjet',
        'firefox',
        'firefox-developer',
        'zen',
        'librewolf',
        'waterfox',
        'tor',
      ]),
    );
  });

  it('detects only known macOS application candidates and deduplicates shared registrations', async () => {
    const present = new Set([
      '/Applications/Google Chrome.app',
      '/Applications/Brave Browser.app',
      '/Applications/Helium.app',
      '/Applications/Firefox.app',
      '/Applications/Zen.app',
    ]);
    const discovered = await discoverInstalledBrowsers({
      platform: 'darwin',
      homeDir: '/Users/example',
      pathExists: async (path) => present.has(path),
    });
    expect(discovered.map((item) => item.id)).toEqual(['chrome', 'brave', 'helium', 'firefox', 'zen']);

    const targets = resolveRegistrationTargets(discovered, {
      platform: 'darwin',
      homeDir: '/Users/example',
    });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      registrationId: 'chrome',
      browsers: ['chrome', 'brave', 'helium'],
      manifestPath:
        '/Users/example/Library/Application Support/Google/Chrome/NativeMessagingHosts/app.syncnos.cli.json',
    });
    expect(targets[1]).toMatchObject({
      registrationId: 'mozilla',
      browsers: ['firefox', 'zen'],
      manifestPath: '/Users/example/Library/Application Support/Mozilla/NativeMessagingHosts/app.syncnos.cli.json',
    });
  });

  it('keeps dedicated macOS and Linux long-tail registration paths', () => {
    expect(
      resolveBrowserTarget('chrome-for-testing', { platform: 'darwin', homeDir: '/Users/example' }).manifestPath,
    ).toBe(
      '/Users/example/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/app.syncnos.cli.json',
    );
    expect(
      resolveBrowserTarget('chrome-for-testing', { platform: 'linux', homeDir: '/home/example' }).manifestPath,
    ).toBe('/home/example/.config/google-chrome-for-testing/NativeMessagingHosts/app.syncnos.cli.json');
    expect(resolveBrowserTarget('arc', { platform: 'darwin', homeDir: '/Users/example' }).manifestPath).toBe(
      '/Users/example/Library/Application Support/Arc/User Data/NativeMessagingHosts/app.syncnos.cli.json',
    );
    expect(resolveBrowserTarget('brave', { platform: 'linux', homeDir: '/home/example' }).manifestPath).toBe(
      '/home/example/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/app.syncnos.cli.json',
    );
    expect(resolveBrowserTarget('vivaldi', { platform: 'linux', homeDir: '/home/example' }).manifestPath).toBe(
      '/home/example/.config/vivaldi/NativeMessagingHosts/app.syncnos.cli.json',
    );
    expect(resolveBrowserTarget('librewolf', { platform: 'linux', homeDir: '/home/example' }).manifestPath).toBe(
      '/home/example/.librewolf/native-messaging-hosts/app.syncnos.cli.json',
    );
    expect(resolveBrowserTarget('waterfox', { platform: 'linux', homeDir: '/home/example' }).manifestPath).toBe(
      '/home/example/.waterfox/native-messaging-hosts/app.syncnos.cli.json',
    );
  });

  it('deduplicates Windows products onto exact HKCU registration targets', () => {
    const options = {
      platform: 'win32' as const,
      homeDir: 'C:\\Users\\example',
      localAppDataDir: 'C:\\Users\\example\\AppData\\Local',
      env: {
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      },
    };
    const targets = resolveRegistrationTargets(['chrome', 'brave', 'vivaldi', 'edge', 'firefox'], options);
    expect(targets.map((item) => [item.registrationId, item.browsers])).toEqual([
      ['chrome', ['chrome', 'brave', 'vivaldi']],
      ['edge', ['edge']],
      ['mozilla', ['firefox']],
    ]);
    expect(targets.map((item) => item.registryKey)).toEqual([
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${contract.nativeHostName}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${contract.nativeHostName}`,
      `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${contract.nativeHostName}`,
    ]);
  });

  it('discovers the standard Slimjet macOS app and Yandex Linux stable executable', async () => {
    const mac = await discoverInstalledBrowsers({
      platform: 'darwin',
      homeDir: '/Users/example',
      pathExists: async (path) => path === '/Applications/FlashPeak Slimjet.app',
    });
    expect(mac.map((item) => item.id)).toEqual(['slimjet']);

    const linux = await discoverInstalledBrowsers({
      platform: 'linux',
      homeDir: '/home/example',
      pathExists: async (path) => path === '/usr/bin/yandex-browser-stable',
    });
    expect(linux.map((item) => item.id)).toEqual(['yandex']);
  });

  it('keeps Tor Windows explicit-registration-only on the Mozilla HKCU target', async () => {
    const options = {
      platform: 'win32' as const,
      homeDir: 'C:\\Users\\example',
      localAppDataDir: 'C:\\Users\\example\\AppData\\Local',
      env: {
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      },
    };
    const target = resolveBrowserTarget('tor', options);
    expect(target).toMatchObject({
      registrationId: 'mozilla',
      registrationKind: 'registry',
      registryKey: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${contract.nativeHostName}`,
    });

    const discovered = await discoverInstalledBrowsers({ ...options, pathExists: async () => true });
    expect(discovered.map((item) => item.id)).not.toContain('tor');
  });

  it('allows both public Chromium store identities while Firefox keeps its Gecko id', () => {
    const chrome = resolveBrowserTarget('chrome', { platform: 'darwin', homeDir: '/Users/example' });
    expect(chrome.extensionIds).toEqual([CHROME_PRODUCTION_EXTENSION_ID, EDGE_PRODUCTION_EXTENSION_ID]);
    expect(buildNativeHostManifest(chrome, '/Users/example/native-host')).toMatchObject({
      allowed_origins: [
        `chrome-extension://${CHROME_PRODUCTION_EXTENSION_ID}/`,
        `chrome-extension://${EDGE_PRODUCTION_EXTENSION_ID}/`,
      ],
    });

    const firefox = resolveBrowserTarget('firefox', { platform: 'darwin', homeDir: '/Users/example' });
    expect(firefox.extensionIds).toEqual([FIREFOX_PRODUCTION_EXTENSION_ID]);
    expect(buildNativeHostManifest(firefox, '/Users/example/native-host')).toMatchObject({
      allowed_extensions: [FIREFOX_PRODUCTION_EXTENSION_ID],
    });
  });

  it('uses Windows path semantics on a non-Windows test host', () => {
    const target = resolveBrowserTarget('edge', {
      platform: 'win32',
      homeDir: 'C:\\Users\\example',
      localAppDataDir: 'C:\\Users\\example\\AppData\\Local',
      env: { ProgramFiles: 'C:\\Program Files' },
    });
    const launcher = win32.join('C:\\Users\\example\\AppData\\Local', 'SyncNos', 'cli', 'native-host.cmd');
    expect(buildNativeHostManifest(target, launcher)).toMatchObject({ path: launcher });
  });

  it('keeps an explicit development id local to one target', () => {
    const override = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const overridden = resolveBrowserTarget('brave', {
      platform: 'darwin',
      homeDir: '/Users/example',
      extensionId: override,
    });
    const production = resolveBrowserTarget('chrome', { platform: 'darwin', homeDir: '/Users/example' });
    expect(overridden.allowlist).toEqual([`chrome-extension://${override}/`]);
    expect(overridden.productionIdentity).toBe(false);
    expect(production.allowlist).toHaveLength(2);
    expect(production.productionIdentity).toBe(true);
  });
});
