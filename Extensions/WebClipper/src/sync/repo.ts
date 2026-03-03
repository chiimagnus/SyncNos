import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../platform/messaging/message-contracts';
import { send } from '../platform/runtime/runtime';
import type { NotionSyncJobStatus, ObsidianSyncStatus } from './models';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

export async function getNotionSyncJobStatus(): Promise<NotionSyncJobStatus> {
  const res = await send<ApiResponse<NotionSyncJobStatus>>(NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS);
  return unwrap(res);
}

export async function getObsidianSyncStatus(): Promise<ObsidianSyncStatus> {
  const res = await send<ApiResponse<ObsidianSyncStatus>>(OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS);
  return unwrap(res);
}

function normalizeIds(ids: unknown): number[] {
  return Array.isArray(ids)
    ? Array.from(
        new Set(
          ids
            .map((x) => Number(x))
            .filter((x) => Number.isFinite(x) && x > 0),
        ),
      )
    : [];
}

export async function syncNotionConversations(conversationIds: number[]): Promise<any> {
  const ids = normalizeIds(conversationIds);
  if (!ids.length) throw new Error('No conversations selected');
  const res = await send<ApiResponse<any>>(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, { conversationIds: ids });
  return unwrap(res);
}

export async function syncObsidianConversations(
  conversationIds: number[],
  { forceFullConversationIds }: { forceFullConversationIds?: number[] } = {},
): Promise<any> {
  const ids = normalizeIds(conversationIds);
  if (!ids.length) throw new Error('No conversations selected');
  const forceFull = normalizeIds(forceFullConversationIds);
  const res = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, {
    conversationIds: ids,
    forceFullConversationIds: forceFull.length ? forceFull : undefined,
  });
  return unwrap(res);
}
