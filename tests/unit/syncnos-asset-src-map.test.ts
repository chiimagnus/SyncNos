import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const mocks = vi.hoisted(() => ({
  getImageCacheAssetsByIds: vi.fn(),
  subscribeDataRevisionChanges: vi.fn(),
  whenDataRevisionObserverReady: vi.fn(),
  requestDataRevisionRetry: vi.fn(),
}));

vi.mock('@services/conversations/data/image-cache-read', () => ({
  getImageCacheAssetsByIds: (...args: any[]) => mocks.getImageCacheAssetsByIds(...args),
}));

vi.mock('@services/data-revisions/observer', () => ({
  subscribeDataRevisionChanges: (listener: (scopes: readonly string[]) => void) =>
    mocks.subscribeDataRevisionChanges(listener),
  whenDataRevisionObserverReady: () => mocks.whenDataRevisionObserverReady(),
  requestDataRevisionRetry: (scopes: readonly string[]) => mocks.requestDataRevisionRetry(scopes),
}));

import { useSyncnosAssetSrcMap } from '@viewmodels/conversations/useSyncnosAssetSrcMap';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeAsset(id: number, conversationId: number, byte = id) {
  return {
    id,
    conversationId,
    url: `https://example.com/${id}.png`,
    blob: new Blob([Uint8Array.of(byte)], { type: 'image/png' }),
    byteSize: 1,
    contentType: 'image/png',
  };
}

