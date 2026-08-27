import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractWebArticleFromCurrentPage } from '../../src/collectors/web/article-extract/engine';
import { normalizeWechatRichMediaContent } from '../../src/collectors/web/article-extract/sites/wechat';
import { markdownToNotionBlocks } from '../../src/services/sync/notion/notion-markdown-blocks';

function setDomGlobals(dom: JSDOM) {
  // @ts-expect-error test global
  globalThis.window = dom.window;
  // @ts-expect-error test global
  globalThis.document = dom.window.document;
  // @ts-expect-error test global
  globalThis.Node = dom.window.Node;
  // @ts-expect-error test global
  globalThis.location = dom.window.location;
  // @ts-expect-error test global
  globalThis.getComputedStyle = dom.window.getComputedStyle;
}

function clearDomGlobals() {
  // @ts-expect-error test global
  delete globalThis.window;
  // @ts-expect-error test global
  delete globalThis.document;
  // @ts-expect-error test global
  delete globalThis.Node;
  // @ts-expect-error test global
  delete globalThis.location;
  // @ts-expect-error test global
  delete globalThis.getComputedStyle;
  // @ts-expect-error test global
  delete globalThis.Readability;
}

afterEach(() => {
  clearDomGlobals();
});

describe('article-extract wechat embedded video', () => {
  it('replaces hydrated player DOM with stable video semantics and drops ephemeral player controls', async () => {
    const firstCover = encodeURIComponent('http://mmbiz.qpic.cn/mmbiz_jpg/demo-first/0?wx_fmt=jpeg&wxfrom=16');
    const dom = new JSDOM(
      `<!doctype html>
      <html>
        <head><title>微信视频正文测试</title></head>
        <body>
          <h1 id="activity-name">微信视频正文测试</h1>
          <span id="js_name">测试作者</span>
          <span id="publish_time">2026-08-27</span>
          <div id="js_content">
            <p>视频前正文。</p>
            <span
              class="video_iframe rich_pages"
              data-mpvid="wxv_4666694207107973127"
              vid="wxv_4666694207107973127"
              data-cover="${firstCover}"
              data-src="https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&amp;auto=0&amp;vid=wxv_4666694207107973127"
            >
              <div class="add_bg_color appmsg_video">
                <div class="page_video_wrapper">
                  <button>Replay Share Like</button>
                  <div>进度条，百分之0</div>
                  <div>0.5倍 0.75倍 1.0倍 1.5倍 2.0倍</div>
                  <div>Video Details</div>
                  <video
                    class="video_fill"
                    src="https://mpvideo.qpic.cn/demo-first.f10002.mp4?auth_key=temporary-secret&amp;vid=wxv_4666694207107973127&amp;dis_t=1787761064"
                    poster="http://mmbiz.qpic.cn/mmbiz_jpg/demo-first/0?wx_fmt=jpeg&amp;wxfrom=16"
                  ></video>
                </div>
              </div>
            </span>
            <p>两段视频之间的正文。</p>
            <span
              class="video_iframe rich_pages"
              data-mpvid="wxv_4999999999999999999"
              data-src="https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&amp;auto=0&amp;vid=wxv_4999999999999999999"
            >
              <div class="page_video_wrapper">
                <button>Play</button>
                <video src="https://mpvideo.qpic.cn/demo-second.f10002.mp4?auth_key=another-secret&amp;vid=wxv_4999999999999999999"></video>
              </div>
            </span>
            <p>视频后正文。</p>
          </div>
        </body>
      </html>`,
      { url: 'https://mp.weixin.qq.com/s/article-with-video', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });
    const markdown = String(extracted.contentMarkdown || '');
    const html = String(extracted.contentHTML || '');
    const text = String(extracted.textContent || '');

    expect(markdown).toContain('视频前正文。');
    expect(markdown).toContain('两段视频之间的正文。');
    expect(markdown).toContain('视频后正文。');
    expect(markdown).toContain('微信视频');
    expect(markdown).toContain('http://mmbiz.qpic.cn/mmbiz_jpg/demo-first/0?wx_fmt=jpeg');
    expect(markdown).toContain(
      'https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&auto=0&vid=wxv_4666694207107973127',
    );
    expect(markdown).toContain(
      'https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&auto=0&vid=wxv_4999999999999999999',
    );

    for (const value of [
      'Replay Share Like',
      '进度条，百分之0',
      '0.5倍',
      'Video Details',
      'mpvideo.qpic.cn',
      'auth_key',
    ]) {
      expect(markdown).not.toContain(value);
      expect(html).not.toContain(value);
      expect(text).not.toContain(value);
    }

    expect(text.match(/微信视频/g)?.length).toBe(2);
    expect(html.match(/data-syncnos-origin="wechat-embedded-video"/g)?.length).toBe(2);
    expect(markdown).not.toContain('[![');

    const notionBlocks = markdownToNotionBlocks(markdown);
    const imageBlocks = notionBlocks.filter((block: any) => block?.type === 'image');
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.image?.external?.url).toBe('http://mmbiz.qpic.cn/mmbiz_jpg/demo-first/0?wx_fmt=jpeg');
    expect(
      notionBlocks.some((block: any) =>
        (block?.paragraph?.rich_text || []).some(
          (rich: any) =>
            rich?.text?.content === '微信视频' &&
            rich?.text?.link?.url ===
              'https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&auto=0&vid=wxv_4666694207107973127',
        ),
      ),
    ).toBe(true);
  });

  it('normalizes an unhydrated metadata-only video without mutating the live article DOM', () => {
    const cover = encodeURIComponent('https://mmbiz.qpic.cn/mmbiz_jpg/unhydrated/0?wx_fmt=jpeg&wxfrom=16');
    const dom = new JSDOM(
      `<body><div id="js_content">
        <span class="video_iframe" data-src="https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&amp;auto=0&amp;vid=wxv_unhydrated" data-cover="${cover}"></span>
      </div></body>`,
      { url: 'https://mp.weixin.qq.com/s/unhydrated', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const root = dom.window.document.querySelector('#js_content')!;
    const normalized = normalizeWechatRichMediaContent(root, dom.window.location.href);

    expect(root.querySelector('.video_iframe')).not.toBeNull();
    expect(normalized.querySelector('.video_iframe')).toBeNull();
    expect(normalized.querySelector('img')?.getAttribute('src')).toBe(
      'https://mmbiz.qpic.cn/mmbiz_jpg/unhydrated/0?wx_fmt=jpeg',
    );
    expect(normalized.querySelector('a')?.getAttribute('href')).toBe(
      'https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&auto=0&vid=wxv_unhydrated',
    );
  });

  it('recovers stable video identity from a partially hydrated runtime player', () => {
    const dom = new JSDOM(
      `<body><div id="js_content">
        <div class="page_video_wrapper">
          <button>Play Share</button>
          <video
            src="https://mpvideo.qpic.cn/runtime.mp4?auth_key=temporary&amp;vid=wxv_runtime_only&amp;dis_t=123"
            poster="https://mmbiz.qpic.cn/mmbiz_jpg/runtime/0?wx_fmt=jpeg&amp;wxfrom=16"
          ></video>
        </div>
      </div></body>`,
      { url: 'https://mp.weixin.qq.com/s/runtime-only', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const root = dom.window.document.querySelector('#js_content')!;
    const normalized = normalizeWechatRichMediaContent(root, dom.window.location.href);
    const html = normalized.innerHTML;

    expect(html).toContain('https://mmbiz.qpic.cn/mmbiz_jpg/runtime/0?wx_fmt=jpeg');
    expect(html).toContain(
      'https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&amp;auto=0&amp;vid=wxv_runtime_only',
    );
    expect(html).not.toContain('mpvideo.qpic.cn');
    expect(html).not.toContain('auth_key');
    expect(html).not.toContain('Play Share');
  });

  it('never promotes a signed runtime MP4 when no stable wxv identity is available', () => {
    const dom = new JSDOM(
      `<body><div id="js_content">
        <div class="page_video_wrapper">
          <button>Replay</button>
          <video
            src="https://mpvideo.qpic.cn/runtime-without-id.mp4?auth_key=temporary&amp;dis_t=123"
            poster="https://mmbiz.qpic.cn/mmbiz_jpg/runtime-no-id/0?wx_fmt=jpeg&amp;wxfrom=16"
          ></video>
        </div>
      </div></body>`,
      { url: 'https://mp.weixin.qq.com/s/runtime-without-id', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const root = dom.window.document.querySelector('#js_content')!;
    const normalized = normalizeWechatRichMediaContent(root, dom.window.location.href);
    const html = normalized.innerHTML;

    expect(html).toContain('https://mmbiz.qpic.cn/mmbiz_jpg/runtime-no-id/0?wx_fmt=jpeg');
    expect(normalized.textContent).toContain('微信视频');
    expect(normalized.querySelector('a')).toBeNull();
    expect(html).not.toContain('mpvideo.qpic.cn');
    expect(html).not.toContain('auth_key');
    expect(html).not.toContain('Replay');
  });

  it('recognizes stable wxv metadata even if WeChat changes the wrapper class name', () => {
    const dom = new JSDOM(
      `<body><div id="js_content">
        <section class="future-wrapper" vid="wxv_future_wrapper">
          <div>Future player controls</div>
        </section>
      </div></body>`,
      { url: 'https://mp.weixin.qq.com/s/future-wrapper', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const root = dom.window.document.querySelector('#js_content')!;
    const normalized = normalizeWechatRichMediaContent(root, dom.window.location.href);

    expect(normalized.textContent?.trim()).toBe('微信视频');
    expect(normalized.innerHTML).toContain('vid=wxv_future_wrapper');
    expect(normalized.innerHTML).not.toContain('Future player controls');
  });

  it('keeps paragraph structure valid when an embedded video sits inside a text paragraph', async () => {
    const dom = new JSDOM(
      `<body>
        <h1 id="activity-name">段内视频</h1>
        <div id="js_content">
          <p>视频之前 <span class="video_iframe" data-mpvid="wxv_inline_paragraph" data-cover="https%3A%2F%2Fmmbiz.qpic.cn%2Fmmbiz_jpg%2Finline%2F0%3Fwx_fmt%3Djpeg"></span> 视频之后</p>
        </div>
      </body>`,
      { url: 'https://mp.weixin.qq.com/s/inline-paragraph', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });

    expect(extracted.contentHTML).not.toMatch(/<p[^>]*>[^]*<p[^>]*data-syncnos-origin="wechat-embedded-video"/);
    expect(extracted.contentMarkdown).toContain('视频之前');
    expect(extracted.contentMarkdown).toContain(
      '[微信视频](https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&auto=0&vid=wxv_inline_paragraph)',
    );
    expect(extracted.contentMarkdown).toContain('视频之后');
    expect(extracted.contentMarkdown.indexOf('视频之前')).toBeLessThan(extracted.contentMarkdown.indexOf('微信视频'));
    expect(extracted.contentMarkdown.indexOf('微信视频')).toBeLessThan(extracted.contentMarkdown.indexOf('视频之后'));

    const notionBlocks = markdownToNotionBlocks(extracted.contentMarkdown);
    expect(notionBlocks.some((block: any) => block?.type === 'image')).toBe(true);
  });

  it('keeps a video-only WeChat article non-empty without retaining player chrome', async () => {
    const dom = new JSDOM(
      `<body>
        <h1 id="activity-name">纯视频文章</h1>
        <div id="js_content">
          <span class="video_iframe" data-mpvid="wxv_video_only">
            <button>Replay Share Like</button>
          </span>
        </div>
      </body>`,
      { url: 'https://mp.weixin.qq.com/s/video-only', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });

    expect(extracted.textContent).toBe('微信视频');
    expect(extracted.contentMarkdown).toBe(
      '[微信视频](https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&auto=0&vid=wxv_video_only)',
    );
    expect(extracted.contentMarkdown).not.toContain('Replay Share Like');
  });

  it('does not normalize video-like DOM outside the WeChat article #js_content root', () => {
    const dom = new JSDOM(
      `<body>
        <main id="video-page">
          <div class="page_video_wrapper" data-mpvid="wxv_5000000000000000000">
            <div>Video Details</div>
            <video src="https://mpvideo.qpic.cn/standalone.mp4?auth_key=standalone&amp;vid=wxv_5000000000000000000"></video>
          </div>
        </main>
      </body>`,
      { url: 'https://mp.weixin.qq.com/video-like-outside-article', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const root = dom.window.document.querySelector('#video-page')!;
    const normalized = normalizeWechatRichMediaContent(root, dom.window.location.href);

    expect(normalized.querySelector('[data-syncnos-origin="wechat-embedded-video"]')).toBeNull();
    expect(normalized.textContent).toContain('Video Details');
    expect(normalized.innerHTML).toContain('mpvideo.qpic.cn');
    expect(normalized.innerHTML).toContain('auth_key=standalone');
  });
});
