import { COMMENTS_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { createArticleCommentsRepository, type ResolvedArticleCommentContext } from '@services/comments/data/storage';
import { serializeArticleCommentDto } from '@services/comments/domain/comment-dto';
import { ArticleCommentInvariantError } from '@services/comments/domain/comment-errors';
import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { storageGet } from '@services/shared/storage';
import {
  ABOUT_YOU_USER_NAME_STORAGE_KEY,
  DEFAULT_ABOUT_YOU_USER_NAME,
  normalizeUserName,
} from '@services/shared/user-profile';
import {
  AUTO_SYNC_CONVERSATION_CHANGED_REASONS,
  type AutoSyncConversationChangedReason,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseBrowserRuntimeFactsRequest,
  type BrowserCommentContext,
  type BrowserConversationReference,
  type BrowserRuntimeFactsCommand,
  type FactsEpoch,
  type StableConversationReference,
} from '@services/local-data/contracts';
import type { ConversationFactsRepository, ConversationReadRunner } from '@services/conversations/data/storage';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
  eventsHub?: { broadcast: (type: string, payload: unknown) => void };
};

type ArticleCommentsHandlersDeps = {
  conversationReadRunner: ConversationReadRunner;
  onConversationChanged: (conversationId: number, reason: AutoSyncConversationChangedReason) => void | Promise<void>;
};

function factsError(router: AnyRouter, error: unknown) {
  if (error instanceof ArticleCommentInvariantError) return router.err(error.code);
  if (error instanceof LocalDataContractError) {
    return router.err(error.message, { code: error.code, diagnostics: error.diagnostics ?? null });
  }
  return router.err(error instanceof Error ? error.message : String(error || 'article comments operation failed'));
}

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function staleReference(): never {
  throw new LocalDataContractError('STALE_REFERENCE');
}

function sameReference(left: StableConversationReference, right: StableConversationReference): boolean {
  return left.source === right.source && left.conversationKey === right.conversationKey;
}

function parseRuntimeCommentRequest(msg: unknown, command: BrowserRuntimeFactsCommand) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) invalidArgument();
  const row = msg as Record<string, unknown>;
  const { type: _type, factsEpoch, ...payload } = row;
  return parseBrowserRuntimeFactsRequest({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: 'comments-runtime',
    command,
    payload,
    ...(Object.hasOwn(row, 'factsEpoch') ? { factsEpoch } : {}),
  });
}

function requireFactsEpoch(value: FactsEpoch | undefined): FactsEpoch {
  if (!value) throw new LocalDataContractError('STALE_BACKEND_EPOCH');
  return value;
}

function browserCommentContext(value: BrowserCommentContext): BrowserCommentContext {
  const canonicalUrl = canonicalizeArticleUrl(value.canonicalUrl);
  if (!canonicalUrl) invalidArgument();
  const conversation = value.conversation;
  if (!conversation) return { canonicalUrl };
  if (Object.hasOwn(conversation, 'conversationId')) invalidArgument();
  const source = String(conversation.source || '').trim();
  const conversationKey = String(conversation.conversationKey || '').trim();
  if (!source || !conversationKey) invalidArgument();
  return { canonicalUrl, conversation: { source, conversationKey } };
}

function browserReference(value: BrowserConversationReference | undefined): StableConversationReference {
  if (!value || Object.hasOwn(value, 'conversationId')) invalidArgument();
  const source = String(value.source || '').trim();
  const conversationKey = String(value.conversationKey || '').trim();
  if (!source || !conversationKey) invalidArgument();
  return { source, conversationKey };
}

async function resolveCommentContext(
  repository: Pick<ConversationFactsRepository, 'getConversationByReference'>,
  input: BrowserCommentContext,
): Promise<ResolvedArticleCommentContext> {
  const context = browserCommentContext(input);
  if (!context.conversation) return { canonicalUrl: context.canonicalUrl, conversation: null };
  const target = await repository.getConversationByReference(context.conversation);
  const conversationId = Number(target?.id);
  const source = String(target?.source || '').trim();
  const conversationKey = String(target?.conversationKey || '').trim();
  if (
    !target ||
    !Number.isSafeInteger(conversationId) ||
    conversationId <= 0 ||
    !source ||
    !conversationKey ||
    !sameReference(context.conversation, { source, conversationKey }) ||
    String(target.sourceType || '')
      .trim()
      .toLowerCase() !== 'article' ||
    canonicalizeArticleUrl(target.url) !== context.canonicalUrl
  ) {
    staleReference();
  }
  return {
    canonicalUrl: context.canonicalUrl,
    conversation: { source, conversationKey, conversationId },
  };
}

