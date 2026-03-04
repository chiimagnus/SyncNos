import { OBSIDIAN_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';
import { send } from '../../platform/runtime/runtime';

type ApiError = { message: string; extra: unknown } | null;
type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

export async function getObsidianSettingsStatus(): Promise<{
  apiBaseUrl: string;
  authHeaderName: string;
  apiKeyPresent: boolean;
  chatFolder: string;
  articleFolder: string;
}> {
  const res = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS);
  const data = unwrap(res);
  return {
    apiBaseUrl: String(data?.apiBaseUrl ?? ''),
    authHeaderName: String(data?.authHeaderName ?? ''),
    apiKeyPresent: !!data?.apiKeyPresent,
    chatFolder: String(data?.chatFolder ?? ''),
    articleFolder: String(data?.articleFolder ?? ''),
  };
}

export async function clearObsidianApiKey(): Promise<void> {
  const res = await send<ApiResponse<any>>(OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS, { apiKey: '' });
  unwrap(res);
}

