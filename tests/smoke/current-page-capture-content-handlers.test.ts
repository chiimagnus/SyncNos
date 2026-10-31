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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('current-page-capture content handlers', () => {
  it('routes the canonical capture command through the shared service', async () => {
    const runtime = setupListener();
    const captureCurrentPage = vi.fn(async () => ({ kind: 'chat', title: 'Saved' }));
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState: vi.fn(), captureCurrentPage } as any, {
      localeReady: Promise.resolve(),
    });

    const result = await dispatch(runtime.getListener(), { type: 'captureCurrentPage' });

    expect(result).toEqual({ ok: true, data: { kind: 'chat', title: 'Saved' }, error: null });
    expect(captureCurrentPage).toHaveBeenCalledOnce();
    expect(captureCurrentPage).toHaveBeenCalledWith();
  });

  it('rechecks the explicitly selected page URL before starting capture', async () => {
    const runtime = setupListener();
    const captureCurrentPage = vi.fn(async () => ({ kind: 'article', title: 'Saved' }));
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState: vi.fn(), captureCurrentPage } as any, {
      localeReady: Promise.resolve(),
    });
    vi.stubGlobal('location', { href: 'https://example.com/changed' });
    expect(
      await dispatch(runtime.getListener(), {
        type: 'captureCurrentPage',
        payload: { expectedUrl: 'https://example.com/original' },
      }),
    ).toMatchObject({ ok: false, error: { extra: { code: 'CAPTURE_TARGET_CHANGED' } } });
    expect(captureCurrentPage).not.toHaveBeenCalled();
    vi.stubGlobal('location', { href: 'https://example.com/original' });
    expect(
      await dispatch(runtime.getListener(), {
        type: 'captureCurrentPage',
        payload: { expectedUrl: 'https://example.com/original' },
      }),
    ).toMatchObject({ ok: true, data: { kind: 'article', title: 'Saved' } });
    expect(captureCurrentPage).toHaveBeenCalledOnce();
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

  it('keeps capture and state requests available when locale initialization fails', async () => {
    const locale = deferred<void>();
    const runtime = setupListener();
    const captureCurrentPage = vi.fn(async () => ({ title: 'Fallback' }));
    const getCurrentPageCaptureState = vi.fn(async () => ({ kind: 'chat' }));
    registerCurrentPageCaptureContentHandlers({ getCurrentPageCaptureState, captureCurrentPage } as any, {
      localeReady: locale.promise,
    });
    let captureResponse: any = null;
    let stateResponse: any = null;
    runtime.getListener()({ type: 'captureCurrentPage' }, {}, (next: any) => {
      captureResponse = next;
    });
    runtime.getListener()({ type: 'getCurrentPageCaptureState' }, {}, (next: any) => {
      stateResponse = next;
    });
    locale.reject(new Error('locale failed'));
    await waitFor(() => captureResponse?.ok === true && stateResponse?.ok === true);
    expect(captureCurrentPage).toHaveBeenCalledOnce();
    expect(getCurrentPageCaptureState).toHaveBeenCalledOnce();
    expect(captureResponse.data).toEqual({ title: 'Fallback' });
    expect(stateResponse.data).toEqual({ kind: 'chat' });
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

  it('retains safe ChatGPT API error code and HTTP status across the content response', async () => {
    const runtime = setupListener();
    registerCurrentPageCaptureContentHandlers(
      {
        getCurrentPageCaptureState: vi.fn(),
        captureCurrentPage: vi.fn(async () => {
          throw Object.assign(new Error('Advanced capture temporarily unavailable'), {
            code: 'chatgpt_api_page_http',
            status: 503,
          });
        }),
      } as any,
      { localeReady: Promise.resolve() },
    );
    expect(await dispatch(runtime.getListener(), { type: 'captureCurrentPage' })).toEqual({
      ok: false,
      data: null,
      error: {
        message: 'Advanced capture temporarily unavailable',
        extra: { code: 'chatgpt_api_page_http', status: 503 },
      },
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
