import { access } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import process from 'node:process';

import { contract } from './contract.mjs';

export const CHROME_PRODUCTION_EXTENSION_ID = 'hmgjflllphdffeocddjjcfllifhejpok';
export const EDGE_PRODUCTION_EXTENSION_ID = 'ijkpghlfmkbjcgafapjcjahaikmnjncl';
export const FIREFOX_PRODUCTION_EXTENSION_ID = 'syncnos-webclipper@syncnos.app';
export const CHROMIUM_PRODUCTION_EXTENSION_IDS = Object.freeze([
  CHROME_PRODUCTION_EXTENSION_ID,
  EDGE_PRODUCTION_EXTENSION_ID,
]);
export const NATIVE_HOST_MANIFEST_FILENAME = `${contract.nativeHostName}.json`;

const macApps = (...names) =>
  names.flatMap((name) => [
    Object.freeze({ base: 'absolute', path: `/Applications/${name}.app` }),
    Object.freeze({ base: 'home', path: `Applications/${name}.app` }),
  ]);
const linuxPaths = (...paths) => paths.map((path) => Object.freeze({ base: 'absolute', path }));
const winPaths = (...items) => items.map(([base, path]) => Object.freeze({ base, path }));
const fileRegistration = (id, base, relativeDir) => Object.freeze({ id, kind: 'file', base, relativeDir });
const registryRegistration = (id, registryKey) => Object.freeze({ id, kind: 'registry', registryKey });

