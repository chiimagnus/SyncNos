import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_READER_PREFS, READER_PREFS_STORAGE_KEY } from '../../src/services/protocols/reader-prefs';

const storageState = vi.hoisted(() => ({
  items: {} as Record<string, unknown>,
  storageGetMock: vi.fn(),
  storageSetMock: vi.fn(),
  listeners: [] as Array<(changes: any, areaName: string) => void>,
}));

vi.mock('../../src/services/shared/storage', () => ({
  storageGet: (...args: unknown[]) => storageState.storageGetMock(...args),
  storageSet: (...args: unknown[]) => storageState.storageSetMock(...args),
  storageOnChanged: (listener: (changes: any, areaName: string) => void) => {
    storageState.listeners.push(listener);
    return () => {
      storageState.listeners = storageState.listeners.filter((item) => item !== listener);
    };
  },
}));

import { useReaderPrefs } from '../../src/viewmodels/reader/useReaderPrefs';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

function snapshotFor(overrides: Record<string, unknown> = {}) {
  return {
    ...DEFAULT_READER_PREFS,
    ...overrides,
    tts: { ...DEFAULT_READER_PREFS.tts, ...((overrides.tts as Record<string, unknown> | undefined) ?? {}) },
  };
}

describe('useReaderPrefs', () => {
  let root: ReactDOM.Root | null = null;
  let snapshot: ReturnType<typeof useReaderPrefs> | null = null;

  function Harness() {
    snapshot = useReaderPrefs();
    return createElement('div', null, 'reader-prefs');
  }

  async function flush() {
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
  }

  async function render() {
    act(() => {
      root!.render(createElement(Harness));
    });
    await flush();
  }

  function dispatchStorage(next: unknown) {
    storageState.items[READER_PREFS_STORAGE_KEY] = next;
    act(() => {
      for (const listener of storageState.listeners) {
        listener({ [READER_PREFS_STORAGE_KEY]: { newValue: next } }, 'local');
      }
    });
  }

  beforeEach(() => {
    setupDom();
    storageState.items = {};
    storageState.listeners = [];
    storageState.storageGetMock.mockReset();
    storageState.storageSetMock.mockReset();
    storageState.storageGetMock.mockImplementation(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(storageState.items, key)) out[key] = storageState.items[key];
      }
      return out;
    });
    storageState.storageSetMock.mockImplementation(async (patch: Record<string, unknown>) => {
      Object.assign(storageState.items, patch);
    });
    snapshot = null;
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('hydrates defaults or an existing durable snapshot', async () => {
    await render();
    expect(snapshot?.prefs).toEqual(DEFAULT_READER_PREFS);

    act(() => root?.unmount());
    root = ReactDOM.createRoot(document.getElementById('root')!);
    storageState.items[READER_PREFS_STORAGE_KEY] = snapshotFor({ fontSize: 27, contentWidth: 1440 });
    await render();
    expect(snapshot?.prefs.fontSize).toBe(27);
    expect(snapshot?.prefs.contentWidth).toBe(1440);
  });

  it('ignores a stale initial read after a newer storage observation', async () => {
    const initialGet = deferred<Record<string, unknown>>();
    storageState.storageGetMock.mockReturnValueOnce(initialGet.promise);
    act(() => root!.render(createElement(Harness)));

    dispatchStorage(snapshotFor({ fontSize: 29 }));
    expect(snapshot?.prefs.fontSize).toBe(29);

    initialGet.resolve({ [READER_PREFS_STORAGE_KEY]: snapshotFor({ fontSize: 16 }) });
    await flush();
    expect(snapshot?.prefs.fontSize).toBe(29);
  });

  it('waits for initial durable hydration before the first local commit', async () => {
    const initialGet = deferred<Record<string, unknown>>();
    storageState.storageGetMock.mockReturnValueOnce(initialGet.promise);
    act(() => root!.render(createElement(Harness)));

    let commit!: Promise<void>;
    act(() => {
      commit = snapshot!.update({ fontSize: 25 });
    });
    expect(snapshot?.prefs.fontSize).toBe(25);
    expect(storageState.storageSetMock).toHaveBeenCalledTimes(0);

    initialGet.resolve({ [READER_PREFS_STORAGE_KEY]: snapshotFor({ contentWidth: 1550 }) });
    await act(async () => commit);

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(1);
    const written = storageState.storageSetMock.mock.calls[0]?.[0]?.[READER_PREFS_STORAGE_KEY];
    expect(written).toMatchObject({ fontSize: 25, contentWidth: 1550 });
  });

  it('fails closed when initial hydration cannot provide a durable base, then recovers from a storage observation', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storageState.storageGetMock.mockRejectedValueOnce(new Error('read failed'));
    await render();
    storageState.storageSetMock.mockClear();

    act(() => snapshot!.preview({ fontSize: 25 }));
    let commitError: unknown = null;
    await act(async () => {
      try {
        await snapshot!.commitPreview();
      } catch (error) {
        commitError = error;
      }
    });

    expect(commitError).toBeInstanceOf(Error);
    expect((commitError as Error).message).toBe('read failed');
    expect(storageState.storageSetMock).toHaveBeenCalledTimes(0);
    expect(snapshot?.prefs.fontSize).toBe(DEFAULT_READER_PREFS.fontSize);

    dispatchStorage(snapshotFor({ contentWidth: 1650, lineHeight: 1.8 }));
    await act(async () => snapshot!.update({ fontSize: 25 }));

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(1);
    expect(storageState.storageSetMock.mock.calls[0]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({
      fontSize: 25,
      contentWidth: 1650,
      lineHeight: 1.8,
    });
    warning.mockRestore();
  });

  it('rebases a pre-hydration dirty preview on the successful durable read before an unmount final commit', async () => {
    const initialGet = deferred<Record<string, unknown>>();
    storageState.storageGetMock.mockReturnValueOnce(initialGet.promise);
    await render();
    storageState.storageSetMock.mockClear();

    act(() => snapshot!.preview({ fontSize: 26 }));
    act(() => root?.unmount());
    root = null;
    expect(storageState.storageSetMock).toHaveBeenCalledTimes(0);

    initialGet.resolve({
      [READER_PREFS_STORAGE_KEY]: snapshotFor({ contentWidth: 1580, lineHeight: 1.85 }),
    });
    await flush();

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(1);
    expect(storageState.storageSetMock.mock.calls[0]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({
      fontSize: 26,
      contentWidth: 1580,
      lineHeight: 1.85,
    });
  });

  it('previews repeatedly with zero writes and commits the generation once', async () => {
    await render();
    storageState.storageSetMock.mockClear();

    act(() => {
      snapshot!.preview({ fontSize: 22 });
      snapshot!.preview({ fontSize: 23 });
      snapshot!.preview({ lineHeight: 1.9 });
    });
    expect(snapshot?.prefs).toMatchObject({ fontSize: 23, lineHeight: 1.9 });
    expect(storageState.storageSetMock).toHaveBeenCalledTimes(0);

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = snapshot!.commitPreview();
      second = snapshot!.commitPreview();
    });
    expect(second).toBe(first);
    await act(async () => first);

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(1);
    expect(storageState.storageSetMock.mock.calls[0]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({
      fontSize: 23,
      lineHeight: 1.9,
    });
  });

  it('suppresses a normalized no-op when preview returns to the durable value', async () => {
    await render();
    storageState.storageSetMock.mockClear();

    act(() => {
      snapshot!.preview({ fontSize: 25 });
      snapshot!.preview({ fontSize: DEFAULT_READER_PREFS.fontSize });
    });
    await act(async () => snapshot!.commitPreview());

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(0);
    expect(snapshot?.prefs.fontSize).toBe(DEFAULT_READER_PREFS.fontSize);
  });

  it('merges dirty preview with an immediate discrete update into one durable write', async () => {
    await render();
    storageState.storageSetMock.mockClear();

    act(() => snapshot!.preview({ fontSize: 24 }));
    await act(async () => snapshot!.update({ fontFamily: 'mono' }));

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(1);
    expect(storageState.storageSetMock.mock.calls[0]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({
      fontSize: 24,
      fontFamily: 'mono',
    });
  });

  it('keeps a newer preview dirty when a self storage observation arrives during the current write', async () => {
    await render();
    storageState.storageSetMock.mockClear();
    const firstWrite = deferred<void>();
    storageState.storageSetMock
      .mockImplementationOnce(async () => firstWrite.promise)
      .mockImplementation(async (patch: Record<string, unknown>) => Object.assign(storageState.items, patch));

    act(() => snapshot!.preview({ fontSize: 24 }));
    let commit!: Promise<void>;
    act(() => {
      commit = snapshot!.commitPreview();
    });
    await flush();
    const firstSnapshot = storageState.storageSetMock.mock.calls[0]?.[0]?.[READER_PREFS_STORAGE_KEY];

    act(() => snapshot!.preview({ lineHeight: 2 }));
    dispatchStorage(firstSnapshot);
    expect(snapshot?.prefs).toMatchObject({ fontSize: 24, lineHeight: 2 });

    firstWrite.resolve();
    await act(async () => commit);

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(2);
    expect(storageState.storageSetMock.mock.calls[1]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({
      fontSize: 24,
      lineHeight: 2,
    });
  });

  it('rebases local dirty fields over an external durable change before commit', async () => {
    await render();
    storageState.storageSetMock.mockClear();

    act(() => snapshot!.preview({ fontSize: 24 }));
    dispatchStorage(snapshotFor({ contentWidth: 1600, lineHeight: 1.6 }));
    expect(snapshot?.prefs).toMatchObject({ fontSize: 24, contentWidth: 1600, lineHeight: 1.6 });

    await act(async () => snapshot!.commitPreview());
    expect(storageState.storageSetMock).toHaveBeenCalledTimes(1);
    expect(storageState.storageSetMock.mock.calls[0]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({
      fontSize: 24,
      contentWidth: 1600,
      lineHeight: 1.6,
    });
  });

  it('does not let local-success fallback overwrite a newer external durable observation', async () => {
    await render();
    storageState.storageSetMock.mockClear();
    const firstWrite = deferred<void>();
    storageState.storageSetMock
      .mockImplementationOnce(async () => firstWrite.promise)
      .mockImplementation(async (patch: Record<string, unknown>) => Object.assign(storageState.items, patch));

    act(() => snapshot!.preview({ fontSize: 24 }));
    let commit!: Promise<void>;
    act(() => {
      commit = snapshot!.commitPreview();
    });
    await flush();
    dispatchStorage(snapshotFor({ contentWidth: 1700 }));

    firstWrite.resolve();
    await act(async () => commit);

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(2);
    expect(storageState.storageSetMock.mock.calls[1]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({
      fontSize: 24,
      contentWidth: 1700,
    });
    expect(snapshot?.prefs).toMatchObject({ fontSize: 24, contentWidth: 1700 });
  });

  it('rolls back the same generation on write failure', async () => {
    await render();
    storageState.storageSetMock.mockReset();
    storageState.storageSetMock.mockRejectedValueOnce(new Error('write failed'));

    act(() => snapshot!.preview({ fontSize: 24 }));
    let writeError: unknown = null;
    await act(async () => {
      try {
        await snapshot!.commitPreview();
      } catch (error) {
        writeError = error;
      }
    });

    expect(writeError).toBeInstanceOf(Error);
    expect((writeError as Error).message).toBe('write failed');
    expect(snapshot?.prefs.fontSize).toBe(DEFAULT_READER_PREFS.fontSize);
    await act(async () => snapshot!.commitPreview());
    expect(storageState.storageSetMock).toHaveBeenCalledTimes(1);
  });

  it('preserves a newer generation after an older write fails and commits the latest trailing snapshot', async () => {
    await render();
    storageState.storageSetMock.mockClear();
    const firstWrite = deferred<void>();
    storageState.storageSetMock
      .mockImplementationOnce(async () => firstWrite.promise)
      .mockImplementation(async (patch: Record<string, unknown>) => Object.assign(storageState.items, patch));

    act(() => snapshot!.preview({ fontSize: 24 }));
    let commit!: Promise<void>;
    act(() => {
      commit = snapshot!.commitPreview();
    });
    await flush();
    act(() => snapshot!.preview({ lineHeight: 2.1 }));
    firstWrite.reject(new Error('first write failed'));

    await act(async () => commit);
    expect(storageState.storageSetMock).toHaveBeenCalledTimes(2);
    expect(storageState.storageSetMock.mock.calls[1]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({
      fontSize: 24,
      lineHeight: 2.1,
    });
    expect(snapshot?.prefs).toMatchObject({ fontSize: 24, lineHeight: 2.1 });
  });

  it('best-effort commits one dirty snapshot on unmount without a duplicate write', async () => {
    await render();
    storageState.storageSetMock.mockClear();
    act(() => snapshot!.preview({ fontSize: 26 }));

    act(() => root?.unmount());
    root = null;
    await flush();

    expect(storageState.storageSetMock).toHaveBeenCalledTimes(1);
    expect(storageState.storageSetMock.mock.calls[0]?.[0]?.[READER_PREFS_STORAGE_KEY]).toMatchObject({ fontSize: 26 });
  });
});
