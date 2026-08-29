import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDataRevisionObserver } from '@services/data-revisions/observer';
import { publishDataRevisionWake, subscribeDataRevisionWake } from '@services/data-revisions/wake';

const ALL_SCOPES = ['conversations', 'messages', 'sync_mappings', 'article_comments', 'image_cache'] as const;

function snapshot(overrides: Partial<Record<(typeof ALL_SCOPES)[number], number>> = {}) {
  return {
    conversations: 0,
    messages: 0,
    sync_mappings: 0,
    article_comments: 0,
    image_cache: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function createObserver(readSnapshot: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) {
  const wakeListeners = new Set<() => void>();
  let storageListener: ((changes: any, areaName: string) => void) | null = null;
  const observer = createDataRevisionObserver({
    readSnapshot,
    subscribeWake(listener) {
      wakeListeners.add(listener);
      return () => wakeListeners.delete(listener);
    },
    subscribeStorage(listener) {
      storageListener = listener;
      return () => {
        if (storageListener === listener) storageListener = null;
      };
    },
    getDocument: () => null,
    getWindow: () => null,
    safetyReconcileMs: 60_000,
    ...overrides,
  });
  return {
    observer,
    wake() {
      for (const listener of Array.from(wakeListeners)) listener();
    },
    storageWake() {
      storageListener?.({ webclipper_data_revision_wake_v1: { newValue: 'wake' } }, 'local');
    },
    storageListener: () => storageListener,
  };
}

function createEventTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      const entries = listeners.get(type) || new Set<() => void>();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string) {
      for (const listener of Array.from(listeners.get(type) || [])) listener();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('data revision observer', () => {
  it('shares one baseline across subscribers and reports only changed scopes', async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ conversations: 1 }));
    const { observer } = createObserver(readSnapshot);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = observer.subscribe(first);
    const stopSecond = observer.subscribe(second);

    await expect(observer.whenReady()).resolves.toEqual({ baselineAvailable: true });
    expect(readSnapshot).toHaveBeenCalledTimes(1);

    observer.requestReconcile();
    await flushMicrotasks();

    expect(first).toHaveBeenCalledWith(['conversations']);
    expect(second).toHaveBeenCalledWith(['conversations']);
    stopFirst();
    stopSecond();
  });

  it('keeps duplicate callback subscriptions active until every subscription is released', async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ conversations: 1 }));
    const { observer } = createObserver(readSnapshot);
    const listener = vi.fn();
    const stopFirst = observer.subscribe(listener);
    const stopSecond = observer.subscribe(listener);

    await observer.whenReady();
    stopFirst();
    observer.requestReconcile();
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledWith(['conversations']);
    stopSecond();
  });

  it('uses same-context wake and isolates a throwing wake subscriber', async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ messages: 1 }));
    const observer = createDataRevisionObserver({
      readSnapshot,
      subscribeWake: subscribeDataRevisionWake,
      subscribeStorage: () => () => {},
      getDocument: () => null,
      getWindow: () => null,
      safetyReconcileMs: 60_000,
    });
    const stopThrowingWakeListener = subscribeDataRevisionWake(() => {
      throw new Error('ignore this listener');
    });
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await observer.whenReady();
    publishDataRevisionWake();
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledWith(['messages']);
    stop();
    stopThrowingWakeListener();
  });

  it('settles degraded after a baseline failure and emits one conservative catch-up after recovery', async () => {
    const readSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('background unavailable'))
      .mockResolvedValueOnce(snapshot());
    const { observer } = createObserver(readSnapshot);
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await expect(observer.whenReady()).resolves.toEqual({ baselineAvailable: false });
    observer.requestReconcile();
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledWith([...ALL_SCOPES]);
    stop();
  });

  it('releases readiness after the named timeout and catches up when the original request resolves late', async () => {
    vi.useFakeTimers();
    const pending = deferred<ReturnType<typeof snapshot>>();
    const readSnapshot = vi.fn(() => pending.promise);
    const { observer } = createObserver(readSnapshot, { readinessTimeoutMs: 20 });
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await vi.advanceTimersByTimeAsync(20);
    await expect(observer.whenReady()).resolves.toEqual({ baselineAvailable: false });

    pending.resolve(snapshot());
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledWith([...ALL_SCOPES]);
    stop();
  });

  it('cleans the prior epoch timeout and discards late results before starting a fresh baseline', async () => {
    vi.useFakeTimers();
    const first = deferred<ReturnType<typeof snapshot>>();
    const second = deferred<ReturnType<typeof snapshot>>();
    const readSnapshot = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const clearTimeoutSpy = vi.fn(globalThis.clearTimeout);
    const { observer } = createObserver(readSnapshot, { readinessTimeoutMs: 20, clearTimeout: clearTimeoutSpy });
    const firstListener = vi.fn();
    const stopFirst = observer.subscribe(firstListener);
    stopFirst();

    const secondListener = vi.fn();
    const stopSecond = observer.subscribe(secondListener);
    await flushMicrotasks();
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(clearTimeoutSpy).toHaveBeenCalled();

    first.resolve(snapshot({ conversations: 1 }));
    await flushMicrotasks();
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();

    second.resolve(snapshot({ conversations: 2 }));
    await expect(observer.whenReady()).resolves.toEqual({ baselineAvailable: true });
    expect(secondListener).not.toHaveBeenCalled();
    stopSecond();
  });

  it('keeps a replacement epoch ready when a previous epoch rejects late', async () => {
    const first = deferred<ReturnType<typeof snapshot>>();
    const second = deferred<ReturnType<typeof snapshot>>();
    const readSnapshot = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { observer } = createObserver(readSnapshot);
    const stopFirst = observer.subscribe(vi.fn());
    stopFirst();
    const stopSecond = observer.subscribe(vi.fn());

    first.reject(new Error('old background request failed'));
    second.resolve(snapshot());

    await expect(observer.whenReady()).resolves.toEqual({ baselineAvailable: true });
    stopSecond();
  });

  it('coalesces in-flight signals into one trailing snapshot', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(snapshot({ article_comments: 1 }));
    const { observer, wake, storageWake } = createObserver(readSnapshot);
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await observer.whenReady();
    await flushMicrotasks();
    wake();
    storageWake();
    await flushMicrotasks();
    expect(readSnapshot).toHaveBeenCalledTimes(2);

    pending.resolve(snapshot({ article_comments: 1 }));
    await flushMicrotasks();

    expect(readSnapshot).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(['article_comments']);
    stop();
  });

  it('keeps the last stable checkpoint across rejected and unstable snapshot reads', async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(Object.assign(new Error('snapshot_unstable'), { code: 'snapshot_unstable' }))
      .mockResolvedValueOnce(snapshot({ conversations: 1 }));
    const { observer } = createObserver(readSnapshot);
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await observer.whenReady();
    observer.requestReconcile();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    observer.requestReconcile();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledWith(['conversations']);
    stop();
  });

  it('reconciles storage and visible lifecycle signals through the same snapshot path', async () => {
    const documentLike = { ...createEventTarget(), visibilityState: 'visible' };
    const windowLike = createEventTarget();
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ article_comments: 1 }))
      .mockResolvedValueOnce(snapshot({ messages: 1, article_comments: 1 }));
    const { observer, storageWake } = createObserver(readSnapshot, {
      getDocument: () => documentLike as any,
      getWindow: () => windowLike as any,
    });
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await observer.whenReady();
    await flushMicrotasks();
    storageWake();
    await flushMicrotasks();
    windowLike.dispatch('focus');
    await flushMicrotasks();

    expect(listener).toHaveBeenNthCalledWith(1, ['article_comments']);
    expect(listener).toHaveBeenNthCalledWith(2, ['messages']);
    stop();
  });

  it('continues notifying other consumers when one revision listener throws', async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ image_cache: 1 }));
    const { observer } = createObserver(readSnapshot);
    const received = vi.fn();
    const stopThrowing = observer.subscribe(() => {
      throw new Error('ignore this consumer');
    });
    const stopReceived = observer.subscribe(received);

    await observer.whenReady();
    observer.requestReconcile();
    await flushMicrotasks();

    expect(received).toHaveBeenCalledWith(['image_cache']);
    stopThrowing();
    stopReceived();
  });

  it('supports DOM-unavailable consumers and removes storage listeners after the last unsubscribe', async () => {
    const readSnapshot = vi.fn().mockResolvedValue(snapshot());
    const { observer, storageListener } = createObserver(readSnapshot);
    const stop = observer.subscribe(vi.fn());

    await observer.whenReady();
    expect(storageListener()).toBeTruthy();
    stop();
    expect(storageListener()).toBeNull();
  });

  it('replays requested scopes after an equal authoritative snapshot and coalesces retries', async () => {
    vi.useFakeTimers();
    const readSnapshot = vi.fn().mockResolvedValue(snapshot());
    const { observer } = createObserver(readSnapshot, { retryReconcileMs: 20 });
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await observer.whenReady();
    await flushMicrotasks();
    observer.requestRetry(['conversations']);
    observer.requestRetry(['conversations']);
    await vi.advanceTimersByTimeAsync(20);
    await flushMicrotasks();

    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(['conversations']);
    stop();
  });

  it('defers a retry requested from a subscriber callback to the next snapshot', async () => {
    vi.useFakeTimers();
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ conversations: 1 }))
      .mockResolvedValueOnce(snapshot({ conversations: 1 }));
    const { observer } = createObserver(readSnapshot, { retryReconcileMs: 20 });
    const notifications: string[][] = [];
    const stop = observer.subscribe((scopes) => {
      notifications.push([...scopes]);
      if (notifications.length === 1) observer.requestRetry(['article_comments']);
    });

    await observer.whenReady();
    await flushMicrotasks();
    observer.requestReconcile();
    await flushMicrotasks();
    expect(notifications).toEqual([['conversations']]);

    await vi.advanceTimersByTimeAsync(20);
    await flushMicrotasks();
    expect(notifications).toEqual([['conversations'], ['article_comments']]);
    stop();
  });

  it('retains retry scopes after a failed snapshot and retries them later', async () => {
    vi.useFakeTimers();
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new Error('snapshot read failed'))
      .mockResolvedValueOnce(snapshot());
    const { observer } = createObserver(readSnapshot, { retryReconcileMs: 20 });
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await observer.whenReady();
    await flushMicrotasks();
    observer.requestRetry(['image_cache']);
    await vi.advanceTimersByTimeAsync(20);
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20);
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledWith(['image_cache']);
    stop();
  });

  it('holds retries while hidden and cancels them after the final unsubscribe', async () => {
    vi.useFakeTimers();
    const documentLike = { ...createEventTarget(), visibilityState: 'hidden' };
    const readSnapshot = vi.fn().mockResolvedValue(snapshot());
    const { observer } = createObserver(readSnapshot, {
      getDocument: () => documentLike as any,
      retryReconcileMs: 20,
    });
    const listener = vi.fn();
    const stop = observer.subscribe(listener);

    await observer.whenReady();
    await flushMicrotasks();
    observer.requestRetry(['messages']);
    await vi.advanceTimersByTimeAsync(40);
    expect(readSnapshot).toHaveBeenCalledTimes(1);

    documentLike.visibilityState = 'visible';
    documentLike.dispatch('visibilitychange');
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledWith(['messages']);

    observer.requestRetry(['messages']);
    stop();
    await vi.advanceTimersByTimeAsync(40);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });
});
