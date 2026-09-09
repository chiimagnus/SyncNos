import type { ArticleCommentLocator } from '@services/comments/domain/comment-locator';

export function hasValidArticleCommentContent(input: {
  parentId: number | null;
  quoteText: string;
  commentText: string;
  locator?: ArticleCommentLocator | null;
  importSource?: string;
  importKey?: string;
}): boolean {
  if (input.commentText.trim()) return true;
  const quoteText = input.quoteText.trim();
  if (input.parentId != null || !quoteText) return false;
  if (input.locator?.quote.exact.trim() === quoteText) return true;
  return Boolean(input.importSource?.trim() && input.importKey?.trim());
}
