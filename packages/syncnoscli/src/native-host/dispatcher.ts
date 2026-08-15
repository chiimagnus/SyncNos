import {
  LocalDataContractError,
  serializedJsonUtf8ByteLength,
  type ConversationListRequestPayload,
  type HostCommentContext,
  type HostConversationReference,
  type HostFactsCommand,
  type HostFactsRequest,
} from '@services/local-data/contracts';
import { ArticleCommentInvariantError } from '@services/comments/domain/comment-errors';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

import { createCommentsRepository } from '../sqlite/comments-repository';
import {
  createSqliteConversationListScope,
  createConversationsRepository,
  decodeSqliteConversationListCursor,
  encodeSqliteConversationListCursor,
} from '../sqlite/conversations-repository';
import { createImagesRepository } from '../sqlite/images-repository';
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
  'FIND_IMAGE_ASSET_BY_URL',
  'SEARCH_CONVERSATIONS',
] as const);

const NATIVE_HOST_CONNECTED_MUTATION_COMMANDS = Object.freeze([
  'SAVE_CONVERSATION_SNAPSHOT',
  'UPSERT_CONVERSATION',
  'DELETE_CONVERSATION',
  'DELETE_CONVERSATIONS',
  'MERGE_CONVERSATIONS',
  'SYNC_CONVERSATION_MESSAGES',
  'PATCH_SYNC_MAPPING',
  'SET_SYNC_CURSOR',
  'SET_CONVERSATION_NOTION_PAGE_ID',
  'CLEAR_SYNC_MAPPING',
  'ADD_ARTICLE_COMMENT',
  'ADD_ARTICLE_COMMENT_REPLY',
  'DELETE_ARTICLE_COMMENT',
  'MIGRATE_ARTICLE_COMMENT_URL',
  'ENSURE_ARTICLE_COMMENT_CONTEXT',
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
  const byId = new Map<number, ReturnType<typeof repository.listArticleCommentsByCanonicalUrl>[number]>();
  for (const comment of [
    ...byConversation,
    ...repository.listArticleCommentsByCanonicalUrl(request.payload.context.canonicalUrl),
  ]) {
    if (
      conversationId
        ? comment.conversationId != null && comment.conversationId !== conversationId
        : comment.conversationId != null
    )
      continue;
    if (!byId.has(comment.id)) byId.set(comment.id, comment);
  }
  return [...byId.values()].sort((left, right) => left.createdAt - right.createdAt || left.id - right.id);
}

function articleCommentInvariantResult(error: unknown): Readonly<{
  code: 'parent_not_found' | 'parent_not_root' | 'parent_context_mismatch';
  kind: 'article-comment-invariant';
}> | null {
  if (!(error instanceof ArticleCommentInvariantError)) return null;
  return Object.freeze({ kind: 'article-comment-invariant', code: error.code });
}

function imageAssetResponse(asset: Readonly<{ byteSize: number; contentType: string; id: number }>) {
  return Object.freeze({
    backendAssetId: asset.id,
    byteSize: asset.byteSize,
    contentType: asset.contentType,
  });
}

/** Reads raw image bytes only after resolving the stable owner in the same Host session. */
export function readNativeHostImageAsset(
  database: SyncNosSqliteDatabase,
  request: HostFactsRequest,
): Readonly<{ bytes: Uint8Array; metadata: ReturnType<typeof imageAssetResponse> }> {
  if (request.command !== 'GET_IMAGE_ASSET') invalidArgument();
  const conversationId = resolveConversationId(database, request.payload.owner);
  const asset = createImagesRepository(database).getImageAssetById({
    conversationId,
    id: request.payload.backendAssetId,
  });
  if (!asset) staleReference();
  return Object.freeze({ bytes: asset.bytes, metadata: imageAssetResponse(asset) });
}

/** Persists streamed bytes under a re-resolved owner; browser epochs never cross this boundary. */
export async function writeNativeHostImageAsset(
  database: SyncNosSqliteDatabase,
  request: HostFactsRequest,
  bytes: Uint8Array,
): Promise<ReturnType<typeof imageAssetResponse>> {
  if (request.command !== 'PUT_IMAGE_ASSET' || !(bytes instanceof Uint8Array)) invalidArgument();
  if (bytes.byteLength !== request.payload.transfer.declaredTotalBytes) protocolMismatch();
  const conversationId = resolveConversationId(database, request.payload.owner);
  const images = createImagesRepository(database);
  if (request.payload.backendAssetId !== undefined) {
    const existing = images.getImageAssetById({
      conversationId,
      id: request.payload.backendAssetId,
    });
    if (!existing || existing.url !== String(request.payload.metadata.url || '').trim()) staleReference();
  }
  const asset = await images.putImageAsset({
    bytes,
    contentType: request.payload.metadata.contentType,
    conversationId,
    metadata: request.payload.metadata,
    url: request.payload.metadata.url,
  });
  return imageAssetResponse(asset);
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
    case 'FIND_IMAGE_ASSET_BY_URL': {
      const conversationId = resolveConversationId(database, request.payload.owner);
      const asset = createImagesRepository(database).findImageAssetByConversationAndUrl({
        conversationId,
        url: request.payload.url,
      });
      return asset ? imageAssetResponse(asset) : null;
    }
    case 'SEARCH_CONVERSATIONS':
      return createSearchRepository(database).searchConversations(request.payload);
    default:
      invalidArgument();
  }
}

