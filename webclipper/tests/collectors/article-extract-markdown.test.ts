import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../../src/collectors/web/article-extract/markdown.ts';

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

    const md = htmlToMarkdown(html, '', 'https://linux.do/t/any/1');
    expect(md).toContain('**Mac**');
    expect(md).toContain('```');
    expect(md).toContain('echo 1');
    expect(md).not.toContain('将代码复制到剪贴板');
  });
});
