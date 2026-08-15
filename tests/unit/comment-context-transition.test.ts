import { describe, expect, it } from 'vitest';

import {
  buildCommentContextIdentityKey,
  classifyCommentContextTransition,
} from '../../src/services/comments/sidebar/comment-context-transition';

describe('comment context transition', () => {
  it('uses the full canonical URL and conversation id tuple for same identity', () => {
    const previous = { canonicalUrl: 'https://linux.do/t/topic/123/20', conversationId: 9 };
    const next = { canonicalUrl: 'https://linux.do/t/topic/123/1', conversationId: 9 };

    expect(classifyCommentContextTransition(previous, next).kind).toBe('same');
    expect(buildCommentContextIdentityKey(previous)).toBe(buildCommentContextIdentityKey(next));
  });

  it('classifies directional orphan attachment without treating the reverse as equal', () => {
    const orphan = { canonicalUrl: 'https://example.com/article', conversationId: null };
    const attached = { canonicalUrl: 'https://example.com/article', conversationId: 12 };

    expect(classifyCommentContextTransition(orphan, attached).kind).toBe('attach-orphan');
    expect(classifyCommentContextTransition(attached, orphan).kind).toBe('conversation-change');
  });

  it('classifies a canonical URL migration only for the same concrete conversation', () => {
    expect(
      classifyCommentContextTransition(
        { canonicalUrl: 'https://example.com/old', conversationId: 12 },
        { canonicalUrl: 'https://example.com/new', conversationId: 12 },
      ).kind,
    ).toBe('url-migrate');
    expect(
      classifyCommentContextTransition(
        { canonicalUrl: 'https://example.com/old', conversationId: 12 },
        { canonicalUrl: 'https://example.com/new', conversationId: 13 },
      ).kind,
    ).toBe('conversation-change');
  });

  it('does not reuse a rendered comment context after its facts epoch changes', () => {
    const previous = {
      canonicalUrl: 'https://example.com/old',
      conversationId: 12,
      conversation: { source: 'web', conversationKey: 'article:https://example.com/old' },
      factsEpoch: 'native:550e8400-e29b-41d4-a716-446655440000',
    };
    const next = {
      ...previous,
      canonicalUrl: 'https://example.com/new',
      factsEpoch: 'native:550e8400-e29b-41d4-a716-446655440001',
    };

    expect(classifyCommentContextTransition(previous, next).kind).toBe('conversation-change');
    expect(buildCommentContextIdentityKey(previous)).not.toBe(buildCommentContextIdentityKey(next));
  });

  it('returns invalid for a missing or non-http next identity', () => {
    expect(classifyCommentContextTransition(null, null).kind).toBe('invalid');
    expect(
      classifyCommentContextTransition(
        { canonicalUrl: 'https://example.com/old', conversationId: 1 },
        { canonicalUrl: 'javascript:alert(1)', conversationId: 1 },
      ).kind,
    ).toBe('invalid');
  });
});