/**
 * Executes only the typed conversation/mapping writes exposed through
 * the lease-bound facade. References are re-resolved by each repository inside its
 * SQLite transaction; browser epochs and browser-local IDs never enter this Host.
 */
export function writeNativeHostConnectedCommand(database: SyncNosSqliteDatabase, request: HostFactsRequest): unknown {
  const conversations = createConversationsRepository(database);
  const mappings = createMappingsRepository(database);
  switch (request.command) {
    case 'SAVE_CONVERSATION_SNAPSHOT': {
      if (!('snapshot' in request.payload)) invalidArgument();
      const snapshot = request.payload.snapshot;
      if (serializedJsonUtf8ByteLength(snapshot) !== request.payload.transfer.declaredTotalBytes) protocolMismatch();
      return conversations.saveConversationSnapshot(snapshot);
    }
    case 'UPSERT_CONVERSATION':
      return conversations.upsertConversation(request.payload);
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
    case 'ADD_ARTICLE_COMMENT': {
      const conversationId = resolveCommentContext(database, request.payload.context);
      try {
        return createCommentsRepository(database).addArticleComment({
          canonicalUrl: request.payload.context.canonicalUrl,
          conversationId,
          authorName: request.payload.authorName,
          quoteText: request.payload.quoteText,
          commentText: request.payload.commentText,
          ...(request.payload.locator ? { locator: request.payload.locator } : {}),
        });
      } catch (error) {
        const invariant = articleCommentInvariantResult(error);
        if (invariant) return invariant;
        throw error;
      }
    }
    case 'ADD_ARTICLE_COMMENT_REPLY': {
      const conversationId = resolveCommentContext(database, request.payload.context);
      try {
        return createCommentsRepository(database).addArticleComment({
          canonicalUrl: request.payload.context.canonicalUrl,
          conversationId,
          authorName: request.payload.authorName,
          quoteText: '',
          commentText: request.payload.commentText,
          parentId: request.payload.backendParentId,
        });
      } catch (error) {
        const invariant = articleCommentInvariantResult(error);
        if (invariant) return invariant;
        throw error;
      }
    }
    case 'DELETE_ARTICLE_COMMENT': {
      const conversationId = resolveCommentContext(database, request.payload.context);
      const canonicalUrl = canonicalizeArticleUrl(request.payload.context.canonicalUrl);
      if (!canonicalUrl) invalidArgument();
      const repository = createCommentsRepository(database);
      repository.deleteArticleCommentByIdInContext({
        canonicalUrl,
        conversationId,
        commentId: request.payload.backendCommentId,
      });
      return Object.freeze({ ok: true });
    }
    case 'ENSURE_ARTICLE_COMMENT_CONTEXT': {
      const conversationId = resolveCommentContext(database, request.payload.context);
      if (!conversationId) staleReference();
      return createCommentsRepository(database).attachOrphanCommentsToConversation(
        request.payload.context.canonicalUrl,
        conversationId,
      );
    }
    case 'MIGRATE_ARTICLE_COMMENT_URL': {
      if (!request.payload.conversation) invalidArgument();
      const conversationId = resolveCommentContext(database, {
        canonicalUrl: request.payload.toCanonicalUrl,
        conversation: request.payload.conversation,
      });
      if (!conversationId) staleReference();
      return createCommentsRepository(database).migrateArticleCommentsCanonicalUrl({
        conversationId,
        fromCanonicalUrl: request.payload.fromCanonicalUrl,
        toCanonicalUrl: request.payload.toCanonicalUrl,
      });
    }
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
