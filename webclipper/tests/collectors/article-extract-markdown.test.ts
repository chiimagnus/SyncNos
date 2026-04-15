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

  it('keeps code language fences when language class exists', () => {
    const html = `
      <article>
        <pre><code class="language-ts">const n: number = 1;</code></pre>
      </article>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://example.com/code' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://example.com/code');
    expect(md).toContain('```ts');
    expect(md).toContain('const n: number = 1;');
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

  it('converts GitHub-style README table HTML into markdown table with alignment', () => {
    const html = `
      <article class="markdown-body entry-content">
        <table>
          <thead>
            <tr>
              <th>Package</th>
              <th style="text-align: right;">Version</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>SyncNos</td>
              <td style="text-align: right;">1.0.24</td>
            </tr>
          </tbody>
        </table>
      </article>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://github.com/chii/example' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://github.com/chii/example');
    expect(md).toMatch(/\|\s*Package\s*\|\s*Version\s*\|/);
    expect(md).toMatch(/\|\s*-{2,}\s*\|\s*-{2,}:\s*\|/);
    expect(md).toMatch(/\|\s*SyncNos\s*\|\s*1\.0\.24\s*\|/);
  });

  it('converts headerless tables to markdown table and keeps text-align:end as right align', () => {
    const html = `
      <article>
        <table>
          <tbody>
            <tr>
              <td>Name</td>
              <td style="text-align:end">Score</td>
            </tr>
            <tr>
              <td>Alice</td>
              <td style="text-align:end">99</td>
            </tr>
          </tbody>
        </table>
      </article>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://example.com/table' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://example.com/table');
    expect(md).toMatch(/\|\s*Name\s*\|\s*Score\s*\|/);
    expect(md).toMatch(/\|\s*-{2,}\s*\|\s*-{2,}:\s*\|/);
    expect(md).toMatch(/\|\s*Alice\s*\|\s*99\s*\|/);
    expect(md).not.toContain('<table');
  });

  it('converts wechat rich_media tables with nested <section>/<span> into markdown tables', () => {
    const html = `
      <article>
        <table style="width: 100%;margin: 24px 0px;border-collapse: collapse;font-size: 15px;">
          <thead>
            <tr style="border: none;">
              <th style="padding: 12px 16px;font-weight: 600;border: 1px solid rgb(240, 224, 224);">
                <section style="text-align: left;"><span leaf="">产品</span></section>
              </th>
              <th style="padding: 12px 16px;font-weight: 600;border: 1px solid rgb(240, 224, 224);">
                <section style="text-align: left;"><span leaf="">做什么</span></section>
              </th>
              <th style="padding: 12px 16px;font-weight: 600;border: 1px solid rgb(240, 224, 224);">
                <section style="text-align: left;"><span leaf="">商业模式</span></section>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style="border: none;">
              <td style="padding: 12px 16px;border: 1px solid rgb(240, 224, 224);">
                <section style="text-align: left;"><span leaf="">websequencediagrams.com</span></section>
              </td>
              <td style="padding: 12px 16px;border: 1px solid rgb(240, 224, 224);">
                <section style="text-align: left;"><span leaf="">在线画 UML 时序图</span></section>
              </td>
              <td style="padding: 12px 16px;border: 1px solid rgb(240, 224, 224);">
                <section style="text-align: left;">
                  <span leaf="">Freemium + 企业版，</span>
                  <strong style="font-weight: 700;"><span leaf="">2008 年的老兵</span></strong>
                </section>
              </td>
            </tr>
          </tbody>
        </table>
      </article>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://mp.weixin.qq.com/s/abc123' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://mp.weixin.qq.com/s/abc123');
    expect(md).toMatch(/\|\s*产品\s*\|\s*做什么\s*\|\s*商业模式\s*\|/);
    expect(md).toMatch(/\|\s*-{2,}\s*\|\s*-{2,}\s*\|\s*-{2,}\s*\|/);
    expect(md).toMatch(
      /\|\s*websequencediagrams\.com\s*\|\s*在线画 UML 时序图\s*\|\s*Freemium \+ 企业版，\s*\*{2}2008 年的老兵\*{2}\s*\|/,
    );
    expect(md).not.toContain('<table');
  });
});
