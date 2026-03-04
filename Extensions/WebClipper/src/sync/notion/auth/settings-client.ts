import { NOTION_MESSAGE_TYPES } from '../../../platform/messaging/message-contracts';
import { send } from '../../../platform/runtime/runtime';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

export async function getNotionConnectionStatus(): Promise<{ connected: boolean }> {
  const res = await send<ApiResponse<{ connected: boolean; token?: unknown }>>(NOTION_MESSAGE_TYPES.GET_AUTH_STATUS);
  const data = unwrap(res);
  return { connected: !!data.connected };
}

export async function disconnectNotion(): Promise<void> {
  const res = await send<ApiResponse<{ disconnected: boolean }>>(NOTION_MESSAGE_TYPES.DISCONNECT);
  unwrap(res);
}

