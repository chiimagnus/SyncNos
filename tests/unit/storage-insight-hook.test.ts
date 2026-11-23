import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorageOverview } from '@services/insight/storage-insight-source';

const source = vi.hoisted(() => ({ get: vi.fn(), scan: vi.fn() }));
const revision = vi.hoisted(() => ({ listen: vi.fn(), ready: vi.fn(), retry: vi.fn() }));

vi.mock('@services/insight/storage-insight-source', () => ({
  getStorageOverview: () => source.get(),
  scanStorageAssets: (options: unknown) => source.scan(options),
}));
vi.mock('@services/data-revisions/observer', () => ({
  subscribeDataRevisionChanges: (fn: (scopes: string[]) => void) => revision.listen(fn),
  whenDataRevisionObserverReady: () => revision.ready(),
  requestDataRevisionRetry: (scopes: string[]) => revision.retry(scopes),
}));

import { useStorageInsight } from '@viewmodels/settings/useStorageInsight';

let dom: JSDOM;
let root: ReactDOM.Root | null;
let onRevision: (scopes: string[]) => void;
let last: ReturnType<typeof useStorageInsight>;
let unsubscribe: ReturnType<typeof vi.fn>;

function Harness() {
  const state = useStorageInsight();
  useEffect(() => {
    last = state;
  }, [state]);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://extension.test', pretendToBeVisual: true });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  unsubscribe = vi.fn();
  root = ReactDOM.createRoot(document.getElementById('root')!);
  revision.listen.mockImplementation((listener) => {
    onRevision = listener;
    return unsubscribe;
  });
  revision.ready.mockResolvedValue({ baselineAvailable: true });
  source.get.mockResolvedValue({ imageCacheRecords: 1, originUsageBytes: 10, originQuotaBytes: 20 });
  source.scan.mockResolvedValue({ records: 1, readableCount: 1, bytes: 2 });
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  dom.window.close();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('storage insights revision lifecycle', () => {
  it('subscribes before reading, ignores irrelevant revisions and responds to image_cache changes', async () => {
    await act(async () => {
      root!.render(createElement(Harness));
    });
    await flush();
    expect(last.overview?.imageCacheRecords).toBe(1);
    expect(source.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      onRevision(['messages']);
    });
    expect(source.get).toHaveBeenCalledTimes(1);

    source.get.mockResolvedValue({ imageCacheRecords: 2, originUsageBytes: null, originQuotaBytes: null });
    await act(async () => {
      onRevision(['image_cache']);
    });
    await flush();
    expect(last.overview?.imageCacheRecords).toBe(2);
  });

  it('drops stale success and preserves last-good on a later read failure', async () => {
    await act(async () => {
      root!.render(createElement(Harness));
    });
    await flush();
    const stale = deferred<StorageOverview>();
    source.get.mockReturnValueOnce(stale.promise).mockRejectedValueOnce(new Error('IDB offline'));
    await act(async () => {
      onRevision(['image_cache']);
    });
    await act(async () => {
      onRevision(['image_cache']);
    });
    await act(async () => {
      stale.resolve({ imageCacheRecords: 999, originUsageBytes: 0, originQuotaBytes: 0 });
    });
    await flush();
    expect(last.overview?.imageCacheRecords).toBe(1);
    expect(last.status).toBe('error');
    expect(last.error).toContain('IDB offline');
    expect(revision.retry).toHaveBeenCalledWith(['image_cache']);
  });

  it('only scans on request, retains last good data after a revision and ignores stale scan completion', async () => {
    await act(async () => {
      root!.render(createElement(Harness));
    });
    expect(source.scan).not.toHaveBeenCalled();
    await act(async () => {
      last.startScan();
    });
    await flush();
    expect(last.scanStatus).toBe('ready');
    expect(last.scanData?.readableCount).toBe(1);

    const pending = deferred<any>();
    source.scan.mockReturnValueOnce(pending.promise);
    await act(async () => {
      last.startScan();
    });
    expect(last.scanStatus).toBe('running');
    const signal = source.scan.mock.calls.at(-1)?.[0].signal as AbortSignal;
    await act(async () => {
      onRevision(['image_cache']);
    });
    expect(signal.aborted).toBe(true);
    expect(last.scanStatus).toBe('stale');

    await act(async () => {
      pending.resolve({ records: 99, readableCount: 99 });
    });
    await flush();
    expect(last.scanData?.readableCount).toBe(1);
    expect(last.scanStatus).toBe('stale');
  });

  it('cancels a user scan and does not report partial results as complete', async () => {
    const pending = deferred<any>();
    source.scan.mockReturnValue(pending.promise);
    await act(async () => {
      root!.render(createElement(Harness));
    });
    await act(async () => {
      last.startScan();
    });
    const signal = source.scan.mock.calls[0]?.[0].signal as AbortSignal;
    await act(async () => {
      last.cancelScan();
    });
    expect(signal.aborted).toBe(true);
    expect(last.scanStatus).toBe('cancelled');
    await act(async () => {
      pending.resolve({ records: 99 });
    });
    expect(last.scanData).toBeNull();
  });

  it('does not apply late results after unmount', async () => {
    const pending = deferred<StorageOverview>();
    source.get.mockReturnValue(pending.promise);
    await act(async () => {
      root!.render(createElement(Harness));
    });
    expect(source.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      root!.unmount();
    });
    root = null;
    await act(async () => {
      pending.resolve({ imageCacheRecords: 9, originUsageBytes: null, originQuotaBytes: null });
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
