import { COMMENTS_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { send } from '@platform/runtime/runtime';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

export type ArticleCommentDto = {
  id: number;
  parentId: number | null;
  conversationId: number | null;
  canonicalUrl: string;
  quoteText: string;
  commentText: string;
  createdAt: number;
  updatedAt: number;
};

export async function addArticleComment(input: {
  canonicalUrl: string;
  conversationId: number | null;
  parentId?: number | null;
  quoteText?: string | null;
  commentText: string;
}): Promise<ArticleCommentDto> {
  const res = await send<ApiResponse<ArticleCommentDto>>(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, input as any);
  return unwrap(res);
}

export async function listArticleCommentsByCanonicalUrl(canonicalUrl: string): Promise<ArticleCommentDto[]> {
  const res = await send<ApiResponse<ArticleCommentDto[]>>(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, {
    canonicalUrl,
  });
  return unwrap(res);
}

export async function deleteArticleCommentById(id: number): Promise<boolean> {
  const res = await send<ApiResponse<{ ok: boolean }>>(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, { id });
  return unwrap(res).ok === true;
}

export async function migrateArticleCommentsCanonicalUrl(input: {
  fromCanonicalUrl: string;
  toCanonicalUrl: string;
  conversationId?: number | null;
}): Promise<{ updated: number }> {
  const payload = {
    fromCanonicalUrl: String(input?.fromCanonicalUrl || ''),
    toCanonicalUrl: String(input?.toCanonicalUrl || ''),
    conversationId: input?.conversationId != null ? Number(input.conversationId) : null,
  };
  const res = await send<ApiResponse<{ updated: number }>>(
    COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL,
    payload as any,
  );
  return unwrap(res);
}
