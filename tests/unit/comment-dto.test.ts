import { describe, expect, it } from 'vitest';

import { parseArticleCommentDto } from '@services/comments/domain/comment-dto';

describe('article comment DTO', () => {
  it('normalizes a persisted comment without accepting an invalid numeric identity', () => {
    expect(
      parseArticleCommentDto({
        id: 7,
        parentId: null,
        conversationId: null,
        canonicalUrl: 'https://example.com/article#selection',
        quoteText: 'quote',
        commentText: 'comment',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toMatchObject({ id: 7, canonicalUrl: 'https://example.com/article' });

    expect(
      parseArticleCommentDto({
        id: 0,
        canonicalUrl: 'https://example.com/article',
        commentText: 'comment',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toBeNull();
  });
});
