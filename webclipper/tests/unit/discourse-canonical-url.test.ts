import { describe, expect, it } from 'vitest';

import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

describe('discourse canonical url', () => {
  it('normalizes different floors of the same topic to the same canonical url', () => {
    const variants = [
      'https://linux.do/t/topic/1870532',
      'https://linux.do/t/topic/1870532/1',
      'https://linux.do/t/topic/1870532/820',
      'https://linux.do/t/topic/1870532/xxx',
      'https://linux.do/t/topic/1870532/820?u=abc#frag',
      'https://linux.do/t/topic/1870532/1/',
    ];

    const canonical = variants.map((url) => canonicalizeArticleUrl(url));
    expect(new Set(canonical)).toEqual(new Set(['https://linux.do/t/topic/1870532']));
  });

  it('keeps different topics distinct', () => {
    const topicA = canonicalizeArticleUrl('https://linux.do/t/topic/1870532/820');
    const topicB = canonicalizeArticleUrl('https://linux.do/t/topic/1870533/820');

    expect(topicA).toBe('https://linux.do/t/topic/1870532');
    expect(topicB).toBe('https://linux.do/t/topic/1870533');
    expect(topicA).not.toBe(topicB);
  });

  it('does not rewrite non-topic urls and still canonicalizes topic-like paths across hosts', () => {
    expect(canonicalizeArticleUrl('https://linux.do/latest?order=created#frag')).toBe(
      'https://linux.do/latest?order=created',
    );
    expect(canonicalizeArticleUrl('https://example.com/path/to/article#frag')).toBe(
      'https://example.com/path/to/article',
    );
    expect(canonicalizeArticleUrl('https://example.com/t/topic/1870532/820#frag')).toBe(
      'https://example.com/t/topic/1870532',
    );
  });
});
