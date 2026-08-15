import {
  LocalDataContractError,
  serializedJsonUtf8ByteLength,
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

const NATIVE_HOST_CONNECTED_MUTATION_COMMANDS = Object.freeze([
  'SAVE_CONVERSATION_SNAPSHOT',
  'DELETE_CONVERSATION',
  'DELETE_CONVERSATIONS',
  'MERGE_CONVERSATIONS',
  'SYNC_CONVERSATION_MESSAGES',
  'PATCH_SYNC_MAPPING',
  'SET_SYNC_CURSOR',
  'SET_CONVERSATION_NOTION_PAGE_ID',
  'CLEAR_SYNC_MAPPING',
] as const);

type NativeHostConnectedReadCommand = (typeof NATIVE_HOST_CONNECTED_READ_COMMANDS)[number];
type NativeHostConnectedMutationCommand = (typeof NATIVE_HOST_CONNECTED_MUTATION_COMMANDS)[number];

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function staleReference(): never {
  throw new LocalDataContractError('STALE_REFERENCE');
}

function protocolMismatch(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
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
 * Dispatches only lease-bound facts reads. Capture streaming and the remaining facts
 * domains gain their matching P3 facades instead of falling through to an IDB path.
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

/**
 * Executes only the typed conversation/mapping writes that P3-T4 exposes through
 * the lease-bound facade. References are re-resolved by each repository inside its
 * SQLite transaction; browser epochs and browser-local IDs never enter this Host.
 */
export function writeNativeHostConnectedCommand(database: SyncNosSqliteDatabase, request: HostFactsRequest): unknown {
  const conversations = createConversationsRepository(database);
  const mappings = createMappingsRepository(database);
  switch (request.command) {
    case 'SAVE_CONVERSATION_SNAPSHOT': {
      const snapshot = request.payload.snapshot;
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) invalidArgument();
      if (serializedJsonUtf8ByteLength(snapshot) !== request.payload.transfer.declaredTotalBytes) protocolMismatch();
      // ponytail: P3-T5 replaces this legacy conversation-only snapshot with the atomic conversation+messages capture.
      return conversations.upsertConversation(snapshot);
    }
    case 'DELETE_CONVERSATION':
      return conversations.deleteConversationsByReferences([request.payload]);
    case 'DELETE_CONVERSATIONS':
      return conversations.deleteConversationsByReferences(request.payload.conversations);
    case 'MERGE_CONVERSATIONS':
      return conversations.mergeConversationsByReferences({
        keep: request.payload.target,
        remove: request.payload.source,
      });
    case 'SYNC_CONVERSATION_MESSAGES':
      if (serializedJsonUtf8ByteLength(request.payload.messages) !== request.payload.transfer.declaredTotalBytes) {
        protocolMismatch();
      }
      return conversations.syncConversationMessagesByReference(request.payload.conversation, request.payload.messages, {
        ...(request.payload.mode ? { mode: request.payload.mode } : {}),
        ...(request.payload.diff !== undefined ? { diff: request.payload.diff } : {}),
      });
    case 'PATCH_SYNC_MAPPING':
      return mappings.patchSyncMappingByReference(request.payload.conversation, request.payload.patch);
    case 'SET_SYNC_CURSOR':
      return mappings.setSyncCursorByReference(request.payload.conversation, request.payload.cursor);
    case 'SET_CONVERSATION_NOTION_PAGE_ID':
      return mappings.setConversationNotionPageIdByReference(
        request.payload.conversation,
        request.payload.notionPageId,
        request.payload.meta,
      );
    case 'CLEAR_SYNC_MAPPING':
      return mappings.clearSyncCursorByReference(request.payload.conversation);
    default:
      invalidArgument();
  }
}

export function isNativeHostConnectedReadCommand(command: HostFactsCommand): command is NativeHostConnectedReadCommand {
  return (NATIVE_HOST_CONNECTED_READ_COMMANDS as readonly string[]).includes(command);
}

export function isNativeHostConnectedMutationCommand(
  command: HostFactsCommand,
): command is NativeHostConnectedMutationCommand {
  return (NATIVE_HOST_CONNECTED_MUTATION_COMMANDS as readonly string[]).includes(command);
}
