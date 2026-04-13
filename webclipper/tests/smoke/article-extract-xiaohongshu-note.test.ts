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

describe('article-extract xiaohongshu note', () => {
  it('keeps xiaohongshu site-spec extraction with hydrated note container', async () => {
    const dom = new JSDOM(
      `<body>
        <div id="noteContainer" class="note-container">
          <div class="author-wrapper">
            <a class="name"><span class="username">作者A</span></a>
          </div>
          <div class="media-container">
            <img src="/media/xhs-note-1.jpg" />
            <img data-src="//sns-webpic-qc.xhscdn.com/20260406/demo/xhs-note-2.jpg" />
          </div>
          <div class="content">
            <span class="note-text">这里是小红书首贴正文关键字。</span>
          </div>
        </div>
      </body>`,
      { url: 'https://www.xiaohongshu.com/explore/abcdef', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });
    const markdown = String(extracted.contentMarkdown || '');

    expect(markdown).toContain('这里是小红书首贴正文关键字。');
    expect(markdown).toContain('https://www.xiaohongshu.com/media/xhs-note-1.jpg');
    expect(markdown).toContain('https://sns-webpic-qc.xhscdn.com/20260406/demo/xhs-note-2.jpg');
  });
});
