import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { appendImageMarkdown, extractImageUrlsFromElement } from '../../src/collectors/collector-utils';

describe('collector-utils images', () => {
  it('extracts best http(s) image urls from element', async () => {
    const dom = new JSDOM(
      `<body>
        <div id="root">
          <img src="data:image/png;base64,abc" />
          <img src="https://example.com/a.jpg" />
          <img src="https://example.com/a.jpg" />
          <img srcset="https://example.com/small.png 200w, https://example.com/large.png 1200w" />
          <img srcset="https://example.com/1x.webp 1x, https://example.com/2x.webp 2x" />
        </div>
      </body>`,
      { url: 'https://example.com/' },
    );

    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;

    const root = dom.window.document.getElementById('root');
    const urls = extractImageUrlsFromElement(root);
    expect(urls).toEqual(['https://example.com/a.jpg', 'https://example.com/large.png', 'https://example.com/2x.webp']);
  });

  it('appends image markdown without duplicating existing urls', () => {
    const base = 'Hello\n\n![](https://example.com/a.png)';
    const md = appendImageMarkdown(base, [
      'https://example.com/a.png',
      'https://example.com/b.png',
      'data:image/png;base64,abc',
    ]);
    expect(md).toBe('Hello\n\n![](https://example.com/a.png)\n![](https://example.com/b.png)');
  });
});
