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

function setupListener() {
  let listener: any = null;
  const removeListener = vi.fn();
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((registered: any) => {
          listener = registered;
        }),
        removeListener,
      },
    },
  };
  return {
    getListener: () => {
      if (!listener) throw new Error('capture content listener not registered');
      return listener;
    },
    removeListener,
  };
}

async function dispatch(listener: any, message: any) {
  let response: any = null;
  const handled = listener(message, {}, (next: any) => {
    response = next;
  });
  expect(handled).toBe(true);
  await waitFor(() => response !== null);
  return response;
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('current-page-capture content handlers', () => {
  it.each([
    ['popup', undefined],
    ['context menu', { source: 'contextmenu' }],
    ['shortcut', { source: 'shortcut' }],
  ])('routes %s capture through the same service state', async (_name, payload) => {
    const runtime = setupListener();
    const captureCurrentPage = vi.fn(async () => ({ kind: 'chat', title: 'Saved' }));
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState: vi.fn(), captureCurrentPage } as any, {
      localeReady: Promise.resolve(),
    });

    const result = await dispatch(runtime.getListener(), {
      type: 'captureCurrentPage',
      ...(payload ? { payload } : null),
    });

    expect(result).toEqual({ ok: true, data: { kind: 'chat', title: 'Saved' }, error: null });
    expect(captureCurrentPage).toHaveBeenCalledOnce();
    expect(captureCurrentPage).toHaveBeenCalledWith();
  });

  it('passes the video metadata result unchanged', async () => {
    const runtime = setupListener();
    const result = {
      kind: 'video',
      label: 'Fetch Video Transcript',
      collectorId: 'video',
      conversationId: 42,
      isNew: true,
      subtitleStatus: 'empty',
    };
    registerCurrentPageCaptureContentHandlers(
      { getCurrentPageCaptureState: vi.fn(), captureCurrentPage: vi.fn(async () => result) } as any,
      { localeReady: Promise.resolve() },
    );

    expect((await dispatch(runtime.getListener(), { type: 'captureCurrentPage' })).data).toEqual(result);
  });

  it('registers the listener before locale is ready, then returns the current activity', async () => {
    const locale = deferred<void>();
    const runtime = setupListener();
    const getCurrentPageCaptureState = vi.fn(async () => ({ kind: 'chat', activity: { phase: 'capturing' } }));
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState, captureCurrentPage: vi.fn() } as any, {
      localeReady: locale.promise,
    });

    let response: any = null;
    expect(
      runtime.getListener()({ type: 'getCurrentPageCaptureState' }, {}, (next: any) => {
        response = next;
      }),
    ).toBe(true);
    await Promise.resolve();
    expect(getCurrentPageCaptureState).not.toHaveBeenCalled();

    locale.resolve();
    await waitFor(() => response?.ok === true);
    expect(response.data).toEqual({ kind: 'chat', activity: { phase: 'capturing' } });
    expect(getCurrentPageCaptureState).toHaveBeenCalledOnce();
  });

  it('keeps capture available when locale initialization fails', async () => {
    const locale = deferred<void>();
    const runtime = setupListener();
    const captureCurrentPage = vi.fn(async () => ({ title: 'Fallback' }));
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState: vi.fn(), captureCurrentPage } as any, {
      localeReady: locale.promise,
    });
    let response: any = null;
    runtime.getListener()({ type: 'captureCurrentPage' }, {}, (next: any) => {
      response = next;
    });
    locale.reject(new Error('locale failed'));
    await waitFor(() => response?.ok === true);
    expect(captureCurrentPage).toHaveBeenCalledOnce();
    expect(response.data).toEqual({ title: 'Fallback' });
  });

  it('returns the same error envelope on failed captures', async () => {
    const runtime = setupListener();
    registerCurrentPageCaptureContentHandlers(
      {
        getCurrentPageCaptureState: vi.fn(),
        captureCurrentPage: vi.fn(async () => {
          throw new Error('Cannot capture this page');
        }),
      } as any,
      { localeReady: Promise.resolve() },
    );

    expect(await dispatch(runtime.getListener(), { type: 'captureCurrentPage' })).toEqual({
      ok: false,
      data: null,
      error: { message: 'Cannot capture this page', extra: null },
    });
  });

  it('removes its registered listener on cleanup', () => {
    const runtime = setupListener();
    const cleanup = registerCurrentPageCaptureContentHandlers(
      { getCurrentPageCaptureState: vi.fn(), captureCurrentPage: vi.fn() } as any,
      { localeReady: Promise.resolve() },
    );

    const listener = runtime.getListener();
    cleanup();
    expect(runtime.removeListener).toHaveBeenCalledOnce();
    expect(runtime.removeListener).toHaveBeenCalledWith(listener);
  });
});
