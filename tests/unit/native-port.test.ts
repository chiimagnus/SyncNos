import { afterEach, describe, expect, it } from 'vitest';

import {
  canConnectNativeHost,
  detectNativeMessagingBrowserFamily,
  readExtensionRuntimeMetadata,
} from '@platform/native-messaging/native-port';

const originalChrome = (globalThis as any).chrome;
const originalBrowser = (globalThis as any).browser;
const originalNavigator = globalThis.navigator;

function setUserAgent(userAgent: string) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent },
  });
}

afterEach(() => {
  (globalThis as any).chrome = originalChrome;
  (globalThis as any).browser = originalBrowser;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

describe('Native Messaging browser metadata', () => {
  it.each([
    ['Mozilla/5.0 Chrome/152.0 Safari/537.36', 'chromium'],
    ['Mozilla/5.0 Helium/1.0 Chrome/152.0 Safari/537.36', 'chromium'],
    ['Mozilla/5.0 Firefox/145.0', 'firefox'],
    ['Mozilla/5.0 Zen/1.0 Firefox/145.0', 'firefox'],
    ['Mozilla/5.0 Version/18.6 Safari/605.1.15', 'unknown'],
  ])('classifies %s without treating Safari as Chromium', (userAgent, expected) => {
    setUserAgent(userAgent);
    expect(detectNativeMessagingBrowserFamily()).toBe(expected);
  });

  it('keeps the CLI bridge unavailable for unsupported browser families even if connectNative exists', () => {
    setUserAgent('Mozilla/5.0 Version/18.6 Safari/605.1.15');
    (globalThis as any).browser = undefined;
    (globalThis as any).chrome = { runtime: { connectNative() {} } };
    expect(canConnectNativeHost()).toBe(false);
  });

  it('returns extension metadata for a supported Chromium runtime', () => {
    setUserAgent('Mozilla/5.0 Chrome/152.0 Safari/537.36');
    (globalThis as any).browser = undefined;
    (globalThis as any).chrome = {
      runtime: {
        id: 'extension-id',
        connectNative() {},
        getManifest: () => ({ version: '1.2.3' }),
      },
    };
    expect(readExtensionRuntimeMetadata()).toEqual({
      runtimeId: 'extension-id',
      extensionVersion: '1.2.3',
      browserFamily: 'chromium',
    });
  });
});