const REGISTRY = Object.freeze({
  chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${contract.nativeHostName}`,
  chromium: `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${contract.nativeHostName}`,
  edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${contract.nativeHostName}`,
  mozilla: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${contract.nativeHostName}`,
});

const BROWSERS = Object.freeze({
  chrome: Object.freeze({
    id: 'chrome',
    name: 'Google Chrome',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Google Chrome'),
        registration: fileRegistration(
          'chrome',
          'home',
          'Library/Application Support/Google/Chrome/NativeMessagingHosts',
        ),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/google-chrome', '/opt/google/chrome/google-chrome'),
        registration: fileRegistration('chrome', 'xdgConfig', 'google-chrome/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(
          ['programFiles', 'Google\\Chrome\\Application\\chrome.exe'],
          ['programFilesX86', 'Google\\Chrome\\Application\\chrome.exe'],
          ['localAppData', 'Google\\Chrome\\Application\\chrome.exe'],
        ),
        registration: registryRegistration('chrome', REGISTRY.chrome),
      }),
    }),
  }),
  'chrome-beta': Object.freeze({
    id: 'chrome-beta',
    name: 'Google Chrome Beta',
    family: 'chromium',
    platforms: Object.freeze({
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/google-chrome-beta', '/opt/google/chrome-beta/google-chrome-beta'),
        registration: fileRegistration('chrome-beta', 'xdgConfig', 'google-chrome-beta/NativeMessagingHosts'),
      }),
    }),
  }),
  'chrome-unstable': Object.freeze({
    id: 'chrome-unstable',
    name: 'Google Chrome Unstable',
    family: 'chromium',
    platforms: Object.freeze({
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/google-chrome-unstable', '/opt/google/chrome-unstable/google-chrome-unstable'),
        registration: fileRegistration('chrome-unstable', 'xdgConfig', 'google-chrome-unstable/NativeMessagingHosts'),
      }),
    }),
  }),
  'chrome-for-testing': Object.freeze({
    id: 'chrome-for-testing',
    name: 'Google Chrome for Testing',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Google Chrome for Testing'),
        registration: fileRegistration(
          'chrome-for-testing',
          'home',
          'Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts',
        ),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/google-chrome-for-testing', '/opt/google/chrome-for-testing/chrome'),
        registration: fileRegistration(
          'chrome-for-testing',
          'xdgConfig',
          'google-chrome-for-testing/NativeMessagingHosts',
        ),
      }),
    }),
  }),
  chromium: Object.freeze({
    id: 'chromium',
    name: 'Chromium',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Chromium'),
        registration: fileRegistration('chromium', 'home', 'Library/Application Support/Chromium/NativeMessagingHosts'),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/chromium', '/usr/bin/chromium-browser'),
        registration: fileRegistration('chromium', 'xdgConfig', 'chromium/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(
          ['localAppData', 'Chromium\\Application\\chrome.exe'],
          ['programFiles', 'Chromium\\Application\\chrome.exe'],
          ['programFilesX86', 'Chromium\\Application\\chrome.exe'],
        ),
        registration: registryRegistration('chromium', REGISTRY.chromium),
      }),
    }),
  }),
  edge: Object.freeze({
    id: 'edge',
    name: 'Microsoft Edge',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Microsoft Edge'),
        registration: fileRegistration(
          'edge',
          'home',
          'Library/Application Support/Microsoft Edge/NativeMessagingHosts',
        ),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'),
        registration: fileRegistration('edge', 'xdgConfig', 'microsoft-edge/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(
          ['programFilesX86', 'Microsoft\\Edge\\Application\\msedge.exe'],
          ['programFiles', 'Microsoft\\Edge\\Application\\msedge.exe'],
          ['localAppData', 'Microsoft\\Edge\\Application\\msedge.exe'],
        ),
        registration: registryRegistration('edge', REGISTRY.edge),
      }),
    }),
  }),
  brave: Object.freeze({
    id: 'brave',
    name: 'Brave',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Brave Browser'),
        registration: fileRegistration(
          'chrome',
          'home',
          'Library/Application Support/Google/Chrome/NativeMessagingHosts',
        ),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/brave-browser', '/opt/brave.com/brave/brave-browser'),
        registration: fileRegistration('brave', 'xdgConfig', 'BraveSoftware/Brave-Browser/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(
          ['programFiles', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
          ['programFilesX86', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
          ['localAppData', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
        ),
        registration: registryRegistration('chrome', REGISTRY.chrome),
      }),
    }),
  }),
  vivaldi: Object.freeze({
    id: 'vivaldi',
    name: 'Vivaldi',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Vivaldi'),
        registration: fileRegistration('vivaldi', 'home', 'Library/Application Support/Vivaldi/NativeMessagingHosts'),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/vivaldi', '/usr/bin/vivaldi-stable', '/opt/vivaldi/vivaldi'),
        registration: fileRegistration('vivaldi', 'xdgConfig', 'vivaldi/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(
          ['localAppData', 'Vivaldi\\Application\\vivaldi.exe'],
          ['programFiles', 'Vivaldi\\Application\\vivaldi.exe'],
          ['programFilesX86', 'Vivaldi\\Application\\vivaldi.exe'],
        ),
        registration: registryRegistration('chrome', REGISTRY.chrome),
      }),
    }),
  }),
  arc: Object.freeze({
    id: 'arc',
    name: 'Arc',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Arc'),
        registration: fileRegistration('arc', 'home', 'Library/Application Support/Arc/User Data/NativeMessagingHosts'),
      }),
    }),
  }),
  helium: Object.freeze({
    id: 'helium',
    name: 'Helium',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Helium'),
        registration: fileRegistration(
          'chrome',
          'home',
          'Library/Application Support/Google/Chrome/NativeMessagingHosts',
        ),
      }),
    }),
  }),
  opera: Object.freeze({
    id: 'opera',
    name: 'Opera',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Opera'),
        registration: fileRegistration(
          'chrome',
          'home',
          'Library/Application Support/Google/Chrome/NativeMessagingHosts',
        ),
      }),
      win32: Object.freeze({
        detect: winPaths(
          ['localAppData', 'Programs\\Opera\\launcher.exe'],
          ['programFiles', 'Opera\\launcher.exe'],
          ['programFilesX86', 'Opera\\launcher.exe'],
        ),
        registration: registryRegistration('chrome', REGISTRY.chrome),
      }),
    }),
  }),
  iridium: Object.freeze({
    id: 'iridium',
    name: 'Iridium',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Iridium'),
        registration: fileRegistration('iridium', 'home', 'Library/Application Support/Iridium/NativeMessagingHosts'),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/iridium', '/usr/bin/iridium-browser'),
        registration: fileRegistration('iridium', 'xdgConfig', 'iridium/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(['programFiles', 'Iridium\\iridium.exe'], ['programFilesX86', 'Iridium\\iridium.exe']),
        registration: registryRegistration('chrome', REGISTRY.chrome),
      }),
    }),
  }),
  yandex: Object.freeze({
    id: 'yandex',
    name: 'Yandex Browser',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Yandex'),
        registration: fileRegistration('yandex', 'home', 'Library/Application Support/Yandex/NativeMessagingHosts'),
      }),
      linux: Object.freeze({
        detect: linuxPaths(
          '/usr/bin/yandex-browser',
          '/usr/bin/yandex-browser-stable',
          '/opt/yandex/browser/yandex-browser',
        ),
        registration: fileRegistration('yandex', 'xdgConfig', 'yandex-browser/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(['localAppData', 'Yandex\\YandexBrowser\\Application\\browser.exe']),
        registration: registryRegistration('chrome', REGISTRY.chrome),
      }),
    }),
  }),
  slimjet: Object.freeze({
    id: 'slimjet',
    name: 'Slimjet',
    family: 'chromium',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('FlashPeak Slimjet', 'Slimjet'),
        registration: fileRegistration('slimjet', 'home', 'Library/Application Support/Slimjet/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(['programFiles', 'Slimjet\\slimjet.exe'], ['programFilesX86', 'Slimjet\\slimjet.exe']),
        registration: registryRegistration('chrome', REGISTRY.chrome),
      }),
    }),
  }),
  firefox: Object.freeze({
    id: 'firefox',
    name: 'Mozilla Firefox',
    family: 'firefox',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Firefox'),
        registration: fileRegistration('mozilla', 'home', 'Library/Application Support/Mozilla/NativeMessagingHosts'),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/firefox'),
        registration: fileRegistration('mozilla', 'home', '.mozilla/native-messaging-hosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(
          ['programFiles', 'Mozilla Firefox\\firefox.exe'],
          ['programFilesX86', 'Mozilla Firefox\\firefox.exe'],
          ['localAppData', 'Mozilla Firefox\\firefox.exe'],
        ),
        registration: registryRegistration('mozilla', REGISTRY.mozilla),
      }),
    }),
  }),
  'firefox-developer': Object.freeze({
    id: 'firefox-developer',
    name: 'Firefox Developer Edition',
    family: 'firefox',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Firefox Developer Edition'),
        registration: fileRegistration('mozilla', 'home', 'Library/Application Support/Mozilla/NativeMessagingHosts'),
      }),
      win32: Object.freeze({
        detect: winPaths(
          ['programFiles', 'Firefox Developer Edition\\firefox.exe'],
          ['programFilesX86', 'Firefox Developer Edition\\firefox.exe'],
        ),
        registration: registryRegistration('mozilla', REGISTRY.mozilla),
      }),
    }),
  }),
  zen: Object.freeze({
    id: 'zen',
    name: 'Zen',
    family: 'firefox',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Zen'),
        registration: fileRegistration('mozilla', 'home', 'Library/Application Support/Mozilla/NativeMessagingHosts'),
      }),
    }),
  }),
  librewolf: Object.freeze({
    id: 'librewolf',
    name: 'LibreWolf',
    family: 'firefox',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('LibreWolf'),
        registration: fileRegistration(
          'librewolf',
          'home',
          'Library/Application Support/librewolf/NativeMessagingHosts',
        ),
      }),
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/librewolf'),
        registration: fileRegistration('librewolf', 'home', '.librewolf/native-messaging-hosts'),
      }),
    }),
  }),
  waterfox: Object.freeze({
    id: 'waterfox',
    name: 'Waterfox',
    family: 'firefox',
    platforms: Object.freeze({
      linux: Object.freeze({
        detect: linuxPaths('/usr/bin/waterfox'),
        registration: fileRegistration('waterfox', 'home', '.waterfox/native-messaging-hosts'),
      }),
    }),
  }),
  tor: Object.freeze({
    id: 'tor',
    name: 'Tor Browser',
    family: 'firefox',
    platforms: Object.freeze({
      darwin: Object.freeze({
        detect: macApps('Tor Browser'),
        registration: fileRegistration(
          'tor',
          'home',
          'Library/Application Support/TorBrowser-Data/Browser/Mozilla/NativeMessagingHosts',
        ),
      }),
      linux: Object.freeze({
        detect: [
          Object.freeze({
            base: 'home',
            path: '.local/share/torbrowser/tbb/x86_64/tor-browser/Browser/start-tor-browser',
          }),
        ],
        registration: fileRegistration(
          'tor',
          'home',
          '.local/share/torbrowser/tbb/x86_64/tor-browser/Browser/TorBrowser/Data/Browser/.mozilla/native-messaging-hosts',
        ),
      }),
      win32: Object.freeze({
        detect: [],
        registration: registryRegistration('mozilla', REGISTRY.mozilla),
      }),
    }),
  }),
});

function targetError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeBrowser(browser) {
  return String(browser || '')
    .trim()
    .toLowerCase();
}

function pathApi(platform) {
  return platform === 'win32' ? win32 : posix;
}

function hasWhitespaceOrControl(value) {
  for (const char of String(value || '')) {
    const code = char.codePointAt(0) ?? 0;
    if (/\s/.test(char) || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function envValue(env, ...names) {
  for (const name of names) {
    const value = String(env?.[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function resolveEnvironment({ platform, homeDir, localAppDataDir, env = process.env } = {}) {
  const path = pathApi(platform);
  const rawHome = String(homeDir || envValue(env, 'HOME', 'USERPROFILE') || '').trim();
  if (!rawHome) throw targetError('home_unavailable', 'Home directory is unavailable');
  const home = path.resolve(rawHome);
  const localAppData = String(localAppDataDir || envValue(env, 'LOCALAPPDATA') || '').trim();
  return {
    platform,
    path,
    home,
    localAppData: localAppData ? path.resolve(localAppData) : '',
    xdgConfig: path.resolve(String(envValue(env, 'XDG_CONFIG_HOME') || path.join(home, '.config'))),
    programFiles: envValue(env, 'ProgramFiles', 'PROGRAMFILES'),
    programFilesX86: envValue(env, 'ProgramFiles(x86)', 'PROGRAMFILES(X86)'),
  };
}

function resolveCandidate(candidate, environment) {
  const raw = String(candidate?.path || '').trim();
  if (!raw) return '';
  if (candidate.base === 'absolute') return environment.path.resolve(raw);
  const base = environment[candidate.base];
  if (!base) return '';
  return environment.path.resolve(base, raw);
}

function productionIdsForFamily(family) {
  return family === 'chromium' ? [...CHROMIUM_PRODUCTION_EXTENSION_IDS] : [FIREFOX_PRODUCTION_EXTENSION_ID];
}

function normalizeExtensionIds(family, extensionId) {
  if (extensionId == null) return productionIdsForFamily(family);
  const value = String(extensionId).trim();
  if (!value) throw targetError('invalid_extension_id', 'Extension id is required');
  if (family === 'chromium' && !/^[a-p]{32}$/.test(value)) {
    throw targetError('invalid_extension_id', 'Chromium extension id must be 32 lowercase a-p characters');
  }
  if (family === 'firefox' && (value.length > 255 || hasWhitespaceOrControl(value))) {
    throw targetError('invalid_extension_id', 'Firefox extension id is invalid');
  }
  return [value];
}

export function listBrowserTargets({ platform = process.platform } = {}) {
  return Object.keys(BROWSERS).filter((id) => !!BROWSERS[id].platforms?.[platform]);
}

function resolveBrowserDetectionCandidates(
  browser,
  { platform = process.platform, homeDir, localAppDataDir, env = process.env } = {},
) {
  const id = normalizeBrowser(browser);
  const definition = BROWSERS[id];
  if (!definition) throw targetError('unsupported_browser', `Unsupported browser target: ${id || '(empty)'}`);
  const platformDefinition = definition.platforms?.[platform];
  if (!platformDefinition)
    throw targetError('unsupported_browser_platform', `${definition.name} is not declared for ${platform}`);
  const environment = resolveEnvironment({ platform, homeDir, localAppDataDir, env });
  return (platformDefinition.detect || []).map((candidate) => resolveCandidate(candidate, environment)).filter(Boolean);
}

export async function discoverInstalledBrowsers({
  platform = process.platform,
  homeDir,
  localAppDataDir,
  env = process.env,
  pathExists = async (path) =>
    await access(path)
      .then(() => true)
      .catch(() => false),
} = {}) {
  const discovered = [];
  for (const id of listBrowserTargets({ platform })) {
    const definition = BROWSERS[id];
    const candidates = resolveBrowserDetectionCandidates(id, { platform, homeDir, localAppDataDir, env });
    let detectedPath = '';
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        detectedPath = candidate;
        break;
      }
    }
    if (!detectedPath) continue;
    discovered.push({
      id,
      name: definition.name,
      family: definition.family,
      detectedPath,
    });
  }
  return discovered;
}

export function resolveBrowserTarget(
  browser,
  { platform = process.platform, homeDir, localAppDataDir, env = process.env, extensionId } = {},
) {
  const id = normalizeBrowser(browser);
  const definition = BROWSERS[id];
  if (!definition) throw targetError('unsupported_browser', `Unsupported browser target: ${id || '(empty)'}`);
  const platformDefinition = definition.platforms?.[platform];
  if (!platformDefinition)
    throw targetError('unsupported_browser_platform', `${definition.name} is not declared for ${platform}`);
  const registration = platformDefinition.registration;
  if (!registration)
    throw targetError('unsupported_browser_platform', `${definition.name} has no registration for ${platform}`);
  const environment = resolveEnvironment({ platform, homeDir, localAppDataDir, env });
  const extensionIds = normalizeExtensionIds(definition.family, extensionId);
  const allowlist =
    definition.family === 'chromium' ? extensionIds.map((value) => `chrome-extension://${value}/`) : [...extensionIds];
  const productionAllowlist =
    definition.family === 'chromium'
      ? productionIdsForFamily('chromium').map((value) => `chrome-extension://${value}/`)
      : productionIdsForFamily('firefox');

  let manifestDir = null;
  let manifestPath = null;
  let registryKey = null;
  if (registration.kind === 'file') {
    const base = environment[registration.base];
    if (!base)
      throw targetError('registration_base_unavailable', `Registration base ${registration.base} is unavailable`);
    manifestDir = environment.path.resolve(base, registration.relativeDir);
    manifestPath = environment.path.resolve(manifestDir, NATIVE_HOST_MANIFEST_FILENAME);
  } else if (registration.kind === 'registry') {
    registryKey = registration.registryKey;
  } else {
    throw targetError('registration_kind_invalid', `Unsupported registration kind: ${registration.kind}`);
  }

  const registrationKey = registration.kind === 'file' ? `file:${manifestPath}` : `registry:${registryKey}`;
  return {
    browserId: id,
    family: definition.family,
    platform,
    registrationId: registration.id,
    registrationKind: registration.kind,
    registrationKey,
    allowlistField: definition.family === 'chromium' ? 'allowed_origins' : 'allowed_extensions',
    extensionIds,
    productionIdentity: JSON.stringify(allowlist) === JSON.stringify(productionAllowlist),
    manifestPath,
    registryKey,
    allowlist,
  };
}

export function resolveRegistrationTargets(
  browsers,
  { platform = process.platform, homeDir, localAppDataDir, env = process.env, extensionId } = {},
) {
  const grouped = new Map();
  for (const browser of browsers || []) {
    const browserId = typeof browser === 'string' ? browser : browser?.id;
    const target = resolveBrowserTarget(browserId, { platform, homeDir, localAppDataDir, env, extensionId });
    const existing = grouped.get(target.registrationKey);
    if (existing) {
      existing.browsers.push(target.browserId);
      continue;
    }
    grouped.set(target.registrationKey, { ...target, browsers: [target.browserId] });
  }
  const sharedByRegistration = new Map();
  for (const browserId of listBrowserTargets({ platform })) {
    const target = resolveBrowserTarget(browserId, { platform, homeDir, localAppDataDir, env });
    const shared = sharedByRegistration.get(target.registrationKey) ?? [];
    shared.push(target.browserId);
    sharedByRegistration.set(target.registrationKey, shared);
  }
  return Array.from(grouped.values(), (target) => ({
    ...target,
    sharedByBrowsers: [...(sharedByRegistration.get(target.registrationKey) ?? target.browsers)],
  }));
}

export function buildNativeHostManifest(target, launcherPath) {
  if (!target || !target.family) throw targetError('unsupported_browser', 'Browser target is required');
  const platform = target.platform || process.platform;
  const path = pathApi(platform);
  const launcher = String(launcherPath || '').trim();
  if (!path.isAbsolute(launcher)) {
    throw targetError('launcher_path_invalid', 'Native host launcher path must be absolute');
  }
  const resolvedLauncher = path.resolve(launcher);
  const base = {
    name: contract.nativeHostName,
    description: 'SyncNos local CLI bridge',
    path: resolvedLauncher,
    type: 'stdio',
  };
  if (target.family === 'chromium') return { ...base, allowed_origins: [...target.allowlist] };
  if (target.family === 'firefox') return { ...base, allowed_extensions: [...target.allowlist] };
  throw targetError('unsupported_browser', `Unsupported browser family: ${target.family}`);
}

export function validateNativeHostManifest(target, manifest, launcherPath) {
  const issues = [];
  const value = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : null;
  if (!value) return { valid: false, issues: ['manifest_not_object'], productionIdentity: false };
  const expectedKeys =
    target.family === 'chromium'
      ? ['allowed_origins', 'description', 'name', 'path', 'type']
      : ['allowed_extensions', 'description', 'name', 'path', 'type'];
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) issues.push('manifest_schema');
  if (value.name !== contract.nativeHostName) issues.push('host_name');
  if (value.type !== 'stdio') issues.push('host_type');
  if (typeof value.description !== 'string' || !value.description.trim()) issues.push('description');

  const path = pathApi(target.platform || process.platform);
  const manifestLauncher = String(value.path || '').trim();
  const expectedLauncher = String(launcherPath || '').trim();
  if (
    !path.isAbsolute(manifestLauncher) ||
    !path.isAbsolute(expectedLauncher) ||
    path.resolve(manifestLauncher) !== path.resolve(expectedLauncher)
  ) {
    issues.push('launcher_path');
  }

  const allowlist = value[target.allowlistField];
  let allowlistValid =
    Array.isArray(allowlist) && allowlist.length > 0 && allowlist.every((item) => typeof item === 'string');
  if (allowlistValid && target.family === 'chromium') {
    allowlistValid = allowlist.every((item) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(item));
  }
  if (allowlistValid && target.family === 'firefox') {
    allowlistValid = allowlist.every((item) => !!item.trim() && !hasWhitespaceOrControl(item));
  }
  if (!allowlistValid) issues.push('allowlist');

  const productionAllowlist =
    target.family === 'chromium'
      ? CHROMIUM_PRODUCTION_EXTENSION_IDS.map((id) => `chrome-extension://${id}/`)
      : [FIREFOX_PRODUCTION_EXTENSION_ID];
  const productionIdentity = allowlistValid && JSON.stringify(allowlist) === JSON.stringify(productionAllowlist);
  return { valid: issues.length === 0, issues, productionIdentity };
}
