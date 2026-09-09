import type { ArticleComment, ArticleCommentLocator } from '@services/comments/domain/models';
import { hasValidArticleCommentContent } from '@services/comments/domain/comment-content';
import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

export type ArticleCommentDto = ArticleComment;
export type ArticleCommentListRequestDto = { canonicalUrl?: string; conversationId?: number | null };
export type ArticleCommentAddRequestDto = {
  canonicalUrl: string;
  conversationId: number | null;
  parentId: number | null;
  quoteText: string;
  commentText: string;
  locator: ArticleCommentLocator | null;
};
export type ArticleCommentDeleteRequestDto = { id: number };

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parseOptionalPositiveInt(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value == null) return { ok: true, value: null };
  const parsed = positiveInt(value);
  return parsed == null ? { ok: false } : { ok: true, value: parsed };
}

export function parseArticleCommentDto(value: unknown): ArticleCommentDto | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = positiveInt(row.id);
  const canonicalUrl = canonicalizeArticleUrl(row.canonicalUrl);
  const parentId = positiveInt(row.parentId);
  const quoteText = String(row.quoteText ?? '');
  const commentText = String(row.commentText ?? '').trim();
  const locator = normalizeArticleCommentLocator(row.locator);
  const createdAt = Number(row.createdAt);
  const updatedAt = Number(row.updatedAt);
  const importSource = String(row.importSource ?? '').trim();
  const importKey = String(row.importKey ?? '').trim();
  if (
    !id ||
    !canonicalUrl ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !hasValidArticleCommentContent({ parentId, quoteText, commentText, locator, importSource, importKey })
  )
    return null;
  return {
    id,
    parentId,
    conversationId: positiveInt(row.conversationId),
    canonicalUrl,
    authorName: row.authorName == null ? null : String(row.authorName),
    quoteText,
    commentText,
    locator,
    ...(importSource && importKey ? { importSource, importKey } : {}),
    createdAt,
    updatedAt,
  };
}

export function parseArticleCommentDtos(value: unknown): ArticleCommentDto[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseArticleCommentDto).filter((item): item is ArticleCommentDto => !!item);
}

export function serializeArticleCommentDto(value: ArticleComment): ArticleCommentDto {
  return {
    ...value,
    authorName: value.authorName ?? null,
    locator: normalizeArticleCommentLocator(value.locator),
  };
}

export function parseArticleCommentAddRequest(value: unknown): ArticleCommentAddRequestDto | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const canonicalUrl = canonicalizeArticleUrl(row.canonicalUrl);
  if (!canonicalUrl) return null;
  const parent = parseOptionalPositiveInt(row.parentId);
  const conversation = parseOptionalPositiveInt(row.conversationId);
  if (!parent.ok || !conversation.ok) return null;
  const parentId = parent.value;
  const quoteText = parentId ? '' : String(row.quoteText ?? '');
  const commentText = String(row.commentText ?? '').trim();
  const locator = parentId ? null : normalizeArticleCommentLocator(row.locator);
  if (!hasValidArticleCommentContent({ parentId, quoteText, commentText, locator })) return null;
  return {
    canonicalUrl,
    conversationId: conversation.value,
    parentId,
    quoteText,
    commentText,
    locator,
  };
}
