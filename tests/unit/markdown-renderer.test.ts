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
