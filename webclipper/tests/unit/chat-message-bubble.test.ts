import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatMessageBubble } from '../../src/ui/shared/ChatMessageBubble';

function extractRootSectionClass(html: string) {
  const match = html.match(/^<section class="([^"]+)">/);
  if (!match) throw new Error(`Expected root <section class=\"...\">, got: ${html.slice(0, 120)}...`);
  return match[1];
}

function extractMarkdownClass(html: string) {
  const match = html.match(/<div class="([^"]+)"[^>]*>/);
  if (!match) throw new Error(`Expected markdown <div class=\"...\">, got: ${html.slice(0, 220)}...`);
  return match[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<');
}

describe('ChatMessageBubble', () => {
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
    expect(notionClass).toContain('[&_p]:tw-max-w-[62ch]');
    expect(notionClass).toContain('[&_ul]:tw-mb-[0.55rem]');

    const bookHtml = renderToStaticMarkup(createElement(ChatMessageBubble, { markdown: 'hello', readingProfile: 'book' }));
    const bookClass = extractMarkdownClass(bookHtml);
    expect(bookClass).toContain('tw-font-[var(--markdown-font-book)]');
    expect(bookClass).toContain('[&_p]:tw-max-w-[74ch]');
    expect(bookClass).toContain('[&_p]:tw-mb-[1.08rem]');
  });

  it('keeps core readability guard classes mounted on markdown container', () => {
    const html = renderToStaticMarkup(createElement(ChatMessageBubble, { markdown: '# t\n\ntext' }));
    const cls = extractMarkdownClass(html);
    expect(cls).toContain('[overflow-wrap:anywhere]');
    expect(cls).toContain('[&_pre]:tw-overflow-auto');
    expect(cls).toContain('[&_table]:tw-overflow-x-auto');
    expect(cls).toContain('[&_.syncnos-md-image-link]');
    expect(cls).toContain('[&_blockquote]:tw-relative');
  });
});
