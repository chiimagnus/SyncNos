import type { ArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { toCanonicalCommentQuote } from '@services/comments/locator/comment-quote-policy';

export function hasValidArticleCommentContent(input: {
  parentId: number | null;
  quoteText: string;
  commentText: string;
  locator?: ArticleCommentLocator | null;
  importSource?: string;
  importKey?: string;
}): boolean {
  if (input.commentText.trim()) return true;
  const quoteText = toCanonicalCommentQuote(input.quoteText);
  if (input.parentId != null || !quoteText.trim()) return false;
  if (input.locator && toCanonicalCommentQuote(input.locator.quote.exact) === quoteText) return true;
  return Boolean(input.importSource?.trim() && input.importKey?.trim());
}
