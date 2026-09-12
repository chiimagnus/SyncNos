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
          available: true,
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
      kind: 'default',
      message: 'No subtitles detected; available video details were saved.',
    });
    expect(sendMock.mock.calls.filter(([type]) => type === 'getActiveTabCaptureState')).toHaveLength(2);
  });

  it('runs the captured callback only for a saved video', async () => {
    const onCaptured = vi.fn(async () => undefined);
    sendMock.mockImplementation(async (type: string) => {
      if (type === 'getActiveTabCaptureState') {
        return apiOk({
          available: true,
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
    expect(latest?.status).toEqual({ kind: 'default', message: 'Saved: Talk' });
    expect(sendMock.mock.calls.filter(([type]) => type === 'getActiveTabCaptureState')).toHaveLength(2);
  });
});
