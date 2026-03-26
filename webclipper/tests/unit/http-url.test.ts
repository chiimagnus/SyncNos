import { describe, expect, it } from 'vitest';

import { normalizeHttpUrl } from '@services/url-cleaning/http-url';

describe('normalizeHttpUrl', () => {
  it('returns empty string for empty or invalid inputs', () => {
    expect(normalizeHttpUrl('')).toBe('');
    expect(normalizeHttpUrl('   ')).toBe('');
    expect(normalizeHttpUrl('not a url')).toBe('');
    expect(normalizeHttpUrl('ftp://example.com')).toBe('');
  });

  it('keeps http/https and strips hash', () => {
    expect(normalizeHttpUrl('https://example.com/path#section')).toBe('https://example.com/path');
    expect(normalizeHttpUrl('  http://example.com/a?b=1#hash  ')).toBe('http://example.com/a?b=1');
  });
});
