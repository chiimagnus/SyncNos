import { FEISHU_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { storageRemove } from '@platform/storage/local';
import { clearFeishuOAuthToken, getFeishuOAuthToken } from '@services/sync/feishu/auth/token-store';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-store';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

function getFeishuDisconnectStorageKeys(): string[] {
  return ['feishu_oauth_pending_state', 'feishu_oauth_last_error', SYNC_JOB_STORAGE_KEYS.feishu];
}

export function registerFeishuSettingsHandlers(router: AnyRouter) {
  router.register(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS, async () => {
    const token = await getFeishuOAuthToken();
    return router.ok({
      connected: !!(token && token.accessToken),
      token: token || null,
    });
  });

  router.register(FEISHU_MESSAGE_TYPES.DISCONNECT, async () => {
    await clearFeishuOAuthToken();
    const clearedKeys = getFeishuDisconnectStorageKeys();
    await storageRemove(clearedKeys);
    return router.ok({ disconnected: true, clearedKeys });
  });
}
