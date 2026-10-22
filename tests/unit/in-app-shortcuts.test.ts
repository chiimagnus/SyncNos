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
  displayInAppShortcut,
  displayInAppShortcutParts,
  shortcutModifiersFromKeyEvent,
  isShortcutModifierKey,
  inAppShortcutMatches,
  inAppShortcutsConflict,
  shortcutPlatform,
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
    expect(defaults['toggle-sidebar']).toBe('Mod+Backslash');
    expect(ids.length).toBeGreaterThan(30);
  });

  it('accepts full keyboard keys and normalizes old left/right modifier bindings', () => {
    expect(normalizeInAppShortcut('Alt+Shift+b')).toBe('Alt+Shift+B');
    expect(normalizeInAppShortcut('Shift+Mod+1')).toBe('Mod+Shift+1');
    expect(normalizeInAppShortcut('Alt+ArrowDown')).toBe('Alt+ArrowDown');
    expect(normalizeInAppShortcut('Ctrl+F12')).toBe('Ctrl+F12');
    for (const valid of [
      'S',
      'Shift+X',
      'Alt+Space',
      'Ctrl+BracketLeft',
      'Shift+Tab',
      'Numpad0',
      'Alt+NumpadAdd',
      'Ctrl+Meta+F24',
      'Ctrl+IntlYen',
      'PageDown',
      'Alt+Backspace',
      'Shift+Enter',
      'Ctrl+PrintScreen',
    ]) {
      expect(normalizeInAppShortcut(valid)).toBe(valid);
    }
    for (const invalid of [
      'Alt+',
      'Ctrl+Control',
      'Ctrl+Ctrl+X',
      'Alt+alt+B',
      'Ctrl+!',
      'Tab',
      'Escape',
      'Fn+X',
      '__proto__+X',
      'constructor+X',
      null,
    ]) {
      expect(normalizeInAppShortcut(invalid)).toBeNull();
    }
    expect(normalizeInAppShortcut('Mod+W')).toBeNull();
    expect(normalizeInAppShortcut('Mod+C')).toBeNull();
    expect(normalizeInAppShortcut('AltLeft+NumpadAdd')).toBe('Alt+NumpadAdd');
    expect(normalizeInAppShortcut('ControlRight+MetaLeft+F24')).toBe('Ctrl+Meta+F24');
    expect(normalizeInAppShortcut('AltLeft+AltRight+X')).toBe('Alt+X');
    expect(normalizeInAppShortcut('Alt+AltLeft+X')).toBeNull();
    expect(normalizeInAppShortcut('Alt+ArrowLeft')).toBeNull();
    expect(normalizeInAppShortcut('AltLeft+ArrowLeft')).toBeNull();
    expect(normalizeInAppShortcut('ControlRight+W')).toBeNull();
    expect(normalizeInAppShortcut('MetaLeft+W')).toBeNull();
    expect(normalizeInAppShortcut('')).toBe('');
  });

  it('captures the same logical key on macOS and Windows, including shifted digits', () => {
    const event = { key: 'B', code: 'KeyB', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
    expect(shortcutFromKeyEvent(event, 'mac')).toBe('Mod+Shift+B');
    expect(shortcutFromKeyEvent({ ...event, metaKey: false, ctrlKey: true }, 'windows')).toBe('Mod+Shift+B');
    expect(shortcutFromKeyEvent({ ...event, key: '!', code: 'Digit1' }, 'mac')).toBe('Mod+Shift+1');
    expect(shortcutFromKeyEvent({ ...event, key: '∫', code: 'KeyB', metaKey: false, altKey: true }, 'mac')).toBe(
      'Alt+Shift+B',
    );
    expect(shortcutFromKeyEvent({ ...event, key: 'Dead', code: 'KeyA' }, 'mac')).toBe('Mod+Shift+A');
    expect(shortcutFromKeyEvent({ ...event, key: 'Dead', code: 'Unidentified' }, 'mac')).toBeNull();
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

  it('keeps previously saved shortcut choices while changing the default sidebar key', async () => {
    persisted = { 'toggle-sidebar': 'Alt+Shift+B' };
    expect((await readInAppShortcutBindings())['toggle-sidebar']).toBe('Alt+Shift+B');
    expect(defaultInAppShortcutBindings()['toggle-sidebar']).toBe('Mod+Backslash');
  });

  it('allows rebinding and clearing default keys, blocks conflicts without writing', async () => {
    const initial = await readInAppShortcutBindings();
    expect(initial['toggle-sidebar']).toBe('Mod+Backslash');

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

    await updateInAppShortcutBinding('toggle-sidebar', 'Mod+Backslash');
    expect(persisted['toggle-sidebar']).toBeUndefined();
  });

  it('rejects malformed keys and handles storage failures without fictitious success', async () => {
    await expect(updateInAppShortcutBinding('filter-source', 'Ctrl+Control')).rejects.toMatchObject({
      code: 'invalid',
    });
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
  it('drops only conflicting stored assignments, not keys overlapping an already rejected entry', () => {
    const bindings = resolveInAppShortcutBindings({
      'toggle-sidebar': 'Mod+Ctrl+Y', // usable on macOS
      'filter-source': 'Ctrl+Meta+Y', // overlaps the first on macOS
      'filter-site': 'Mod+Meta+Y', // usable on Windows, not overlapping the first
    });
    expect(bindings['toggle-sidebar']).toBe('Mod+Ctrl+Y');
    expect(bindings['filter-source']).toBe('');
    expect(bindings['filter-site']).toBe('Mod+Meta+Y');
  });

  it('identifies macOS, Windows, Linux, ChromeOS and unknown systems and displays their own keyboard names', () => {
    const platform = (name: string) => shortcutPlatform({ platform: name, userAgent: '' });
    expect(platform('MacIntel')).toBe('mac');
    expect(platform('Win32')).toBe('windows');
    expect(platform('Linux x86_64')).toBe('linux');
    expect(platform('CrOS x86_64')).toBe('chromeos');
    expect(platform('UnknownOS')).toBe('other');
    expect(displayInAppShortcut('Mod+AltLeft+ShiftRight+BracketLeft', 'mac')).toBe('⌘ + ⌥ + ⇧ + [');
    expect(displayInAppShortcut('Mod+AltLeft+ShiftRight+BracketLeft', 'windows')).toBe('Ctrl + Alt + Shift + [');
    expect(displayInAppShortcut('MetaLeft+ControlRight+Space', 'linux')).toBe('Super + Ctrl + Space');
    expect(displayInAppShortcut('MetaRight+NumpadEnter', 'chromeos')).toBe('Search + Num Enter');
    expect(displayInAppShortcut('MetaRight+NumpadEnter', 'other')).toBe('Super + Num Enter');
    expect(displayInAppShortcut('Ctrl+Backspace', 'mac')).toBe('⌃ + ⌫');
    expect(displayInAppShortcut('Alt+Delete', 'mac')).toBe('⌥ + ⌦');
    expect(displayInAppShortcut('Alt+Delete', 'windows')).toBe('Alt + Delete');
    expect(displayInAppShortcutParts('AltLeft+ShiftRight', 'mac')).toEqual(['⌥', '⇧']);
  });

  it('uses logical modifier flags and treats left and right keys identically', () => {
    const modifiers = ['Control', 'Alt', 'Shift', 'Meta'];
    for (const key of modifiers) {
      expect(isShortcutModifierKey({ key, code: `${key}Left` })).toBe(true);
      expect(isShortcutModifierKey({ key, code: `${key}Right` })).toBe(true);
    }
    expect(isShortcutModifierKey({ key: 'OS', code: 'OSRight' })).toBe(true);
    expect(isShortcutModifierKey({ key: 'B', code: 'KeyB' })).toBe(false);
    const base = { key: '+', code: 'NumpadAdd', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true };
    const binding = shortcutFromKeyEvent(base, 'mac');
    expect(binding).toBe('Mod+Ctrl+Alt+Shift+NumpadAdd');
    expect(inAppShortcutMatches(binding!, binding!, 'mac')).toBe(true);
    expect(inAppShortcutMatches('ControlRight+MetaLeft+AltRight+ShiftLeft+NumpadAdd', binding!, 'mac')).toBe(false); // Must normalize stored keys first.
    expect(
      inAppShortcutMatches(
        normalizeInAppShortcut('ControlRight+MetaLeft+AltRight+ShiftLeft+NumpadAdd')!,
        binding!,
        'mac',
      ),
    ).toBe(true);
    expect(inAppShortcutMatches('Ctrl+Mod+Alt+Shift+NumpadAdd', binding!, 'mac')).toBe(true);
    expect(inAppShortcutMatches('Ctrl+Mod+Alt+Shift+NumpadAdd', binding!, 'windows')).toBe(false);
    expect(shortcutModifiersFromKeyEvent({ ...base, key: 'Alt', code: 'AltLeft' }, 'mac')).toBe('Mod+Ctrl+Alt+Shift');
    expect(shortcutModifiersFromKeyEvent({ ...base, key: 'Alt', code: 'AltRight' }, 'mac')).toBe('Mod+Ctrl+Alt+Shift');
    expect(shortcutModifiersFromKeyEvent({ ...base, ctrlKey: false, metaKey: false, shiftKey: false }, 'linux')).toBe(
      'Alt',
    );
    expect(shortcutFromKeyEvent({ ...base, key: 'B', code: 'KeyB' }, 'mac')).toBe('Mod+Ctrl+Alt+Shift+B');
  });

  it('allows all standard physical key families while protecting browser navigation and overlapping bindings', () => {
    const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    expect(shortcutFromKeyEvent({ ...base, key: '!', code: 'Digit1' }, 'linux')).toBe('1');
    expect(shortcutFromKeyEvent({ ...base, key: ' ', code: 'Space' }, 'windows')).toBe('Space');
    expect(shortcutFromKeyEvent({ ...base, key: '?', code: 'Slash' }, 'mac')).toBe('Slash');
    expect(shortcutFromKeyEvent({ ...base, key: 'Numpad1', code: 'Numpad1' }, 'mac')).toBe('Numpad1');
    expect(shortcutFromKeyEvent({ ...base, key: 'PageDown', code: 'PageDown' }, 'mac')).toBe('PageDown');
    expect(shortcutFromKeyEvent({ ...base, key: 'F24', code: 'F24' }, 'mac')).toBe('F24');
    expect(shortcutFromKeyEvent({ ...base, key: 'Fn', code: 'Fn' }, 'mac')).toBeNull();
    expect(inAppShortcutsConflict('Alt+Shift+B', 'AltLeft+ShiftRight+B')).toBe(true);
    expect(inAppShortcutsConflict('AltLeft+ShiftRight+B', 'AltRight+ShiftRight+B')).toBe(true);
    expect(inAppShortcutsConflict('Mod+Shift+K', 'ControlLeft+ShiftLeft+K')).toBe(true);
    expect(inAppShortcutsConflict('MetaLeft+Space', 'MetaRight+Space')).toBe(true);
    expect(normalizeInAppShortcut('AltLeft+Tab')).toBeNull();
  });

  it('consolidates legacy persisted sides, keeps one owner for collisions, and saves generic modifiers', async () => {
    persisted = {
      'toggle-sidebar': 'AltLeft+ShiftLeft+Y',
      'filter-source': 'AltRight+ShiftRight+Y',
      'open-settings': 'MetaRight+Slash',
    };
    const migrated = await readInAppShortcutBindings();
    expect(migrated['toggle-sidebar']).toBe('Alt+Shift+Y');
    expect(migrated['filter-source']).toBe('');
    expect(migrated['open-settings']).toBe('Meta+Slash');

    await expect(updateInAppShortcutBinding('filter-source', 'Alt+Shift+Y')).rejects.toMatchObject({
      code: 'conflict',
      conflictingAction: 'toggle-sidebar',
    });
    await updateInAppShortcutBinding('filter-source', 'AltRight+ShiftLeft+F24');
    const result = await readInAppShortcutBindings();
    expect(result['filter-source']).toBe('Alt+Shift+F24');
    expect(persisted['filter-source']).toBe('Alt+Shift+F24');
    expect(result['toggle-sidebar']).toBe('Alt+Shift+Y');
    expect(result['open-settings']).toBe('Meta+Slash');
  });

  it('rejects protected browser shortcuts even when imported with old physical-side names', () => {
    expect(normalizeInAppShortcut('AltRight+ArrowLeft')).toBeNull();
    expect(normalizeInAppShortcut('MetaLeft+W')).toBeNull();
    expect(normalizeInAppShortcut('ControlLeft+W')).toBeNull();
    expect(normalizeInAppShortcut('ShiftLeft+ShiftRight+W')).toBe('Shift+W');
  });
});
