import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatMessageBubble } from '../../src/ui/shared/ChatMessageBubble';
import { composeThinkingMarkdown } from '@services/shared/thinking-block';

function extractRootSectionClass(html: string) {
  const match = html.match(/^<section class="([^"]+)">/);
  if (!match) throw new Error(`Expected root <section class=\"...\">, got: ${html.slice(0, 120)}...`);
  return match[1];
}

function extractMarkdownClass(html: string) {
  const match = html.match(/<div class="([^"]+)"[^>]*>/);
  if (!match) throw new Error(`Expected markdown <div class=\"...\">, got: ${html.slice(0, 220)}...`);
  return match[1].replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<');
}

describe('ChatMessageBubble', () => {
  it('renders captured thinking as a keyboard-accessible native disclosure before the final answer', () => {
    const markdown = composeThinkingMarkdown('**Plan**\n\nEvaluate $x^2$.', 'Final **answer**.');
    const html = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'assistant', markdown }));
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).not.toContain('<details open=');
    expect(html).toContain('Thinking</summary>');
    expect(html).toContain('<strong>Plan</strong>');
    expect(html).toContain('<strong>answer</strong>');
    expect(html).toContain('Collapse thinking</button>');
    expect(html.indexOf('<strong>Plan</strong>')).toBeLessThan(html.indexOf('Collapse thinking</button>'));
    expect(html.indexOf('Collapse thinking</button>')).toBeLessThan(html.indexOf('</details>'));
    expect(html).not.toContain('[!NOTE]-');

    const user = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'user', markdown }));
    expect(user).not.toContain('<details');
    expect(user).not.toContain('Collapse thinking');
    const ordinary = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'assistant', markdown: 'Final' }));
    expect(ordinary).not.toContain('<details');
    expect(ordinary).not.toContain('Collapse thinking');
  });

  it('matches the assistant reply typography and surface for expanded thinking in every reading profile', () => {
    for (const readingProfile of ['medium', 'notion', 'book']) {
      const html = renderToStaticMarkup(
        createElement(ChatMessageBubble, {
          role: 'assistant',
          readingProfile,
          markdown: composeThinkingMarkdown('**Thought**\n\nA paragraph.', '**Answer**\n\nAnother paragraph.'),
        }),
      );
      const details = html.match(/<details class="([^"]+)">/);
      expect(details?.[1]).toBe('tw-mb-3');
      expect(html).not.toContain('tw-border-t');
      expect(html).not.toContain('tw-bg-[var(--bg-sunken)]');
      const markdownClasses = [...html.matchAll(/<div class="([^"]+)"/g)].map((match) => match[1]);
      expect(markdownClasses).toHaveLength(2);
      expect(markdownClasses[0]).toBe(markdownClasses[1]);
      expect(html.indexOf('<summary')).toBeLessThan(html.indexOf('<strong>Thought</strong>'));
      expect(html.indexOf('<strong>Thought</strong>')).toBeLessThan(html.indexOf('<strong>Answer</strong>'));
    }
  });

  it('supports thinking-only and long multi-paragraph reasoning without an empty answer panel', () => {
    const html = renderToStaticMarkup(
      createElement(ChatMessageBubble, {
        role: 'assistant',
        markdown: composeThinkingMarkdown('analysis\n\n```ts\nconst x = 1;\n```', ''),
      }),
    );
    expect(html).toContain('<details');
    expect(html).toContain('analysis');
    expect(html).toContain('<pre>');
    expect(html).not.toContain('[!NOTE]-');
  });
  it('renders user messages with green-tinted bubbles without card background conflicts', () => {
    const html = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'user', markdown: 'hi' }));
    const cls = extractRootSectionClass(html);
    expect(cls).toContain('tw-bg-[var(--bubble-user-bg)]');
    expect(cls).not.toContain('tw-bg-[var(--bg-card)]');
  });

  it('normalizes legacy roles to user and assistant styles', () => {
    const userHtml = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'Human', markdown: 'hi' }));
    expect(extractRootSectionClass(userHtml)).toContain('tw-bg-[var(--bubble-user-bg)]');

    const assistantHtml = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'model', markdown: 'hi' }));
    expect(extractRootSectionClass(assistantHtml)).toContain('tw-bg-[var(--bg-card)]');
  });

  it('renders punctuation-adjacent bold across chat and article messages by default', () => {
    const markdown = '**Helium 实机采集已成功。**修复版对已保存的 ChatGPT 会话完成了真实 DOM 抓取';
    const chat = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'assistant', markdown }));
    const article = renderToStaticMarkup(createElement(ChatMessageBubble, { markdown }));
    for (const html of [chat, article]) {
      expect(html).toContain('<strong>Helium 实机采集已成功。</strong>修复版');
      expect(html).not.toContain('**Helium');
    }
  });

  it('uses medium profile by default and for unknown values', () => {
    const defaultHtml = renderToStaticMarkup(createElement(ChatMessageBubble, { markdown: 'hello' }));
    expect(extractMarkdownClass(defaultHtml)).toContain('tw-font-[var(--markdown-font-medium)]');

    const unknownProfileHtml = renderToStaticMarkup(
      createElement(ChatMessageBubble, { markdown: 'hello', readingProfile: 'legacy' }),
    );
    expect(extractMarkdownClass(unknownProfileHtml)).toContain('tw-font-[var(--markdown-font-medium)]');
  });

  it('applies requested profile typography classes', () => {
    const notionHtml = renderToStaticMarkup(
      createElement(ChatMessageBubble, { markdown: 'hello', readingProfile: 'notion' }),
    );
    const notionClass = extractMarkdownClass(notionHtml);
    expect(notionClass).toContain('tw-font-[var(--markdown-font-notion)]');
    expect(notionClass).toContain('[&_p]:tw-max-w-full');
    expect(notionClass).toContain('[&_ul]:tw-mb-[0.58rem]');

    const bookHtml = renderToStaticMarkup(
      createElement(ChatMessageBubble, { markdown: 'hello', readingProfile: 'book' }),
    );
    const bookClass = extractMarkdownClass(bookHtml);
    expect(bookClass).toContain('tw-font-[var(--markdown-font-book)]');
    expect(bookClass).toContain('[&_p]:tw-max-w-full');
    expect(bookClass).toContain('[&_p]:tw-mb-[1.2rem]');
  });

  it('renders syncnos assets only from the resolved source map supplied by its owner', () => {
    const resolved = renderToStaticMarkup(
      createElement(ChatMessageBubble, {
        markdown: '![cached](syncnos-asset://7)',
        syncnosAssetSrcById: new Map([[7, 'blob:resolved-7']]),
      }),
    );
    expect(resolved).toContain('src="blob:resolved-7"');
    expect(resolved).toContain('data-syncnos-asset-id="7"');
    expect(resolved).not.toContain('<span class="syncnos-md-image-link">');

    const unresolved = renderToStaticMarkup(
      createElement(ChatMessageBubble, { markdown: '![cached](syncnos-asset://7)' }),
    );
    expect(unresolved).not.toContain('blob:resolved-7');
    expect(unresolved).toContain('data:image/gif;base64,');
  });

  it('renders ChatGPT file references only from the transient resolver map', () => {
    const resolved = renderToStaticMarkup(
      createElement(ChatMessageBubble, {
        markdown: '![generated](chatgpt-file://file_generated_1)',
        chatgptFileSrcById: new Map([
          ['file_generated_1', 'https://chatgpt.com/backend-api/estuary/content?id=file_generated_1&sig=test'],
        ]),
      }),
    );
    expect(resolved).toContain(
      'src="https://chatgpt.com/backend-api/estuary/content?id=file_generated_1&amp;sig=test"',
    );
    expect(resolved).toContain('data-chatgpt-file-id="file_generated_1"');
    expect(resolved).toContain('class="syncnos-md-image-link"');
    expect(resolved).toContain(
      'href="https://chatgpt.com/backend-api/estuary/content?id=file_generated_1&amp;sig=test"',
    );
    expect(resolved).toContain('https://chatgpt.com/backend-api/estuary/content?keys=id,sig');
    expect(resolved).not.toContain('src="chatgpt-file://');

    const unresolved = renderToStaticMarkup(
      createElement(ChatMessageBubble, { markdown: '![generated](chatgpt-file://file_generated_1)' }),
    );
    expect(unresolved).toContain('data:image/gif;base64,');
    expect(unresolved).not.toContain('src="chatgpt-file://');
    expect(unresolved).not.toContain('<span class="syncnos-md-image-link">');
  });

  it('keeps core readability guard classes mounted on markdown container', () => {
    const html = renderToStaticMarkup(createElement(ChatMessageBubble, { markdown: '# t\n\ntext' }));
    const cls = extractMarkdownClass(html);
    expect(cls).toContain('[overflow-wrap:anywhere]');
    expect(cls).toContain('[&_pre]:tw-overflow-auto');
    expect(cls).toContain('[&_pre]:tw-bg-[color-mix(in_srgb,var(--bg-primary)_80%,var(--border))]');
    expect(cls).toContain('[&_table]:tw-overflow-x-auto');
    expect(cls).toContain('[&_.syncnos-md-image-link]');
    expect(cls).toContain('[&_blockquote]:tw-relative');
  });
});
