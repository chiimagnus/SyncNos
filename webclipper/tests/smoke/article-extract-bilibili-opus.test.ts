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

describe('article-extract bilibili opus', () => {
  it('extracts images + text and strips bilibili @ image suffix', async () => {
    const dom = new JSDOM(
      `<body>
        <div class="bili-opus-view">
          <div class="opus-module-top">
            <div class="opus-module-top__album">
              <div class="horizontal-scroll-album__pic__img">
                <img src="//i0.hdslb.com/bfs/new_dyn/a.jpg@858w_1044h.webp" />
              </div>
              <div class="horizontal-scroll-album__pic__img">
                <img src="//i0.hdslb.com/bfs/new_dyn/b.jpg@858w_1044h.webp" />
              </div>
            </div>
          </div>
          <div class="opus-module-title"><span class="opus-module-title__text">标题</span></div>
          <div class="opus-module-author">
            <div class="opus-module-author__name">作者</div>
            <div class="opus-module-author__pub__text">2026年04月01日 09:21</div>
          </div>
          <div class="opus-module-content"><p>正文段落</p></div>
        </div>
      </body>`,
      { url: 'https://www.bilibili.com/opus/123', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const extracted = await extractWebArticleFromCurrentPage({ stabilizationTimeoutMs: 1, stabilizationMinTextLength: 1 });
    const markdown = String(extracted.contentMarkdown || '');

    expect(markdown).toContain('![](<https://i0.hdslb.com/bfs/new_dyn/a.jpg>)');
    expect(markdown).toContain('![](<https://i0.hdslb.com/bfs/new_dyn/b.jpg>)');
    expect(markdown).toContain('正文段落');
  });
});

