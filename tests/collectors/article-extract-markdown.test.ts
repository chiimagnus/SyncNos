import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdownTurndown } from '../../src/collectors/web/article-extract/markdown-turndown.ts';
import { markdownToNotionBlocks } from '../../src/services/sync/notion/notion-markdown-blocks.ts';

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

  it('unwraps a Discourse original image link instead of serializing its thumbnail metadata', () => {
    const html = `
      <article>
        <a href="https://cdn3.ldstatic.com/original/4X/5/1/2/example.png" title="CleanShot">
          <img alt="CleanShot" src="https://cdn3.ldstatic.com/optimized/4X/5/1/2/example_2_259x375.png" />
          CleanShot828×1194 84 KB
        </a>
        <a href="https://linux.do/t/topic/1"><img src="https://cdn3.ldstatic.com/optimized/4X/5/1/2/other_2_259x375.png" /></a>
      </article>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://linux.do/t/topic/1' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://linux.do/t/topic/1');
    expect(md).toContain('![CleanShot](https://cdn3.ldstatic.com/original/4X/5/1/2/example.png)');
    expect(md).not.toContain('example_2_259x375.png');
    expect(md).not.toContain('CleanShot828×1194 84 KB');
    expect(md).toContain('![](https://cdn3.ldstatic.com/optimized/4X/5/1/2/other_2_259x375.png)');

    const blocks = markdownToNotionBlocks(md);
    expect(blocks[0]?.type).toBe('image');
    expect(blocks[0]?.image?.external?.url).toBe('https://cdn3.ldstatic.com/original/4X/5/1/2/example.png');
  });

  it('removes Discourse emoji images and their empty links', () => {
    const html = `
      <article>
        <p><a href="https://chiimagnus.notion.site/syncnos-angels">SyncNos 天使赞助者们<img class="emoji" alt=":heart_eyes:" src="https://cdn.ldstatic.com/images/emoji/twemoji/heart_eyes.png?v=15" /></a></p>
        <p><a href="https://example.com/emoji-only"><img alt=":sparkles:" src="https://cdn.ldstatic.com/images/emoji/twemoji/sparkles.png?v=15" /></a></p>
      </article>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://linux.do/t/topic/1' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://linux.do/t/topic/1');
    expect(md).toContain('[SyncNos 天使赞助者们](https://chiimagnus.notion.site/syncnos-angels)');
    expect(md).not.toContain('heart_eyes');
    expect(md).not.toContain('sparkles');
    expect(md).not.toContain('https://example.com/emoji-only');
  });

  it('captures full wechat rich_media code-snippet blocks with multiple <code> siblings', () => {
    const html = `
      <section><section class="code-snippet__fix code-snippet__js"><ul class="code-snippet__line-index code-snippet__js"><li></li><li></li><li></li><li></li><li></li></ul><pre class="code-snippet__js" data-lang="markdown"><code><span leaf=""><span class="code-snippet__section"># 寓言写作 Prompt</span></span></code><code><span leaf=""><span class="code-snippet__section">围绕&nbsp;</span><span class="code-snippet__section"><span class="code-snippet__strong">**{concept}**</span></span><span class="code-snippet__section">&nbsp;这个概念，写一则寓言来完整地解释它。要像真正的寓言那样间接讲，不要直接点破。</span></span></code><code><span leaf="">---</span></code><code><span leaf=""><span class="code-snippet__section">## 一、寓言体感</span></span></code><code><span leaf=""><span class="code-snippet__bullet">-</span>&nbsp;<span class="code-snippet__strong">**篇幅**</span>：1000字以内。真正的寓言是精炼的，靠一个核心场景、一两次转折把意思撑起来，不需要铺陈。</span></code></pre></section></section>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://mp.weixin.qq.com/s/abc123' });
    setupDom(dom);

    const md = htmlToMarkdownTurndown(html, 'https://mp.weixin.qq.com/s/abc123');
    expect(md).toContain('```markdown');
    expect(md).toContain('# 寓言写作 Prompt');
    expect(md).toContain('围绕 **{concept}** 这个概念');
    expect(md).toContain('## 一、寓言体感');
    expect(md).toContain('- **篇幅**：1000字以内');
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
