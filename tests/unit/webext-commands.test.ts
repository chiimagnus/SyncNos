import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getURL = vi.fn();
const tabsCreate = vi.fn();

vi.mock('@platform/runtime/runtime', () => ({
  getURL: (...args: any[]) => getURL(...args),
}));

vi.mock('@platform/webext/tabs', () => ({
  tabsCreate: (...args: any[]) => tabsCreate(...args),
}));

import {
  commandsGetAll,
  commandsOnCommand,
  getShortcutSettingsAccess,
  openShortcutSettings,
} from '@platform/webext/commands';

const previousBrowser = (globalThis as any).browser;
const previousChrome = (globalThis as any).chrome;

describe('WebExtension commands adapter', () => {
  beforeEach(() => {
    delete (globalThis as any).browser;
    delete (globalThis as any).chrome;
    getURL.mockReset().mockReturnValue('chrome-extension://syncnos/');
    tabsCreate.mockReset().mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousBrowser === undefined) delete (globalThis as any).browser;
    else (globalThis as any).browser = previousBrowser;
    if (previousChrome === undefined) delete (globalThis as any).chrome;
    else (globalThis as any).chrome = previousChrome;
  });

  it('prefers the browser commands listener when available', () => {
    const browserAddListener = vi.fn();
    const chromeAddListener = vi.fn();
    const listener = vi.fn();
    (globalThis as any).browser = { commands: { onCommand: { addListener: browserAddListener } } };
    (globalThis as any).chrome = { commands: { onCommand: { addListener: chromeAddListener } } };

    expect(commandsOnCommand(listener)).toBe(true);

    expect(browserAddListener).toHaveBeenCalledWith(listener);
    expect(chromeAddListener).not.toHaveBeenCalled();
  });

  it('falls back to the chrome commands listener', () => {
    const chromeAddListener = vi.fn();
    const listener = vi.fn();
    (globalThis as any).chrome = { commands: { onCommand: { addListener: chromeAddListener } } };

    expect(commandsOnCommand(listener)).toBe(true);

    expect(chromeAddListener).toHaveBeenCalledWith(listener);
  });

  it('contains browser listener registration failures without retrying another namespace', () => {
    const chromeAddListener = vi.fn();
    const listener = vi.fn();
    (globalThis as any).browser = {
      commands: {
        onCommand: {
          addListener: () => {
            throw new Error('browser failed');
          },
        },
      },
    };
    (globalThis as any).chrome = { commands: { onCommand: { addListener: chromeAddListener } } };

    expect(commandsOnCommand(listener)).toBe(false);
    expect(chromeAddListener).not.toHaveBeenCalled();
  });

  it('returns false when the commands API is unavailable', () => {
    expect(commandsOnCommand(vi.fn())).toBe(false);
  });

  it('reads and normalizes browser commands through the Promise API', async () => {
    (globalThis as any).browser = {
      commands: {
        getAll: vi
          .fn()
          .mockResolvedValue([{ name: 'capture-current-page', description: 'Capture', shortcut: '⌘+Shift+Y' }]),
      },
    };

    await expect(commandsGetAll()).resolves.toEqual([
      { name: 'capture-current-page', description: 'Capture', shortcut: '⌘+Shift+Y' },
    ]);
  });

  it('falls back to the chrome callback getAll API when the browser API is absent', async () => {
    (globalThis as any).chrome = {
      runtime: {},
      commands: {
        getAll: vi.fn((callback: (commands: unknown[]) => void) => {
          callback([{ name: 'open-syncnos-app', description: 'Open', shortcut: 'Ctrl+Shift+Y' }]);
        }),
      },
    };

    await expect(commandsGetAll()).resolves.toEqual([
      { name: 'open-syncnos-app', description: 'Open', shortcut: 'Ctrl+Shift+Y' },
    ]);
  });

  it('propagates browser getAll failures without retrying the chrome alias', async () => {
    const chromeGetAll = vi.fn();
    (globalThis as any).browser = {
      commands: { getAll: vi.fn().mockRejectedValue(new Error('browser commands failed')) },
    };
    (globalThis as any).chrome = {
      runtime: {},
      commands: { getAll: chromeGetAll },
    };

    await expect(commandsGetAll()).rejects.toThrow('browser commands failed');
    expect(chromeGetAll).not.toHaveBeenCalled();
  });

  it('rejects chrome getAll when runtime.lastError is set', async () => {
    (globalThis as any).chrome = {
      runtime: { lastError: { message: 'commands blocked' } },
      commands: { getAll: vi.fn((callback: (commands: unknown[]) => void) => callback([])) },
    };

    await expect(commandsGetAll()).rejects.toThrow('commands blocked');
  });

  it('rejects when command discovery is unavailable', async () => {
    await expect(commandsGetAll()).rejects.toThrow('commands.getAll unavailable');
  });

  it('prefers the native shortcut-settings API without creating a tab', async () => {
    const openShortcutSettingsApi = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).browser = { commands: { openShortcutSettings: openShortcutSettingsApi } };

    expect(getShortcutSettingsAccess()).toBe('api');
    await expect(openShortcutSettings()).resolves.toEqual({ opened: true, access: 'api' });
    expect(openShortcutSettingsApi).toHaveBeenCalledTimes(1);
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('opens the Chrome shortcut manager for Chromium extension URLs', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36' });

    expect(getShortcutSettingsAccess()).toBe('chromium-url');
    await expect(openShortcutSettings()).resolves.toEqual({ opened: true, access: 'chromium-url' });
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts', active: true });
  });

  it('opens the Edge shortcut manager for Edge user agents', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0' });

    await expect(openShortcutSettings()).resolves.toEqual({ opened: true, access: 'chromium-url' });
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'edge://extensions/shortcuts', active: true });
  });

  it('uses manual guidance for non-Chromium extension schemes without a native API', async () => {
    getURL.mockReturnValue('moz-extension://syncnos/');

    expect(getShortcutSettingsAccess()).toBe('manual');
    await expect(openShortcutSettings()).resolves.toEqual({ opened: false, access: 'manual' });
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('downgrades an internal manager open failure to manual guidance', async () => {
    tabsCreate.mockRejectedValueOnce(new Error('blocked internal URL'));

    await expect(openShortcutSettings()).resolves.toEqual({ opened: false, access: 'manual' });
  });
});
