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

describe('article-extract markdown complex rules', () => {
  it('keeps complex cooked structures after conversion', async () => {
    const dom = new JSDOM(
      `<body>
        <article data-post-number="1">
          <div class="topic-meta-data"><span class="username">alice</span></div>
          <div class="cooked">
            <aside class="quote onebox">
              <article class="onebox-body">
                <h3>Onebox 标题</h3>
                <p>onebox 预览文本</p>
              </article>
            </aside>
            <p>onebox 后正文关键字。</p>
            <details>
              <summary>展开内容</summary>
              <blockquote>details 内引用块</blockquote>
              <pre><code>const n = 1;\nconsole.log(n);</code></pre>
            </details>
            <blockquote>外层引用文本</blockquote>
            <pre><code>echo 'shell'</code></pre>
            <table>
              <thead><tr><th>列1</th><th>列2</th></tr></thead>
              <tbody><tr><td>A</td><td>B</td></tr></tbody>
            </table>
          </div>
        </article>
      </body>`,
      { url: 'https://linux.do/t/topic/200000/1', pretendToBeVisual: true },
    );

    setDomGlobals(dom);
    const extracted = await extractWebArticleFromCurrentPage({
      stabilizationTimeoutMs: 1,
      stabilizationMinTextLength: 1,
    });
    const markdown = String(extracted.contentMarkdown || '');

    expect(markdown).toContain('onebox 后正文关键字。');
    expect(markdown).toContain('**展开内容**');
    expect(markdown).toContain('> 外层引用文本');
    expect(markdown).toContain('```');
    expect(markdown).toContain('const n = 1;');
    expect(markdown).toContain('列1');
    expect(markdown).toContain('A');
  });
});
