import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_READING_PROFILE_IDS,
  resolveMarkdownReadingProfileId,
} from '../../src/services/protocols/markdown-reading-profiles';
import { MARKDOWN_READING_PROFILE_PRESETS } from '../../src/ui/shared/markdown-reading-profile-presets';
import { ChatMessageBubble } from '../../src/ui/shared/ChatMessageBubble';

const SAMPLE_MARKDOWN = [
  '# Title',
  '',
  'paragraph with a very_long_unbroken_token_1234567890123456789012345678901234567890 and [link](https://example.com).',
  '',
  '> quote line',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '|a|b|',
  '|-|-|',
  '|1|2|',
  '',
  '![](https://example.com/img.png)',
].join('\n');

function extractRootSectionClass(html: string) {
  const match = html.match(/^<section class="([^"]+)">/);
  if (!match) throw new Error(`Expected root <section class=\"...\">, got: ${html.slice(0, 120)}...`);
  return match[1];
}

function extractMarkdownClass(html: string) {
  const match = html.match(/<div class="([^"]+)"[^>]*><h1>/);
  if (!match) throw new Error(`Expected markdown <div class=\"...\">, got: ${html.slice(0, 280)}...`);
  return match[1].replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<');
}

function parseMeasureCh(value: string): number {
  const matched = /^(\d+(?:\.\d+)?)ch$/i.exec(String(value || '').trim());
  if (!matched) return Number.NaN;
  return Number(matched[1]);
}

describe('markdown reading profile smoke guards', () => {
  it('falls back unknown profile to medium and keeps readability guards mounted', () => {
    expect(resolveMarkdownReadingProfileId('legacy')).toBe('medium');

    const html = renderToStaticMarkup(
      createElement(ChatMessageBubble, {
        role: 'assistant',
        readingProfile: 'legacy',
        markdown: SAMPLE_MARKDOWN,
      }),
    );
    const cls = extractMarkdownClass(html);

    expect(cls).toContain('tw-font-[var(--markdown-font-medium)]');
    expect(cls).toContain('[overflow-wrap:anywhere]');
    expect(cls).toContain('[&_pre]:tw-overflow-auto');
    expect(cls).toContain('[&_table]:tw-overflow-x-auto');
    expect(cls).toContain('[&_.syncnos-md-image-link]');
  });

  it('renders all profiles for both user and assistant bubbles with key node guards', () => {
    const roles = ['user', 'assistant'] as const;
    for (const profileId of MARKDOWN_READING_PROFILE_IDS) {
      for (const role of roles) {
        const html = renderToStaticMarkup(
          createElement(ChatMessageBubble, {
            role,
            readingProfile: profileId,
            markdown: SAMPLE_MARKDOWN,
          }),
        );

        const rootCls = extractRootSectionClass(html);
        if (role === 'user') expect(rootCls).toContain('tw-bg-[var(--bubble-user-bg)]');
        else expect(rootCls).toContain('tw-bg-[var(--bg-card)]');

        const cls = extractMarkdownClass(html);
        expect(cls).toContain('[&_h1]:tw-text-[');
        expect(cls).toContain('[&_blockquote]:tw-relative');
        expect(cls).toContain('[&_code]:tw-px-[5px]');
        expect(cls).toContain('[&_table]:tw-overflow-x-auto');
      }
    }
  });

  it('keeps profile measure and line-height within readability guardrails', () => {
    for (const profileId of MARKDOWN_READING_PROFILE_IDS) {
      const preset = MARKDOWN_READING_PROFILE_PRESETS[profileId];
      expect(Number(preset.spec.lineHeight)).toBeGreaterThanOrEqual(1.5);
      expect(parseMeasureCh(preset.spec.measure)).toBeLessThanOrEqual(80);
    }
  });
});