function makeAssetMap(...assets: ReturnType<typeof makeAsset>[]) {
  return new Map(assets.map((asset) => [asset.id, asset]));
}

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
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
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: dom.window.FileReader });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).FileReader;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('useSyncnosAssetSrcMap', () => {
  let root: ReactDOM.Root | null = null;
  let revisionListener: ((scopes: readonly string[]) => void) | null = null;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let latestMap: ReadonlyMap<number, string> = new Map();
  let renderedMaps: ReadonlyMap<number, string>[] = [];
  let createObjectUrl: ReturnType<typeof vi.fn>;
  let revokeObjectUrl: ReturnType<typeof vi.fn>;
  let originalCreateObjectUrl: PropertyDescriptor | undefined;
  let originalRevokeObjectUrl: PropertyDescriptor | undefined;
  let objectUrlSequence = 0;

  function Probe({ conversationId, markdowns }: { conversationId: number; markdowns: string[] }) {
    latestMap = useSyncnosAssetSrcMap({ conversationId, markdowns });
    renderedMaps.push(latestMap);
    return null;
  }

  async function renderProbe(conversationId: number, markdowns: string[]) {
    await act(async () => {
      root!.render(createElement(Probe, { conversationId, markdowns }));
      await flushMicrotasks();
    });
  }

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    latestMap = new Map();
    renderedMaps = [];
    revisionListener = null;
    unsubscribe = vi.fn();
    objectUrlSequence = 0;
    mocks.getImageCacheAssetsByIds.mockReset();
    mocks.subscribeDataRevisionChanges.mockReset();
    mocks.whenDataRevisionObserverReady.mockReset();
    mocks.requestDataRevisionRetry.mockReset();
    mocks.subscribeDataRevisionChanges.mockImplementation((listener) => {
      revisionListener = listener;
      return unsubscribe;
    });
    originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    createObjectUrl = vi.fn(() => `blob:asset-${++objectUrlSequence}`);
    revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectUrl });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
        await flushMicrotasks();
      });
    }
    root = null;
    if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
    else delete (URL as any).createObjectURL;
    if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
    else delete (URL as any).revokeObjectURL;
    cleanupDom();
  });

  it('subscribes before the first asset read and proceeds after degraded readiness', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    mocks.whenDataRevisionObserverReady.mockReturnValue(readiness.promise);
    mocks.getImageCacheAssetsByIds.mockResolvedValue(makeAssetMap(makeAsset(7, 11)));

    await renderProbe(11, ['![cached](syncnos-asset://7)']);
    expect(mocks.subscribeDataRevisionChanges).toHaveBeenCalledTimes(1);
    expect(mocks.getImageCacheAssetsByIds).not.toHaveBeenCalled();

    await act(async () => {
      readiness.resolve({ baselineAvailable: false });
      await flushMicrotasks();
    });

    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledWith({ ids: [7], conversationId: 11 });
    expect(latestMap.get(7)).toBe('blob:asset-1');
  });

  it('reads only the latest conversation and asset ids when identity changes while readiness is pending', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    mocks.whenDataRevisionObserverReady.mockReturnValue(readiness.promise);
    mocks.getImageCacheAssetsByIds.mockImplementation(({ ids, conversationId }: any) =>
      Promise.resolve(makeAssetMap(...Array.from(ids, (id: any) => makeAsset(Number(id), conversationId)))),
    );

    await renderProbe(11, ['![old](syncnos-asset://1)']);
    await renderProbe(22, ['![new](syncnos-asset://2)']);
    expect(mocks.getImageCacheAssetsByIds).not.toHaveBeenCalled();

    await act(async () => {
      readiness.resolve({ baselineAvailable: true });
      await flushMicrotasks();
    });

    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);
    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledWith({ ids: [2], conversationId: 22 });
    expect(latestMap.has(1)).toBe(false);
    expect(latestMap.get(2)).toBe('blob:asset-1');
  });

  it('resolves multiple local assets through one bulk read per generation', async () => {
    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.getImageCacheAssetsByIds.mockResolvedValue(makeAssetMap(makeAsset(3, 11), makeAsset(4, 11)));

    await renderProbe(11, [
      '![first](syncnos-asset://3) ![duplicate](syncnos-asset://3)',
      '![second](syncnos-asset://4)',
    ]);

    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);
    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledWith({ ids: [3, 4], conversationId: 11 });
    expect(latestMap.get(3)).toBe('blob:asset-1');
    expect(latestMap.get(4)).toBe('blob:asset-2');
  });

  it('re-resolves on image_cache revisions without replacing its observer subscription', async () => {
    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.getImageCacheAssetsByIds.mockResolvedValue(makeAssetMap(makeAsset(3, 11)));
    await renderProbe(11, ['![cached](syncnos-asset://3)']);
    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);

    await act(async () => {
      revisionListener?.(['image_cache']);
      await flushMicrotasks();
    });

    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(2);
    expect(mocks.subscribeDataRevisionChanges).toHaveBeenCalledTimes(1);
  });

  it('preserves last-good sources on read failure, requests retry, and replaces them on replay', async () => {
    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.getImageCacheAssetsByIds.mockResolvedValueOnce(makeAssetMap(makeAsset(4, 11)));
    await renderProbe(11, ['![cached](syncnos-asset://4)']);
    expect(latestMap.get(4)).toBe('blob:asset-1');

    mocks.getImageCacheAssetsByIds.mockRejectedValueOnce(new Error('idb unavailable'));
    await act(async () => {
      revisionListener?.(['image_cache']);
      await flushMicrotasks();
    });

    expect(latestMap.get(4)).toBe('blob:asset-1');
    expect(mocks.requestDataRevisionRetry).toHaveBeenCalledWith(['image_cache']);
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:asset-1');

    mocks.requestDataRevisionRetry.mockClear();
    mocks.getImageCacheAssetsByIds.mockResolvedValueOnce(makeAssetMap(makeAsset(4, 11, 9)));
    await act(async () => {
      revisionListener?.(['image_cache']);
      await flushMicrotasks();
    });

    expect(latestMap.get(4)).toBe('blob:asset-2');
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:asset-1');
    expect(mocks.requestDataRevisionRetry).not.toHaveBeenCalled();
  });

  it('does not reuse a prior conversation asset when the new conversation read rejects', async () => {
    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.getImageCacheAssetsByIds.mockResolvedValueOnce(makeAssetMap(makeAsset(4, 11)));
    await renderProbe(11, ['![cached](syncnos-asset://4)']);
    expect(latestMap.get(4)).toBe('blob:asset-1');

    renderedMaps = [];
    mocks.getImageCacheAssetsByIds.mockRejectedValueOnce(new Error('idb unavailable'));
    await renderProbe(22, ['![cached](syncnos-asset://4)']);

    expect(renderedMaps.every((map) => !map.has(4))).toBe(true);
    expect(mocks.getImageCacheAssetsByIds).toHaveBeenLastCalledWith({ ids: [4], conversationId: 22 });
    expect(latestMap.has(4)).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:asset-1');
    expect(mocks.requestDataRevisionRetry).toHaveBeenCalledWith(['image_cache']);
  });

  it('treats a resolved missing bulk entry as authoritative and revokes the old object URL', async () => {
    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.getImageCacheAssetsByIds.mockResolvedValueOnce(makeAssetMap(makeAsset(5, 11)));
    await renderProbe(11, ['![cached](syncnos-asset://5)']);
    expect(latestMap.get(5)).toBe('blob:asset-1');

    mocks.getImageCacheAssetsByIds.mockResolvedValueOnce(new Map());
    await act(async () => {
      revisionListener?.(['image_cache']);
      await flushMicrotasks();
    });

    expect(latestMap.has(5)).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:asset-1');
    expect(mocks.requestDataRevisionRetry).not.toHaveBeenCalled();
  });

  it('drops an old identity resolve and drains one trailing resolve for the latest identity', async () => {
    const oldRead = deferred<any>();
    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.getImageCacheAssetsByIds
      .mockImplementationOnce(() => oldRead.promise)
      .mockResolvedValueOnce(makeAssetMap(makeAsset(8, 22)));

    await renderProbe(11, ['![old](syncnos-asset://7)']);
    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(1);
    await renderProbe(22, ['![new](syncnos-asset://8)']);

    await act(async () => {
      oldRead.resolve(makeAssetMap(makeAsset(7, 11)));
      await flushMicrotasks();
    });

    expect(mocks.getImageCacheAssetsByIds).toHaveBeenCalledTimes(2);
    expect(mocks.getImageCacheAssetsByIds.mock.calls[1]?.[0]).toEqual({ ids: [8], conversationId: 22 });
    expect(latestMap.has(7)).toBe(false);
    expect(latestMap.get(8)).toBe('blob:asset-1');
  });

  it('does not retry a rejected read from an old identity', async () => {
    const oldRead = deferred<any>();
    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.getImageCacheAssetsByIds
      .mockImplementationOnce(() => oldRead.promise)
      .mockResolvedValueOnce(makeAssetMap(makeAsset(10, 22)));

    await renderProbe(11, ['![old](syncnos-asset://9)']);
    await renderProbe(22, ['![new](syncnos-asset://10)']);

    await act(async () => {
      oldRead.reject(new Error('stale failure'));
      await flushMicrotasks();
    });

    expect(mocks.requestDataRevisionRetry).not.toHaveBeenCalled();
    expect(latestMap.get(10)).toBe('blob:asset-1');
  });

  it('unsubscribes and avoids late reads when unmounted before readiness settles', async () => {
    const readiness = deferred<{ baselineAvailable: boolean }>();
    mocks.whenDataRevisionObserverReady.mockReturnValue(readiness.promise);

    await renderProbe(11, ['![cached](syncnos-asset://12)']);
    await act(async () => {
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;

    readiness.resolve({ baselineAvailable: true });
    await flushMicrotasks();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.getImageCacheAssetsByIds).not.toHaveBeenCalled();
  });

  it('revokes mounted object URLs on unmount', async () => {
    mocks.whenDataRevisionObserverReady.mockResolvedValue({ baselineAvailable: true });
    mocks.getImageCacheAssetsByIds.mockResolvedValue(makeAssetMap(makeAsset(13, 11)));
    await renderProbe(11, ['![cached](syncnos-asset://13)']);
    expect(latestMap.get(13)).toBe('blob:asset-1');

    await act(async () => {
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:asset-1');
  });
});
