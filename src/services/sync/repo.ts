import {
  FEISHU_MESSAGE_TYPES,
  GITHUB_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
} from '@platform/messaging/message-contracts';
import { send } from '@platform/runtime/runtime';
import type { SyncJobStatusResponse, SyncProvider } from '@services/sync/models';
import { normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';

export type SyncStartAck = {
  provider: SyncProvider;
  started: boolean;
};

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  const error = new Error(message) as Error & { extra?: unknown };
  error.extra = res.error?.extra ?? null;
  throw error;
}

export async function getNotionSyncJobStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS);
  return unwrap(res);
}

export async function clearNotionSyncJobStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(NOTION_MESSAGE_TYPES.CLEAR_SYNC_JOB_STATUS);
  return unwrap(res);
}

export async function getObsidianSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS);
  return unwrap(res);
}

export async function clearObsidianSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(OBSIDIAN_MESSAGE_TYPES.CLEAR_SYNC_STATUS);
  return unwrap(res);
}

export async function getFeishuSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(FEISHU_MESSAGE_TYPES.GET_SYNC_STATUS);
  return unwrap(res);
}

export async function clearFeishuSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(FEISHU_MESSAGE_TYPES.CLEAR_SYNC_STATUS);
  return unwrap(res);
}

export async function getGithubSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(GITHUB_MESSAGE_TYPES.GET_SYNC_STATUS);
  return unwrap(res);
}

export async function clearGithubSyncStatus(): Promise<SyncJobStatusResponse> {
  const res = await send<ApiResponse<SyncJobStatusResponse>>(GITHUB_MESSAGE_TYPES.CLEAR_SYNC_STATUS);
  return unwrap(res);
}

export async function syncNotionConversations(conversationIds: number[]): Promise<SyncStartAck> {
  const ids = normalizeSyncConversationIds(conversationIds);
  if (!ids.length) throw new Error('No conversations selected');
  const res = await send<ApiResponse<SyncStartAck>>(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, { conversationIds: ids });
  return unwrap(res);
}

export async function syncObsidianConversations(
  conversationIds: number[],
  { forceFullConversationIds }: { forceFullConversationIds?: number[] } = {},
): Promise<SyncStartAck> {
  const ids = normalizeSyncConversationIds(conversationIds);
  if (!ids.length) throw new Error('No conversations selected');
  const forceFull = normalizeSyncConversationIds(forceFullConversationIds);
  const res = await send<ApiResponse<SyncStartAck>>(OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, {
    conversationIds: ids,
    forceFullConversationIds: forceFull.length ? forceFull : undefined,
  });
  return unwrap(res);
}

export async function syncFeishuConversations(conversationIds: number[]): Promise<SyncStartAck> {
  const ids = normalizeSyncConversationIds(conversationIds);
  if (!ids.length) throw new Error('No conversations selected');
  const res = await send<ApiResponse<SyncStartAck>>(FEISHU_MESSAGE_TYPES.SYNC_CONVERSATIONS, { conversationIds: ids });
  return unwrap(res);
}

export async function syncGithubConversations(conversationIds: number[]): Promise<SyncStartAck> {
  const ids = normalizeSyncConversationIds(conversationIds);
  if (!ids.length) throw new Error('No conversations selected');
  const res = await send<ApiResponse<SyncStartAck>>(GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS, { conversationIds: ids });
  return unwrap(res);
}
