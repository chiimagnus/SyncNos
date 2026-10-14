import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer, markdownLikelyContainsMath } from '@ui/shared/markdown-core';
import { createKatexMarkdownRenderer } from '@ui/shared/markdown-math';

describe('createMarkdownRenderer', () => {
  it('renders common markdown features', () => {
    const md = createMarkdownRenderer();
    const html = md.render('# Title\n\nhello\nworld\n\n~~gone~~\n\n|a|b|\n|-|-|\n|1|2|');
    expect(html).toContain('<h1>');
    expect(html).toContain('<br>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('<table>');
  });

  it('renders punctuation-adjacent emphasis globally without inserting spaces into the text', () => {
    const md = createMarkdownRenderer();
    const example = '**Helium 实机采集已成功。**修复版对已保存的 ChatGPT 会话完成了真实 DOM 抓取';
    expect(md.render(example)).toContain(
      '<strong>Helium 实机采集已成功。</strong>修复版对已保存的 ChatGPT 会话完成了真实 DOM 抓取',
    );

    expect(md.render('**一、工具是平等的，结果不是。**AI 是放大器。')).toContain(
      '<strong>一、工具是平等的，结果不是。</strong>AI 是放大器。',
    );
    expect(md.render('前文**！重点**后文')).toContain('前文<strong>！重点</strong>后文');
    expect(md.render('*旅行。*计划')).toContain('<em>旅行。</em>计划');
    expect(md.render('**Title.**word')).toContain('<strong>Title.</strong>word');
    expect(md.render('**A &amp; B。**正文')).toContain('<strong>A &amp; B。</strong>正文');
    expect(md.render('**普通加粗**正常尾部')).toContain('<strong>普通加粗</strong>正常尾部');
    expect(md.render('[**标题。**链接](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer noopener"><strong>标题。</strong>链接</a>',
    );
    expect(md.render('~~**删除。**文本~~')).toContain('<s><strong>删除。</strong>文本</s>');
  });

  it('delegates nested emphasis, links and inline code to markdown-it instead of flattening them', () => {
    const md = createMarkdownRenderer();
    const html = md.render('**参阅 [文档](https://example.com)、`git status` 和 *重点*。**接着阅读');
    expect(html).toContain(
      '<strong>参阅 <a href="https://example.com" target="_blank" rel="noreferrer noopener">文档</a>、<code>git status</code> 和 <em>重点</em>。</strong>接着阅读',
    );
    expect(md.render('***嵌套。***正文')).toContain('<em><strong>嵌套。</strong></em>正文');
    expect(md.render('**公式 $E=mc^2$。**正文')).toContain('<strong>公式 $E=mc^2$。</strong>正文');
  });

  it('handles many adjacent emphasis delimiters without recursive scanning', () => {
    const md = createMarkdownRenderer();
    const html = md.render('**完成。**下一步 '.repeat(250));
    expect((html.match(/<strong>完成。<\/strong>/g) || []).length).toBe(250);
  });

  it('does not reinterpret code, escaped syntax, whitespace-marked literal stars or unsafe HTML', () => {
    const md = createMarkdownRenderer();
    const source = [
      '`**原样代码。**正文`',
      '',
      '```md',
      '**围栏代码。**正文',
      '```',
      '',
      String.raw`\*\*明确转义。\*\*正文`,
      '',
      '** 空格表示字面内容 **正文',
      '',
      '<script>alert(1)</script>',
    ].join('\n');
    const html = md.render(source);
    expect(html).toContain('<code>**原样代码。**正文</code>');
    expect(html).toContain('**围栏代码。**正文');
    expect(html).toContain('**明确转义。**正文');
    expect(html).toContain('** 空格表示字面内容 **正文');
    expect(html).not.toContain('<strong>明确转义。</strong>');
    expect(html).not.toContain('<strong>空格表示字面内容</strong>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('keeps math rendering intact when recovering punctuation-adjacent emphasis', () => {
    const md = createKatexMarkdownRenderer();
    const html = md.render('**结果正确。**下一步计算 $E=mc^2$。');
    expect(html).toContain('<strong>结果正确。</strong>下一步计算');
    expect(html).toContain('class="katex"');
  });

  it('does not allow raw HTML by default', () => {
    const md = createMarkdownRenderer();
    const html = md.render('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('can render links with target blank when enabled', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: true });
    const html = md.render('[x](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('keeps links in the current tab when openLinksInNewTab is disabled', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: false });
    const html = md.render('[x](https://example.com)');
    expect(html).not.toContain('target="_blank"');
  });

  it('renders images with an explicit link below (http urls only)', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: true });
    const html = md.render('![](https://example.com/a.png?token=secret&x=1)');
    expect(html).toContain('<img');
    expect(html).toContain('class="syncnos-md-image"');
    expect(html).toContain('<a href="https://example.com/a.png?token=secret&amp;x=1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('https://example.com/a.png?keys=token,x');
  });

  it('does not render a link line for data:image urls', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: true });
    const html = md.render('![](data:image/png;base64,AAAA)');
    expect(html).toContain('<img');
    expect(html).not.toContain('syncnos-md-image-link');
  });

  it('renders syncnos-asset images with local asset markers and placeholder src', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: true });
    const html = md.render('![](syncnos-asset://42)');
    expect(html).toContain('<img');
    expect(html).toContain('data-syncnos-asset-id="42"');
    // Use a tiny valid image as fallback to avoid noisy console errors.
    expect(html).toContain('src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="');
    expect(html).not.toContain('syncnos-md-image-link');
    expect(html).not.toContain('src="https://');
  });

  it('renders malformed internal image targets as safe placeholders without leaking internal urls', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: true });
    for (const target of [
      'syncnos-asset://nope',
      'syncnos-asset://0',
      'syncnos-asset://9007199254740992',
      'chatgpt-file://bad',
    ]) {
      const html = md.render(`![bad](${target})`);
      expect(html).toContain('src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="');
      expect(html).not.toContain(target);
      expect(html).not.toContain('data-syncnos-asset-id');
      expect(html).not.toContain('syncnos-md-image-link');
    }
  });

  it('renders inline math with KaTeX', () => {
    const md = createKatexMarkdownRenderer();
    const html = md.render('x = $E=mc^2$');
    expect(html).toContain('katex');
    expect(html).toContain('katex-html');
    expect(html).toContain('<math');
  });

  it('renders block math with KaTeX', () => {
    const md = createKatexMarkdownRenderer();
    const html = md.render('$$E=mc^2$$');
    expect(html).toContain('katex-display');
    expect(html).toContain('katex');
  });

  it('degrades image tokens without creating img elements when images are disabled', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: true, renderImages: false });
    const html = md.render(
      [
        '![Remote](https://example.com/a.png)',
        '![Data](data:image/png;base64,AAAA)',
        '![Asset](syncnos-asset://42)',
        '![Chat](chatgpt-file://file_abc)',
      ].join('\n\n'),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://example.com/a.png"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('>Remote</a>');
    expect(html).toContain('>Data</span>');
    expect(html).toContain('>Asset</span>');
    expect(html).toContain('>Chat</span>');
  });

  it('does not rewrite image-like syntax inside inline or fenced code when images are disabled', () => {
    const md = createMarkdownRenderer({ renderImages: false });
    const html = md.render(
      ['`![inline](https://example.com/a.png)`', '```md', '![fenced](https://example.com/b.png)', '```'].join('\n'),
    );
    expect(html).toContain('![inline](https://example.com/a.png)');
    expect(html).toContain('![fenced](https://example.com/b.png)');
    expect(html).not.toContain('<img');
  });

  it('does not emit dangerous href schemes', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: true });
    const html = md.render('[x](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
  });

  it('supports MathML-only output for Shadow DOM consumers', () => {
    const md = createKatexMarkdownRenderer({ mathOutput: 'mathml' });
    const html = md.render('$E=mc^2$');
    expect(html).toContain('<math');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('katex-html');
  });
});

describe('markdownLikelyContainsMath', () => {
  it('detects supported inline and block dollar math', () => {
    expect(markdownLikelyContainsMath('x = $E=mc^2$')).toBe(true);
    expect(markdownLikelyContainsMath('$$\nx^2\n$$')).toBe(true);
  });

  it('ignores ordinary or unmatched dollar text', () => {
    expect(markdownLikelyContainsMath('Price is $5')).toBe(false);
    expect(markdownLikelyContainsMath('escaped \\$5')).toBe(false);
    expect(markdownLikelyContainsMath('plain text')).toBe(false);
  });
});
