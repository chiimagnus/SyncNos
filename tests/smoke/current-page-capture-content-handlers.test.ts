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

  it('routes video context-menu progress through the unified current-page handler', async () => {
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

    const captureCurrentPage = vi.fn(async (input?: any) => {
      input?.onProgress?.({ message: 'No subtitles detected; available video details were saved.', kind: 'default' });
      return {
        kind: 'video',
        label: 'Fetch Video Transcript',
        collectorId: 'video',
        conversationId: 42,
        isNew: true,
        subtitleStatus: 'empty',
      };
    });
    const showSaveTip = vi.fn();
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState: vi.fn(), captureCurrentPage } as any, {
      inpageTip: { showSaveTip },
    });

    let response: any = null;
    expect(
      registeredListener?.({ type: 'captureCurrentPage', payload: { source: 'contextmenu' } }, {}, (value: any) => {
        response = value;
      }),
    ).toBe(true);
    await waitFor(() => response?.ok === true);

    expect(captureCurrentPage).toHaveBeenCalledTimes(1);
    expect(showSaveTip).toHaveBeenCalledWith('No subtitles detected; available video details were saved.', {
      kind: 'default',
    });
    expect(response?.data).toMatchObject({ kind: 'video', subtitleStatus: 'empty', conversationId: 42, isNew: true });
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

    const getCurrentPageCaptureState = vi.fn(async () => ({ readiness: 'ready' }));
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
    expect(stateResponse?.data).toEqual({ readiness: 'ready' });
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

  it('shows the same inpage progress for shortcut capture', async () => {
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

    const captureCurrentPage = vi.fn(async (input?: any) => {
      input?.onProgress?.({ message: 'Saved by shortcut', kind: 'default' });
      return { title: 'Shortcut' };
    });
    const showSaveTip = vi.fn();
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState: vi.fn(), captureCurrentPage } as any, {
      inpageTip: { showSaveTip },
    });

    let response: any = null;
    registeredListener?.({ type: 'captureCurrentPage', payload: { source: 'shortcut' } }, {}, (value: any) => {
      response = value;
    });
    await waitFor(() => response?.ok === true);

    expect(showSaveTip).toHaveBeenCalledWith('Saved by shortcut', { kind: 'default' });
    expect(response?.data).toEqual({ title: 'Shortcut' });
  });

  it('does not show an inpage tip for capture messages without an inpage source', async () => {
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

    const captureCurrentPage = vi.fn(async (input?: any) => {
      input?.onProgress?.({ message: 'Should stay hidden', kind: 'default' });
      return { title: 'Popup' };
    });
    const showSaveTip = vi.fn();
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState: vi.fn(), captureCurrentPage } as any, {
      inpageTip: { showSaveTip },
    });

    let response: any = null;
    registeredListener?.({ type: 'captureCurrentPage' }, {}, (value: any) => {
      response = value;
    });
    await waitFor(() => response?.ok === true);

    expect(captureCurrentPage).toHaveBeenCalledWith(undefined);
    expect(showSaveTip).not.toHaveBeenCalled();
  });

  it('keeps the existing error envelope while surfacing shortcut capture errors', async () => {
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

    const captureCurrentPage = vi.fn(async (input?: any) => {
      input?.onProgress?.({ message: 'Cannot capture this page', kind: 'error' });
      throw new Error('Cannot capture this page');
    });
    const showSaveTip = vi.fn();
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState: vi.fn(), captureCurrentPage } as any, {
      inpageTip: { showSaveTip },
    });

    let response: any = null;
    registeredListener?.({ type: 'captureCurrentPage', payload: { source: 'shortcut' } }, {}, (value: any) => {
      response = value;
    });
    await waitFor(() => response?.ok === false);

    expect(showSaveTip).toHaveBeenCalledWith('Cannot capture this page', { kind: 'error' });
    expect(response).toEqual({
      ok: false,
      data: null,
      error: { message: 'Cannot capture this page', extra: null },
    });
  });
});
