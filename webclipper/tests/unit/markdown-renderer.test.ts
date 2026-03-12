import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from '../../src/ui/shared/markdown';

describe('createMarkdownRenderer', () => {
  it('renders common markdown features', () => {
    const md = createMarkdownRenderer();
    const html = md.render('# Title\n\nhello\nworld\n\n|a|b|\n|-|-|\n|1|2|');
    expect(html).toContain('<h1>');
    expect(html).toContain('<br>');
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
});
