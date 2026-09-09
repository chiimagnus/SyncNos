import { describe, expect, it } from 'vitest';

import { parseArticleCommentAddRequest, parseArticleCommentDto } from '@services/comments/domain/comment-dto';

const locator = {
  v: 1 as const,
  env: 'app' as const,
  quote: { type: 'TextQuoteSelector' as const, exact: 'quote' },
  position: { type: 'TextPositionSelector' as const, start: 0, end: 5 },
};

const valid = {
  canonicalUrl: 'https://example.com/article',
  conversationId: null,
  parentId: null,
  quoteText: 'quote',
  commentText: 'comment',
  locator: null,
};

describe('article comment runtime DTO', () => {
  it('accepts omitted or null optional ids', () => {
    expect(parseArticleCommentAddRequest(valid)).toMatchObject({ conversationId: null, parentId: null });
    const { conversationId: _conversationId, parentId: _parentId, ...withoutIds } = valid;
    expect(parseArticleCommentAddRequest(withoutIds)).toMatchObject({ conversationId: null, parentId: null });
  });

  it('accepts highlight-only roots only when they carry an anchored quote', () => {
    expect(parseArticleCommentAddRequest({ ...valid, commentText: '', locator })).toMatchObject({
      parentId: null,
      quoteText: 'quote',
      commentText: '',
      locator,
    });
    expect(parseArticleCommentAddRequest({ ...valid, commentText: '', locator: null })).toBeNull();
    expect(
      parseArticleCommentAddRequest({
        ...valid,
        commentText: '',
        locator: { ...locator, quote: { ...locator.quote, exact: 'different' } },
      }),
    ).toBeNull();
    expect(parseArticleCommentAddRequest({ ...valid, parentId: 7, commentText: '', locator })).toBeNull();

    expect(
      parseArticleCommentDto({
        id: 1,
        parentId: null,
        conversationId: 2,
        canonicalUrl: 'https://example.com/article',
        quoteText: 'quote',
        commentText: '',
        locator,
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toMatchObject({ id: 1, quoteText: 'quote', commentText: '', locator });

    expect(
      parseArticleCommentDto({
        id: 2,
        parentId: null,
        conversationId: 2,
        canonicalUrl: 'https://www.dedao.cn/course/article?id=example',
        quoteText: 'imported quote',
        commentText: '',
        locator: null,
        importSource: 'dedao',
        importKey: 'line-2',
        createdAt: 2,
        updatedAt: 2,
      }),
    ).toMatchObject({
      id: 2,
      quoteText: 'imported quote',
      commentText: '',
      locator: null,
      importSource: 'dedao',
      importKey: 'line-2',
    });

    expect(
      parseArticleCommentDto({
        id: 3,
        parentId: null,
        conversationId: 2,
        canonicalUrl: 'https://www.dedao.cn/course/article?id=example',
        quoteText: 'imported quote',
        commentText: '',
        locator: null,
        importSource: 'dedao',
        importKey: '',
        createdAt: 3,
        updatedAt: 3,
      }),
    ).toBeNull();
  });

  it.each([
    { parentId: 0 },
    { parentId: -1 },
    { parentId: 'bad' },
    { conversationId: 0 },
    { conversationId: -1 },
    { conversationId: 'bad' },
  ])('rejects explicit invalid optional ids: %j', (override) => {
    expect(parseArticleCommentAddRequest({ ...valid, ...override })).toBeNull();
  });
});
