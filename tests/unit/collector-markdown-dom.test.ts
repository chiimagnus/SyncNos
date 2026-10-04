import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '@collectors/shared/markdown-dom';
import { replaceMathElementsWithLatexText } from '@collectors/formula-utils';

const markdown = new MarkdownIt();

function roundTrip(html: string): Document {
  const document = new JSDOM(html).window.document;
  return new JSDOM(markdown.render(htmlToMarkdown(document.body))).window.document;
}

describe('shared collector Markdown semantics', () => {
  it('preserves quote and paragraph boundaries inside list items', () => {
    const document = roundTrip('<ol><li>Before<blockquote><p>Quote</p></blockquote><p>After</p></li></ol>');
    expect(document.querySelector('ol > li > blockquote')?.textContent.trim()).toBe('Quote');
    expect(document.querySelector('ol > li > p:last-child')?.textContent.trim()).toBe('After');
  });

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

  it('preserves table alignment, rich cells and escaped pipes', () => {
    const document = roundTrip(`<table><thead><tr>
      <th style="text-align: left"><div>Left</div></th><th align="center">Center</th><th style="text-align: right">Right</th>
      </tr></thead><tbody><tr><td><strong>Bold</strong> a|b</td><td><code>a\\|b</code></td><td>中文 😀</td></tr></tbody></table>`);
    expect(Array.from(document.querySelectorAll('th')).map((cell) => cell.style.textAlign)).toEqual([
      'left',
      'center',
      'right',
    ]);
    expect(document.querySelectorAll('td')).toHaveLength(3);
    expect(document.querySelector('td strong')?.textContent).toBe('Bold');
    expect(document.querySelector('td')?.textContent).toContain('a|b');
    expect(document.querySelector('td code')?.textContent).toBe('a\\|b');
  });

  it('preserves explicit line breaks in paragraphs, quotes and lists', () => {
    const document = roundTrip(
      '<p>First<br>Second</p><blockquote><p>Quote<br>Next</p></blockquote><ul><li>A<br>B</li></ul>',
    );
    expect(document.querySelectorAll('br')).toHaveLength(3);
    expect(document.querySelector('blockquote br')).not.toBeNull();
    expect(document.querySelector('li br')).not.toBeNull();
  });

  it('keeps ordinary HTML source wrapping soft', () => {
    const source = new JSDOM('<p>First\nSecond <em>Third\nFourth</em></p>').window.document;
    expect(htmlToMarkdown(source.body)).toBe('First Second *Third Fourth*');
  });

  it('keeps a display-math span block-level unless it is in inline flow', () => {
    const formula =
      '<span class="katex-display"><span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span></span>';
    for (const tag of ['span', 'div']) {
      const block = formula
        .replace('<span class="katex-display">', `<${tag} class="katex-display">`)
        .replace(/<\/span>$/, `</${tag}>`);
      const standalone = new JSDOM(`<div>${block}</div>`).window.document;
      replaceMathElementsWithLatexText(standalone.body);
      expect(htmlToMarkdown(standalone.body)).toBe('$$x^2$$');
      const inline = new JSDOM(`<li>Before ${block} after</li>`).window.document;
      replaceMathElementsWithLatexText(inline.body);
      expect(htmlToMarkdown(inline.body)).toBe('Before $x^2$ after');
      const emphasized = new JSDOM(`<strong>${block}</strong>`).window.document;
      replaceMathElementsWithLatexText(emphasized.body);
      expect(htmlToMarkdown(emphasized.body)).toBe('**$x^2$**');
    }
  });
});
