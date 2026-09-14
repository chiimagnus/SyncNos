import { describe, expect, test } from 'vitest';

import {
  toCanonicalCommentQuote,
  toDisplayCommentQuote,
} from '../../src/services/comments/locator/comment-quote-policy';

describe('comment quote policy', () => {
  test('canonical quote keeps full text, line breaks, and zero-width characters', () => {
    const input = `alpha\r\nbeta\u200d${'x'.repeat(220)}`;
    expect(toCanonicalCommentQuote(input)).toBe(`alpha\nbeta\u200d${'x'.repeat(220)}`);
  });

  test('display quote truncates the fixed preview budget by grapheme without changing canonical quote', () => {
    const family = '👨‍👩‍👧‍👦';
    const input = `${family.repeat(201)}tail`;
    expect(toDisplayCommentQuote(input)).toBe(`${family.repeat(200)}…`);
    expect(toCanonicalCommentQuote(input)).toBe(input);
  });
});
