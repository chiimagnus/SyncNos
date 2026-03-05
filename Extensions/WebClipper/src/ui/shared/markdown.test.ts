import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from './markdown';

describe('createMarkdownRenderer', () => {
  it('renders links with target=_blank + rel=noopener/noreferrer by default', () => {
    const md = createMarkdownRenderer();
    const html = md.render('[x](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*(noreferrer[^"]*noopener|noopener[^"]*noreferrer)[^"]*"/);
  });

  it('can opt out of opening links in new tabs', () => {
    const md = createMarkdownRenderer({ openLinksInNewTab: false });
    const html = md.render('[x](https://example.com)');
    expect(html).not.toContain('target="_blank"');
  });
});

