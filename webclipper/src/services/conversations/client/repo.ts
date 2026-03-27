import { CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { send } from '@platform/runtime/runtime';
import type {
  Conversation,
  ConversationDetail,
  ConversationListCursor,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListQueryInput,
} from '@services/conversations/domain/models';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

export async function getConversationListBootstrap(
  queryInput?: ConversationListQueryInput | null,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  const res = await send<ApiResponse<ConversationListPage<Conversation>>>(CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_BOOTSTRAP, {
    query: queryInput || {},
    limit: Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : undefined,
  });
  return unwrap(res);
}

export async function getConversationListPage(
  queryInput: ConversationListQueryInput | null | undefined,
  cursor: ConversationListCursor,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  const res = await send<ApiResponse<ConversationListPage<Conversation>>>(CORE_MESSAGE_TYPES.GET_CONVERSATION_LIST_PAGE, {
    query: queryInput || {},
    cursor,
    limit: Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : undefined,
  });
  return unwrap(res);
}

export async function findConversationBySourceAndKey(
  source: string,
  conversationKey: string,
): Promise<ConversationListOpenTarget | null> {
  const res = await send<ApiResponse<ConversationListOpenTarget | null>>(
    CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_SOURCE_AND_KEY,
    {
      source: String(source || '').trim(),
      conversationKey: String(conversationKey || '').trim(),
    },
  );
  return unwrap(res);
}

export async function findConversationById(conversationId: number): Promise<ConversationListOpenTarget | null> {
  const id = Number(conversationId);
  const res = await send<ApiResponse<ConversationListOpenTarget | null>>(CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_ID, {
    conversationId: id,
  });
  return unwrap(res);
}

export async function getConversationDetail(conversationId: number): Promise<ConversationDetail> {
  const res = await send<ApiResponse<ConversationDetail>>(CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, {
    conversationId,
  });
  return unwrap(res);
}

export async function deleteConversations(conversationIds: number[]): Promise<unknown> {
  const ids = Array.isArray(conversationIds)
    ? conversationIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
    : [];
  if (!ids.length) return null;
  const res = await send<ApiResponse<unknown>>(CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, { conversationIds: ids });
  return unwrap(res);
}

export async function upsertConversation(
  payload: Partial<Conversation>,
): Promise<Conversation & { __isNew?: boolean }> {
  const res = await send<ApiResponse<Conversation & { __isNew?: boolean }>>(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
    payload: payload as any,
  });
  return unwrap(res);
}

export async function mergeConversations(input: { keepConversationId: number; removeConversationId: number }): Promise<{
  keptConversationId: number;
  removedConversationId: number;
  movedMessages: number;
  movedImageCache: number;
  merged: boolean;
}> {
  const keepConversationId = Number(input.keepConversationId);
  const removeConversationId = Number(input.removeConversationId);
  const res = await send<
    ApiResponse<{
      keptConversationId: number;
      removedConversationId: number;
      movedMessages: number;
      movedImageCache: number;
      merged: boolean;
    }>
  >(CORE_MESSAGE_TYPES.MERGE_CONVERSATIONS, { keepConversationId, removeConversationId });
  return unwrap(res);
}

export type BackfillConversationImagesResult = {
  scannedMessages: number;
  updatedMessages: number;
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
};

export async function backfillConversationImages(
  conversationId: number,
  conversationUrl?: string,
): Promise<BackfillConversationImagesResult> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid conversationId');
  const res = await send<ApiResponse<BackfillConversationImagesResult>>(
    CORE_MESSAGE_TYPES.BACKFILL_CONVERSATION_IMAGES,
    {
      conversationId: id,
      conversationUrl: String(conversationUrl || ''),
    },
  );
  return unwrap(res);
}
