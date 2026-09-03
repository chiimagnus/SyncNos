import { FEISHU_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { send } from '@platform/runtime/runtime';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

export async function disconnectFeishu(): Promise<void> {
  const res = await send<ApiResponse<{ disconnected: boolean }>>(FEISHU_MESSAGE_TYPES.DISCONNECT);
  unwrap(res);
}
