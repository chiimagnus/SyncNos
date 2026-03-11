import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatMessageBubble } from '../../src/ui/shared/ChatMessageBubble';

function extractRootSectionClass(html: string) {
  const match = html.match(/^<section class="([^"]+)">/);
  if (!match) throw new Error(`Expected root <section class=\"...\">, got: ${html.slice(0, 120)}...`);
  return match[1];
}

describe('ChatMessageBubble', () => {
  it('renders user messages with green-tinted bubbles without card background conflicts', () => {
    const html = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'user', markdown: 'hi' }));
    const cls = extractRootSectionClass(html);
    expect(cls).toContain('tw-bg-[color-mix(in_srgb,var(--secondary)_26%,var(--bg-card))]');
    expect(cls).not.toContain('tw-bg-[var(--bg-card)]');
  });

  it('normalizes legacy roles to user and assistant styles', () => {
    const userHtml = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'Human', markdown: 'hi' }));
    expect(extractRootSectionClass(userHtml)).toContain('tw-bg-[color-mix(in_srgb,var(--secondary)_26%,var(--bg-card))]');

    const assistantHtml = renderToStaticMarkup(createElement(ChatMessageBubble, { role: 'model', markdown: 'hi' }));
    expect(extractRootSectionClass(assistantHtml)).toContain('tw-bg-[var(--bg-card)]');
  });
});
