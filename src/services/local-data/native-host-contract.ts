import rawContract from './native-host-contract.json';

export type ChromiumHostIdentity = Readonly<{
  runtimeId: string;
  origin: string;
}>;

export type NativeHostContract = Readonly<{
  version: 1;
  host: Readonly<{
    name: string;
    protocolVersion: number;
    schemaVersion: number;
    databaseRelativePath: 'syncnos.sqlite';
    nativeManifestVersion: 1;
    manifestFormat: 'native-messaging-v1';
  }>;
  browsers: Readonly<{
    chrome: ChromiumHostIdentity;
    edge: ChromiumHostIdentity;
    firefox: Readonly<{
      geckoId: string;
      allowedExtension: string;
      strictMinVersion: string;
    }>;
    safari: Readonly<{
      localDataSupported: false;
    }>;
  }>;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, label: string, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected fields`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}

function chromiumIdentity(value: unknown, label: string): ChromiumHostIdentity {
  const identity = record(value, label);
  exactKeys(identity, label, ['runtimeId', 'origin']);
  const runtimeId = string(identity.runtimeId, `${label}.runtimeId`);
  const origin = string(identity.origin, `${label}.origin`);
  if (!/^[a-p]{32}$/.test(runtimeId)) throw new Error(`${label}.runtimeId must be a Chromium extension id`);
  if (origin !== `chrome-extension://${runtimeId}/` || origin.includes('*')) {
    throw new Error(`${label}.origin must be the exact extension origin`);
  }
  return { runtimeId, origin };
}

export function parseNativeHostContract(input: unknown): NativeHostContract {
  const root = record(input, 'native host contract');
  exactKeys(root, 'native host contract', ['version', 'host', 'browsers']);
  if (root.version !== 1) throw new Error('native host contract version must be 1');

  const host = record(root.host, 'host');
  exactKeys(host, 'host', [
    'name',
    'protocolVersion',
    'schemaVersion',
    'databaseRelativePath',
    'nativeManifestVersion',
    'manifestFormat',
  ]);
  const hostName = string(host.name, 'host.name');
  if (!/^[a-z0-9]+(?:[._][a-z0-9]+)*$/.test(hostName)) throw new Error('host.name is invalid');
  if (host.databaseRelativePath !== 'syncnos.sqlite')
    throw new Error('host.databaseRelativePath must be syncnos.sqlite');
  if (host.nativeManifestVersion !== 1) throw new Error('host.nativeManifestVersion must be 1');
  if (host.manifestFormat !== 'native-messaging-v1') throw new Error('host.manifestFormat is invalid');

  const browsers = record(root.browsers, 'browsers');
  exactKeys(browsers, 'browsers', ['chrome', 'edge', 'firefox', 'safari']);
  const chrome = chromiumIdentity(browsers.chrome, 'browsers.chrome');
  const edge = chromiumIdentity(browsers.edge, 'browsers.edge');
  if (chrome.runtimeId === edge.runtimeId || chrome.origin === edge.origin) {
    throw new Error('Chromium browser identities must be distinct');
  }

  const firefox = record(browsers.firefox, 'browsers.firefox');
  exactKeys(firefox, 'browsers.firefox', ['geckoId', 'allowedExtension', 'strictMinVersion']);
  const geckoId = string(firefox.geckoId, 'browsers.firefox.geckoId');
  const allowedExtension = string(firefox.allowedExtension, 'browsers.firefox.allowedExtension');
  const strictMinVersion = string(firefox.strictMinVersion, 'browsers.firefox.strictMinVersion');
  if (!/^[^@\s]+@[^@\s]+$/.test(geckoId) || allowedExtension !== geckoId) {
    throw new Error('Firefox identity must use one exact Gecko id');
  }
  if (!/^\d+(?:\.\d+){0,2}$/.test(strictMinVersion)) throw new Error('Firefox minimum version is invalid');

  const safari = record(browsers.safari, 'browsers.safari');
  exactKeys(safari, 'browsers.safari', ['localDataSupported']);
  if (safari.localDataSupported !== false) throw new Error('Safari local data must stay unsupported');

  return {
    version: 1,
    host: {
      name: hostName,
      protocolVersion: positiveInteger(host.protocolVersion, 'host.protocolVersion'),
      schemaVersion: positiveInteger(host.schemaVersion, 'host.schemaVersion'),
      databaseRelativePath: 'syncnos.sqlite',
      nativeManifestVersion: 1,
      manifestFormat: 'native-messaging-v1',
    },
    browsers: {
      chrome,
      edge,
      firefox: { geckoId, allowedExtension, strictMinVersion },
      safari: { localDataSupported: false },
    },
  };
}

export const nativeHostContract = parseNativeHostContract(rawContract);
