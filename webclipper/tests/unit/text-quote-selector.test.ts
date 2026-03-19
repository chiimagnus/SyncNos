import { describe, expect, it } from 'vitest';

import { findTextQuoteInText, normalizeTextQuoteSelector } from '../../src/comments/anchor/text-quote-selector';

describe('text-quote-selector', () => {
  it('normalizes selector and requires exact', () => {
    expect(normalizeTextQuoteSelector(null)).toBeNull();
    expect(normalizeTextQuoteSelector({})).toBeNull();
    expect(normalizeTextQuoteSelector({ exact: '  hi  ' })).toEqual({ exact: 'hi' });
    expect(normalizeTextQuoteSelector({ exact: 'hi', prefix: ' a ', suffix: ' b ' })).toEqual({
      exact: 'hi',
      prefix: ' a ',
      suffix: ' b ',
    });
  });

  it('finds unique exact match', () => {
    const match = findTextQuoteInText('hello world', { exact: 'world' });
    expect(match).toEqual({ start: 6, end: 11 });
  });

  it('disambiguates with prefix and suffix when exact repeats', () => {
    const text = 'A: hello world. B: hello world.';
    const selector = { exact: 'hello world', prefix: 'B: ', suffix: '.' };
    const match = findTextQuoteInText(text, selector);
    expect(match).toEqual({ start: 19, end: 30 });
  });

  it('falls back to first hit when no candidates satisfy prefix/suffix', () => {
    const text = 'x abc y abc z';
    const selector = { exact: 'abc', prefix: 'nope' };
    const match = findTextQuoteInText(text, selector);
    expect(match).toEqual({ start: 2, end: 5 });
  });
});
