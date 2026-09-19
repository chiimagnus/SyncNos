import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('@services/shared/runtime', () => ({ send: sendMock }));
vi.mock('@i18n', () => ({
  t: (key: string) =>
    ({
      unavailable: 'Unavailable',
      currentPageCannotBeCaptured: 'Current page cannot be captured',
      captureFailedFallback: 'Capture failed',
      fetchingDots: 'Fetching...',
      checkingDots: 'Checking...',
      captureWaitingForMessages: 'waiting for messages…',
      sourceChatgpt: 'ChatGPT',
    })[key] || key,
}));
import { usePopupCurrentPageCapture } from '@viewmodels/popup/usePopupCurrentPageCapture';

let dom: JSDOM;
let root: ReactDOM.Root | null = null;
let latest: ReturnType<typeof usePopupCurrentPageCapture> | null = null;

function apiOk<T>(data: T) {
  return { ok: true, data, error: null };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe(props: { onCaptured: () => void | Promise<void> }) {
  latest = usePopupCurrentPageCapture({ onCaptured: props.onCaptured });
  return React.createElement('button', null, latest.buttonLabel);
}

async function flushEffects() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  latest = null;
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'chrome-extension://syncnos/popup.html',
  });
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  g.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  vi.useRealTimers();
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  dom.window.close();
  const g = globalThis as any;
  delete g.window;
  delete g.document;
  delete g.navigator;
  delete g.IS_REACT_ACT_ENVIRONMENT;
});

