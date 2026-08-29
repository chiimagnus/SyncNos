import { describe, expect, it } from 'vitest';

import {
  buildCanonicalWebArticleConversationKey,
  buildCanonicalWebArticleIdentity,
  normalizeWebArticleConversationKey,
  WEB_ARTICLE_SOURCE,
} from '@services/conversations/domain/article-identity';

describe('web article conversation identity', () => {
  it('builds a canonical identity from the shared article URL canonicalizer', () => {
    expect(buildCanonicalWebArticleIdentity('https://Example.com/post?x=1#fragment')).toEqual({
      source: WEB_ARTICLE_SOURCE,
      conversationKey: 'article:https://example.com/post?x=1',
      url: 'https://example.com/post?x=1',
    });
    expect(buildCanonicalWebArticleConversationKey('https://example.com/post#fragment')).toBe(
      'article:https://example.com/post',
    );
  });

  it('uses the Discourse canonical URL form for identity', () => {
    expect(buildCanonicalWebArticleIdentity('https://forum.example.com/t/topic-slug/123/4?u=someone#reply')).toEqual({
      source: WEB_ARTICLE_SOURCE,
      conversationKey: 'article:https://forum.example.com/t/topic-slug/123',
      url: 'https://forum.example.com/t/topic-slug/123',
    });
  });

  it('normalizes article-prefixed keys without changing unrelated keys', () => {
    expect(normalizeWebArticleConversationKey(' ARTICLE:https://Example.com/post#fragment ')).toBe(
      'article:https://example.com/post',
    );
    expect(normalizeWebArticleConversationKey('legacy-key')).toBe('legacy-key');
  });

  it('never manufactures an article key from an invalid or non-http URL', () => {
    expect(buildCanonicalWebArticleConversationKey('')).toBe('');
    expect(buildCanonicalWebArticleConversationKey('mailto:test@example.com')).toBe('');
    expect(buildCanonicalWebArticleIdentity('not a url')).toBeNull();
    expect(normalizeWebArticleConversationKey('article:mailto:test@example.com')).toBe(
      'article:mailto:test@example.com',
    );
  });
});
