import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractWebArticleFromCurrentPage } from '../../src/collectors/web/article-extract/engine';

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

describe('article-extract wechat share media with text', () => {
  it('captures #js_content text instead of returning image-only gallery', async () => {
    const dom = new JSDOM(
      `<!doctype html>
      <html>
        <head>
          <title>微信图文页</title>
        </head>
        <body>
          <div id="js_article" class="share_content_page"></div>
          <div id="img_swiper_content"></div>
          <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/a/640?wx_fmt=jpeg&tp=webp&wxfrom=5" /></div>
          <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/b/640?from=singlemessage&wxfrom=5" /></div>
          <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/c/640?wxfrom=5" /></div>
          <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/d/640?usePicPrefetch=1&wxfrom=5" /></div>

          <div id="js_content" style="visibility:hidden;opacity:0;">
            <div id="js_image_content" class="image_content">
              <h1 class="rich_media_title">右侧标题</h1>
              <p id="js_image_desc">右侧文字A<br/>右侧文字B</p>
            </div>
            <div class="wx_bottom_modal_wrp" role="dialog" aria-modal="true">
              <button>Close</button>
              <div>更多</div>
              <div>微信扫一扫赞赏作者</div>
              <div>Like the Author</div>
              <div>Other Amount</div>
              <div>¥</div>
              <div>最低赞赏 ¥0</div>
              <div>OK</div>
              <div>Back</div>
              <div>赞赏金额</div>
              <div>1 2 3 4 5 6 7 8 9 0 .</div>
            </div>
          </div>
        </body>
      </html>`,
      {
        url: 'https://mp.weixin.qq.com/s/abc123',
        pretendToBeVisual: true,
      },
    );

    setDomGlobals(dom);

    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });

    expect(extracted.ok).toBe(true);
    expect(String(extracted.title || '')).toContain('右侧标题');

    const markdown = String(extracted.contentMarkdown || '');
    expect(markdown).toContain('右侧文字A');
    expect(markdown).toContain('右侧文字B');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/img/a/640?wx_fmt=jpeg)');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/img/b/640)');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/img/c/640)');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/img/d/640)');
    expect(markdown).not.toContain('| --- |');
    expect(markdown).not.toContain('| ![](');
    expect(markdown).not.toContain('微信扫一扫赞赏作者');
    expect(markdown).not.toContain('Like the Author');
    expect(markdown).not.toContain('最低赞赏');
    expect(markdown).not.toContain('赞赏金额');
    expect(markdown).not.toContain('Other Amount');
  });
});
