import { describe, expect, it } from 'vitest';

import { computeArticleCommentThreadCount } from '@services/comments/domain/comment-metrics';

describe('computeArticleCommentThreadCount', () => {
  it('returns 0 for empty list', () => {
    expect(computeArticleCommentThreadCount([])).toBe(0);
  });

  it('counts only root comments when parent exists', () => {
    const comments = [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 1 },
      { id: 4, parentId: null },
    ];
    expect(computeArticleCommentThreadCount(comments)).toBe(2);
  });

  it('treats orphan replies as roots', () => {
    const comments = [
      { id: 1, parentId: 999 },
      { id: 2, parentId: 1 },
      { id: 3, parentId: null },
    ];
    expect(computeArticleCommentThreadCount(comments)).toBe(2);
  });

  it('deduplicates by id', () => {
    const comments = [
      { id: 1, parentId: null },
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 2, parentId: 1 },
    ];
    expect(computeArticleCommentThreadCount(comments)).toBe(1);
  });

  it('keeps stable output for invalid id/parentId values', () => {
    const comments = [
      { id: 0, parentId: null },
      { id: Number.NaN, parentId: Number.NaN },
      { id: Number.POSITIVE_INFINITY, parentId: 123 },
      { id: -1, parentId: -2 },
    ];
    expect(computeArticleCommentThreadCount(comments)).toBe(4);
  });
});
