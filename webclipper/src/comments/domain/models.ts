export type ArticleCommentQuoteContext = {
  prefix?: string;
  suffix?: string;
};

export type ArticleComment = {
  id: number;
  parentId: number | null;
  conversationId: number | null;
  canonicalUrl: string;
  quoteText: string;
  quoteContext?: ArticleCommentQuoteContext | null;
  commentText: string;
  createdAt: number;
  updatedAt: number;
};

export type AddArticleCommentInput = {
  parentId?: number | null;
  conversationId: number | null;
  canonicalUrl: string;
  quoteText?: string | null;
  quoteContext?: ArticleCommentQuoteContext | null;
  commentText: string;
  createdAt?: number | null;
  updatedAt?: number | null;
};
