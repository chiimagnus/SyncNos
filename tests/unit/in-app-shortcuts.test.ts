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
  heldShortcutModifiers,
  physicalModifierKey,
  inAppShortcutMatches,
  inAppShortcutsConflict,
  setHeldShortcutModifier,
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
    expect(ids.length).toBeGreaterThan(30);
  });

  it('accepts common physical keys, numpad, punctuation, bare keys, and modifier sides', () => {
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
      'AltRight+NumpadAdd',
      'ControlRight+MetaLeft+F24',
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
      null,
    ]) {
      expect(normalizeInAppShortcut(invalid)).toBeNull();
    }
    expect(normalizeInAppShortcut('Mod+W')).toBeNull();
    expect(normalizeInAppShortcut('Mod+C')).toBeNull();
    expect(normalizeInAppShortcut('Alt+ArrowLeft')).toBeNull();
    expect(normalizeInAppShortcut('AltLeft+ArrowLeft')).toBeNull();
    expect(normalizeInAppShortcut('ControlRight+W')).toBeNull();
    expect(normalizeInAppShortcut('MetaLeft+W')).toBeNull();
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
    expect(shortcutFromKeyEvent({ ...event, key: 'Dead', code: 'KeyA' }, true)).toBe('Mod+Shift+A');
    expect(shortcutFromKeyEvent({ ...event, key: 'Dead', code: 'Unidentified' }, true)).toBeNull();
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
  it('identifies macOS, Windows, Linux, ChromeOS and unknown systems and displays their own keyboard names', () => {
    const platform = (name: string) => shortcutPlatform({ platform: name, userAgent: '' });
    expect(platform('MacIntel')).toBe('mac');
    expect(platform('Win32')).toBe('windows');
    expect(platform('Linux x86_64')).toBe('linux');
    expect(platform('CrOS x86_64')).toBe('chromeos');
    expect(platform('UnknownOS')).toBe('other');
    expect(displayInAppShortcut('Mod+AltLeft+ShiftRight+BracketLeft', 'mac')).toBe('⌘ + L ⌥ + R ⇧ + [');
    expect(displayInAppShortcut('Mod+AltLeft+ShiftRight+BracketLeft', 'windows')).toBe('Ctrl + L Alt + R Shift + [');
    expect(displayInAppShortcut('MetaLeft+ControlRight+Space', 'linux')).toBe('L Super + R Ctrl + Space');
    expect(displayInAppShortcut('MetaRight+NumpadEnter', 'chromeos')).toBe('R Search + Num Enter');
    expect(displayInAppShortcut('MetaRight+NumpadEnter', 'other')).toBe('R Super + Num Enter');
    expect(displayInAppShortcut('Ctrl+Backspace', 'mac')).toBe('⌃ + ⌫');
    expect(displayInAppShortcut('Alt+Delete', 'mac')).toBe('⌥ + ⌦');
    expect(displayInAppShortcut('Alt+Delete', 'windows')).toBe('Alt + Delete');
    expect(displayInAppShortcutParts('AltLeft+ShiftRight', 'mac')).toEqual(['L ⌥', 'R ⇧']);
  });

  it('uses physical key codes and distinguishes left and right of every modifier family', () => {
    const held = new Set<string>();
    for (const [key, code] of [
      ['Control', 'ControlLeft'],
      ['Alt', 'AltRight'],
      ['Shift', 'ShiftLeft'],
      ['Meta', 'MetaRight'],
    ]) {
      expect(physicalModifierKey({ key, code })).toBe(code);
      expect(setHeldShortcutModifier(held, { key, code }, true)).toBe(true);
    }
    expect(heldShortcutModifiers(held)).toBe('ControlLeft+MetaRight+AltRight+ShiftLeft');
    const event = { key: '+', code: 'NumpadAdd', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true };
    const binding = shortcutFromKeyEvent(event, 'mac', held);
    expect(binding).toBe('ControlLeft+MetaRight+AltRight+ShiftLeft+NumpadAdd');
    expect(inAppShortcutMatches(binding!, binding!, 'mac')).toBe(true);
    expect(inAppShortcutMatches('ControlRight+MetaRight+AltRight+ShiftLeft+NumpadAdd', binding!, 'mac')).toBe(false);
    expect(inAppShortcutMatches('Ctrl+Mod+Alt+Shift+NumpadAdd', binding!, 'mac')).toBe(true);
    expect(inAppShortcutMatches('Ctrl+Mod+Alt+Shift+NumpadAdd', binding!, 'windows')).toBe(false);
    expect(setHeldShortcutModifier(held, { key: 'Alt', code: 'AltRight' }, false)).toBe(true);
    expect(held.has('AltRight')).toBe(false);
    expect(physicalModifierKey({ key: 'Control', code: '', location: 2 })).toBe('ControlRight');
    expect(physicalModifierKey({ key: 'Meta', code: '', location: 1 })).toBe('MetaLeft');
    expect(physicalModifierKey({ key: 'Shift', code: '', location: 0 })).toBe('Shift');
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
    expect(inAppShortcutsConflict('AltLeft+ShiftRight+B', 'AltRight+ShiftRight+B')).toBe(false);
    expect(inAppShortcutsConflict('Mod+Shift+K', 'ControlLeft+ShiftLeft+K')).toBe(true);
    expect(inAppShortcutsConflict('MetaLeft+Space', 'MetaRight+Space')).toBe(false);
    expect(normalizeInAppShortcut('AltLeft+Tab')).toBeNull();
  });

  it('protects assigned physical variants during writes and preserves independent left/right bindings', async () => {
    await updateInAppShortcutBinding('toggle-sidebar', 'AltLeft+ShiftLeft+B');
    await expect(updateInAppShortcutBinding('filter-source', 'Alt+Shift+B')).rejects.toMatchObject({
      code: 'conflict',
      conflictingAction: 'toggle-sidebar',
    });
    await updateInAppShortcutBinding('filter-source', 'AltRight+ShiftLeft+B');
    const bindings = await readInAppShortcutBindings();
    expect(bindings['toggle-sidebar']).toBe('AltLeft+ShiftLeft+B');
    expect(bindings['filter-source']).toBe('AltRight+ShiftLeft+B');
    expect(
      resolveInAppShortcutBindings({ 'toggle-sidebar': 'AltLeft+ShiftLeft+B', 'filter-source': 'Alt+Shift+B' })[
        'filter-source'
      ],
    ).toBe('');
  });
});
