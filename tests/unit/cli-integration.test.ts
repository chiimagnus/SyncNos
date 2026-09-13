import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLI_INSTANCE_ID_STORAGE_KEY,
  CLI_INTEGRATION_ENABLED_STORAGE_KEY,
  disableCliIntegration,
  enableCliIntegration,
  getCliInstanceId,
  readCliIntegrationStatus,
} from '@services/cli/cli-integration';

const originalChrome = (globalThis as any).chrome;
const originalBrowser = (globalThis as any).browser;
const originalNavigator = globalThis.navigator;

function installChrome(options: { requestGranted?: boolean; permissionGranted?: boolean } = {}) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 Chrome/152.0 Safari/537.36' },
  });
  const store: Record<string, unknown> = {};
  let permissionGranted = options.permissionGranted === true;
  let requestCalled = false;
  const remove = vi.fn((_query: unknown, callback: (removed: boolean) => void) => {
    permissionGranted = false;
    callback(true);
  });

  (globalThis as any).browser = undefined;
  (globalThis as any).chrome = {
    runtime: {
      id: 'extension-id',
      lastError: null,
      connectNative: vi.fn(),
    },
    storage: {
      local: {
        get(keys: string[], callback: (value: Record<string, unknown>) => void) {
          callback(Object.fromEntries((keys || []).filter((key) => key in store).map((key) => [key, store[key]])));
        },
        set(items: Record<string, unknown>, callback: () => void) {
          Object.assign(store, items);
          callback();
        },
      },
    },
    permissions: {
      request(_query: unknown, callback: (granted: boolean) => void) {
        requestCalled = true;
        const granted = options.requestGranted === true;
        if (granted) permissionGranted = true;
        callback(granted);
      },
      contains(_query: unknown, callback: (granted: boolean) => void) {
        callback(permissionGranted);
      },
      remove,
      onRemoved: { addListener() {}, removeListener() {} },
    },
  };

  return { store, remove, requestCalled: () => requestCalled };
}

afterEach(() => {
  (globalThis as any).chrome = originalChrome;
  (globalThis as any).browser = originalBrowser;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

describe('CLI integration preference', () => {
  it('requests nativeMessaging immediately and persists opt-in only when granted', async () => {
    const denied = installChrome({ requestGranted: false });
    const deniedPromise = enableCliIntegration();
    expect(denied.requestCalled()).toBe(true);
    await expect(deniedPromise).resolves.toBe(false);
    expect(denied.store[CLI_INTEGRATION_ENABLED_STORAGE_KEY]).toBeUndefined();

    const granted = installChrome({ requestGranted: true });
    const grantedPromise = enableCliIntegration();
    expect(granted.requestCalled()).toBe(true);
    await expect(grantedPromise).resolves.toBe(true);
    expect(granted.store[CLI_INTEGRATION_ENABLED_STORAGE_KEY]).toBe(true);
    await expect(readCliIntegrationStatus()).resolves.toEqual({
      available: true,
      enabled: true,
      permissionGranted: true,
    });
  });

  it('persists disabled before removing the optional permission', async () => {
    const chrome = installChrome({ permissionGranted: true });
    chrome.store[CLI_INTEGRATION_ENABLED_STORAGE_KEY] = true;
    await disableCliIntegration();
    expect(chrome.store[CLI_INTEGRATION_ENABLED_STORAGE_KEY]).toBe(false);
    expect(chrome.remove).toHaveBeenCalledWith({ permissions: ['nativeMessaging'] }, expect.any(Function));
  });

  it('creates one durable CLI profile id and reuses it', async () => {
    const chrome = installChrome();
    const first = await getCliInstanceId();
    const second = await getCliInstanceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second).toBe(first);
    expect(chrome.store[CLI_INSTANCE_ID_STORAGE_KEY]).toBe(first);

    vi.resetModules();
    const reloaded = await import('@services/cli/cli-integration');
    await expect(reloaded.getCliInstanceId()).resolves.toBe(first);
  });
});
