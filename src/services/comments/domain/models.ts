import type { ArticleCommentLocator } from '@services/comments/domain/comment-locator';

export type {
  ArticleCommentBoundaryPath,
  ArticleCommentLocator,
  ArticleCommentLocatorEnv,
  ArticleCommentLocatorV1,
  ArticleCommentLocatorV2,
  ArticleCommentRootEvidence,
  ArticleCommentSurfaceHint,
  ArticleCommentTextModelVersion,
  ArticleCommentTextPositionSelector,
  ArticleCommentTextQuoteSelector,
} from '@services/comments/domain/comment-locator';

export type ArticleComment = {
  id: number;
  parentId: number | null;
  conversationId: number | null;
  canonicalUrl: string;
  authorName?: string | null;
  quoteText: string;
  commentText: string;
  locator?: ArticleCommentLocator | null;
  importSource?: string | null;
  importKey?: string | null;
  createdAt: number;
  updatedAt: number;
};

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
