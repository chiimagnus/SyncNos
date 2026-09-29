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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

  it('serializes concurrent open requests so repeated shortcuts cannot create duplicate tabs', async () => {
    const created = {
      id: 9,
      windowId: 15,
      url: 'chrome-extension://syncnos/app.html#/',
    };
    const create = deferred<typeof created>();
    const createStarted = deferred<void>();
    tabsQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);
    tabsCreate.mockImplementationOnce(() => {
      createStarted.resolve();
      return create.promise;
    });

    const first = openOrFocusExtensionAppTab({ route: '/' });
    const second = openOrFocusExtensionAppTab({ route: '/' });
    await createStarted.promise;

    expect(tabsQuery).toHaveBeenCalledTimes(1);
    expect(tabsCreate).toHaveBeenCalledTimes(1);

    create.resolve(created);
    await Promise.all([first, second]);

    expect(tabsQuery).toHaveBeenCalledTimes(2);
    expect(tabsCreate).toHaveBeenCalledTimes(1);
    expect(tabsUpdate).toHaveBeenCalledWith(9, { active: true });
    expect(windowsUpdate).toHaveBeenCalledWith(15, { focused: true });
  });

  it('shares the same serialization between background ensure and foreground open', async () => {
    const created = {
      id: 11,
      windowId: 16,
      url: 'chrome-extension://syncnos/app.html#/',
    };
    const create = deferred<typeof created>();
    const createStarted = deferred<void>();
    tabsQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);
    tabsCreate.mockImplementationOnce(() => {
      createStarted.resolve();
      return create.promise;
    });

    const ensure = ensureExtensionAppTab();
    const open = openOrFocusExtensionAppTab({ route: '/' });
    await createStarted.promise;

    expect(tabsCreate).toHaveBeenCalledTimes(1);

    create.resolve(created);
    await Promise.all([ensure, open]);

    expect(tabsCreate).toHaveBeenCalledTimes(1);
    expect(tabsUpdate).toHaveBeenCalledWith(11, { active: true });
  });
});
