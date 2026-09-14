import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shortcutMocks = vi.hoisted(() => ({
  read: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@services/shortcuts/keyboard-shortcuts', () => ({
  readKeyboardShortcutSnapshot: shortcutMocks.read,
  openKeyboardShortcutSettings: shortcutMocks.open,
}));

import { useKeyboardShortcutsController } from '@viewmodels/settings/useKeyboardShortcutsController';

type Snapshot = ReturnType<typeof useKeyboardShortcutsController>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const readySnapshot = (captureShortcut = 'Ctrl+Shift+Y') => ({
  supported: true,
  managerAccess: 'openable' as const,
  items: [
    { action: 'open-popup' as const, shortcut: 'Ctrl+Shift+P' },
    { action: 'capture-current-page' as const, shortcut: captureShortcut },
    { action: 'open-app' as const, shortcut: '' },
  ],
});

let dom: JSDOM | null = null;
let root: ReactDOM.Root | null = null;
let latestSnapshot: Snapshot | null = null;

function Harness({ active }: { active: boolean }) {
  latestSnapshot = useKeyboardShortcutsController({ active });
  return null;
}

function setupDom() {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/settings',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  root = ReactDOM.createRoot(document.getElementById('root')!);
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  dom?.window.close();
  dom = null;
}

async function flushReact() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

async function renderController(active: boolean) {
  act(() => {
    root!.render(createElement(Harness, { active }));
  });
  await flushReact();
}

beforeEach(() => {
  shortcutMocks.read.mockReset().mockResolvedValue(readySnapshot());
  shortcutMocks.open.mockReset().mockResolvedValue('opened');
  latestSnapshot = null;
  setupDom();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
  }
  root = null;
  cleanupDom();
});

describe('useKeyboardShortcutsController', () => {
  it('does not read shortcuts while General settings is inactive', async () => {
    await renderController(false);

    expect(shortcutMocks.read).not.toHaveBeenCalled();
    expect(latestSnapshot?.status).toBe('idle');
  });

  it('reads once when activated and exposes the browser snapshot', async () => {
    await renderController(true);

    expect(shortcutMocks.read).toHaveBeenCalledTimes(1);
    expect(latestSnapshot?.status).toBe('ready');
    expect(latestSnapshot?.items).toEqual(readySnapshot().items);
    expect(latestSnapshot?.managerAccess).toBe('openable');
  });

  it('refreshes from the browser when the settings window regains focus', async () => {
    shortcutMocks.read
      .mockResolvedValueOnce(readySnapshot('Ctrl+Shift+Y'))
      .mockResolvedValueOnce(readySnapshot('Ctrl+Alt+Y'));
    await renderController(true);

    act(() => window.dispatchEvent(new window.Event('focus')));
    await flushReact();

    expect(shortcutMocks.read).toHaveBeenCalledTimes(2);
    expect(latestSnapshot?.items[1]?.shortcut).toBe('Ctrl+Alt+Y');
  });

  it('removes the focus refresh when deactivated', async () => {
    await renderController(true);
    await renderController(false);
    shortcutMocks.read.mockClear();

    act(() => window.dispatchEvent(new window.Event('focus')));
    await flushReact();

    expect(shortcutMocks.read).not.toHaveBeenCalled();
    expect(latestSnapshot?.status).toBe('idle');
  });

  it('ignores a late read after deactivation', async () => {
    const pending = deferred<ReturnType<typeof readySnapshot>>();
    shortcutMocks.read.mockReturnValueOnce(pending.promise);
    act(() => root!.render(createElement(Harness, { active: true })));
    await flushReact();
    expect(latestSnapshot?.status).toBe('loading');

    await renderController(false);
    pending.resolve(readySnapshot('Ctrl+Stale'));
    await flushReact();

    expect(latestSnapshot?.status).toBe('idle');
    expect(latestSnapshot?.items).toEqual([]);
  });

  it('ignores a late read after unmount', async () => {
    const pending = deferred<ReturnType<typeof readySnapshot>>();
    shortcutMocks.read.mockReturnValueOnce(pending.promise);
    act(() => root!.render(createElement(Harness, { active: true })));
    await flushReact();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = null;
    pending.resolve(readySnapshot('Ctrl+Stale'));
    await flushReact();

    expect(consoleError.mock.calls.flat().map(String).join(' ').toLowerCase()).not.toContain('unmounted');
    consoleError.mockRestore();
  });

  it('uses the latest overlapping refresh result', async () => {
    const first = deferred<ReturnType<typeof readySnapshot>>();
    const second = deferred<ReturnType<typeof readySnapshot>>();
    shortcutMocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    act(() => root!.render(createElement(Harness, { active: true })));
    await flushReact();

    act(() => window.dispatchEvent(new window.Event('focus')));
    await flushReact();
    second.resolve(readySnapshot('Ctrl+Latest'));
    await flushReact();
    expect(latestSnapshot?.items[1]?.shortcut).toBe('Ctrl+Latest');

    first.resolve(readySnapshot('Ctrl+Stale'));
    await flushReact();
    expect(latestSnapshot?.items[1]?.shortcut).toBe('Ctrl+Latest');
  });

  it('downgrades the manager state locally when opening the native manager fails', async () => {
    shortcutMocks.open.mockResolvedValueOnce('manual');
    await renderController(true);

    await act(async () => {
      await latestSnapshot!.openManager();
    });

    expect(latestSnapshot?.managerAccess).toBe('manual');
  });

  it('marks command discovery as unsupported without affecting the hook lifecycle', async () => {
    shortcutMocks.read.mockResolvedValueOnce({
      supported: false,
      managerAccess: 'unsupported',
      items: readySnapshot('').items,
    });
    await renderController(true);

    expect(latestSnapshot?.status).toBe('unsupported');
    expect(latestSnapshot?.managerAccess).toBe('unsupported');
  });
});
