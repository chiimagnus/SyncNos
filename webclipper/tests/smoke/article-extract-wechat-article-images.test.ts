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

describe('article-extract wechat article images', () => {
  it('extracts data-src images without requiring Readability injection', async () => {
    const dom = new JSDOM(
      `<body>
        <h1 id="activity-name">微信文章标题</h1>
        <div id="meta_content">
          <span id="js_name">作者A</span>
          <em id="publish_time">2026-04-13</em>
        </div>
        <div id="js_content" style="visibility: hidden; opacity: 0;">
          <p>正文段落</p>
          <section style="text-align:center;">
            <img data-src="https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png&from=appmsg" />
          </section>
          <p>第二段</p>
          <img data-original="https://mmbiz.qpic.cn/mmbiz_jpg/def/0?wx_fmt=jpeg" />
        </div>
      </body>`,
      {
        url: 'https://mp.weixin.qq.com/s/oKuSgz5CP4aPOjt_o2Vi8g',
        pretendToBeVisual: true,
      },
    );

    setDomGlobals(dom);

    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });

    expect(extracted.ok).toBe(true);
    expect(String(extracted.title || '')).toContain('微信文章标题');
    expect(String(extracted.author || '')).toContain('作者A');
    expect(String(extracted.publishedAt || '')).toContain('2026-04-13');

    const markdown = String(extracted.contentMarkdown || '');
    expect(markdown).toContain('正文段落');
    expect(markdown).toContain('第二段');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png&from=appmsg)');
    expect(markdown).toContain('![](https://mmbiz.qpic.cn/mmbiz_jpg/def/0?wx_fmt=jpeg)');
  });
});

