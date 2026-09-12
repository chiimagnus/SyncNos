import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestVideoPageMeta } from '../../src/collectors/video/video-bridge-store';
import { extractVideoTranscriptFromCurrentPage } from '../../src/collectors/video/video-transcript-extract';

const STORE_KEY = '__SYNCNOS_VIDEO_TRANSCRIPT_BRIDGE__';

let dom: JSDOM;

function installDom(url: string, html = '<!doctype html><html><head></head><body></body></html>') {
  dom = new JSDOM(html, { url });
  vi.stubGlobal('window', dom.window as unknown as Window & typeof globalThis);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
}

function setResponses(responses: any[]) {
  (globalThis as any)[STORE_KEY] = { responses };
}

function installMetaResponder(meta: any) {
  vi.spyOn(window, 'postMessage').mockImplementation((data: any) => {
    if (data?.type !== 'SYNCNOS_VIDEO_META_REQUEST') return;
    window.dispatchEvent(
      new (window as any).MessageEvent('message', {
        source: window,
        data: {
          __syncnos: true,
          type: 'SYNCNOS_VIDEO_META_RESPONSE',
          requestId: data.requestId,
          meta,
        },
      }),
    );
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any)[STORE_KEY];
});

afterEach(() => {
  delete (globalThis as any)[STORE_KEY];
  vi.unstubAllGlobals();
  dom?.window.close();
});

describe('video transcript extraction', () => {
  it('uses only Bilibili subtitle and chapter responses bound to the current canonical page', async () => {
    const pageA = 'https://www.bilibili.com/video/BV1AAAAAAAAA/';
    const pageB = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(pageB, '<div class="bpx-player-subtitle-panel-text"><span>stale DOM subtitle</span></div>');
    installMetaResponder({
      state: {
        platform: 'bilibili',
        identityUrl: pageB,
        title: 'B title',
        author: 'B author',
        description: 'B description',
        durationSeconds: 123.5,
        thumbnailUrl: 'https://example.com/b.jpg',
      },
      dom: null,
    });
    setResponses([
      {
        url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/a.json',
        pageUrl: pageA,
        bodyText: JSON.stringify({ body: [{ from: 1, to: 2, content: 'A subtitle' }] }),
        at: 10,
      },
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=a',
        pageUrl: pageA,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'A chapter', from: 0, to: 10 }] } }),
        at: 11,
      },
      {
        url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/b.json',
        pageUrl: pageB,
        bodyText: JSON.stringify({ body: [{ from: 1.234, to: 3.456, content: 'B subtitle' }] }),
        at: 20,
      },
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=b',
        pageUrl: pageB,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'B chapter', from: 0, to: 30 }] } }),
        at: 21,
      },
    ]);

    const extracted = await extractVideoTranscriptFromCurrentPage();

    expect(extracted).toEqual({
      meta: {
        platform: 'bilibili',
        url: pageB,
        title: 'B title',
        author: 'B author',
        description: 'B description',
        durationSeconds: 123.5,
        thumbnailUrl: 'https://example.com/b.jpg',
      },
      cues: [{ start: 1.234, end: 3.456, text: 'B subtitle' }],
      chapters: [{ title: 'B chapter', startSeconds: 0, endSeconds: 30 }],
    });
  });

  it('returns empty subtitles and unknown chapters when only stale or identity-less Bilibili responses exist', async () => {
    const pageA = 'https://www.bilibili.com/video/BV1AAAAAAAAA/';
    const pageB = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(pageB, '<div class="bpx-player-subtitle-panel-text"><span>must not be used</span></div>');
    installMetaResponder({
      state: { platform: 'bilibili', identityUrl: pageB, title: 'B' },
      dom: null,
    });
    setResponses([
      {
        url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/a.json',
        pageUrl: pageA,
        bodyText: JSON.stringify({ body: [{ from: 1, to: 2, content: 'A subtitle' }] }),
        at: 10,
      },
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=missing-page',
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'old', from: 0, to: 10 }] } }),
        at: 11,
      },
    ]);

    const extracted = await extractVideoTranscriptFromCurrentPage();
    expect(extracted.cues).toEqual([]);
    expect(extracted.chapters).toBeNull();
  });

  it('falls back to an earlier current-page WBI response when the latest response cannot determine chapters', async () => {
    const page = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(page);
    installMetaResponder({ state: { platform: 'bilibili', identityUrl: page }, dom: null });
    setResponses([
      {
        url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/b.json',
        pageUrl: page,
        bodyText: JSON.stringify({ body: [{ from: 1, to: 2, content: 'subtitle' }] }),
        at: 1,
      },
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=valid',
        pageUrl: page,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'Valid', from: 0, to: 20 }] } }),
        at: 2,
      },
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=latest-incomplete',
        pageUrl: page,
        bodyText: JSON.stringify({ code: 0, data: {} }),
        at: 3,
      },
    ]);

    expect((await extractVideoTranscriptFromCurrentPage()).chapters).toEqual([
      { title: 'Valid', startSeconds: 0, endSeconds: 20 },
    ]);
  });

  it('treats the latest current-page explicit empty view_points array as a chapter clear', async () => {
    const page = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(page);
    installMetaResponder({ state: { platform: 'bilibili', identityUrl: page }, dom: null });
    setResponses([
      {
        url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/b.json',
        pageUrl: page,
        bodyText: JSON.stringify({ body: [{ from: 1, to: 2, content: 'subtitle' }] }),
        at: 1,
      },
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=b',
        pageUrl: page,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [] } }),
        at: 2,
      },
    ]);

    expect((await extractVideoTranscriptFromCurrentPage()).chapters).toEqual([]);
  });

  it('rejects stale state metadata as a whole and selects an identity-matched Bilibili DOM candidate', async () => {
    const pageA = 'https://www.bilibili.com/video/BV1AAAAAAAAA/';
    const pageB = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(pageB);
    installMetaResponder({
      state: {
        platform: 'bilibili',
        identityUrl: pageA,
        title: 'A title',
        author: 'A author',
        description: 'A description',
        durationSeconds: 999,
        thumbnailUrl: 'https://example.com/a.jpg',
      },
      dom: {
        platform: 'bilibili',
        identityUrl: pageB,
        title: 'B title',
        author: 'B author',
        description: 'B description',
      },
    });
    setResponses([]);

    const { meta } = await extractVideoTranscriptFromCurrentPage();
    expect(meta).toEqual({
      platform: 'bilibili',
      url: pageB,
      title: 'B title',
      author: 'B author',
      description: 'B description',
      durationSeconds: null,
      thumbnailUrl: '',
    });
  });

  it('does not use stale YouTube transcript DOM when no current timedtext response exists', async () => {
    const page = 'https://www.youtube.com/watch?v=current';
    installDom(
      page,
      '<ytd-transcript-segment-renderer><span class="segment-timestamp">0:01</span><span class="segment-text">stale</span></ytd-transcript-segment-renderer>',
    );
    installMetaResponder({
      state: { platform: 'youtube', identityUrl: page, title: 'Current video' },
      dom: null,
    });
    setResponses([
      {
        url: 'https://www.youtube.com/api/timedtext?v=old',
        pageUrl: 'https://www.youtube.com/watch?v=old',
        bodyText: '<transcript><text start="1" dur="1">old</text></transcript>',
        at: 1,
      },
    ]);

    const extracted = await extractVideoTranscriptFromCurrentPage();
    expect(extracted.cues).toEqual([]);
    expect(extracted.chapters).toBeNull();
  });
});

