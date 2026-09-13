import { storageGet, storageSet } from '@services/shared/storage';

export const CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY = 'chatgpt_api_capture_enabled';

export async function readChatgptApiCaptureEnabled(): Promise<boolean> {
  const local = await storageGet([CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY]);
  return local?.[CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY] === true;
}

export async function writeChatgptApiCaptureEnabled(enabled: boolean): Promise<boolean> {
  if (typeof enabled !== 'boolean') throw new TypeError('chatgpt_api_capture_enabled requires a boolean');
  await storageSet({ [CHATGPT_API_CAPTURE_ENABLED_STORAGE_KEY]: enabled });
  return enabled;
}
