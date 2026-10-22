import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: storage.get,
  storageSet: storage.set,
  storageRemove: storage.remove,
}));

import {
  IN_APP_SHORTCUT_ACTIONS,
  IN_APP_SHORTCUT_STORAGE_KEY,
  InAppShortcutBindingError,
  defaultInAppShortcutBindings,
  normalizeInAppShortcut,
  readInAppShortcutBindings,
  resetInAppShortcutBindings,
  resolveInAppShortcutBindings,
  shortcutFromKeyEvent,
  updateInAppShortcutBinding,
} from '@services/shortcuts/in-app-shortcuts';

let persisted: Record<string, unknown>;

beforeEach(() => {
  persisted = {};
  storage.get.mockReset().mockImplementation(async () => ({ [IN_APP_SHORTCUT_STORAGE_KEY]: persisted }));
  storage.set.mockReset().mockImplementation(async (patch: Record<string, unknown>) => {
    persisted = patch[IN_APP_SHORTCUT_STORAGE_KEY] as Record<string, unknown>;
  });
  storage.remove.mockReset().mockImplementation(async () => {
    persisted = {};
  });
});

describe('in-app shortcut contract', () => {
  it('lists each reachable action once and starts with non-conflicting defaults', () => {
    const ids = IN_APP_SHORTCUT_ACTIONS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const defaults = defaultInAppShortcutBindings();
    const assigned = Object.values(defaults).filter(Boolean);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(ids.length).toBeGreaterThan(30);
  });

  it('accepts platform-neutral modifiers, alphabet, digit and arrow keys, but not bare or unsupported keys', () => {
    expect(normalizeInAppShortcut('Alt+Shift+b')).toBe('Alt+Shift+B');
    expect(normalizeInAppShortcut('Shift+Mod+1')).toBe('Mod+Shift+1');
    expect(normalizeInAppShortcut('Alt+ArrowDown')).toBe('Alt+ArrowDown');
    expect(normalizeInAppShortcut('Ctrl+F12')).toBe('Ctrl+F12');
    for (const invalid of ['S', 'Shift+X', 'Alt+', 'Ctrl+Control', 'Ctrl+Ctrl+X', 'Ctrl+!', 'Alt+Space', null]) {
      expect(normalizeInAppShortcut(invalid)).toBeNull();
    }
    expect(normalizeInAppShortcut('Mod+W')).toBeNull();
    expect(normalizeInAppShortcut('Mod+C')).toBeNull();
    expect(normalizeInAppShortcut('Alt+ArrowLeft')).toBeNull();
    expect(normalizeInAppShortcut('')).toBe('');
  });

  it('captures the same logical key on macOS and Windows, including shifted digits', () => {
    const event = { key: 'B', code: 'KeyB', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
    expect(shortcutFromKeyEvent(event, true)).toBe('Mod+Shift+B');
    expect(shortcutFromKeyEvent({ ...event, metaKey: false, ctrlKey: true }, false)).toBe('Mod+Shift+B');
    expect(shortcutFromKeyEvent({ ...event, key: '!', code: 'Digit1' }, true)).toBe('Mod+Shift+1');
    expect(shortcutFromKeyEvent({ ...event, key: '∫', code: 'KeyB', metaKey: false, altKey: true }, true)).toBe(
      'Alt+Shift+B',
    );
    expect(shortcutFromKeyEvent({ ...event, key: 'Dead', code: 'KeyA' }, true)).toBeNull();
  });

  it('merges overrides, preserving explicit blank values and dropping unknown or malformed entries', () => {
    const defaults = defaultInAppShortcutBindings();
    const result = resolveInAppShortcutBindings({
      'toggle-sidebar': '',
      'open-settings': 'Ctrl+Alt+9',
      'filter-source': 'bad',
      __proto__: 'Alt+B',
      'future-action': 'Alt+F',
    });
    expect(result['toggle-sidebar']).toBe('');
    expect(result['open-settings']).toBe('Ctrl+Alt+9');
    expect(result['filter-source']).toBe(defaults['filter-source']);
    expect(Object.keys(result)).toHaveLength(IN_APP_SHORTCUT_ACTIONS.length);
  });

  it('allows rebinding and clearing default keys, blocks conflicts without writing', async () => {
    const initial = await readInAppShortcutBindings();
    expect(initial['toggle-sidebar']).toBe('Alt+Shift+B');

    await updateInAppShortcutBinding('toggle-sidebar', '');
    expect((await readInAppShortcutBindings())['toggle-sidebar']).toBe('');
    await updateInAppShortcutBinding('filter-site', 'Ctrl+Alt+Q');
    expect((await readInAppShortcutBindings())['filter-site']).toBe('Ctrl+Alt+Q');

    const callsBefore = storage.set.mock.calls.length;
    await expect(updateInAppShortcutBinding('open-settings', 'Ctrl+Alt+Q')).rejects.toMatchObject({
      code: 'conflict',
      conflictingAction: 'filter-site',
    } satisfies Partial<InAppShortcutBindingError>);
    expect(storage.set).toHaveBeenCalledTimes(callsBefore);

    await updateInAppShortcutBinding('toggle-sidebar', 'Alt+Shift+B');
    expect(persisted['toggle-sidebar']).toBeUndefined();
  });

  it('rejects malformed keys and handles storage failures without fictitious success', async () => {
    await expect(updateInAppShortcutBinding('filter-source', 'Shift+A')).rejects.toMatchObject({ code: 'invalid' });
    expect(storage.set).not.toHaveBeenCalled();

    storage.set.mockRejectedValueOnce(new Error('storage denied'));
    await expect(updateInAppShortcutBinding('filter-source', 'Ctrl+Alt+Q')).rejects.toThrow('storage denied');
  });

  it('restores defaults by removing only the in-app setting', async () => {
    await updateInAppShortcutBinding('filter-source', '');
    await expect(resetInAppShortcutBindings()).resolves.toEqual(defaultInAppShortcutBindings());
    expect(storage.remove).toHaveBeenCalledWith([IN_APP_SHORTCUT_STORAGE_KEY]);
  });

  it('does not execute duplicate imported values when storage is corrupted', () => {
    const result = resolveInAppShortcutBindings({ 'toggle-sidebar': 'Alt+Shift+P' });
    expect(result['toggle-sidebar']).toBe('Alt+Shift+P');
    expect(result['open-settings']).toBe('');
  });
});
