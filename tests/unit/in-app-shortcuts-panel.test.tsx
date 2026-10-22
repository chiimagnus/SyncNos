import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  onChanged: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: storage.get,
  storageSet: storage.set,
  storageRemove: storage.remove,
  storageOnChanged: storage.onChanged,
}));

import { InAppShortcutsPanel } from '@ui/settings/sections/InAppShortcutsPanel';
import { IN_APP_SHORTCUT_STORAGE_KEY } from '@services/shortcuts/in-app-shortcuts';

let dom: JSDOM;
let root: ReactDOM.Root | null;
let persisted: Record<string, string>;

function click(selector: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing button: ${selector}`);
  act(() => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  return button;
}

function key(button: HTMLButtonElement, value: string, code: string, mods: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key: value,
    code,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  act(() => {
    button.dispatchEvent(event);
  });
  return event;
}

const toggleSelector = 'button[aria-label^="Set shortcut: Toggle library sidebar"]';
const clearSelector = 'button[aria-label="Clear: Toggle library sidebar"]';

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/settings',
    pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window.navigator, 'platform', { configurable: true, value: 'MacIntel' });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, name, { configurable: true, value });
  root = ReactDOM.createRoot(document.getElementById('root')!);
  persisted = {};
  storage.get.mockReset().mockImplementation(async () => ({ [IN_APP_SHORTCUT_STORAGE_KEY]: persisted }));
  storage.set.mockReset().mockImplementation(async (value) => {
    persisted = value[IN_APP_SHORTCUT_STORAGE_KEY];
  });
  storage.remove.mockReset().mockImplementation(async () => {
    persisted = {};
  });
  storage.onChanged.mockReset().mockReturnValue(() => {});
});

afterEach(async () => {
  if (root)
    await act(async () => {
      root!.unmount();
    });
  root = null;
  dom.window.close();
  for (const name of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete (globalThis as any)[name];
  }
});

async function mount() {
  await act(async () => {
    root!.render(createElement(InAppShortcutsPanel));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('in-app shortcut editor', () => {
  it('shows all actions in groups and can record a new Mac binding', async () => {
    await mount();
    expect(document.querySelectorAll('details').length).toBe(4);
    expect(document.querySelectorAll('button[aria-label^="Set shortcut: "]').length).toBeGreaterThan(30);
    expect(document.querySelector(toggleSelector)?.textContent).toContain('⌥ + ⇧ + B');
    expect(document.querySelector(toggleSelector)?.querySelectorAll('kbd')).toHaveLength(1);

    const button = click(toggleSelector);
    expect(button.textContent).toContain('Recording');
    await act(async () => {
      key(button, '∫', 'KeyB', { metaKey: true, shiftKey: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persisted['toggle-sidebar']).toBe('Mod+Shift+B');
    expect(document.querySelector(toggleSelector)?.textContent).toContain('⌘ + ⇧ + B');
  });

  it('rejects conflicts, cancels Escape and allows clearing and resetting a binding', async () => {
    await mount();
    const button = click(toggleSelector);
    key(button, 'Escape', 'Escape');
    expect(document.querySelector(toggleSelector)?.textContent).toContain('⌥ + ⇧ + B');

    const conflicting = click(toggleSelector);
    await act(async () => {
      key(conflicting, 'P', 'KeyP', { altKey: true, shiftKey: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Settings');
    expect(persisted['toggle-sidebar']).toBeUndefined();

    await act(async () => {
      click(clearSelector);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persisted['toggle-sidebar']).toBe('');
    expect(document.querySelector(toggleSelector)?.textContent).toContain('Unassigned');

    const restore = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Restore defaults',
    );
    expect(restore).toBeTruthy();
    await act(async () => {
      restore!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector(toggleSelector)?.textContent).toContain('⌥ + ⇧ + B');
    expect(storage.remove).toHaveBeenCalledWith([IN_APP_SHORTCUT_STORAGE_KEY]);
  });

  it('keeps the previous key when save fails and reports the error', async () => {
    await mount();
    storage.set.mockRejectedValueOnce(new Error('no permissions'));
    const button = click(toggleSelector);
    await act(async () => {
      key(button, 'G', 'KeyG', { metaKey: true, shiftKey: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not save');
    expect(document.querySelector(toggleSelector)?.textContent).toContain('⌥ + ⇧ + B');
  });

  it('shows left/right modifiers as they are pressed, then saves punctuation or Backspace instead of silently clearing', async () => {
    await mount();
    const button = click(toggleSelector);
    expect(button.textContent).toContain('Recording');
    key(button, 'Meta', 'MetaRight', { metaKey: true, location: 2 });
    expect(document.querySelector(toggleSelector)?.textContent).toContain('R ⌘');
    key(button, 'Alt', 'AltLeft', { metaKey: true, altKey: true, location: 1 });
    expect(document.querySelector(toggleSelector)?.textContent).toContain('L ⌥');
    await act(async () => {
      key(button, '?', 'Slash', { metaKey: true, altKey: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persisted['toggle-sidebar']).toBe('MetaRight+AltLeft+Slash');
    expect(document.querySelector(toggleSelector)?.textContent).toContain('R ⌘ + L ⌥ + /');

    const replace = click(toggleSelector);
    await act(async () => {
      key(replace, 'Backspace', 'Backspace');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persisted['toggle-sidebar']).toBe('Backspace');
    expect(document.querySelector(toggleSelector)?.textContent).toContain('⌫');

    await act(async () => {
      click(clearSelector);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persisted['toggle-sidebar']).toBe('');
    expect(document.querySelector(toggleSelector)?.textContent).toContain('Unassigned');
  });

  it('filters the operation list and cancels recording on browser focus loss', async () => {
    await mount();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const nativeSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeSetter.call(search, 'narration');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('details')).toHaveLength(1);
    expect(document.querySelector('details')?.open).toBe(true);
    expect(document.querySelector(toggleSelector)).toBeNull();
    await act(async () => {
      nativeSetter.call(search, 'no-such-operation');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(document.querySelector('details')).toBeNull();
    expect(document.body.textContent).toContain('No matching actions');
    await act(async () => {
      nativeSetter.call(search, '');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const record = click(toggleSelector);
    key(record, 'Alt', 'AltRight', { altKey: true, location: 2 });
    expect(document.querySelector(toggleSelector)?.textContent).toContain('R ⌥');
    act(() => window.dispatchEvent(new window.Event('blur')));
    expect(document.querySelector(toggleSelector)?.getAttribute('data-shortcut-recording')).toBeNull();
    expect(persisted['toggle-sidebar']).toBeUndefined();
  });
});
