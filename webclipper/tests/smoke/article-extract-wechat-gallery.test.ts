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

describe('article-extract wechat gallery markdown', () => {
  it('appends wechat share media as image blocks instead of markdown table', async () => {
    const dom = new JSDOM(
      `<body>
        <div id="js_content"><p>正文段落</p></div>
        <div class="share_content_page"></div>
        <div id="img_swiper_content"></div>
        <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/a/640?wx_fmt=jpeg&tp=webp&wxfrom=5" /></div>
        <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/b/640?from=singlemessage&wxfrom=5" /></div>
        <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/c/640?wxfrom=5" /></div>
        <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/d/640?usePicPrefetch=1&wxfrom=5" /></div>
      </body>`,
      {
        url: 'https://mp.weixin.qq.com/s/abc123',
        pretendToBeVisual: true,
      },
    );

    const readability = class {
      _doc: Document;
      constructor(doc: Document) {
        this._doc = doc;
      }
      parse() {
        const root = this._doc.querySelector('#js_content');
        return {
          title: '微信文章',
          byline: '',
          content: root ? root.innerHTML : '',
          textContent: root ? root.textContent || '' : '',
          excerpt: '',
        };
      }
    };

    setDomGlobals(dom);
    // @ts-expect-error test global
    globalThis.Readability = readability;

    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });
    const markdown = String(extracted.contentMarkdown || '');

    expect(markdown).toContain('![](https://mmbiz.qpic.cn/img/a/640?wx_fmt=jpeg)');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/img/b/640)');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/img/c/640)');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/img/d/640)');
    expect(markdown).not.toContain('| --- |');
    expect(markdown).not.toContain('| ![](');
  });
});
