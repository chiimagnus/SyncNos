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
});

