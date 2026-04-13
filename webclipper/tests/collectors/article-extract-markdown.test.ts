import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdownTurndown } from '../../src/collectors/web/article-extract/markdown-turndown.ts';

function setupDom(dom: JSDOM) {
  // @ts-expect-error test global
  globalThis.window = dom.window;
  // @ts-expect-error test global
  globalThis.document = dom.window.document;
  // @ts-expect-error test global
  globalThis.Node = dom.window.Node;
  // @ts-expect-error test global
  globalThis.location = dom.window.location;
}

describe('article-extract markdown', () => {
  it('renders code blocks inside <details> as fenced blocks', () => {
    const html = `
      <details>
        <summary>Mac</summary>
        <pre class="codeblock-buttons">
          <div class="codeblock-button-wrapper">
            <button aria-label="将代码复制到剪贴板"></button>
          </div>
          <code class="lang-auto">echo 1\n</code>
        </pre>
      </details>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://linux.do/t/any/1' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://linux.do/t/any/1');
    expect(md).toContain('**Mac**');
    expect(md).toContain('```');
    expect(md).toContain('echo 1');
    expect(md).not.toContain('将代码复制到剪贴板');
  });

  it('promotes lazy-loaded image urls (data-src) to markdown images', () => {
    const html = `
      <article>
        <p>hello</p>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://mmbiz.qpic.cn/a/b/0?wx_fmt=jpeg" />
        <img data-original="https://example.com/original.png" />
      </article>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://mp.weixin.qq.com/s/abc123' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://mp.weixin.qq.com/s/abc123');
    expect(md).toContain('![](https://mmbiz.qpic.cn/a/b/0?wx_fmt=jpeg)');
    expect(md).toContain('![](https://example.com/original.png)');
    expect(md).not.toContain('data:image/gif');
  });
});
