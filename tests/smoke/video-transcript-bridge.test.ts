import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORE_KEY = '__SYNCNOS_VIDEO_TRANSCRIPT_BRIDGE__';

let dom: JSDOM;

async function loadBridge() {
  let config: any = null;
  vi.stubGlobal('defineContentScript', (value: any) => {
    config = value;
    return value;
  });
  await import('../../src/entrypoints/video-transcript-bridge.content.ts');
  if (!config) throw new Error('bridge content script was not registered');
  return config;
}

function dispatch(data: any) {
  window.dispatchEvent(new (window as any).MessageEvent('message', { source: window, data }));
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete (globalThis as any)[STORE_KEY];
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.bilibili.com/video/BV1BBBBBBBBB/',
  });
  vi.stubGlobal('window', dom.window as unknown as Window & typeof globalThis);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
});

afterEach(() => {
  delete (globalThis as any)[STORE_KEY];
  vi.unstubAllGlobals();
  dom.window.close();
});

describe('video transcript isolated bridge', () => {
  it('is injected on exact video-capable hosts rather than only video paths', async () => {
    const config = await loadBridge();
    expect(config.runAt).toBe('document_start');
    expect(config.matches).toEqual([
      'https://www.youtube.com/*',
      'https://youtu.be/*',
      'https://www.bilibili.com/*',
      'https://bilibili.com/*',
    ]);
  });

  it('stores only video-state endpoints with request-page identity', async () => {
    const config = await loadBridge();
    config.main();

    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://api.bilibili.com/x/player/wbi/v2?cid=current',
      pageUrl: location.href,
      bodyText: '{"code":0}',
    });
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/current.json',
      pageUrl: location.href,
      bodyText: '{"body":[]}',
    });
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://evil.example/?next=https://www.youtube.com/api/timedtext',
      pageUrl: location.href,
      bodyText: 'evil',
    });
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://api.bilibili.com/x/player/wbi/v2?cid=no-page',
      bodyText: '{"code":0}',
    });

    expect((globalThis as any)[STORE_KEY]).toEqual({
      responses: [
        {
          url: 'https://api.bilibili.com/x/player/wbi/v2?cid=current',
          pageUrl: location.href,
          bodyText: '{"code":0}',
        },
      ],
    });
  });

  it('keeps only the latest response for each endpoint kind', async () => {
    const config = await loadBridge();
    config.main();

    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://api.bilibili.com/x/player/wbi/v2?cid=old',
      pageUrl: location.href,
      bodyText: 'old-player',
    });
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://api.bilibili.com/x/player/wbi/v2?cid=new',
      pageUrl: location.href,
      bodyText: 'new-player',
    });
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://www.youtube.com/api/timedtext?v=current&lang=en',
      pageUrl: 'https://www.youtube.com/watch?v=current',
      bodyText: 'youtube',
    });

    expect((globalThis as any)[STORE_KEY].responses).toEqual([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=new',
        pageUrl: location.href,
        bodyText: 'new-player',
      },
      {
        url: 'https://www.youtube.com/api/timedtext?v=current&lang=en',
        pageUrl: 'https://www.youtube.com/watch?v=current',
        bodyText: 'youtube',
      },
    ]);
  });
});
