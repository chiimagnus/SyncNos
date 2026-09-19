import {
  permissionsApiAvailable,
  permissionsContains,
  permissionsRemove,
  permissionsRequest,
} from '@platform/webext/permissions';
import { detectNativeMessagingBrowserFamily } from '@platform/native-messaging/native-port';
import { storageGet, storageSet } from '@services/shared/storage';

export const CLI_INTEGRATION_ENABLED_STORAGE_KEY = 'syncnos_cli_integration_enabled_v1';
export const CLI_INSTANCE_ID_STORAGE_KEY = 'syncnos_cli_instance_id_v1';
export const NATIVE_MESSAGING_PERMISSION = 'nativeMessaging';

export type CliIntegrationCapability = {
  available: boolean;
  permissionGranted: boolean;
};

let instanceIdPromise: Promise<string> | null = null;

function isCliIntegrationAvailable(): boolean {
  // Chromium-derived browsers may hide runtime.connectNative until the optional
  // nativeMessaging permission is granted. Availability must describe whether
  // the permission can be requested, not whether the gated API is visible yet.
  return permissionsApiAvailable() && detectNativeMessagingBrowserFamily() !== 'unknown';
}

export async function readCliIntegrationCapability(): Promise<CliIntegrationCapability> {
  const available = isCliIntegrationAvailable();
  const permissionGranted = available
    ? await permissionsContains([NATIVE_MESSAGING_PERMISSION]).catch(() => false)
    : false;
  return { available, permissionGranted };
}

export async function readCliIntegrationEnabled(): Promise<boolean> {
  const stored = await storageGet([CLI_INTEGRATION_ENABLED_STORAGE_KEY]);
  return stored[CLI_INTEGRATION_ENABLED_STORAGE_KEY] === true;
}

export function enableCliIntegration(): Promise<boolean> {
  if (!isCliIntegrationAvailable()) return Promise.resolve(false);

  // permissions.request must happen synchronously in the user gesture call stack.
  const requested = permissionsRequest([NATIVE_MESSAGING_PERMISSION]);
  return requested.then(async (granted) => {
    if (!granted) return false;
    await storageSet({ [CLI_INTEGRATION_ENABLED_STORAGE_KEY]: true });
    return true;
  });
}

export async function disableCliIntegration(): Promise<void> {
  await storageSet({ [CLI_INTEGRATION_ENABLED_STORAGE_KEY]: false });
  if (!permissionsApiAvailable()) return;
  await permissionsRemove([NATIVE_MESSAGING_PERMISSION]).catch(() => false);
}

export async function disableCliIntegrationAfterPermissionRemoval(): Promise<void> {
  await storageSet({ [CLI_INTEGRATION_ENABLED_STORAGE_KEY]: false });
}

export function getCliInstanceId(): Promise<string> {
  if (instanceIdPromise) return instanceIdPromise;
  instanceIdPromise = (async () => {
    const stored = await storageGet([CLI_INSTANCE_ID_STORAGE_KEY]);
    const existing = String(stored[CLI_INSTANCE_ID_STORAGE_KEY] || '').trim();
    if (existing) return existing;

    const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    if (!randomUUID) throw new Error('crypto.randomUUID unavailable');
    const created = randomUUID();
    await storageSet({ [CLI_INSTANCE_ID_STORAGE_KEY]: created });
    return created;
  })().catch((error) => {
    instanceIdPromise = null;
    throw error;
  });
  return instanceIdPromise;
}
