import { OBSIDIAN_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { getObsidianSettings, saveObsidianSettings } from './settings-store';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type Deps = {
  getInstanceId: () => string;
  testObsidianConnection: (input: { instanceId: string }) => Promise<unknown>;
};

export function registerObsidianSettingsHandlers(router: AnyRouter, deps: Deps) {
  router.register(OBSIDIAN_MESSAGE_TYPES.GET_SETTINGS, async () => {
    const data = await getObsidianSettings();
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.SAVE_SETTINGS, async (msg) => {
    const data = await saveObsidianSettings({
      enabled: msg.enabled,
      apiBaseUrl: msg.apiBaseUrl,
      apiKey: msg.apiKey,
      authHeaderName: msg.authHeaderName,
      chatFolder: msg.chatFolder,
      articleFolder: msg.articleFolder,
    });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.TEST_CONNECTION, async () => {
    const data = await deps.testObsidianConnection({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });
}
