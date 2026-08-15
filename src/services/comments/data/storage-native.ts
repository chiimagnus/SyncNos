import { connectNative, type NativeHostRequest } from '@platform/local-data/native-client';
import {
  ArticleCommentInvariantError,
  type ArticleCommentInvariantCode,
} from '@services/comments/domain/comment-errors';
import { parseArticleCommentDto, parseArticleCommentDtos } from '@services/comments/domain/comment-dto';
import type { ArticleComment } from '@services/comments/domain/models';
import {
  LocalDataContractError,
  type HostCommentContext,
  type HostConversationReference,
  type HostFactsCommand,
} from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type {
  ArticleCommentsAddReplyInput,
  ArticleCommentsAddRootInput,
  ArticleCommentsDeleteInput,
  ArticleCommentsEnsureContextInput,
  ArticleCommentsFactsRepository,
  ArticleCommentsListInput,
  ArticleCommentsMigrateInput,
  ResolvedArticleCommentContext,
} from '@services/comments/data/storage';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

type NativeConnectedCommand = Extract<
  HostFactsCommand,
  | 'LIST_ARTICLE_COMMENTS'
  | 'ADD_ARTICLE_COMMENT'
  | 'ADD_ARTICLE_COMMENT_REPLY'
  | 'DELETE_ARTICLE_COMMENT'
  | 'MIGRATE_ARTICLE_COMMENT_URL'
  | 'ENSURE_ARTICLE_COMMENT_CONTEXT'
>;

type NativeConnect = <TData>(input: NativeHostRequest<NativeConnectedCommand>) => Promise<TData>;

export type NativeArticleCommentsDependencies = Readonly<{
  connectNative?: NativeConnect;
}>;

function protocolFailure(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
}

function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) protocolFailure();
  return Number(value);
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) protocolFailure();
  return value.trim();
}

function hostReference(input: ResolvedArticleCommentContext['conversation']): HostConversationReference {
  if (!input) throw new LocalDataContractError('STALE_REFERENCE');
  return {
    source: requiredText(input.source),
    conversationKey: requiredText(input.conversationKey),
    backendConversationId: positiveId(input.conversationId),
  };
}

function hostContext(input: ResolvedArticleCommentContext): HostCommentContext {
  const canonicalUrl = canonicalizeArticleUrl(input.canonicalUrl);
  if (!canonicalUrl) throw new LocalDataContractError('INVALID_ARGUMENT');
  return {
    canonicalUrl,
    ...(input.conversation ? { conversation: hostReference(input.conversation) } : {}),
  };
}

function invariantCode(value: unknown): ArticleCommentInvariantCode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== 'article-comment-invariant') return null;
  const code = row.code;
  return code === 'parent_not_found' || code === 'parent_not_root' || code === 'parent_context_mismatch' ? code : null;
}

function asComment(value: unknown): ArticleComment {
  const invariant = invariantCode(value);
  if (invariant) throw new ArticleCommentInvariantError(invariant);
  const comment = parseArticleCommentDto(value);
  if (!comment) protocolFailure();
  return comment;
}

function asComments(value: unknown): ArticleComment[] {
  if (!Array.isArray(value)) protocolFailure();
  const comments = parseArticleCommentDtos(value);
  if (comments.length !== value.length) protocolFailure();
  return comments;
}

function asUpdated(value: unknown): { updated: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolFailure();
  const updated = Number((value as Record<string, unknown>).updated);
  if (!Number.isSafeInteger(updated) || updated < 0) protocolFailure();
  return { updated };
}

function asDeleted(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).ok !== true) {
    protocolFailure();
  }
  return true;
}

/** Typed Native Host adapter. It never sees a browser facts epoch or an unresolved numeric conversation id. */
export function createNativeArticleCommentsRepository(
  lease: FactsOperationLease,
  dependencies: NativeArticleCommentsDependencies = {},
): ArticleCommentsFactsRepository {
  const nativeConnect = (dependencies.connectNative ?? connectNative) as NativeConnect;
  const request = async <TData>(command: NativeConnectedCommand, payload: unknown): Promise<TData> => {
    assertFactsOperationLease(lease);
    const result = await nativeConnect<TData>({ command, payload } as NativeHostRequest<NativeConnectedCommand>);
    assertFactsOperationLease(lease);
    return result;
  };

  return Object.freeze({
    async list({ context, fallbackPolicy }: ArticleCommentsListInput) {
      const result = await request<unknown>('LIST_ARTICLE_COMMENTS', {
        context: hostContext(context),
        fallbackPolicy,
      });
      return asComments(result);
    },
    async addRoot({ context, authorName, quoteText, commentText, locator }: ArticleCommentsAddRootInput) {
      return asComment(
        await request<unknown>('ADD_ARTICLE_COMMENT', {
          context: hostContext(context),
          authorName: requiredText(authorName),
          quoteText: String(quoteText ?? ''),
          commentText: requiredText(commentText),
          ...(locator ? { locator } : {}),
        }),
      );
    },
    async addReply({ context, authorName, commentText, parentId }: ArticleCommentsAddReplyInput) {
      return asComment(
        await request<unknown>('ADD_ARTICLE_COMMENT_REPLY', {
          context: hostContext(context),
          authorName: requiredText(authorName),
          commentText: requiredText(commentText),
          backendParentId: positiveId(parentId),
        }),
      );
    },
    async delete({ context, commentId }: ArticleCommentsDeleteInput) {
      return asDeleted(
        await request<unknown>('DELETE_ARTICLE_COMMENT', {
          context: hostContext(context),
          backendCommentId: positiveId(commentId),
        }),
      );
    },
    async ensureContext({ context }: ArticleCommentsEnsureContextInput) {
      if (!context.conversation) throw new LocalDataContractError('STALE_REFERENCE');
      return asUpdated(await request<unknown>('ENSURE_ARTICLE_COMMENT_CONTEXT', { context: hostContext(context) }));
    },
    async migrateCanonicalUrl({ context, fromCanonicalUrl, toCanonicalUrl }: ArticleCommentsMigrateInput) {
      const conversation = hostReference(context.conversation);
      return asUpdated(
        await request<unknown>('MIGRATE_ARTICLE_COMMENT_URL', {
          conversation,
          fromCanonicalUrl: requiredText(fromCanonicalUrl),
          toCanonicalUrl: requiredText(toCanonicalUrl),
        }),
      );
    },
  });
}
