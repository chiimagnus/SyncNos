// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scan = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@services/insight/image-duplicates', () => ({
  scanDuplicateImageAssets: (...args: unknown[]) => scan.run(...args),
}));
import { useStorageDuplicates } from '@viewmodels/settings/useStorageDuplicates';

const assets = [{ id: 1, conversationId: 1, bytes: 3, readable: true }] as any[];
const result = {
  candidates: 2,
  hashed: 2,
  hashErrors: 0,
  duplicateGroups: 1,
  potentialRedundantBytes: 3,
  groups: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let root: ReactDOM.Root;
let current: ReturnType<typeof useStorageDuplicates>;
function Harness({ valid = true }: { valid?: boolean }) {
  const state = useStorageDuplicates(assets, valid);
  useEffect(() => {
    current = state;
  }, [state]);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = ReactDOM.createRoot(document.getElementById('root')!);
  scan.run.mockReset().mockResolvedValue(result);
  await act(async () => {
    root.render(createElement(Harness));
  });
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('duplicate scan lifecycle', () => {
  it('is opt-in and reports only verified duplicate results', async () => {
    expect(scan.run).not.toHaveBeenCalled();
    await act(async () => {
      current.start();
    });
    expect(scan.run).toHaveBeenCalledWith(assets, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(current.status).toBe('ready');
    expect(current.report?.potentialRedundantBytes).toBe(3);
  });

  it('cancels work when the resource snapshot becomes stale, never displaying outdated results', async () => {
    const pending = deferred<any>();
    scan.run.mockReturnValueOnce(pending.promise);
    await act(async () => {
      current.start();
    });
    expect(current.status).toBe('running');
    const signal = scan.run.mock.calls.at(-1)?.[1].signal as AbortSignal;
    await act(async () => {
      root.render(createElement(Harness, { valid: false }));
    });
    expect(signal.aborted).toBe(true);
    expect(current.status).toBe('stale');
    await act(async () => {
      pending.resolve(result);
    });
    expect(current.report).toBeNull();
  });

  it('keeps the last verified report when a subsequent scan fails', async () => {
    await act(async () => {
      current.start();
    });
    scan.run.mockRejectedValueOnce(new Error('indexedDB read failed'));
    await act(async () => {
      current.start();
    });
    expect(current.report?.duplicateGroups).toBe(1);
    expect(current.status).toBe('error');
    expect(current.error).toContain('indexedDB read failed');
  });
});
