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
  it('uses only Bilibili player state bound to the current canonical page', async () => {
    const pageA = 'https://www.bilibili.com/video/BV1AAAAAAAAA/';
    const pageB = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(pageB, '<div class="bpx-player-subtitle-panel-text"><span>stale DOM subtitle</span></div>');
    installMetaResponder({
      state: {
        identityUrl: pageB,
        title: 'B title',
        author: 'B author',
        description: 'B description',
        durationSeconds: 123.5,
        thumbnailUrl: 'https://example.com/b.jpg',
      },
      dom: null,
      activeSubtitleLanguage: '',
    });
    setResponses([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=a',
        pageUrl: pageA,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'A chapter', from: 0, to: 10 }] } }),
      },
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=b',
        pageUrl: pageB,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'B chapter', from: 0, to: 30 }] } }),
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
      cues: [],
      chapters: [{ title: 'B chapter', startSeconds: 0, endSeconds: 30 }],
      subtitleStatus: 'off',
    });
  });

  it('rejects direct extraction on unsupported pages instead of constructing an unknown Video', async () => {
    installDom('https://www.bilibili.com/opus/123456');
    setResponses([]);

    await expect(extractVideoTranscriptFromCurrentPage()).rejects.toThrow('unsupported video page');
  });

  it('canonicalizes a Bilibili watch-later container to the same BV identity for metadata, subtitles, and chapters', async () => {
    const watchLater = 'https://www.bilibili.com/list/watchlater?bvid=BV1FwY4zkEef&oid=115049943269792';
    const canonical = 'https://www.bilibili.com/video/BV1FwY4zkEef/';
    installDom(watchLater);
    installMetaResponder({
      state: {
        identityUrl: canonical,
        title: 'Watch later title',
        description: 'Watch later description',
      },
      dom: null,
      activeSubtitleLanguage: '',
    });
    setResponses([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=watchlater',
        pageUrl: watchLater,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'Chapter', from: 0, to: 30 }] } }),
      },
    ]);

    const extracted = await extractVideoTranscriptFromCurrentPage();
    expect(extracted.meta.url).toBe(canonical);
    expect(extracted.cues).toEqual([]);
    expect(extracted.chapters).toEqual([{ title: 'Chapter', startSeconds: 0, endSeconds: 30 }]);
  });

  it('returns empty subtitles and unknown chapters when only stale or identity-less Bilibili responses exist', async () => {
    const pageB = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(pageB, '<div class="bpx-player-subtitle-panel-text"><span>must not be used</span></div>');
    installMetaResponder({
      state: { identityUrl: pageB, title: 'B' },
      dom: null,
      activeSubtitleLanguage: '',
    });
    setResponses([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=missing-page',
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'old', from: 0, to: 10 }] } }),
      },
    ]);

    const extracted = await extractVideoTranscriptFromCurrentPage();
    expect(extracted.cues).toEqual([]);
    expect(extracted.chapters).toBeNull();
  });

  it('uses only the latest Bilibili player response instead of reviving older state', async () => {
    const page = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(page);
    installMetaResponder({ state: { identityUrl: page }, dom: null, activeSubtitleLanguage: '' });
    setResponses([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=valid',
        pageUrl: page,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [{ content: 'Valid', from: 0, to: 20 }] } }),
      },
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=latest-incomplete',
        pageUrl: page,
        bodyText: JSON.stringify({ code: 0, data: {} }),
      },
    ]);

    expect((await extractVideoTranscriptFromCurrentPage()).chapters).toBeNull();
  });

  it('treats the latest current-page explicit empty view_points array as a chapter clear', async () => {
    const page = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(page);
    installMetaResponder({ state: { identityUrl: page }, dom: null, activeSubtitleLanguage: '' });
    setResponses([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=b',
        pageUrl: page,
        bodyText: JSON.stringify({ code: 0, data: { view_points: [] } }),
      },
    ]);

    expect((await extractVideoTranscriptFromCurrentPage()).chapters).toEqual([]);
  });

  it('fetches only the Bilibili subtitle language currently active in the player', async () => {
    const page = 'https://www.bilibili.com/video/BV1ECaq6nEJn/';
    installDom(page);
    installMetaResponder({
      state: { identityUrl: page, title: 'FSD' },
      dom: null,
      activeSubtitleLanguage: 'ai-en',
    });
    setResponses([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=42263383076',
        pageUrl: page,
        bodyText: JSON.stringify({
          code: 0,
          data: {
            view_points: [{ content: 'Cybercab', from: 0, to: 509 }],
            subtitle: {
              subtitles: [
                { lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/zh' },
                { lan: 'ai-en', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/en' },
              ],
            },
          },
        }),
      },
    ]);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ body: [{ from: 0.08, to: 2.56, content: 'English subtitle' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const extracted = await extractVideoTranscriptFromCurrentPage();

    expect(fetchMock).toHaveBeenCalledWith('https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/en', {
      credentials: 'omit',
    });
    expect(extracted.cues).toEqual([{ start: 0.08, end: 2.56, text: 'English subtitle' }]);
    expect(extracted.subtitleStatus).toBe('ok');
  });

  it('does not fetch Bilibili subtitles when none is active', async () => {
    const page = 'https://www.bilibili.com/video/BV1OFFSUBTITLE/';
    installDom(page);
    installMetaResponder({ state: { identityUrl: page }, dom: null, activeSubtitleLanguage: '' });
    setResponses([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=off',
        pageUrl: page,
        bodyText: JSON.stringify({
          code: 0,
          data: {
            subtitle: {
              subtitles: [{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/x' }],
            },
          },
        }),
      },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const extracted = await extractVideoTranscriptFromCurrentPage();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(extracted.subtitleStatus).toBe('off');
  });

  it('uses empty only when Bilibili explicitly reports no subtitle tracks', async () => {
    const page = 'https://www.bilibili.com/video/BV1NOSUBTITLE/';
    installDom(page);
    installMetaResponder({ state: { identityUrl: page }, dom: null, activeSubtitleLanguage: '' });
    setResponses([
      {
        url: 'https://api.bilibili.com/x/player/wbi/v2?cid=empty',
        pageUrl: page,
        bodyText: JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
      },
    ]);

    expect((await extractVideoTranscriptFromCurrentPage()).subtitleStatus).toBe('empty');
  });

  it('rejects stale state metadata as a whole and selects an identity-matched Bilibili DOM candidate', async () => {
    const pageA = 'https://www.bilibili.com/video/BV1AAAAAAAAA/';
    const pageB = 'https://www.bilibili.com/video/BV1BBBBBBBBB/';
    installDom(pageB);
    installMetaResponder({
      state: {
        identityUrl: pageA,
        title: 'A title',
        author: 'A author',
        description: 'A description',
        durationSeconds: 999,
        thumbnailUrl: 'https://example.com/a.jpg',
      },
      dom: {
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

  it('does not revive an older YouTube subtitle when the latest timedtext response is invalid', async () => {
    const page = 'https://www.youtube.com/watch?v=current';
    installDom(page);
    installMetaResponder({
      state: { identityUrl: page, title: 'Current video' },
      dom: null,
    });
    setResponses([
      {
        url: 'https://www.youtube.com/api/timedtext?v=current&lang=en',
        pageUrl: page,
        bodyText: '<transcript><text start="1.25" dur="1.5">valid</text></transcript>',
      },
      {
        url: 'https://www.youtube.com/api/timedtext?v=current&lang=en&fmt=invalid',
        pageUrl: page,
        bodyText: '{not valid json',
      },
    ]);

    const extracted = await extractVideoTranscriptFromCurrentPage();
    expect(extracted.cues).toEqual([]);
    expect(extracted.subtitleStatus).toBe('unavailable');
  });

  it('does not use stale YouTube transcript DOM when no current timedtext response exists', async () => {
    const page = 'https://www.youtube.com/watch?v=current';
    installDom(
      page,
      '<ytd-transcript-segment-renderer><span class="segment-timestamp">0:01</span><span class="segment-text">stale</span></ytd-transcript-segment-renderer>',
    );
    installMetaResponder({
      state: { identityUrl: page, title: 'Current video' },
      dom: null,
    });
    setResponses([
      {
        url: 'https://www.youtube.com/api/timedtext?v=old',
        pageUrl: 'https://www.youtube.com/watch?v=old',
        bodyText: '<transcript><text start="1" dur="1">old</text></transcript>',
      },
    ]);

    const extracted = await extractVideoTranscriptFromCurrentPage();
    expect(extracted.cues).toEqual([]);
    expect(extracted.chapters).toBeNull();
    expect(extracted.subtitleStatus).toBe('off');
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
            meta: { state: { identityUrl: 'wrong' }, dom: null },
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
            meta: { state: { identityUrl: location.href }, dom: null },
          },
        }),
      );
    });

    await expect(requestVideoPageMeta()).resolves.toEqual({
      state: { identityUrl: location.href },
      dom: null,
      activeSubtitleLanguage: '',
    });
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('times out without polling or retaining a pending request', async () => {
    vi.useFakeTimers();
    try {
      installDom('https://www.youtube.com/watch?v=current');
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);

      const pending = requestVideoPageMeta();
      await vi.advanceTimersByTimeAsync(1_200);
      await expect(pending).resolves.toBeNull();
      expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });
});
