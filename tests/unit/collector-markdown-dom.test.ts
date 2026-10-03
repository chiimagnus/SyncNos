import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '@collectors/shared/markdown-dom';

const markdown = new MarkdownIt();

function roundTrip(html: string): Document {
  const document = new JSDOM(html).window.document;
  return new JSDOM(markdown.render(htmlToMarkdown(document.body))).window.document;
}

describe('shared collector Markdown semantics', () => {
  it('preserves code whitespace and embedded Markdown fences', () => {
    const code = '  first  \n\n\n```ts\nexample()\n```\n  last  \n';
    const document = new JSDOM('<pre><code class="language-md"></code></pre>').window.document;
    document.querySelector('code')!.textContent = code;
    const rendered = new JSDOM(markdown.render(htmlToMarkdown(document.body))).window.document;
    expect(rendered.querySelector('pre code')?.textContent).toBe(code);
    expect(rendered.querySelectorAll('pre')).toHaveLength(1);
  });

  it('keeps child lists under ordered markers, including multi-digit markers', () => {
    const document = roundTrip(
      '<ol start="10"><li>Parent<ul><li>Child<ol><li>Grandchild</li></ol></li></ul></li></ol>',
    );
    expect(document.querySelector('ol > li > ul > li > ol > li')?.textContent).toBe('Grandchild');
    expect(document.body.children).toHaveLength(1);
  });

  it('round-trips inline code that starts and ends with backticks', () => {
    expect(roundTrip('<p>Example <code>`value`</code>.</p>').querySelector('code')?.textContent).toBe('`value`');
  });
});
