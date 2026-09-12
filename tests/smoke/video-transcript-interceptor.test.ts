import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dom: JSDOM;

function installDom(url: string, html = '<!doctype html><html><head></head><body></body></html>') {
  dom = new JSDOM(html, { url });
  vi.stubGlobal('window', dom.window as unknown as Window & typeof globalThis);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
}

async function loadInterceptor() {
  let config: any = null;
  vi.stubGlobal('defineContentScript', (value: any) => {
    config = value;
    return value;
  });
  await import('../../src/entrypoints/video-transcript-interceptor.content.ts');
  if (!config) throw new Error('interceptor content script was not registered');
  return config;
}

function dispatchMetaRequest(requestId = 'meta-request') {
  window.dispatchEvent(
    new (window as any).MessageEvent('message', {
      source: window,
      data: { __syncnos: true, type: 'SYNCNOS_VIDEO_META_REQUEST', requestId },
    }),
  );
}

function findPosted(spy: ReturnType<typeof vi.spyOn>, type: string) {
  return spy.mock.calls.map((call) => call[0] as any).filter((data) => data?.type === type);
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  dom?.window.close();
});

describe('video transcript main-world interceptor', () => {
  it('is injected at document-start on exact video-capable hosts', async () => {
    installDom('https://www.youtube.com/');
    const config = await loadInterceptor();
    expect(config.runAt).toBe('document_start');
    expect(config.world).toBe('MAIN');
    expect(config.matches).toEqual([
      'https://www.youtube.com/*',
      'https://youtu.be/*',
      'https://www.bilibili.com/*',
      'https://bilibili.com/*',
    ]);
  });

  it('binds fetch responses to the page where the request started', async () => {
    const pageA = 'https://www.youtube.com/watch?v=A';
    const pageB = 'https://www.youtube.com/watch?v=B';
    installDom(pageA);

    let resolveFetch!: (value: any) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const config = await loadInterceptor();
    config.main();

    const pending = (globalThis.fetch as any)('https://www.youtube.com/api/timedtext?v=A');
    dom.reconfigure({ url: pageB });
    resolveFetch({
      url: 'https://www.youtube.com/api/timedtext?v=A',
      clone: () => ({
        headers: { get: () => 'text/xml' },
        text: async () => '<transcript><text start="1" dur="1">A</text></transcript>',
      }),
    });
    await pending;

    const posted = findPosted(postSpy, 'SYNCNOS_VIDEO_INTERCEPTED');
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      url: 'https://www.youtube.com/api/timedtext?v=A',
      pageUrl: pageA,
      bodyText: '<transcript><text start="1" dur="1">A</text></transcript>',
    });
  });

  it('keeps XHR endpoint identity from open time and page identity from send time', async () => {
    const pageA = 'https://www.youtube.com/watch?v=A';
    const pageB = 'https://www.youtube.com/watch?v=B';
    installDom(pageA);

    class FakeXhr {
      responseType = 'json';
      response: any = { events: [{ tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'B' }] }] };
      private listeners = new Map<string, () => void>();

      get responseText() {
        throw new Error('responseText must not be read for responseType=json');
      }

      open() {}
      send() {
        this.listeners.get('load')?.();
      }
      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, listener);
      }
      getResponseHeader() {
        return 'application/json';
      }
    }

    vi.stubGlobal('XMLHttpRequest', FakeXhr as any);
    vi.stubGlobal('fetch', undefined);
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const config = await loadInterceptor();
    config.main();

    const xhr = new (globalThis as any).XMLHttpRequest();
    xhr.open('GET', '/api/timedtext');
    dom.reconfigure({ url: pageB });
    xhr.send();

    const posted = findPosted(postSpy, 'SYNCNOS_VIDEO_INTERCEPTED');
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      url: 'https://www.youtube.com/api/timedtext',
      pageUrl: pageB,
      bodyText: JSON.stringify(xhr.response),
    });
  });

  it.each([
    {
      responseType: 'text',
      responseText: '<transcript><text start="1">text</text></transcript>',
      response: null,
      expected: '<transcript><text start="1">text</text></transcript>',
    },
    {
      responseType: 'arraybuffer',
      responseText: '',
      response: new TextEncoder().encode('{"body":[]}').buffer,
      expected: '{"body":[]}',
    },
  ])('reads $responseType XHR bodies without crossing response APIs', async (fixture) => {
    installDom('https://www.youtube.com/watch?v=current');

    class FakeXhr {
      responseType = fixture.responseType;
      response = fixture.response;
      responseText = fixture.responseText;
      private listeners = new Map<string, () => void>();
      open() {}
      send() {
        this.listeners.get('load')?.();
      }
      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, listener);
      }
      getResponseHeader() {
        return 'text/plain';
      }
    }

    vi.stubGlobal('XMLHttpRequest', FakeXhr as any);
    vi.stubGlobal('fetch', undefined);
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const config = await loadInterceptor();
    config.main();

    const xhr = new (globalThis as any).XMLHttpRequest();
    xhr.open('GET', 'https://www.youtube.com/api/timedtext?v=current');
    xhr.send();

    expect(findPosted(postSpy, 'SYNCNOS_VIDEO_INTERCEPTED')[0]?.bodyText).toBe(fixture.expected);
  });

  it('does not intercept substring-spoofed response URLs', async () => {
    installDom('https://www.youtube.com/watch?v=current');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        url: 'https://evil.example/?next=https://www.youtube.com/api/timedtext',
        clone: () => ({ headers: { get: () => 'text/plain' }, text: async () => 'evil' }),
      })),
    );
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const config = await loadInterceptor();
    config.main();

    await (globalThis.fetch as any)('https://evil.example/?next=https://www.youtube.com/api/timedtext');
    expect(findPosted(postSpy, 'SYNCNOS_VIDEO_INTERCEPTED')).toEqual([]);
  });

  it('returns identity-bound YouTube state metadata including the full description', async () => {
    installDom('https://www.youtube.com/watch?v=abc');
    (window as any).ytInitialPlayerResponse = {
      videoDetails: {
        videoId: 'abc',
        title: 'Title',
        author: 'Author',
        shortDescription: 'line 1\nline 2',
        lengthSeconds: '123',
        thumbnail: { thumbnails: [{ url: 'small' }, { url: 'large' }] },
      },
    };
    vi.stubGlobal('fetch', undefined);
    vi.stubGlobal('XMLHttpRequest', undefined);
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const config = await loadInterceptor();
    config.main();

    dispatchMetaRequest('youtube-meta');
    const response = findPosted(postSpy, 'SYNCNOS_VIDEO_META_RESPONSE')[0];
    expect(response).toEqual({
      __syncnos: true,
      type: 'SYNCNOS_VIDEO_META_RESPONSE',
      requestId: 'youtube-meta',
      meta: {
        state: {
          platform: 'youtube',
          identityUrl: 'https://www.youtube.com/watch?v=abc',
          title: 'Title',
          author: 'Author',
          description: 'line 1\nline 2',
          durationSeconds: 123,
          thumbnailUrl: 'large',
        },
        dom: null,
      },
    });
  });

  it('returns separate Bilibili state and DOM metadata candidates without mixing them', async () => {
    installDom(
      'https://www.bilibili.com/video/BV1STATE1234/?p=2&utm_source=test',
      '<!doctype html><html><head><link rel="canonical" href="https://www.bilibili.com/video/BV1DOM123456/?p=2"></head><body><h1 class="video-title"></h1><a class="up-name"></a><div class="desc-info-text"></div></body></html>',
    );
    (window as any).__INITIAL_STATE__ = {
      videoData: {
        bvid: 'BV1STATE1234',
        title: 'State title',
        owner: { name: 'State author' },
        desc: '',
        desc_v2: [{ raw_text: 'State line 1' }, { raw_text: 'State line 2' }],
        duration: 456,
        pic: 'https://example.com/state.jpg',
      },
    };
    const title = document.querySelector('h1.video-title') as HTMLElement;
    const author = document.querySelector('a.up-name') as HTMLElement;
    const description = document.querySelector('.desc-info-text') as HTMLElement;
    title.innerText = 'DOM title';
    author.innerText = 'DOM author';
    description.innerText = 'DOM full description';

    vi.stubGlobal('fetch', undefined);
    vi.stubGlobal('XMLHttpRequest', undefined);
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const config = await loadInterceptor();
    config.main();

    dispatchMetaRequest('bilibili-meta');
    const response = findPosted(postSpy, 'SYNCNOS_VIDEO_META_RESPONSE')[0];
    expect(response.meta.state).toEqual({
      platform: 'bilibili',
      identityUrl: 'https://www.bilibili.com/video/BV1STATE1234/?p=2',
      title: 'State title',
      author: 'State author',
      description: 'State line 1\nState line 2',
      durationSeconds: 456,
      thumbnailUrl: 'https://example.com/state.jpg',
    });
    expect(response.meta.dom).toEqual({
      platform: 'bilibili',
      identityUrl: 'https://www.bilibili.com/video/BV1DOM123456/?p=2',
      title: 'DOM title',
      author: 'DOM author',
      description: 'DOM full description',
    });
  });
});
