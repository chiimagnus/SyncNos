import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatMessageBubble } from './ChatMessageBubble';

function extractRootSectionClass(html: string) {
  const m = html.match(/^<section class="([^"]+)">/);
  if (!m) throw new Error(`Expected root <section class="...">, got: ${html.slice(0, 120)}...`);
  return m[1];
}

describe('ChatMessageBubble', () => {
  it('renders user messages as green bubbles (and avoids bg-white conflicts)', () => {
    const html = renderToStaticMarkup(<ChatMessageBubble role="user" markdown="hi" />);
    const cls = extractRootSectionClass(html);
    expect(cls).toContain('tw-bg-[#69BB84]');
    // Regression guard: `tw-bg-white` on the same node can override the user bg
    // depending on Tailwind rule ordering.
    expect(cls).not.toContain('tw-bg-white');
  });

  it('normalizes legacy roles to user/assistant', () => {
    const userHtml = renderToStaticMarkup(<ChatMessageBubble role="Human" markdown="hi" />);
    expect(extractRootSectionClass(userHtml)).toContain('tw-bg-[#69BB84]');

    const assistantHtml = renderToStaticMarkup(<ChatMessageBubble role="model" markdown="hi" />);
    expect(extractRootSectionClass(assistantHtml)).toContain('tw-bg-white');
  });
});

