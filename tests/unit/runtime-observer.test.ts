import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createObserver } from '@collectors/runtime-observer';

type ObserverRecord = {
  callback: MutationCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

let observerRecords: ObserverRecord[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  observerRecords = [];
  class FakeMutationObserver {
    callback: MutationCallback;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: MutationCallback) {
      this.callback = callback;
      observerRecords.push({ callback, observe: this.observe, disconnect: this.disconnect });
    }
  }
  // @ts-expect-error test global
  globalThis.MutationObserver = FakeMutationObserver;
  // @ts-expect-error minimal fake document
  globalThis.document = { documentElement: null, body: null };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // @ts-expect-error cleanup
  delete globalThis.MutationObserver;
  // @ts-expect-error cleanup
  delete globalThis.document;
});

describe('runtime observer lifecycle', () => {
  it('cancels a mutation debounce when stopped', async () => {
    const root = {} as Node;
    const onTick = vi.fn();
    const observer = createObserver({ getRoot: () => root, onTick, debounceMs: 50 });
    observer.start();
    expect(onTick).toHaveBeenCalledTimes(1);
    observerRecords[0]!.callback([], observerRecords[0] as any);
    observer.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(observerRecords[0]!.disconnect).toHaveBeenCalledTimes(1);
  });

  it('cancels a leading:false pending tick when stopped', async () => {
    const root = {} as Node;
    const onTick = vi.fn();
    const observer = createObserver({ getRoot: () => root, onTick, debounceMs: 50, leading: false });
    observer.start();
    expect(onTick).not.toHaveBeenCalled();
    observer.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('continues polling after an initially missing root and attaches when it appears', async () => {
    let root: Node | null = null;
    const onTick = vi.fn();
    const getRoot = vi.fn(() => root);
    const observer = createObserver({ getRoot, onTick });
    observer.start();
    expect(observerRecords).toHaveLength(0);
    expect(onTick).toHaveBeenCalledTimes(1);

    root = {} as Node;
    await vi.advanceTimersByTimeAsync(800);
    expect(observerRecords).toHaveLength(1);
    expect(observerRecords[0]!.observe).toHaveBeenCalledWith(
      root,
      expect.objectContaining({ subtree: true, childList: true }),
    );
    expect(onTick).toHaveBeenCalledTimes(2);
    observer.stop();
  });

  it('does not duplicate leading work or polling when start is called twice without a root', async () => {
    const onTick = vi.fn();
    const getRoot = vi.fn(() => null);
    const observer = createObserver({ getRoot, onTick });
    observer.start();
    observer.start();
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(getRoot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(getRoot).toHaveBeenCalledTimes(2);
    observer.stop();
  });

  it('clears the root poll even if a MutationObserver was never created', async () => {
    const getRoot = vi.fn(() => null);
    const observer = createObserver({ getRoot, onTick: vi.fn() });
    observer.start();
    observer.stop();
    const callsAfterStop = getRoot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2400);
    expect(getRoot).toHaveBeenCalledTimes(callsAfterStop);
  });

  it('start/stop/start does not reuse an old pending callback', async () => {
    const root = {} as Node;
    const onTick = vi.fn();
    const observer = createObserver({ getRoot: () => root, onTick, debounceMs: 50 });
    observer.start();
    observerRecords[0]!.callback([], observerRecords[0] as any);
    observer.stop();
    observer.start();
    expect(onTick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(observerRecords).toHaveLength(2);
    observer.stop();
  });
});