describe('video page metadata request', () => {
  it('resolves only the matching request id and removes its one-shot listener', async () => {
    installDom('https://www.bilibili.com/video/BV1BBBBBBBBB/');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    let requestId = '';
    vi.spyOn(window, 'postMessage').mockImplementation((data: any) => {
      if (data?.type !== 'SYNCNOS_VIDEO_META_REQUEST') return;
      requestId = data.requestId;
      window.dispatchEvent(
        new (window as any).MessageEvent('message', {
          source: window,
          data: {
            __syncnos: true,
            type: 'SYNCNOS_VIDEO_META_RESPONSE',
            requestId: 'wrong-id',
            meta: { state: { platform: 'bilibili', identityUrl: 'wrong' }, dom: null },
          },
        }),
      );
      window.dispatchEvent(
        new (window as any).MessageEvent('message', {
          source: window,
          data: {
            __syncnos: true,
            type: 'SYNCNOS_VIDEO_META_RESPONSE',
            requestId,
            meta: { state: { platform: 'bilibili', identityUrl: location.href }, dom: null },
          },
        }),
      );
    });

    await expect(requestVideoPageMeta({ timeoutMs: 50 })).resolves.toEqual({
      state: { platform: 'bilibili', identityUrl: location.href },
      dom: null,
    });
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('times out without polling or retaining a pending request', async () => {
    installDom('https://www.youtube.com/watch?v=current');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);

    await expect(requestVideoPageMeta({ timeoutMs: 1 })).resolves.toBeNull();
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });
});
