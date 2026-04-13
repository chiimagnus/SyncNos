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
}

afterEach(() => {
  clearDomGlobals();
});

describe('article-extract discourse onebox regression', () => {
  it('keeps OP content after onebox block in cooked html', async () => {
    const dom = new JSDOM(
      `<body>
        <article data-post-number="1">
          <div class="topic-meta-data"><span class="username">alice</span></div>
          <time datetime="2026-04-01T09:21:00.000Z"></time>
          <div class="cooked">
            <aside class="quote onebox">
              <article class="onebox-body">
                <h3>外链预览标题</h3>
                <p>onebox 预览文本</p>
              </article>
            </aside>
            <p>这是 onebox 之后的首贴正文关键字。</p>
            <ul>
              <li>正文列表项 A</li>
              <li>正文列表项 B</li>
            </ul>
          </div>
        </article>
      </body>`,
      { url: 'https://linux.do/t/topic/1635410/1', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });

    expect(String(extracted.contentMarkdown || '')).toContain('这是 onebox 之后的首贴正文关键字。');
  });
});
