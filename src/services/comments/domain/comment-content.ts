import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';

export function hasValidArticleCommentContent(input: {
  parentId: number | null;
  quoteText: unknown;
  commentText: unknown;
  locator?: unknown;
  importSource?: unknown;
  importKey?: unknown;
}): boolean {
  if (String(input.commentText ?? '').trim()) return true;
  const quoteText = String(input.quoteText ?? '').trim();
  if (input.parentId != null || !quoteText) return false;
  const locator = normalizeArticleCommentLocator(input.locator);
  if (locator && String(locator.quote.exact || '').trim() === quoteText) return true;
  return Boolean(String(input.importSource ?? '').trim() && String(input.importKey ?? '').trim());
}
