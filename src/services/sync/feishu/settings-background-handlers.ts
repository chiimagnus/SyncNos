import { FEISHU_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { storageRemove } from '@platform/storage/local';
import { clearFeishuOAuthToken, getFeishuOAuthToken } from '@services/sync/feishu/auth/token-store';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type Deps = {
  runExclusiveMaintenance: <T>(mutation: () => Promise<T>, options?: { clearStatusAfter?: boolean }) => Promise<T>;
};

function getFeishuDisconnectStorageKeys(): string[] {
  return ['feishu_oauth_pending_state', 'feishu_oauth_last_error'];
}

export function registerFeishuSettingsHandlers(router: AnyRouter, deps: Deps) {
  router.register(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS, async () => {
    const token = await getFeishuOAuthToken();
    return router.ok({
      connected: !!(token && token.accessToken),
      token: token || null,
    });
  });

  router.register(FEISHU_MESSAGE_TYPES.DISCONNECT, async () => {
    try {
      const clearedKeys = await deps.runExclusiveMaintenance(
        async () => {
          await clearFeishuOAuthToken();
          const keys = getFeishuDisconnectStorageKeys();
          await storageRemove(keys);
          return keys;
        },
        { clearStatusAfter: true },
      );
      return router.ok({ disconnected: true, clearedKeys });
    } catch (error) {
      const message = String((error as any)?.message ?? error ?? 'feishu disconnect failed');
      const code = String((error as any)?.extra?.code ?? (error as any)?.code ?? '').trim();
      return code ? router.err(message, { code }) : router.err(message);
    }
  });
}
