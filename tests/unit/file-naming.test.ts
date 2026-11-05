import { describe, expect, it } from 'vitest';

import { buildConversationBasename, stableConversationId10 } from '@services/conversations/domain/file-naming';
import { sanitizeFilenamePart } from '@services/conversations/domain/markdown';

describe('file-naming', () => {
  it('generates space-free conversation basenames for Obsidian-safe files', () => {
    const convo = {
      source: 'doubao',
      title: '问候与帮助 - 豆包',
      conversationKey: 'k1',
    };

    const id10 = stableConversationId10(convo);
    const basename = buildConversationBasename(convo);

    expect(basename).toBe(`doubao-问候与帮助-豆包-${id10}`);
    expect(basename).not.toMatch(/\s/);
  });

  it('removes unsupported Unicode from filenames without changing ordinary Chinese or emoji', () => {
    const original = '有限元进度总结' + String.fromCodePoint(0x4e7c4) + '📚';
    const convo = { source: 'chatgpt', title: original, conversationKey: 'unicode-case' };

    expect(buildConversationBasename(convo)).toBe('chatgpt-有限元进度总结📚-' + stableConversationId10(convo));
    expect(sanitizeFilenamePart(String.fromCodePoint(0x4e7c4), 'Untitled')).toBe('Untitled');
  });

  it('removes malformed surrogate and control characters and never cuts an emoji in half', () => {
    expect(sanitizeFilenamePart('A\uD800B\uDC00C\u0000D', 'Untitled')).toBe('ABCD');
    expect(sanitizeFilenamePart('a'.repeat(79) + '😀tail', 'Untitled', 80)).toBe('a'.repeat(79));
    expect(sanitizeFilenamePart('a'.repeat(79) + '-tail', 'Untitled', 80)).toBe('a'.repeat(79));
  });

  it('bounds the final filename by UTF-8 bytes for multibyte titles', () => {
    const convo = { source: 'chatgpt', title: '文'.repeat(80), conversationKey: 'long-name' };
    const basename = buildConversationBasename(convo);
    expect(new TextEncoder().encode(basename + '-0001.webp').byteLength).toBeLessThanOrEqual(255);
    expect(basename).toMatch(new RegExp('-' + stableConversationId10(convo) + '$'));
  });
});