async function currentAuthorName(): Promise<string> {
  const local = await storageGet([ABOUT_YOU_USER_NAME_STORAGE_KEY]);
  return normalizeUserName(local?.[ABOUT_YOU_USER_NAME_STORAGE_KEY]) || DEFAULT_ABOUT_YOU_USER_NAME;
}

function conversationIdForEvent(context: ResolvedArticleCommentContext): number | null {
  return context.conversation?.conversationId ?? null;
}

function broadcastChanged(
  router: AnyRouter,
  input: Readonly<{ conversationId: number | null; reason: string; extra?: Record<string, unknown> }>,
) {
  router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
    reason: input.reason,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.extra ?? {}),
  });
}

export function registerArticleCommentsHandlers(router: AnyRouter, deps: ArticleCommentsHandlersDeps) {
  router.register(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, async (msg) => {
    try {
      const request = parseRuntimeCommentRequest(msg, 'LIST_ARTICLE_COMMENTS');
      if (request.command !== 'LIST_ARTICLE_COMMENTS') invalidArgument();
      const factsEpoch = requireFactsEpoch(request.factsEpoch);
      const items = await deps.conversationReadRunner.run({
        kind: 'article-comments-list',
        expectedFactsEpoch: factsEpoch,
        read: async ({ lease, mode, repository }) => {
          const context = await resolveCommentContext(repository, request.payload.context);
          return await createArticleCommentsRepository({ lease, mode }).list({
            context,
            fallbackPolicy: request.payload.fallbackPolicy,
          });
        },
      });
      return router.ok(items.map(serializeArticleCommentDto));
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, async (msg) => {
    try {
      const request = parseRuntimeCommentRequest(msg, 'ADD_ARTICLE_COMMENT');
      if (request.command !== 'ADD_ARTICLE_COMMENT') invalidArgument();
      const factsEpoch = requireFactsEpoch(request.factsEpoch);
      const locator = normalizeArticleCommentLocator(request.payload.locator);
      const result = await deps.conversationReadRunner.run({
        kind: 'article-comments-add-root',
        expectedFactsEpoch: factsEpoch,
        read: async ({ lease, mode, repository }) => {
          const context = await resolveCommentContext(repository, request.payload.context);
          const authorName = await currentAuthorName();
          const comment = await createArticleCommentsRepository({ lease, mode }).addRoot({
            context,
            authorName,
            quoteText: request.payload.quoteText,
            commentText: request.payload.commentText,
            ...(locator ? { locator } : {}),
          });
          const conversationId = conversationIdForEvent(context);
          if (conversationId) {
            await deps.onConversationChanged(
              conversationId,
              AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
            );
          }
          return { comment, conversationId };
        },
      });
      broadcastChanged(router, { reason: 'articleCommentAdded', conversationId: result.conversationId });
      return router.ok(serializeArticleCommentDto(result.comment));
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT_REPLY, async (msg) => {
    try {
      const request = parseRuntimeCommentRequest(msg, 'ADD_ARTICLE_COMMENT_REPLY');
      if (request.command !== 'ADD_ARTICLE_COMMENT_REPLY') invalidArgument();
      const factsEpoch = requireFactsEpoch(request.factsEpoch);
      const result = await deps.conversationReadRunner.run({
        kind: 'article-comments-add-reply',
        expectedFactsEpoch: factsEpoch,
        read: async ({ lease, mode, repository }) => {
          const context = await resolveCommentContext(repository, request.payload.context);
          const authorName = await currentAuthorName();
          const comment = await createArticleCommentsRepository({ lease, mode }).addReply({
            context,
            authorName,
            parentId: request.payload.parentId,
            commentText: request.payload.commentText,
          });
          const conversationId = conversationIdForEvent(context);
          if (conversationId) {
            await deps.onConversationChanged(
              conversationId,
              AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
            );
          }
          return { comment, conversationId };
        },
      });
      broadcastChanged(router, { reason: 'articleCommentReplyAdded', conversationId: result.conversationId });
      return router.ok(serializeArticleCommentDto(result.comment));
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, async (msg) => {
    try {
      const request = parseRuntimeCommentRequest(msg, 'DELETE_ARTICLE_COMMENT');
      if (request.command !== 'DELETE_ARTICLE_COMMENT') invalidArgument();
      const factsEpoch = requireFactsEpoch(request.factsEpoch);
      const result = await deps.conversationReadRunner.run({
        kind: 'article-comments-delete',
        expectedFactsEpoch: factsEpoch,
        read: async ({ lease, mode, repository }) => {
          const context = await resolveCommentContext(repository, request.payload.context);
          await createArticleCommentsRepository({ lease, mode }).delete({
            context,
            commentId: request.payload.commentId,
          });
          const conversationId = conversationIdForEvent(context);
          if (conversationId) {
            await deps.onConversationChanged(
              conversationId,
              AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
            );
          }
          return { conversationId };
        },
      });
      broadcastChanged(router, { reason: 'articleCommentDeleted', conversationId: result.conversationId });
      return router.ok({ ok: true });
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(COMMENTS_MESSAGE_TYPES.ENSURE_ARTICLE_COMMENT_CONTEXT, async (msg) => {
    try {
      const request = parseRuntimeCommentRequest(msg, 'ENSURE_ARTICLE_COMMENT_CONTEXT');
      if (request.command !== 'ENSURE_ARTICLE_COMMENT_CONTEXT') invalidArgument();
      const factsEpoch = requireFactsEpoch(request.factsEpoch);
      const result = await deps.conversationReadRunner.run({
        kind: 'article-comments-ensure-context',
        expectedFactsEpoch: factsEpoch,
        read: async ({ lease, mode, repository }) => {
          const context = await resolveCommentContext(repository, request.payload.context);
          const attached = await createArticleCommentsRepository({ lease, mode }).ensureContext({ context });
          const conversationId = conversationIdForEvent(context);
          if (attached.updated > 0 && conversationId) {
            await deps.onConversationChanged(
              conversationId,
              AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
            );
          }
          return { ...attached, conversationId };
        },
      });
      if (result.updated > 0) {
        broadcastChanged(router, { reason: 'articleCommentAttached', conversationId: result.conversationId });
      }
      return router.ok({ updated: result.updated });
    } catch (error) {
      return factsError(router, error);
    }
  });

  router.register(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENT_URL, async (msg) => {
    try {
      const request = parseRuntimeCommentRequest(msg, 'MIGRATE_ARTICLE_COMMENT_URL');
      if (request.command !== 'MIGRATE_ARTICLE_COMMENT_URL') invalidArgument();
      const factsEpoch = requireFactsEpoch(request.factsEpoch);
      const conversation = browserReference(request.payload.conversation);
      const fromCanonicalUrl = canonicalizeArticleUrl(request.payload.fromCanonicalUrl);
      const toCanonicalUrl = canonicalizeArticleUrl(request.payload.toCanonicalUrl);
      if (!fromCanonicalUrl || !toCanonicalUrl) invalidArgument();
      const result = await deps.conversationReadRunner.run({
        kind: 'article-comments-migrate-url',
        expectedFactsEpoch: factsEpoch,
        read: async ({ lease, mode, repository }) => {
          const context = await resolveCommentContext(repository, { canonicalUrl: toCanonicalUrl, conversation });
          const migrated = await createArticleCommentsRepository({ lease, mode }).migrateCanonicalUrl({
            context,
            fromCanonicalUrl,
            toCanonicalUrl,
          });
          const conversationId = conversationIdForEvent(context);
          if (migrated.updated > 0 && conversationId) {
            await deps.onConversationChanged(
              conversationId,
              AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
            );
          }
          return { ...migrated, conversationId };
        },
      });
      if (result.updated > 0) {
        broadcastChanged(router, {
          reason: 'articleCommentsMigrated',
          conversationId: result.conversationId,
          extra: { fromCanonicalUrl, toCanonicalUrl },
        });
      }
      return router.ok({ updated: result.updated });
    } catch (error) {
      return factsError(router, error);
    }
  });
}
