export type ArticleComment = {
  id: number;
  parentId: number | null;
  conversationId: number | null;
  canonicalUrl: string;
  authorName?: string | null;
  quoteText: string;
  commentText: string;
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
  createdAt?: number | null;
  updatedAt?: number | null;
};
