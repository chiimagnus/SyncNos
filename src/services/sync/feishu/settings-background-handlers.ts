import { FEISHU_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  clearFeishuOAuthAttemptAndToken,
  getFeishuOAuthAttemptSummary,
  getFeishuOAuthConfigSummary,
  saveFeishuOAuthConfig,
  startFeishuOAuthAttempt,
  type FeishuOAuthConfigInput,
} from '@services/sync/feishu/auth/oauth';
import { getFeishuOAuthToken } from '@services/sync/feishu/auth/token-store';
import { getFeishuPathConfig, saveFeishuPathConfig } from '@services/sync/feishu/settings-store';

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
    const [token, attempt] = await Promise.all([getFeishuOAuthToken(), getFeishuOAuthAttemptSummary()]);
    return router.ok({
      connected: !!token?.accessToken,
      pending: attempt.pending,
      errorPresent: attempt.errorPresent,
    });
  });

  router.register(FEISHU_MESSAGE_TYPES.GET_AUTH_CONFIG, async () => {
    try {
      return router.ok(await getFeishuOAuthConfigSummary());
    } catch (error) {
      return errorResponse(router, error, 'feishu oauth config load failed');
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.START_AUTH, async () => {
    try {
      return router.ok(await startFeishuOAuthAttempt());
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

  router.register(FEISHU_MESSAGE_TYPES.GET_PATH_CONFIG, async () => {
    try {
      return router.ok(await getFeishuPathConfig());
    } catch (error) {
      return errorResponse(router, error, 'feishu path config load failed');
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.SAVE_PATH_CONFIG, async (msg) => {
    try {
      return router.ok(
        await saveFeishuPathConfig({
          chatFolder: msg?.chatFolder,
          articleFolder: msg?.articleFolder,
          videoFolder: msg?.videoFolder,
        }),
      );
    } catch (error) {
      return errorResponse(router, error, 'feishu path config save failed');
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.DISCONNECT, async () => {
    try {
      await deps.runExclusiveMaintenance(() => clearFeishuOAuthAttemptAndToken());
      return router.ok({ disconnected: true });
    } catch (error) {
      return errorResponse(router, error, 'feishu disconnect failed');
    }
  });
}
