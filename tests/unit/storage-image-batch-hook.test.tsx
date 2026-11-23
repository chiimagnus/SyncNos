// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@services/conversations/data/image-optimization-batch', () => ({
  optimizeImageBatch: (...args: unknown[]) => mocks.run(...args),
}));
import { useStorageImageBatch } from '@viewmodels/settings/useStorageImageBatch';

let root: ReactDOM.Root;
let last: ReturnType<typeof useStorageImageBatch>;
function Harness() {
  const current = useStorageImageBatch();
  useEffect(() => {
    last = current;
  }, [current]);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const selection = [
  { id: 1, conversationId: 5 },
  { id: 2, conversationId: 5 },
];

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = ReactDOM.createRoot(document.querySelector('#root')!);
  mocks.run.mockReset();
  await act(async () => {
    root.render(createElement(Harness));
  });
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('image optimization batch lifecycle', () => {
  it('prevents duplicate runs, shows confirmed progress and truthfully marks partial cancellation', async () => {
    const pending = deferred<any>();
    mocks.run.mockReturnValue(pending.promise);
    let run!: Promise<void>;
    await act(async () => {
      run = last.start(selection);
      await last.start(selection);
    });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(last.status).toBe('running');
    const options = mocks.run.mock.calls[0]?.[1];
    await act(async () => {
      await options.onProgress({
        processed: 1,
        total: 2,
        savedCount: 1,
        bytesSaved: 12,
        entries: [{ id: 1, conversationId: 5, status: 'saved', bytesSaved: 12 }],
      });
    });
    expect(last.result?.bytesSaved).toBe(12);

    await act(async () => {
      last.cancel();
    });
    expect(options.signal.aborted).toBe(true);
    expect(last.status).toBe('cancelling');
    await act(async () => {
      pending.resolve({
        processed: 1,
        total: 2,
        savedCount: 1,
        bytesSaved: 12,
        entries: [{ id: 1, conversationId: 5, status: 'saved', bytesSaved: 12 }],
        cancelled: true,
      });
      await run;
    });
    expect(last.status).toBe('cancelled');
    expect(last.result?.savedCount).toBe(1);
  });

  it('stops the job on unmount without reporting an invented completion', async () => {
    const pending = deferred<any>();
    mocks.run.mockReturnValue(pending.promise);
    await act(async () => {
      void last.start(selection);
    });
    const signal = mocks.run.mock.calls[0]?.[1].signal as AbortSignal;
    await act(async () => {
      root.unmount();
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ processed: 0, cancelled: true });
    });
    root = ReactDOM.createRoot(document.createElement('div'));
  });
});
