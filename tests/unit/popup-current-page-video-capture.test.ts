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
      checkingCurrentPage: 'Checking current page',
      currentPageCannotBeCaptured: 'Current page cannot be captured',
      captureFailedFallback: 'Capture failed',
      fetchingDots: 'Fetching...',
      checkingDots: 'Checking...',
      partialCaptureSaved: 'Partial capture saved',
      captureWaitingForMessages: 'waiting for messages…',
      partialCaptureSavedLive: 'Live reply saved; confirm later.',
      partialCaptureSavedHistory: 'History still unconfirmed.',
      partialCaptureSavedContent: 'Some content remains unconfirmed.',
      partialCaptureSavedMedia: 'Some media remains incomplete.',
      sourceChatgpt: 'ChatGPT',
      videoTranscriptTipNoSubtitles: 'No subtitles detected; available video details were saved.',
    })[key] || key,
}));
vi.mock('@services/shared/capture-tip', () => ({
  buildCaptureSuccessTipMessage: ({ isNew, title }: { isNew: boolean; title?: string }) =>
    `${isNew ? 'Saved' : 'Updated'}: ${title || 'Untitled'}`,
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
    sendMock.mockImplementation(async (type: string) => {
      if (type === 'getActiveTabCaptureState') {
        return apiOk({
          readiness: 'ready',
          kind: 'video',
          label: 'Fetch Video Transcript',
          collectorId: 'video',
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

    let result: any = null;
    await act(async () => {
      result = await latest?.capture();
    });

    expect(result).toMatchObject({ kind: 'video', subtitleStatus: 'empty', conversationId: 19, isNew: true });
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(latest?.status).toEqual({
      phase: 'saved',
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
    expect(latest?.phase).toBe('waiting');
    expect(latest?.status).toEqual({
      phase: 'waiting',
      kind: 'info',
      message: 'ChatGPT · waiting for messages…',
    });
    expect(await latest?.capture()).toBeNull();
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it('serializes waiting polls so one slow state request cannot overlap the next', async () => {
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

  it('maps ChatGPT live-tail partial reasons to a warning instead of the generic history message', async () => {
    const onCaptured = vi.fn();
    sendMock.mockImplementation(async (type: string) => {
      if (type === 'getActiveTabCaptureState') {
        return apiOk({ readiness: 'ready', kind: 'chat', label: 'Fetch AI Chat', collectorId: 'chatgpt' });
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

    expect(latest?.phase).toBe('saved-partial');
    expect(latest?.status).toEqual({
      phase: 'saved-partial',
      kind: 'warning',
      message: 'Live reply saved; confirm later.',
    });
  });

  it('runs the captured callback only for a saved video', async () => {
    const onCaptured = vi.fn(async () => undefined);
    sendMock.mockImplementation(async (type: string) => {
      if (type === 'getActiveTabCaptureState') {
        return apiOk({
          readiness: 'ready',
          kind: 'video',
          label: 'Fetch Video Transcript',
          collectorId: 'video',
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

    let result: any = null;
    await act(async () => {
      result = await latest?.capture();
    });

    expect(result).toMatchObject({ kind: 'video', subtitleStatus: 'ok', conversationId: 21, isNew: true });
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(latest?.status).toEqual({ phase: 'saved', kind: 'success', message: 'Saved: Talk' });
    expect(sendMock.mock.calls.filter(([type]) => type === 'getActiveTabCaptureState')).toHaveLength(2);
  });
});
