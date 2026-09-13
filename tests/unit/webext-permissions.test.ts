import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  permissionsContains,
  permissionsOnRemoved,
  permissionsRemove,
  permissionsRequest,
} from '@platform/webext/permissions';

const originalChrome = (globalThis as any).chrome;
const originalBrowser = (globalThis as any).browser;

afterEach(() => {
  (globalThis as any).chrome = originalChrome;
  (globalThis as any).browser = originalBrowser;
});

describe('webext permissions wrapper', () => {
  it('invokes chrome.permissions.request synchronously for user-gesture preservation', async () => {
    let requestedSynchronously = false;
    (globalThis as any).browser = undefined;
    (globalThis as any).chrome = {
      runtime: { lastError: null },
      permissions: {
        request(query: unknown, callback: (granted: boolean) => void) {
          requestedSynchronously = true;
          expect(query).toEqual({ permissions: ['nativeMessaging'] });
          callback(true);
        },
      },
    };

    const pending = permissionsRequest(['nativeMessaging']);
    expect(requestedSynchronously).toBe(true);
    await expect(pending).resolves.toBe(true);
  });

  it('normalizes browser promise contains/remove and removable onRemoved listener', async () => {
    let removedListener: ((change: any) => void) | null = null;
    const removeListener = vi.fn();
    (globalThis as any).chrome = undefined;
    (globalThis as any).browser = {
      permissions: {
        contains: vi.fn(async () => true),
        remove: vi.fn(async () => true),
        onRemoved: {
          addListener(listener: (change: any) => void) {
            removedListener = listener;
          },
          removeListener,
        },
      },
    };

    await expect(permissionsContains(['nativeMessaging'])).resolves.toBe(true);
    await expect(permissionsRemove(['nativeMessaging'])).resolves.toBe(true);
    const listener = vi.fn();
    const unsubscribe = permissionsOnRemoved(listener);
    removedListener?.({ permissions: ['nativeMessaging'] });
    expect(listener).toHaveBeenCalledWith({ permissions: ['nativeMessaging'] });
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
