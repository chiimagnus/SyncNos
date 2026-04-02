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

describe('article-extract xhs note', () => {
  it('extracts images + desc and strips xhs ! image suffix', async () => {
    const dom = new JSDOM(
      `<head>
        <meta property="og:title" content="小红书笔记标题" />
      </head>
      <body>
        <div id="noteContainer" class="note-container">
          <div class="author"><span class="username">小作者</span></div>
          <img class="avatar-item" src="https://sns-avatar-qc.xhscdn.com/avatar/1040g2jo31noe4mqc586049n7868krg4dlfk2ti8?imageView2/2/w/120/format/jpg|imageMogr2/strip" />
          <div class="media-container">
            <img src="https://sns-webpic-qc.xhscdn.com/path/one!nd_dft_wlteh_webp_3" />
            <img src="https://sns-webpic-qc.xhscdn.com/path/one!nd_dft_wlteh_webp_3" />
            <img src="https://sns-webpic-qc.xhscdn.com/path/two!nc_n_webp_mw_1" />
            <div class="swiper-slide" style="background: url(&quot;https://sns-webpic-qc.xhscdn.com/path/three!nc_n_webp_mw_1&quot;) center center / contain no-repeat;"></div>
          </div>
          <div class="note-content">
            <div id="detail-desc" class="desc">
              <span class="note-text">#话题 看我看到了谁👀 @某人</span>
            </div>
            <div class="bottom-container"><span class="date">2天前 湖南</span></div>
          </div>
        </div>
      </body>`,
      { url: 'https://www.xiaohongshu.com/explore/abc', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const extracted = await extractWebArticleFromCurrentPage({ stabilizationTimeoutMs: 1, stabilizationMinTextLength: 1 });
    const markdown = String(extracted.contentMarkdown || '');

    expect(markdown).toContain('![](<https://sns-webpic-qc.xhscdn.com/path/one>)');
    expect(markdown).toContain('![](<https://sns-webpic-qc.xhscdn.com/path/two>)');
    expect(markdown).toContain('![](<https://sns-webpic-qc.xhscdn.com/path/three>)');
    expect(markdown).not.toContain('sns-avatar-qc.xhscdn.com/avatar');
    expect(markdown).toContain('#话题 看我看到了谁👀 @某人');
  });
});
