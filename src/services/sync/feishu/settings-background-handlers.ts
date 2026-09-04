import { FEISHU_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  clearFeishuOAuthAttemptAndToken,
  saveFeishuOAuthConfig,
  startFeishuOAuthAttempt,
  type FeishuOAuthConfigInput,
} from '@services/sync/feishu/auth/oauth';
import { getFeishuOAuthToken } from '@services/sync/feishu/auth/token-store';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type Deps = {
  runExclusiveMaintenance: <T>(mutation: () => Promise<T>) => Promise<T>;
};

function errorResponse(router: AnyRouter, error: unknown, fallback: string) {
  const message = String((error as any)?.message ?? error ?? fallback);
  const code = String((error as any)?.extra?.code ?? (error as any)?.code ?? '').trim();
  return code ? router.err(message, { code }) : router.err(message);
}

function pickFeishuOAuthConfigInput(message: any): FeishuOAuthConfigInput {
  const source = message && typeof message === 'object' ? message : {};
  const input: FeishuOAuthConfigInput = {};
  if (Object.prototype.hasOwnProperty.call(source, 'clientId')) input.clientId = source.clientId;
  if (Object.prototype.hasOwnProperty.call(source, 'clientSecret')) input.clientSecret = source.clientSecret;
  if (Object.prototype.hasOwnProperty.call(source, 'tokenExchangeProxyUrl')) {
    input.tokenExchangeProxyUrl = source.tokenExchangeProxyUrl;
  }
  return input;
}

export function registerFeishuSettingsHandlers(router: AnyRouter, deps: Deps) {
  router.register(FEISHU_MESSAGE_TYPES.GET_AUTH_STATUS, async () => {
    const token = await getFeishuOAuthToken();
    return router.ok({ connected: !!token?.accessToken });
  });

  router.register(FEISHU_MESSAGE_TYPES.START_AUTH, async (msg) => {
    try {
      return router.ok(
        await startFeishuOAuthAttempt({
          clientId: msg?.clientId,
          clientSecret: msg?.clientSecret,
          tokenExchangeProxyUrl: msg?.tokenExchangeProxyUrl,
        }),
      );
    } catch (error) {
      return errorResponse(router, error, 'feishu oauth start failed');
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.SAVE_AUTH_CONFIG, async (msg) => {
    try {
      return router.ok(await saveFeishuOAuthConfig(pickFeishuOAuthConfigInput(msg)));
    } catch (error) {
      return errorResponse(router, error, 'feishu oauth config save failed');
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.DISCONNECT, async () => {
    try {
      const clearedKeys = await deps.runExclusiveMaintenance(() => clearFeishuOAuthAttemptAndToken());
      return router.ok({ disconnected: true, clearedKeys });
    } catch (error) {
      return errorResponse(router, error, 'feishu disconnect failed');
    }
  });
}
