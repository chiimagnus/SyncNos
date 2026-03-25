export type ArticleComment = {
  id: number;
  parentId: number | null;
  conversationId: number | null;
  canonicalUrl: string;
  authorName?: string | null;
  quoteText: string;
  commentText: string;
  locator?: ArticleCommentLocator | null;
  createdAt: number;
  updatedAt: number;
};

export type ArticleCommentLocatorEnv = 'inpage' | 'app';

export type ArticleCommentTextQuoteSelector = {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
};

export type ArticleCommentTextPositionSelector = {
  type: 'TextPositionSelector';
  start: number;
  end: number;
};

export type ArticleCommentLocatorV1 = {
  v: 1;
  env: ArticleCommentLocatorEnv;
  quote: ArticleCommentTextQuoteSelector;
  position: ArticleCommentTextPositionSelector;
};

export type ArticleCommentLocator = ArticleCommentLocatorV1;

export type AddArticleCommentInput = {
  parentId?: number | null;
  conversationId: number | null;
  canonicalUrl: string;
  authorName?: string | null;
  quoteText?: string | null;
  commentText: string;
  locator?: ArticleCommentLocator | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};
