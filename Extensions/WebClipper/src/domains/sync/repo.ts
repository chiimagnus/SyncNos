import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';
import { send } from '../../platform/runtime/runtime';
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
