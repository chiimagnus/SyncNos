import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ get: vi.fn(), onChanged: vi.fn() }));

vi.mock('@services/shared/storage', () => ({
  storageGet: storage.get,
  storageOnChanged: storage.onChanged,
}));

import { IN_APP_SHORTCUT_STORAGE_KEY, type InAppShortcutAction } from '@services/shortcuts/in-app-shortcuts';
import { useInAppShortcuts } from '@viewmodels/shortcuts/useInAppShortcuts';

let dom: JSDOM;
let root: ReactDOM.Root | null;
let listener: ((changes: Record<string, unknown>, area: string) => void) | null;
const handlers = { 'toggle-sidebar': vi.fn(), 'filter-source': vi.fn(), 'open-settings': vi.fn() };

function Harness({ enabled = true }: { enabled?: boolean }) {
  useInAppShortcuts(handlers as Partial<Record<InAppShortcutAction, () => void>>, enabled);
  return null;
}

function sendKey(key: string, code: string, options: Record<string, unknown> = {}, target: EventTarget = document) {
  const event = new window.KeyboardEvent('keydown', {
    key,
    code,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function render(enabled = true) {
  await act(async () => {
    root!.render(createElement(Harness, { enabled }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/app',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(dom.window.navigator, 'platform', { configurable: true, value: 'Win32' });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  root = ReactDOM.createRoot(document.getElementById('root')!);
  listener = null;
  Object.values(handlers).forEach((handler) => handler.mockReset());
  storage.get.mockReset().mockResolvedValue({ [IN_APP_SHORTCUT_STORAGE_KEY]: {} });
  storage.onChanged.mockReset().mockImplementation((cb) => {
    listener = cb;
    return () => {
      listener = null;
    };
  });
});

afterEach(async () => {
  if (root)
    await act(async () => {
      root!.unmount();
    });
  root = null;
  dom.window.close();
  for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete (globalThis as any)[key];
  }
});

describe('in-app keydown dispatch', () => {
  it('dispatches a default binding once, prevents browser default and ignores repeat', async () => {
    await render();
    const first = sendKey('\\', 'Backslash', { ctrlKey: true });
    expect(first.defaultPrevented).toBe(true);
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(1);

    sendKey('\\', 'Backslash', { ctrlKey: true, repeat: true });
    sendKey('\\', 'Backslash', { altKey: true });
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(1);
    expect(handlers['filter-source']).not.toHaveBeenCalled();
  });

  it('ignores editable fields, composition and any modal, without stealing keydown', async () => {
    await render();
    const input = document.createElement('input');
    document.body.append(input);
    expect(sendKey('\\', 'Backslash', { ctrlKey: true }, input).defaultPrevented).toBe(false);

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'plaintext-only');
    document.body.append(editable);
    sendKey('\\', 'Backslash', { ctrlKey: true }, editable);
    sendKey('\\', 'Backslash', { ctrlKey: true, isComposing: true });
    expect(handlers['toggle-sidebar']).not.toHaveBeenCalled();

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    sendKey('\\', 'Backslash', { ctrlKey: true });
    expect(handlers['toggle-sidebar']).not.toHaveBeenCalled();
    modal.remove();
    sendKey('\\', 'Backslash', { ctrlKey: true });
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(1);
  });

  it('uses live storage bindings, honors explicit blank and unmutes a new key', async () => {
    await render();
    act(() =>
      listener?.(
        {
          [IN_APP_SHORTCUT_STORAGE_KEY]: {
            newValue: {
              'toggle-sidebar': '',
              'filter-source': 'Mod+Alt+Q',
            },
          },
        },
        'local',
      ),
    );

    sendKey('\\', 'Backslash', { ctrlKey: true });
    expect(handlers['toggle-sidebar']).not.toHaveBeenCalled();
    sendKey('q', 'KeyQ', { altKey: true, ctrlKey: true });
    expect(handlers['filter-source']).toHaveBeenCalledTimes(1);
  });

  it('stays disabled when requested and removes listeners on unmount', async () => {
    await render(false);
    sendKey('\\', 'Backslash', { ctrlKey: true });
    expect(handlers['toggle-sidebar']).not.toHaveBeenCalled();
    await render(true);
    sendKey('\\', 'Backslash', { ctrlKey: true });
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(1);

    await act(async () => {
      root!.unmount();
    });
    root = null;
    sendKey('\\', 'Backslash', { ctrlKey: true });
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(1);
    expect(listener).toBeNull();
  });

  it('does not apply a stale initial read after newer storage changes', async () => {
    let resolveRead!: (value: unknown) => void;
    storage.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    await render();
    act(() => listener?.({ [IN_APP_SHORTCUT_STORAGE_KEY]: { newValue: { 'toggle-sidebar': '' } } }, 'local'));
    await act(async () => {
      resolveRead({ [IN_APP_SHORTCUT_STORAGE_KEY]: {} });
    });
    sendKey('\\', 'Backslash', { ctrlKey: true });
    expect(handlers['toggle-sidebar']).not.toHaveBeenCalled();
  });

  it('executes migrated old-side bindings with either hand and generic browser modifier flags', async () => {
    await render();
    act(() =>
      listener?.(
        { [IN_APP_SHORTCUT_STORAGE_KEY]: { newValue: { 'toggle-sidebar': 'AltRight+ShiftLeft+B' } } },
        'local',
      ),
    );
    const chord = { altKey: true, shiftKey: true };
    sendKey('B', 'KeyB', chord);
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(1);
    sendKey('Alt', 'AltRight', { altKey: true, location: 2 });
    sendKey('Shift', 'ShiftLeft', { ...chord, location: 1 });
    sendKey('B', 'KeyB', chord);
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new window.Event('blur')));
    sendKey('Alt', 'AltLeft', { altKey: true, location: 1 });
    sendKey('Shift', 'ShiftRight', { ...chord, location: 2 });
    sendKey('B', 'KeyB', chord);
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(3);
    sendKey('B', 'KeyB', { altKey: true });
    expect(handlers['toggle-sidebar']).toHaveBeenCalledTimes(3);
  });
});