describe('popup current-page video capture', () => {
  it('shows video state and treats empty subtitles as a saved metadata-only video', async () => {
    const onCaptured = vi.fn();
    let stateCalls = 0;
    sendMock.mockImplementation(async (type: string) => {
      if (type === 'getActiveTabCaptureState') {
        stateCalls += 1;
        return apiOk({
          readiness: 'ready',
          kind: 'video',
          label: 'Fetch Video Transcript',
          collectorId: 'video',
          ...(stateCalls > 1
            ? {
                activity: {
                  phase: 'settled',
                  kind: 'success',
                  message: 'No subtitles detected; available video details were saved.',
                  expiresAt: Date.now() + 5_000,
                },
              }
            : null),
        });
      }
      if (type === 'captureActiveTabCurrentPage') {
        return apiOk({
          kind: 'video',
          label: 'Fetch Video Transcript',
          collectorId: 'video',
          conversationId: 19,
          isNew: true,
          subtitleStatus: 'empty',
          title: 'Talk',
        });
      }
      throw new Error(`unexpected message: ${type}`);
    });

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => root?.render(React.createElement(Probe, { onCaptured })));
    await flushEffects();
    expect(latest?.buttonLabel).toBe('Fetch Video Transcript');

    await act(async () => {
      await latest?.capture();
    });
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(latest?.status).toEqual({
      kind: 'success',
      message: 'No subtitles detected; available video details were saved.',
    });
    expect(sendMock.mock.calls.filter(([type]) => type === 'getActiveTabCaptureState')).toHaveLength(2);
  });

  it('shows supported-but-empty chat pages as neutral waiting and keeps capture disabled', async () => {
    const onCaptured = vi.fn();
    sendMock.mockResolvedValue(
      apiOk({
        readiness: 'waiting',
        kind: 'chat',
        label: 'Fetch AI Chat',
        collectorId: 'chatgpt',
        reason: 'ChatGPT · waiting for messages…',
      }),
    );

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => root?.render(React.createElement(Probe, { onCaptured })));
    await flushEffects();

    expect(latest?.buttonDisabled).toBe(true);
    expect(latest?.buttonLabel).toBe('ChatGPT · waiting for messages…');
    expect(latest?.status).toEqual({
      kind: 'info',
      message: 'ChatGPT · waiting for messages…',
    });
    await expect(latest!.capture()).resolves.toBeUndefined();
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it('single-flights mount and immediate focus state refreshes', async () => {
    const onCaptured = vi.fn();
    const stateRequest = deferred<ReturnType<typeof apiOk<any>>>();
    sendMock.mockImplementation((type: string) => {
      if (type !== 'getActiveTabCaptureState') throw new Error(`unexpected message: ${type}`);
      return stateRequest.promise;
    });

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => {
      root?.render(React.createElement(Probe, { onCaptured }));
      await Promise.resolve();
    });
    expect(sendMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new window.Event('focus'));
      await Promise.resolve();
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(latest?.checking).toBe(true);

    await act(async () => {
      stateRequest.resolve(
        apiOk({ readiness: 'ready', kind: 'video', label: 'Fetch Video Transcript', collectorId: 'video' }),
      );
      await flushEffects();
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(latest?.checking).toBe(false);
    expect(latest?.captureState).toMatchObject({ readiness: 'ready', kind: 'video' });
  });

  it('serializes waiting polls so one slow state request cannot overlap focus or the next poll', async () => {
    vi.useFakeTimers();
    const onCaptured = vi.fn();
    const slowPoll = deferred<ReturnType<typeof apiOk<any>>>();
    let stateCalls = 0;
    const waitingState = {
      readiness: 'waiting',
      kind: 'chat',
      label: 'Fetch AI Chat',
      collectorId: 'chatgpt',
      reason: 'ChatGPT · waiting for messages…',
    };
    sendMock.mockImplementation(async (type: string) => {
      if (type !== 'getActiveTabCaptureState') throw new Error(`unexpected message: ${type}`);
      stateCalls += 1;
      if (stateCalls === 2) return slowPoll.promise;
      return apiOk(waitingState);
    });

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => root?.render(React.createElement(Probe, { onCaptured })));
    await flushEffects();
    expect(stateCalls).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(stateCalls).toBe(2);

    await act(async () => {
      window.dispatchEvent(new window.Event('focus'));
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(stateCalls).toBe(2);

    await act(async () => {
      slowPoll.resolve(apiOk(waitingState));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    expect(stateCalls).toBe(3);
  });

  it('shows recent capture activity from another surface and clears it after expiry', async () => {
    vi.useFakeTimers();
    const onCaptured = vi.fn();
    sendMock.mockResolvedValue(
      apiOk({
        readiness: 'ready',
        kind: 'video',
        label: 'Fetch Video Transcript',
        collectorId: 'video',
        activity: {
          phase: 'settled',
          kind: 'success',
          message: 'Updated: Talk',
          expiresAt: Date.now() + 5_000,
        },
      }),
    );

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => root?.render(React.createElement(Probe, { onCaptured })));
    await flushEffects();

    expect(latest?.buttonLabel).toBe('Updated: Talk');
    expect(latest?.status).toEqual({ kind: 'success', message: 'Updated: Talk' });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(latest?.buttonLabel).toBe('Fetch Video Transcript');
    expect(latest?.status).toBeNull();
  });

  it('polls an external capture until the shared activity settles', async () => {
    vi.useFakeTimers();
    const onCaptured = vi.fn();
    let stateCalls = 0;
    sendMock.mockImplementation(async (type: string) => {
      if (type !== 'getActiveTabCaptureState') throw new Error(`unexpected message: ${type}`);
      stateCalls += 1;
      if (stateCalls === 1) {
        return apiOk({
          readiness: 'ready',
          kind: 'article',
          label: 'Fetch Article',
          collectorId: 'web',
          activity: {
            phase: 'capturing',
            kind: 'info',
            message: 'Fetching...',
            expiresAt: null,
          },
        });
      }
      return apiOk({
        readiness: 'ready',
        kind: 'article',
        label: 'Fetch Article',
        collectorId: 'web',
        activity: {
          phase: 'settled',
          kind: 'success',
          message: 'Updated: Article',
          expiresAt: Date.now() + 5_000,
        },
      });
    });

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => root?.render(React.createElement(Probe, { onCaptured })));
    await flushEffects();

    expect(latest?.buttonDisabled).toBe(true);
    expect(latest?.buttonLabel).toBe('Fetching...');

    await act(async () => {
      vi.advanceTimersByTime(300);
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(stateCalls).toBe(2);
    expect(latest?.buttonDisabled).toBe(false);
    expect(latest?.buttonLabel).toBe('Updated: Article');
    expect(latest?.status).toEqual({ kind: 'success', message: 'Updated: Article' });
  });

  it('uses the canonical capture activity for ChatGPT partial-save status', async () => {
    const onCaptured = vi.fn();
    let stateCalls = 0;
    sendMock.mockImplementation(async (type: string) => {
      if (type === 'getActiveTabCaptureState') {
        stateCalls += 1;
        return apiOk({
          readiness: 'ready',
          kind: 'chat',
          label: 'Fetch AI Chat',
          collectorId: 'chatgpt',
          ...(stateCalls > 1
            ? {
                activity: {
                  phase: 'settled',
                  kind: 'warning',
                  message: 'Live reply saved; confirm later.',
                  expiresAt: Date.now() + 5_000,
                },
              }
            : null),
        });
      }
      if (type === 'captureActiveTabCurrentPage') {
        return apiOk({
          kind: 'chat',
          label: 'Fetch AI Chat',
          collectorId: 'chatgpt',
          conversationId: 20,
          isNew: false,
          captureCompleteness: 'partial',
          captureReasons: ['chatgpt_api_live_tail_unconfirmed'],
          title: 'Chat',
        });
      }
      throw new Error(`unexpected message: ${type}`);
    });

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => root?.render(React.createElement(Probe, { onCaptured })));
    await flushEffects();
    await act(async () => {
      await latest?.capture();
    });

    expect(latest?.status).toEqual({
      kind: 'warning',
      message: 'Live reply saved; confirm later.',
    });
  });

  it('keeps state relay failures as errors without exposing a fabricated capture state', async () => {
    const onCaptured = vi.fn();
    sendMock.mockRejectedValue(new Error('relay failed'));

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => root?.render(React.createElement(Probe, { onCaptured })));
    await flushEffects();

    expect(latest?.buttonDisabled).toBe(true);
    expect(latest?.buttonLabel).toBe('Unavailable');
    expect(latest?.status).toEqual({ kind: 'error', message: 'relay failed' });
    expect(latest?.captureState).toBeNull();
    expect(latest?.checking).toBe(false);
    await expect(latest!.capture()).resolves.toBeUndefined();
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it('runs the captured callback only for a saved video', async () => {
    const onCaptured = vi.fn(async () => undefined);
    let stateCalls = 0;
    sendMock.mockImplementation(async (type: string) => {
      if (type === 'getActiveTabCaptureState') {
        stateCalls += 1;
        return apiOk({
          readiness: 'ready',
          kind: 'video',
          label: 'Fetch Video Transcript',
          collectorId: 'video',
          ...(stateCalls > 1
            ? {
                activity: {
                  phase: 'settled',
                  kind: 'success',
                  message: 'Saved: Talk',
                  expiresAt: Date.now() + 5_000,
                },
              }
            : null),
        });
      }
      if (type === 'captureActiveTabCurrentPage') {
        return apiOk({
          kind: 'video',
          label: 'Fetch Video Transcript',
          collectorId: 'video',
          conversationId: 21,
          isNew: true,
          subtitleStatus: 'ok',
          title: 'Talk',
        });
      }
      throw new Error(`unexpected message: ${type}`);
    });

    root = ReactDOM.createRoot(document.getElementById('root')!);
    await act(async () => root?.render(React.createElement(Probe, { onCaptured })));
    await flushEffects();

    await act(async () => {
      await latest?.capture();
    });
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(latest?.status).toEqual({ kind: 'success', message: 'Saved: Talk' });
    expect(sendMock.mock.calls.filter(([type]) => type === 'getActiveTabCaptureState')).toHaveLength(2);
  });
});
