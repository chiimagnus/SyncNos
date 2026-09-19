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
  ensureReady: () => Promise<unknown>;
  readDisplayMode: () => Promise<'supported' | 'all' | 'off'>;
  setDisplayMode: (mode: 'supported' | 'all' | 'off') => Promise<unknown>;
}) {
  const { registerClipperContextMenu } = await import('@platform/context-menus/clipper-context-menu');
  return registerClipperContextMenu({ displayModeStorageKey: 'inpage_display_mode', ...options });
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
    update: vi.fn(async () => {}),
    removeAll: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
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
  it('registers listeners without readiness, state reads, or menu structure creation', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const ensureReady = vi.fn(async () => {});
    const readDisplayMode = vi.fn().mockResolvedValue('all');

    await registerMenu({ ensureReady, readDisplayMode, setDisplayMode: vi.fn() });
    await flush();

    expect(ensureReady).not.toHaveBeenCalled();
    expect(readDisplayMode).not.toHaveBeenCalled();
    expect(storageMocks.get).not.toHaveBeenCalled();
    expect(api.removeAll).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.onClicked.addListener).toHaveBeenCalledTimes(1);
    expect(api.onShown.addListener).toHaveBeenCalledTimes(1);
  });

  it('installs only on explicit request and waits for Promise-only removeAll before create', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const ready = deferred<void>();
    const removeAllDone = deferred<void>();
    const ensureReady = vi.fn(() => ready.promise);
    const readDisplayMode = vi.fn().mockResolvedValue('off');
    api.removeAll.mockImplementationOnce(() => removeAllDone.promise);

    const controller = await registerMenu({ ensureReady, readDisplayMode, setDisplayMode: vi.fn() });
    const installing = controller.installOrRefresh();
    await flush();

    expect(ensureReady).toHaveBeenCalledTimes(1);
    expect(readDisplayMode).not.toHaveBeenCalled();
    expect(api.removeAll).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();

    ready.resolve();
    await flush();
    expect(readDisplayMode).toHaveBeenCalledTimes(1);
    expect(api.removeAll).toHaveBeenCalledTimes(1);
    expect(api.create).not.toHaveBeenCalled();

    removeAllDone.resolve();
    await installing;
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'syncnos_clipper_mode_off', checked: true }));
  });

  it('uses the single generic save click route for video-capable pages', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    tabsMocks.query.mockResolvedValue([{ id: 7, url: 'https://www.bilibili.com/video/BV1FwY4zkEef/' }]);
    const controller = await registerMenu({
      ensureReady: async () => {},
      readDisplayMode: vi.fn().mockResolvedValue('all'),
      setDisplayMode: vi.fn(),
    });
    await controller.installOrRefresh();

    api.emitClick('syncnos_clipper_save_current_page');
    await flush();

    expect(tabsMocks.send).toHaveBeenCalledWith(7, {
      type: 'captureCurrentPage',
      payload: { source: 'contextmenu' },
    });
    expect(api.create.mock.calls.map(([value]: any[]) => value?.id)).not.toContain(
      'syncnos_clipper_save_video_transcript',
    );
  });

  it('display clicks use the canonical writer and restore checked truth after a rejected write', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const readDisplayMode = vi.fn().mockResolvedValue('all');
    const setDisplayMode = vi.fn().mockRejectedValue(new Error('write failed'));
    const controller = await registerMenu({ ensureReady: async () => {}, readDisplayMode, setDisplayMode });
    await controller.installOrRefresh();
    api.update.mockClear();

    api.emitClick('syncnos_clipper_mode_off');
    await flush();

    expect(setDisplayMode).toHaveBeenCalledWith('off');
    expect(storageMocks.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ inpage_display_mode: expect.anything() }),
    );
    expect(readDisplayMode).toHaveBeenCalledTimes(2);
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_mode_all', { checked: true });
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_mode_off', { checked: false });
  });

  it('storage changes update checked state without rebuilding menu structure', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const readDisplayMode = vi.fn().mockResolvedValue('all');
    const controller = await registerMenu({
      ensureReady: async () => {},
      readDisplayMode,
      setDisplayMode: vi.fn(),
    });
    await controller.installOrRefresh();
    const removeAllCalls = api.removeAll.mock.calls.length;
    const createCalls = api.create.mock.calls.length;
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
    expect(api.removeAll).toHaveBeenCalledTimes(removeAllCalls);
    expect(api.create).toHaveBeenCalledTimes(createCalls);

    const reads = readDisplayMode.mock.calls.length;
    storageListener?.({ unrelated_setting: { newValue: true } }, 'local');
    await flush();
    expect(readDisplayMode).toHaveBeenCalledTimes(reads);
  });

  it('onShown waits for lazy readiness and refreshes localized labels, dynamic title, and checked state', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const ready = deferred<void>();
    const ensureReady = vi.fn(() => ready.promise);
    const readDisplayMode = vi.fn().mockResolvedValue('off');
    storageMocks.get.mockResolvedValue({ ai_chat_auto_save_enabled: false });

    await registerMenu({ ensureReady, readDisplayMode, setDisplayMode: vi.fn() });
    api.emitShown({ id: 7, url: 'https://chatgpt.com/c/1' });
    await flush();

    expect(ensureReady).toHaveBeenCalledTimes(1);
    expect(readDisplayMode).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();

    ready.resolve();
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(1));

    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_root', { title: 'SyncNos WebClipper' });
    expect(api.update).toHaveBeenCalledWith('syncnos_clipper_save_current_page', { title: 'Save current AI chat' });
    expect(api.update).toHaveBeenCalledWith(
      'syncnos_clipper_mode_off',
      expect.objectContaining({ title: expect.any(String), checked: true }),
    );
    expect(api.update).toHaveBeenCalledWith(
      'syncnos_clipper_autosave',
      expect.objectContaining({ title: expect.any(String), checked: false }),
    );
    expect(api.removeAll).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('awaits all Promise updates before refresh and isolates update rejection', async () => {
    const api = (globalThis.chrome as any).contextMenus;
    const updateDone = deferred<void>();
    let updateCount = 0;
    api.update.mockImplementation(() => {
      updateCount += 1;
      if (updateCount === 1) return Promise.reject(new Error('one update failed'));
      return updateDone.promise;
    });

    await registerMenu({
      ensureReady: async () => {},
      readDisplayMode: vi.fn().mockResolvedValue('all'),
      setDisplayMode: vi.fn(),
    });
    api.emitShown({ id: 7, url: 'https://chatgpt.com/c/1' });
    await flush();

    expect(api.update).toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();

    updateDone.resolve();
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(1));
  });
});
