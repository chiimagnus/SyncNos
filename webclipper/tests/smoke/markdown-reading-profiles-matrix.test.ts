import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MARKDOWN_READING_PROFILE_IDS, resolveMarkdownReadingProfileId } from '../../src/services/protocols/markdown-reading-profiles';
import { MARKDOWN_READING_PROFILE_PRESETS } from '../../src/ui/shared/markdown-reading-profile-presets';
import { ChatMessageBubble } from '../../src/ui/shared/ChatMessageBubble';

const SAMPLE_MD = '# T\n\nparagraph with [link](https://example.com)';
const ROLES = ['user', 'assistant'] as const;

function extractRootClass(html: string) {
  const match = html.match(/^<section class="([^"]+)">/);
  if (!match) throw new Error(`Expected root <section class=\"...\">, got: ${html.slice(0, 120)}...`);
  return match[1];
}

function extractMarkdownClass(html: string) {
  const match = html.match(/<div class="([^"]+)"[^>]*><h1>/);
  if (!match) throw new Error(`Expected markdown <div class=\"...\">, got: ${html.slice(0, 220)}...`);
  return match[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<');
}

function readTokensCss() {
  return readFileSync(resolve(process.cwd(), 'src/ui/styles/tokens.css'), 'utf8');
}

describe('markdown reading profile matrix guards', () => {
  it('keeps resolver and preset contract aligned for all profile ids', () => {
    expect(resolveMarkdownReadingProfileId('unknown')).toBe('medium');
    for (const id of MARKDOWN_READING_PROFILE_IDS) {
      expect(resolveMarkdownReadingProfileId(id)).toBe(id);
      expect(MARKDOWN_READING_PROFILE_PRESETS[id].id).toBe(id);
    }
  });

  it('covers profile x bubbleRole matrix with stable class contracts', () => {
    for (const profileId of MARKDOWN_READING_PROFILE_IDS) {
      const preset = MARKDOWN_READING_PROFILE_PRESETS[profileId];
      const expectedFontClass = String(preset.typographyClassName).match(/tw-font-\[var\(--markdown-font-[^)]+\)\]/)?.[0];
      expect(expectedFontClass).toBeTruthy();

      for (const role of ROLES) {
        const html = renderToStaticMarkup(
          createElement(ChatMessageBubble, {
            role,
            readingProfile: profileId,
            markdown: SAMPLE_MD,
          }),
        );

        const rootClass = extractRootClass(html);
        if (role === 'user') expect(rootClass).toContain('tw-bg-[var(--bubble-user-bg)]');
        else expect(rootClass).toContain('tw-bg-[var(--bg-card)]');

        const markdownClass = extractMarkdownClass(html);
        expect(markdownClass).toContain(String(expectedFontClass));
        expect(markdownClass).toContain('[overflow-wrap:anywhere]');
        expect(markdownClass).toContain('[&_blockquote]:tw-relative');
        expect(markdownClass).toContain('[&_pre]:tw-overflow-auto');
        expect(markdownClass).toContain('[&_table]:tw-overflow-x-auto');
        expect(markdownClass).toContain('[&_.syncnos-md-image-link]');
      }
    }
  });

  it('keeps light/dark token scaffolding for readability fallback', () => {
    const css = readTokensCss();
    expect(css).toContain(':root {');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('--text-primary:');
    expect(css).toContain('--text-secondary:');
    expect(css).toContain('--bg-card:');
    expect(css).toContain('--info:');
    expect(css).toContain('--markdown-font-medium:');
    expect(css).toContain('--markdown-font-notion:');
    expect(css).toContain('--markdown-font-book:');
  });
});
