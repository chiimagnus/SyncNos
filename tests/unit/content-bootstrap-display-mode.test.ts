import { beforeEach, describe, expect, it, vi } from 'vitest';

const displayMocks = vi.hoisted(() => ({ read: vi.fn() }));
const storageMocks = vi.hoisted(() => ({ onChanged: vi.fn() }));

vi.mock('@services/shared/inpage-display-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/shared/inpage-display-mode')>();
  return { ...actual, readEffectiveInpageDisplayMode: displayMocks.read };
});
vi.mock('@services/shared/storage', () => ({ storageOnChanged: storageMocks.onChanged }));

import { createRuntimeClient } from '@platform/runtime/client';
import { startContentBootstrap } from '@services/bootstrap/content';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

type StorageListener = (changes: any, areaName: string) => void;

function harness(hostname = 'chatgpt.com') {
  let storageListener: StorageListener | null = null;
  const removeDisplay = vi.fn();
  storageMocks.onChanged.mockImplementation((listener: StorageListener) => {
    storageListener = listener;
    return removeDisplay;
  });
  let invalidationListener: ((error: Error) => void) | null = null;
  const removeRuntime = vi.fn();
  const runtime = {
    onInvalidated: vi.fn((listener: (error: Error) => void) => {
      invalidationListener = listener;
      return removeRuntime;
    }),
    getURL: vi.fn(() => 'chrome-extension://ext/icon.png'),
  };
  const residents: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
  const wrapper = {
    start: vi.fn(() => {
      const resident = { stop: vi.fn() };
      residents.push(resident);
      return resident;
    }),
  };
  const initRuntime = vi.fn();
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname } });
  const bootstrap = startContentBootstrap({
    runtime,
    inpageButton: { initRuntime },
    createController: () => wrapper,
  });
  return {
    bootstrap,
    wrapper,
    residents,
    initRuntime,
    removeDisplay,
    removeRuntime,
    emitStorage: (changes: any, areaName = 'local') => storageListener?.(changes, areaName),
    invalidate: () => invalidationListener?.(new Error('Extension context invalidated')),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  displayMocks.read.mockResolvedValue('all');
});

describe('content bootstrap display mode', () => {
  it('applies initial all/off/supported host semantics', async () => {
    displayMocks.read.mockResolvedValueOnce('off');
    const off = harness();
    await flush();
    expect(off.wrapper.start).not.toHaveBeenCalled();
    off.bootstrap.stop();

    displayMocks.read.mockResolvedValueOnce('supported');
    const supported = harness('chatgpt.com');
    await flush();
    expect(supported.wrapper.start).toHaveBeenCalledTimes(1);
    supported.bootstrap.stop();

    displayMocks.read.mockResolvedValueOnce('supported');
    const unsupported = harness('example.com');
    await flush();
    expect(unsupported.wrapper.start).not.toHaveBeenCalled();
    unsupported.bootstrap.stop();
  });

  it('live toggles stop and restart exactly one resident', async () => {
    const h = harness();
    await flush();
    expect(h.wrapper.start).toHaveBeenCalledTimes(1);
    h.emitStorage({ inpage_display_mode: { oldValue: 'all', newValue: 'off' } });
    expect(h.residents[0]?.stop).toHaveBeenCalledTimes(1);
    h.emitStorage({ inpage_display_mode: { oldValue: 'off', newValue: 'all' } });
    expect(h.wrapper.start).toHaveBeenCalledTimes(2);
    h.emitStorage({ inpage_display_mode: { oldValue: 'all', newValue: 'all' } });
    expect(h.wrapper.start).toHaveBeenCalledTimes(2);
    h.bootstrap.stop();
  });

  it('ignores stale initial reads and non-local wakes', async () => {
    const initial = deferred<'all' | 'off'>();
    displayMocks.read.mockReturnValueOnce(initial.promise);
    const h = harness();
    h.emitStorage({ inpage_display_mode: { newValue: 'off' } }, 'sync');
    expect(h.wrapper.start).not.toHaveBeenCalled();
    h.emitStorage({ inpage_display_mode: { newValue: 'off' } });
    initial.resolve('all');
    await flush();
    expect(h.wrapper.start).not.toHaveBeenCalled();
    h.bootstrap.stop();
  });

  it('re-resolves removed or invalid canonical values instead of hardcoding all', async () => {
    displayMocks.read.mockResolvedValueOnce('all').mockResolvedValueOnce('supported');
    const h = harness('example.com');
    await flush();
    expect(h.wrapper.start).toHaveBeenCalledTimes(1);
    h.emitStorage({ inpage_display_mode: { oldValue: 'all', newValue: undefined } });
    await flush();
    expect(h.residents[0]?.stop).toHaveBeenCalledTimes(1);
    expect(displayMocks.read).toHaveBeenCalledTimes(2);
    h.bootstrap.stop();
  });

  it('stop unsubscribes both owners and blocks later wake/restart', async () => {
    const h = harness();
    await flush();
    h.bootstrap.stop();
    expect(h.removeRuntime).toHaveBeenCalledTimes(1);
    expect(h.removeDisplay).toHaveBeenCalledTimes(1);
    expect(h.residents[0]?.stop).toHaveBeenCalledTimes(1);
    h.emitStorage({ inpage_display_mode: { newValue: 'all' } });
    expect(h.wrapper.start).toHaveBeenCalledTimes(1);
  });

  it('runtime invalidation uses the same bootstrap stop closure', async () => {
    const h = harness();
    await flush();
    h.invalidate();
    expect(h.removeRuntime).toHaveBeenCalledTimes(1);
    expect(h.removeDisplay).toHaveBeenCalledTimes(1);
    expect(h.residents[0]?.stop).toHaveBeenCalledTimes(1);
    h.emitStorage({ inpage_display_mode: { newValue: 'all' } });
    expect(h.wrapper.start).toHaveBeenCalledTimes(1);
  });

  it('honors a runtime invalidation that happened before bootstrap subscribed', async () => {
    // @ts-expect-error test global
    globalThis.chrome = { runtime: { id: 'ext', sendMessage: vi.fn() } };
    const runtime = createRuntimeClient();
    delete (globalThis.chrome as any).runtime.id;
    await expect(runtime.send('probe')).rejects.toThrow('Extension context invalidated');
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'chatgpt.com' } });
    const wrapper = { start: vi.fn(() => ({ stop: vi.fn() })) };
    const removeDisplay = vi.fn();
    storageMocks.onChanged.mockImplementation(() => removeDisplay);
    displayMocks.read.mockResolvedValueOnce('all');

    const bootstrap = startContentBootstrap({ runtime, createController: () => wrapper });
    await flush();
    expect(wrapper.start).not.toHaveBeenCalled();
    expect(removeDisplay).toHaveBeenCalledTimes(1);
    bootstrap.stop();
    // @ts-expect-error test global cleanup
    delete globalThis.chrome;
  });

  it('fail-opens initial read only while its generation is current', async () => {
    displayMocks.read.mockRejectedValueOnce(new Error('read failed'));
    const h = harness();
    await flush();
    expect(h.wrapper.start).toHaveBeenCalledTimes(1);
    h.bootstrap.stop();
  });
});
