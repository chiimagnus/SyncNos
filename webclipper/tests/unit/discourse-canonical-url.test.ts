import { describe, expect, it } from 'vitest';

import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

describe('discourse canonical url', () => {
  it('normalizes different floors of the same topic to the same canonical url', () => {
    const variants = [
      'https://linux.do/t/topic-slug/123',
      'https://linux.do/t/topic-slug/123/1',
      'https://linux.do/t/topic-slug/123/20',
      'https://linux.do/t/topic-slug/123/xxx',
      'https://linux.do/t/topic-slug/123/20?u=abc#frag',
      'https://linux.do/t/topic-slug/123/1/',
    ];

    const canonical = variants.map((url) => canonicalizeArticleUrl(url));
    expect(new Set(canonical)).toEqual(new Set(['https://linux.do/t/topic-slug/123']));
  });

  it('keeps different topics distinct', () => {
    const topicA = canonicalizeArticleUrl('https://linux.do/t/topic-slug/123/20');
    const topicB = canonicalizeArticleUrl('https://linux.do/t/topic-slug/456/20');

    expect(topicA).toBe('https://linux.do/t/topic-slug/123');
    expect(topicB).toBe('https://linux.do/t/topic-slug/456');
    expect(topicA).not.toBe(topicB);
  });

  it('does not rewrite non-topic urls and still canonicalizes topic-like paths across hosts', () => {
    expect(canonicalizeArticleUrl('https://linux.do/latest?order=created#frag')).toBe(
      'https://linux.do/latest?order=created',
    );
    expect(canonicalizeArticleUrl('https://example.com/path/to/article#frag')).toBe(
      'https://example.com/path/to/article',
    );
    expect(canonicalizeArticleUrl('https://example.com/t/topic-slug/123/20#frag')).toBe(
      'https://example.com/t/topic-slug/123',
    );
  });
});
