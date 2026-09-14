import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandsGetAll = vi.fn();
const getShortcutSettingsAccess = vi.fn();
const openShortcutSettings = vi.fn();

vi.mock('@platform/webext/commands', () => ({
  commandsGetAll: (...args: any[]) => commandsGetAll(...args),
  getShortcutSettingsAccess: (...args: any[]) => getShortcutSettingsAccess(...args),
  openShortcutSettings: (...args: any[]) => openShortcutSettings(...args),
}));

import { openKeyboardShortcutSettings, readKeyboardShortcutSnapshot } from '@services/shortcuts/keyboard-shortcuts';

describe('keyboard shortcuts service', () => {
  beforeEach(() => {
    commandsGetAll.mockReset();
    getShortcutSettingsAccess.mockReset().mockReturnValue('api');
    openShortcutSettings.mockReset().mockResolvedValue({ opened: true, access: 'api' });
  });

  it('returns browser shortcuts in stable product order', async () => {
    commandsGetAll.mockResolvedValue([
      { name: 'open-syncnos-app', description: '', shortcut: 'Ctrl+3' },
      { name: '_execute_action', description: '', shortcut: 'Ctrl+1' },
      { name: 'capture-current-page', description: '', shortcut: 'Ctrl+2' },
    ]);

    await expect(readKeyboardShortcutSnapshot()).resolves.toEqual({
      supported: true,
      managerAccess: 'openable',
      items: [
        { action: 'open-popup', shortcut: 'Ctrl+1' },
        { action: 'capture-current-page', shortcut: 'Ctrl+2' },
        { action: 'open-app', shortcut: 'Ctrl+3' },
      ],
    });
  });

  it('keeps missing browser commands as unassigned rows', async () => {
    commandsGetAll.mockResolvedValue([{ name: '_execute_action', description: '', shortcut: '⌘+Shift+Y' }]);

    const snapshot = await readKeyboardShortcutSnapshot();

    expect(snapshot.items).toEqual([
      { action: 'open-popup', shortcut: '⌘+Shift+Y' },
      { action: 'capture-current-page', shortcut: '' },
      { action: 'open-app', shortcut: '' },
    ]);
  });

  it('preserves shortcut strings without parsing or rewriting them', async () => {
    commandsGetAll.mockResolvedValue([{ name: 'capture-current-page', description: '', shortcut: 'Ctrl+Shift+Y' }]);

    const snapshot = await readKeyboardShortcutSnapshot();

    expect(snapshot.items[1].shortcut).toBe('Ctrl+Shift+Y');
  });

  it('returns a stable unsupported snapshot when command discovery fails', async () => {
    getShortcutSettingsAccess.mockReturnValue('unsupported');
    commandsGetAll.mockRejectedValue(new Error('commands unavailable'));

    await expect(readKeyboardShortcutSnapshot()).resolves.toEqual({
      supported: false,
      managerAccess: 'unsupported',
      items: [
        { action: 'open-popup', shortcut: '' },
        { action: 'capture-current-page', shortcut: '' },
        { action: 'open-app', shortcut: '' },
      ],
    });
  });

  it('maps platform manager access without leaking platform details', async () => {
    commandsGetAll.mockResolvedValue([]);
    getShortcutSettingsAccess.mockReturnValue('manual');

    const snapshot = await readKeyboardShortcutSnapshot();

    expect(snapshot.managerAccess).toBe('manual');
  });

  it('converts manager open failures into stable manual or unsupported results', async () => {
    openShortcutSettings.mockResolvedValueOnce({ opened: false, access: 'manual' });
    await expect(openKeyboardShortcutSettings()).resolves.toBe('manual');

    openShortcutSettings.mockResolvedValueOnce({ opened: false, access: 'unsupported' });
    await expect(openKeyboardShortcutSettings()).resolves.toBe('unsupported');

    openShortcutSettings.mockRejectedValueOnce(new Error('unexpected'));
    await expect(openKeyboardShortcutSettings()).resolves.toBe('manual');
  });
});
