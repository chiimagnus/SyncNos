import { SETTINGS_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import {
  PublicSettingsError,
  getAllPublicSettings,
  getPublicSetting,
  getPublicSettingsSchema,
  setPublicSetting,
} from '@services/settings/public-settings';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

function errorResponse(router: AnyRouter, error: unknown) {
  if (error instanceof PublicSettingsError) {
    return router.err(error.message, { code: error.code, ...(error.extra ? { details: error.extra } : {}) });
  }
  return router.err(String((error as any)?.message || error || 'settings request failed'));
}

export function registerPublicSettingsHandlers(router: AnyRouter): void {
  router.register(SETTINGS_MESSAGE_TYPES.SCHEMA, async () => {
    try {
      return router.ok(await getPublicSettingsSchema());
    } catch (error) {
      return errorResponse(router, error);
    }
  });

  router.register(SETTINGS_MESSAGE_TYPES.GET, async (msg) => {
    try {
      const key = String(msg?.key || '').trim();
      return router.ok(key ? await getPublicSetting(key) : await getAllPublicSettings());
    } catch (error) {
      return errorResponse(router, error);
    }
  });

  router.register(SETTINGS_MESSAGE_TYPES.SET, async (msg) => {
    try {
      return router.ok(await setPublicSetting(msg?.key, msg?.value));
    } catch (error) {
      return errorResponse(router, error);
    }
  });
}
