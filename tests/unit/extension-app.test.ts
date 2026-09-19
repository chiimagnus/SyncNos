import { beforeEach, describe, expect, it, vi } from 'vitest';

const tabsCreate = vi.fn();
const tabsQuery = vi.fn();
const tabsUpdate = vi.fn();
const windowsUpdate = vi.fn();

vi.mock('@platform/runtime/runtime', () => ({
  getURL: (path: string) => `chrome-extension://syncnos${path}`,
}));

vi.mock('@platform/webext/tabs', () => ({
  tabsCreate: (...args: any[]) => tabsCreate(...args),
  tabsQuery: (...args: any[]) => tabsQuery(...args),
  tabsUpdate: (...args: any[]) => tabsUpdate(...args),
}));

vi.mock('@platform/webext/windows', () => ({
  windowsUpdate: (...args: any[]) => windowsUpdate(...args),
}));

import { ensureExtensionAppTab, openOrFocusExtensionAppTab } from '@platform/webext/extension-app';

describe('extension app tab routing', () => {
  beforeEach(() => {
    tabsCreate.mockReset();
    tabsQuery.mockReset();
    tabsUpdate.mockReset();
    windowsUpdate.mockReset();
    tabsCreate.mockResolvedValue({ id: 2, url: 'chrome-extension://syncnos/app.html' });
    tabsQuery.mockResolvedValue([]);
    tabsUpdate.mockResolvedValue(null);
    windowsUpdate.mockResolvedValue(null);
  });

  it('reuses an exact app.html tab and updates the hash route', async () => {
    tabsQuery.mockResolvedValue([
      {
        id: 1,
        windowId: 10,
        url: 'chrome-extension://syncnos/app.html#/settings',
      },
    ]);

    await openOrFocusExtensionAppTab({ route: '/settings?section=aboutyou' });

    expect(windowsUpdate).toHaveBeenCalledWith(10, { focused: true });
    expect(tabsUpdate).toHaveBeenCalledWith(1, {
      active: true,
      url: 'chrome-extension://syncnos/app.html#/settings?section=aboutyou',
    });
    expect(tabsUpdate.mock.invocationCallOrder[0]).toBeLessThan(windowsUpdate.mock.invocationCallOrder[0]);
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('does not reuse URLs that only share the app.html prefix', async () => {
    tabsQuery.mockResolvedValue([
      {
        id: 1,
        windowId: 10,
        url: 'chrome-extension://syncnos/app.html-old#/settings',
      },
    ]);

    await openOrFocusExtensionAppTab({ route: '/' });

    expect(windowsUpdate).not.toHaveBeenCalled();
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsCreate).toHaveBeenCalledWith({
      active: true,
      url: 'chrome-extension://syncnos/app.html#/',
    });
  });

  it('does not reuse legacy query-string app.html URLs', async () => {
    tabsQuery.mockResolvedValue([
      {
        id: 1,
        windowId: 10,
        url: 'chrome-extension://syncnos/app.html?loc=legacy',
      },
    ]);

    await openOrFocusExtensionAppTab({ route: '/' });

    expect(windowsUpdate).not.toHaveBeenCalled();
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsCreate).toHaveBeenCalledWith({
      active: true,
      url: 'chrome-extension://syncnos/app.html#/',
    });
  });

  it('opens the hash-router root when no route is provided', async () => {
    await openOrFocusExtensionAppTab();

    expect(tabsCreate).toHaveBeenCalledWith({
      active: true,
      url: 'chrome-extension://syncnos/app.html#/',
    });
  });

  it('reuses an existing app tab without focusing, activating, or changing its route', async () => {
    const existing = {
      id: 7,
      windowId: 12,
      url: 'chrome-extension://syncnos/app.html#/settings?section=github',
      active: false,
    };
    tabsQuery.mockResolvedValue([existing]);

    await expect(ensureExtensionAppTab()).resolves.toBe(existing);

    expect(windowsUpdate).not.toHaveBeenCalled();
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('creates a missing app tab in the background', async () => {
    await ensureExtensionAppTab();

    expect(windowsUpdate).not.toHaveBeenCalled();
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsCreate).toHaveBeenCalledWith({
      active: false,
      url: 'chrome-extension://syncnos/app.html#/',
    });
  });
});
