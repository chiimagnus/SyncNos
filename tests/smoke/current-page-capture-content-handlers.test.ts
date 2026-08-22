import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerCurrentPageCaptureContentHandlers } from '@services/bootstrap/current-page-capture-content-handlers';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('current-page-capture content handlers', () => {
  it('shows inpage tip progress when capture is triggered from context menu', async () => {
    let registeredListener: any = null;
    const addListener = vi.fn((listener: any) => {
      registeredListener = listener;
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener,
          removeListener: vi.fn(),
        },
      },
    };

    const captureCurrentPage = vi.fn(async (input?: any) => {
      input?.onProgress?.({ message: 'Saving...', kind: 'default' });
      input?.onProgress?.({ message: 'Saved: Hello', kind: 'default' });
      return { title: 'Hello' };
    });

    const showSaveTip = vi.fn();

    registerCurrentPageCaptureContentHandlers(
      {
        // Not used in this test.
        getCurrentPageCaptureState: vi.fn(),
        captureCurrentPage,
      } as any,
      { inpageTip: { showSaveTip } },
    );

    expect(addListener).toHaveBeenCalledTimes(1);

    let response: any = null;
    const returned = registeredListener?.(
      { type: 'captureCurrentPage', payload: { source: 'contextmenu' } },
      {},
      (value: any) => {
        response = value;
      },
    );

    expect(returned).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(captureCurrentPage).toHaveBeenCalledTimes(1);
    expect(showSaveTip).toHaveBeenCalledWith('Saving...', { kind: 'default' });
    expect(showSaveTip).toHaveBeenCalledWith('Saved: Hello', { kind: 'default' });
    expect(response?.ok).toBe(true);
    expect(response?.data).toEqual({ title: 'Hello' });
  });

  it('registers capture listeners immediately and waits for locale before service work', async () => {
    const locale = deferred<void>();
    let registeredListener: any = null;
    const addListener = vi.fn((listener: any) => {
      registeredListener = listener;
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener,
          removeListener: vi.fn(),
        },
      },
    };

    const getCurrentPageCaptureState = vi.fn(async () => ({ available: true }));
    const captureCurrentPage = vi.fn(async () => ({ title: 'Hello' }));

    registerCurrentPageCaptureContentHandlers(
      {
        getCurrentPageCaptureState,
        captureCurrentPage,
      } as any,
      { localeReady: locale.promise },
    );

    expect(addListener).toHaveBeenCalledTimes(1);

    let stateResponse: any = null;
    expect(
      registeredListener?.({ type: 'getCurrentPageCaptureState' }, {}, (value: any) => {
        stateResponse = value;
      }),
    ).toBe(true);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(getCurrentPageCaptureState).not.toHaveBeenCalled();

    locale.resolve();
    await waitFor(() => stateResponse?.ok === true);
    expect(getCurrentPageCaptureState).toHaveBeenCalledTimes(1);
    expect(stateResponse?.ok).toBe(true);
    expect(stateResponse?.data).toEqual({ available: true });
  });

  it('continues current-page work after locale readiness rejects', async () => {
    const locale = deferred<void>();
    let registeredListener: any = null;

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: any) => {
            registeredListener = listener;
          }),
          removeListener: vi.fn(),
        },
      },
    };

    const captureCurrentPage = vi.fn(async () => ({ title: 'Fallback' }));
    registerCurrentPageCaptureContentHandlers(
      {
        getCurrentPageCaptureState: vi.fn(),
        captureCurrentPage,
      } as any,
      { localeReady: locale.promise },
    );

    let response: any = null;
    registeredListener?.({ type: 'captureCurrentPage', payload: { source: 'popup' } }, {}, (value: any) => {
      response = value;
    });
    locale.reject(new Error('locale failed'));
    await waitFor(() => response?.ok === true);

    expect(captureCurrentPage).toHaveBeenCalledTimes(1);
    expect(response?.ok).toBe(true);
    expect(response?.data).toEqual({ title: 'Fallback' });
  });
});
