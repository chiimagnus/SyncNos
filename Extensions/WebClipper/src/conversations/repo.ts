import { CORE_MESSAGE_TYPES } from '../platform/messaging/message-contracts';
import { send } from '../platform/runtime/runtime';
import type { Conversation, ConversationDetail } from './models';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await send<ApiResponse<Conversation[]>>(CORE_MESSAGE_TYPES.GET_CONVERSATIONS);
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
    ? conversationIds
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    : [];
  if (!ids.length) return null;
  const res = await send<ApiResponse<unknown>>(CORE_MESSAGE_TYPES.DELETE_CONVERSATIONS, { conversationIds: ids });
  return unwrap(res);
}
