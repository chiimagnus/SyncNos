import {
  LocalDataContractError,
  type ConversationListRequestPayload,
  type HostCommentContext,
  type HostConversationReference,
  type HostFactsCommand,
  type HostFactsRequest,
} from '@services/local-data/contracts';
import {
  filterArticleCommentsForListIdentity,
  mergeArticleCommentsByIdentity,
} from '@services/comments/sidebar/article-comments-sidebar-adapter';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

import { createCommentsRepository } from '../sqlite/comments-repository';
import {
  createSqliteConversationListScope,
  createConversationsRepository,
  decodeSqliteConversationListCursor,
  encodeSqliteConversationListCursor,
} from '../sqlite/conversations-repository';
import { createMappingsRepository } from '../sqlite/mappings-repository';
import { createMessagesRepository } from '../sqlite/messages-repository';
import { createSearchRepository } from '../sqlite/search';
import type { SyncNosSqliteDatabase } from '../sqlite/schema';

const NATIVE_HOST_CONNECTED_READ_COMMANDS = Object.freeze([
  'CONVERSATION_BOOTSTRAP',
  'CONVERSATION_LOAD_MORE',
  'CONVERSATION_LOOKUP',
  'CONVERSATION_DETAIL',
  'CONVERSATION_TAIL',
  'GET_SYNC_MAPPING',
  'LIST_ARTICLE_COMMENTS',
  'SEARCH_CONVERSATIONS',
] as const);

type NativeHostConnectedReadCommand = (typeof NATIVE_HOST_CONNECTED_READ_COMMANDS)[number];

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function staleReference(): never {
  throw new LocalDataContractError('STALE_REFERENCE');
}

function listScope(payload: ConversationListRequestPayload) {
  return createSqliteConversationListScope({
    ...(payload.sourceKey ? { sourceKey: payload.sourceKey } : null),
    ...(payload.siteKey ? { siteKey: payload.siteKey } : null),
  });
}

function resolveConversationId(database: SyncNosSqliteDatabase, reference: HostConversationReference): number {
  const target = createConversationsRepository(database).findConversationBySourceAndKey(
    reference.source,
    reference.conversationKey,
  );
  if (!target || (reference.backendConversationId !== undefined && reference.backendConversationId !== target.id)) {
    staleReference();
  }
  return target.id;
}

function resolveCommentContext(database: SyncNosSqliteDatabase, context: HostCommentContext): number | null {
  if (!context.conversation) return null;
  const conversationId = resolveConversationId(database, context.conversation);
  const conversation = createConversationsRepository(database).getConversationById(conversationId);
  const canonicalUrl = canonicalizeArticleUrl(context.canonicalUrl);
  if (
    !conversation ||
    conversation.sourceType?.toLowerCase() !== 'article' ||
    !canonicalUrl ||
    canonicalizeArticleUrl(conversation.url) !== canonicalUrl
  ) {
    staleReference();
  }
  return conversationId;
}

function readConversationList(database: SyncNosSqliteDatabase, request: HostFactsRequest): unknown {
  const payload = request.payload as ConversationListRequestPayload;
  const scope = listScope(payload);
  const repository = createConversationsRepository(database);
  const query = { sourceKey: scope.sourceKey, siteKey: scope.siteKey };
  const page =
    request.command === 'CONVERSATION_BOOTSTRAP'
      ? (() => {
          if (payload.cursor !== undefined) invalidArgument();
          return repository.getConversationListBootstrap(query, payload.limit);
        })()
      : (() => {
          if (request.command !== 'CONVERSATION_LOAD_MORE' || payload.cursor === undefined) invalidArgument();
          const cursor = decodeSqliteConversationListCursor(payload.cursor, scope);
          return repository.getConversationListPage(query, cursor, payload.limit);
        })();
  return Object.freeze({
    ...page,
    cursor: page.cursor ? encodeSqliteConversationListCursor(page.cursor, scope) : null,
  });
}

function readComments(database: SyncNosSqliteDatabase, request: HostFactsRequest): unknown {
  if (request.command !== 'LIST_ARTICLE_COMMENTS') invalidArgument();
  const conversationId = resolveCommentContext(database, request.payload.context);
  const repository = createCommentsRepository(database);
  const byConversation = conversationId ? repository.listArticleCommentsByConversationId(conversationId) : [];
  if (request.payload.fallbackPolicy === 'none') return byConversation;
  const byCanonicalUrl = filterArticleCommentsForListIdentity(
    repository.listArticleCommentsByCanonicalUrl(request.payload.context.canonicalUrl),
    { conversationId },
  );
  return mergeArticleCommentsByIdentity(byConversation, byCanonicalUrl);
}

/**
 * Dispatches only read operations whose request and response semantics are already
 * complete. Byte upload/export and mutations gain their typed stream handlers with
 * the matching P3 facts facades; they must never be guessed as one-shot JSON here.
 */
export function readNativeHostConnectedCommand(database: SyncNosSqliteDatabase, request: HostFactsRequest): unknown {
  switch (request.command) {
    case 'CONVERSATION_BOOTSTRAP':
    case 'CONVERSATION_LOAD_MORE':
      return readConversationList(database, request);
    case 'CONVERSATION_LOOKUP': {
      const conversationId = resolveConversationId(database, request.payload);
      return createConversationsRepository(database).getConversationById(conversationId);
    }
    case 'CONVERSATION_DETAIL': {
      const conversationId = resolveConversationId(database, request.payload);
      return createMessagesRepository(database).getConversationDetail(conversationId);
    }
    case 'CONVERSATION_TAIL': {
      const conversationId = resolveConversationId(database, request.payload.conversation);
      return Object.freeze({
        conversationId,
        messages: createMessagesRepository(database).getMessagesTailAfterKeyByConversationId(
          conversationId,
          request.payload.afterMessageKey,
          request.payload.limit ?? 200,
        ),
      });
    }
    case 'GET_SYNC_MAPPING': {
      const conversationId = resolveConversationId(database, request.payload.conversation);
      return createMappingsRepository(database).getSyncMappingByConversation(conversationId);
    }
    case 'LIST_ARTICLE_COMMENTS':
      return readComments(database, request);
    case 'SEARCH_CONVERSATIONS':
      return createSearchRepository(database).searchConversations(request.payload);
    default:
      invalidArgument();
  }
}

export function isNativeHostConnectedReadCommand(command: HostFactsCommand): command is NativeHostConnectedReadCommand {
  return (NATIVE_HOST_CONNECTED_READ_COMMANDS as readonly string[]).includes(command);
}
