import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  onChanged: vi.fn(),
}));
const tabsMocks = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn() }));

vi.mock('@platform/storage/local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/storage/local')>();
  return {
    ...actual,
    storageGet: storageMocks.get,
    storageSet: storageMocks.set,
    storageOnChanged: storageMocks.onChanged,
  };
});
vi.mock('@platform/webext/tabs', () => ({ tabsQuery: tabsMocks.query, tabsSendMessage: tabsMocks.send }));

async function registerMenu(options: {
  ready: Promise<unknown>;
  readDisplayMode: () => Promise<'supported' | 'all' | 'off'>;
  setDisplayMode: (mode: 'supported' | 'all' | 'off') => Promise<unknown>;
}) {
  const { registerClipperContextMenu } = await import('@platform/context-menus/clipper-context-menu');
  registerClipperContextMenu(options);
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function createMenusApi() {
  const clicked: Array<(info: any, tab: any) => void> = [];
  const shown: Array<(info: any, tab: any) => void> = [];
  return {
    create: vi.fn(),
    update: vi.fn(),
    removeAll: vi.fn((cb: any) => cb?.()),
    refresh: vi.fn(),
    onClicked: { addListener: vi.fn((cb: any) => clicked.push(cb)) },
    onShown: { addListener: vi.fn((cb: any) => shown.push(cb)) },
    emitClick(id: string, checked?: boolean) {
      for (const cb of clicked) cb({ menuItemId: id, checked }, null);
    },
    emitShown(tab: any) {
      for (const cb of shown) cb({ menuIds: ['syncnos_clipper_root'] }, tab);
    },
  };
}

let storageListener: ((changes: any, areaName: string) => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  storageListener = null;
  storageMocks.get.mockResolvedValue({ ai_chat_auto_save_enabled: true });
  storageMocks.set.mockResolvedValue(undefined);
  storageMocks.onChanged.mockImplementation((listener: any) => {
    storageListener = listener;
    return () => {
      if (storageListener === listener) storageListener = null;
    };
  });
  tabsMocks.send.mockResolvedValue({ ok: true, data: { kind: 'chat' }, error: null });
  // @ts-expect-error test global
  globalThis.chrome = { contextMenus: createMenusApi() };
});

afterEach(() => {
  // @ts-expect-error test global
  delete globalThis.chrome;
});

describe('clipper context menu runtime settings', () => {
  it('waits for ready and reads display through injected owner-facing reader', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const ready = deferred<void>();
    const readDisplayMode = vi.fn().mockResolvedValue('off');
    await registerMenu({ ready: ready.promise, readDisplayMode, setDisplayMode: vi.fn() });
    expect(api.create).not.toHaveBeenCalled();
    ready.resolve();
    await flush();
    expect(readDisplayMode).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'syncnos_clipper_mode_off', checked: true }));
  });

  it('display clicks use injected writer and never storageSet the display key', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const setDisplayMode = vi.fn().mockResolvedValue('off');
    await registerMenu({
      ready: Promise.resolve(),
      readDisplayMode: vi.fn().mockResolvedValue('all'),
      setDisplayMode,
    });
    await flush();
    api.emitClick('syncnos_clipper_mode_off');
    await flush();
    expect(setDisplayMode).toHaveBeenCalledWith('off');
    expect(storageMocks.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ inpage_display_mode: expect.anything() }),
    );
  });

  it('restores checked state from durable truth when the display write rejects', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const readDisplayMode = vi.fn().mockResolvedValue('all');
    const setDisplayMode = vi.fn().mockRejectedValue(new Error('write failed'));
    await registerMenu({ ready: Promise.resolve(), readDisplayMode, setDisplayMode });
    await flush();
    api.update.mockClear();
    api.emitClick('syncnos_clipper_mode_off');
    await flush();
    expect(readDisplayMode).toHaveBeenCalledTimes(2);
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_mode_all', { checked: true });
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_mode_off', { checked: false });
  });

  it('canonical display and autosave wakes converge checked state without legacy listener support', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const readDisplayMode = vi.fn().mockResolvedValue('all');
    await registerMenu({ ready: Promise.resolve(), readDisplayMode, setDisplayMode: vi.fn() });
    await flush();
    api.update.mockClear();
    readDisplayMode.mockResolvedValue('supported');
    storageMocks.get.mockResolvedValue({ ai_chat_auto_save_enabled: false });
    storageListener?.(
      { inpage_display_mode: { newValue: 'supported' }, ai_chat_auto_save_enabled: { newValue: false } },
      'local',
    );
    await flush();
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_mode_supported', { checked: true });
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_autosave', { checked: false });
    const reads = readDisplayMode.mock.calls.length;
    storageListener?.({ inpage_supported_only: { newValue: true } }, 'local');
    await flush();
    expect(readDisplayMode).toHaveBeenCalledTimes(reads);
  });

  it('onShown re-reads stale checked truth and still refreshes Save title when setting read fails', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const readDisplayMode = vi.fn().mockResolvedValue('all');
    await registerMenu({ ready: Promise.resolve(), readDisplayMode, setDisplayMode: vi.fn() });
    await flush();
    api.update.mockClear();
    readDisplayMode.mockResolvedValueOnce('off');
    storageMocks.get.mockResolvedValueOnce({ ai_chat_auto_save_enabled: false });
    api.emitShown({ id: 7, url: 'https://chatgpt.com/c/1' });
    await flush();
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_mode_off', { checked: true });
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_save_current_page', { title: 'Save current AI chat' });

    api.update.mockClear();
    readDisplayMode.mockRejectedValueOnce(new Error('read failed'));
    api.emitShown({ id: 7, url: 'https://chatgpt.com/c/1' });
    await flush();
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_save_current_page', { title: 'Save current AI chat' });
    expect(api.refresh).toHaveBeenCalled();
  });
});
