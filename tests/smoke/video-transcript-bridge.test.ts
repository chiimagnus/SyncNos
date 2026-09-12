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

  it('stores only trusted video endpoints with request-page identity', async () => {
    const config = await loadBridge();
    config.main();

    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/current.json',
      pageUrl: location.href,
      contentType: 'application/json',
      bodyText: '{"body":[]}',
      at: 10,
    });
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://evil.example/?next=https://www.youtube.com/api/timedtext',
      pageUrl: location.href,
      bodyText: 'evil',
      at: 11,
    });
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/no-page.json',
      bodyText: '{"body":[]}',
      at: 12,
    });
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_META_RESPONSE',
      requestId: 'legacy-meta',
      meta: { state: null, dom: null },
    });

    expect((globalThis as any)[STORE_KEY]).toEqual({
      responses: [
        {
          url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/current.json',
          pageUrl: location.href,
          contentType: 'application/json',
          bodyText: '{"body":[]}',
          at: 10,
        },
      ],
    });
  });

  it('keeps one bounded response history without truncating oversized JSON', async () => {
    const config = await loadBridge();
    config.main();

    const exactlyAtLimit = 'x'.repeat(2_000_000);
    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://api.bilibili.com/x/player/wbi/v2?limit=exact',
      pageUrl: location.href,
      bodyText: exactlyAtLimit,
      at: 1,
    });
    expect((globalThis as any)[STORE_KEY].responses).toHaveLength(1);
    expect((globalThis as any)[STORE_KEY].responses[0].bodyText).toHaveLength(2_000_000);

    dispatch({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_INTERCEPTED',
      url: 'https://api.bilibili.com/x/player/wbi/v2?limit=over',
      pageUrl: location.href,
      bodyText: `${exactlyAtLimit}x`,
      at: 2,
    });
    expect((globalThis as any)[STORE_KEY].responses).toHaveLength(1);

    for (let index = 0; index < 31; index += 1) {
      dispatch({
        __syncnos: true,
        type: 'SYNCNOS_VIDEO_INTERCEPTED',
        url: `https://api.bilibili.com/x/player/wbi/v2?index=${index}`,
        pageUrl: location.href,
        bodyText: `body-${index}`,
        at: 100 + index,
      });
    }

    const responses = (globalThis as any)[STORE_KEY].responses;
    expect(responses).toHaveLength(30);
    expect(responses[0].bodyText).toBe('body-1');
    expect(responses[29].bodyText).toBe('body-30');
  });
});
