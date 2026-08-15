import { COMMENTS_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { send } from '@platform/runtime/runtime';
import { normalizeArticleCommentLocator, type ArticleCommentLocator } from '@services/comments/domain/comment-locator';
import {
  parseArticleCommentDto,
  parseArticleCommentDtos,
  type ArticleCommentDto,
} from '@services/comments/domain/comment-dto';
import type { BrowserCommentContext, FactsEpoch, StableConversationReference } from '@services/local-data/contracts';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

export type ArticleCommentsClientContext = Readonly<{
  canonicalUrl: string;
  conversation?: StableConversationReference;
  factsEpoch: FactsEpoch;
}>;

export class ArticleCommentsClientError extends Error {
  readonly code: string | null;

  constructor(message: string, extra: unknown) {
    super(message);
    this.name = 'ArticleCommentsClientError';
    this.code =
      extra && typeof extra === 'object' && typeof (extra as Record<string, unknown>).code === 'string'
        ? String((extra as Record<string, unknown>).code)
        : null;
  }
}

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  throw new ArticleCommentsClientError(res.error?.message ?? 'unknown error', res.error?.extra ?? null);
}

function contextPayload(input: ArticleCommentsClientContext): BrowserCommentContext {
  const canonicalUrl = canonicalizeArticleUrl(input.canonicalUrl);
  if (!canonicalUrl) throw new Error('missing canonicalUrl');
  const source = String(input.conversation?.source || '').trim();
  const conversationKey = String(input.conversation?.conversationKey || '').trim();
  if ((source && !conversationKey) || (!source && conversationKey))
    throw new Error('invalid comment conversation reference');
  return {
    canonicalUrl,
    ...(source && conversationKey ? { conversation: { source, conversationKey } } : {}),
  };
}

function factsEpoch(input: ArticleCommentsClientContext): FactsEpoch {
  if (typeof input.factsEpoch !== 'string' || !input.factsEpoch) throw new Error('missing facts epoch');
  return input.factsEpoch;
}

export async function listArticleComments(
  input: Readonly<{
    context: ArticleCommentsClientContext;
    fallbackPolicy: 'none' | 'include-orphan-url';
  }>,
): Promise<ArticleCommentDto[]> {
  const res = await send<ApiResponse<ArticleCommentDto[]>>(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, {
    context: contextPayload(input.context),
    factsEpoch: factsEpoch(input.context),
    fallbackPolicy: input.fallbackPolicy,
  });
  return parseArticleCommentDtos(unwrap(res));
}

export async function addArticleComment(
  input: Readonly<{
    commentText: string;
    context: ArticleCommentsClientContext;
    locator?: ArticleCommentLocator | null;
    quoteText?: string | null;
  }>,
): Promise<ArticleCommentDto> {
  const locator = normalizeArticleCommentLocator(input.locator);
  const res = await send<ApiResponse<ArticleCommentDto>>(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
    context: contextPayload(input.context),
    factsEpoch: factsEpoch(input.context),
    quoteText: String(input.quoteText ?? ''),
    commentText: String(input.commentText ?? ''),
    ...(locator ? { locator } : {}),
  });
  const parsed = parseArticleCommentDto(unwrap(res));
  if (!parsed) throw new Error('invalid article comment response');
  return parsed;
}

export async function addArticleCommentReply(
  input: Readonly<{
    commentText: string;
    context: ArticleCommentsClientContext;
    parentId: number;
  }>,
): Promise<ArticleCommentDto> {
  const res = await send<ApiResponse<ArticleCommentDto>>(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT_REPLY, {
    context: contextPayload(input.context),
    factsEpoch: factsEpoch(input.context),
    parentId: Number(input.parentId),
    commentText: String(input.commentText ?? ''),
  });
  const parsed = parseArticleCommentDto(unwrap(res));
  if (!parsed) throw new Error('invalid article comment response');
  return parsed;
}

export async function deleteArticleComment(
  input: Readonly<{
    commentId: number;
    context: ArticleCommentsClientContext;
  }>,
): Promise<boolean> {
  const res = await send<ApiResponse<{ ok: boolean }>>(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, {
    context: contextPayload(input.context),
    factsEpoch: factsEpoch(input.context),
    commentId: Number(input.commentId),
  });
  return unwrap(res).ok === true;
}

export async function ensureArticleCommentContext(
  input: Readonly<{
    context: ArticleCommentsClientContext;
  }>,
): Promise<{ updated: number }> {
  const res = await send<ApiResponse<{ updated: number }>>(COMMENTS_MESSAGE_TYPES.ENSURE_ARTICLE_COMMENT_CONTEXT, {
    context: contextPayload(input.context),
    factsEpoch: factsEpoch(input.context),
  });
  return unwrap(res);
}

export async function migrateArticleCommentCanonicalUrl(
  input: Readonly<{
    context: ArticleCommentsClientContext & Readonly<{ conversation: StableConversationReference }>;
    fromCanonicalUrl: string;
    toCanonicalUrl: string;
  }>,
): Promise<{ updated: number }> {
  const context = contextPayload(input.context);
  if (!context.conversation) throw new Error('missing comment conversation reference');
  const res = await send<ApiResponse<{ updated: number }>>(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENT_URL, {
    conversation: context.conversation,
    factsEpoch: factsEpoch(input.context),
    fromCanonicalUrl: String(input.fromCanonicalUrl || ''),
    toCanonicalUrl: String(input.toCanonicalUrl || ''),
  });
  return unwrap(res);
}
