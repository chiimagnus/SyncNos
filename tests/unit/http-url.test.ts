import { describe, expect, it } from 'vitest';

import { canonicalizeArticleUrl, normalizeHttpUrl, sanitizeHttpUrl } from '@services/url-cleaning/http-url';

describe('sanitizeHttpUrl', () => {
  it('preserves original http/https query and hash while trimming whitespace', () => {
    expect(sanitizeHttpUrl('  https://example.com/path?x=1#section  ')).toBe('https://example.com/path?x=1#section');
    expect(sanitizeHttpUrl(' http://example.com/a?b=1#hash ')).toBe('http://example.com/a?b=1#hash');
  });

  it('rejects empty and non-http schemes', () => {
    expect(sanitizeHttpUrl('')).toBe('');
    expect(sanitizeHttpUrl('   ')).toBe('');
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeHttpUrl('obsidian://open?vault=x')).toBe('');
    expect(sanitizeHttpUrl('ftp://example.com')).toBe('');
  });
});

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

describe('canonicalizeArticleUrl', () => {
  it('returns empty string for empty or invalid inputs', () => {
    expect(canonicalizeArticleUrl('')).toBe('');
    expect(canonicalizeArticleUrl('not a url')).toBe('');
    expect(canonicalizeArticleUrl('ftp://example.com')).toBe('');
  });

  it('canonicalizes Discourse topic urls to topic level and strips query/hash', () => {
    const canonical = 'https://linux.do/t/topic-slug/123';
    expect(canonicalizeArticleUrl('https://linux.do/t/topic-slug/123')).toBe(canonical);
    expect(canonicalizeArticleUrl('https://linux.do/t/topic-slug/123/1')).toBe(canonical);
    expect(canonicalizeArticleUrl('https://linux.do/t/topic-slug/123/20?u=abc#frag')).toBe(canonical);
    expect(canonicalizeArticleUrl('https://linux.do/t/topic-slug/123/xxx?u=abc#frag')).toBe(canonical);
    expect(canonicalizeArticleUrl('https://linux.do/t/topic-slug/123/20/')).toBe(canonical);
    expect(canonicalizeArticleUrl('https://linux.do/T/topic-slug/123/99?u=abc')).toBe(canonical);
  });

  it('keeps non-discourse urls unchanged except hash removal', () => {
    expect(canonicalizeArticleUrl('https://example.com/path?a=1#frag')).toBe('https://example.com/path?a=1');
  });

  it('keeps non-topic discourse paths unchanged except hash removal', () => {
    expect(canonicalizeArticleUrl('https://linux.do/latest?order=created#frag')).toBe(
      'https://linux.do/latest?order=created',
    );
  });
});
