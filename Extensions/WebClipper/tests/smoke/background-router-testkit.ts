import { registerConversationHandlers } from '../../src/conversations/background-handlers';
import { registerSettingsHandlers } from '../../src/settings/background-handlers';
import { registerSyncHandlers } from '../../src/domains/sync/background-handlers';
import { registerWebArticleHandlers } from '../../src/integrations/web-article/background-handlers';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';

export function createTestBackgroundRouter() {
  const NS: any = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});
  if (!NS.__backgroundInstanceId) {
    NS.__backgroundInstanceId = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  router.register('__WXT_PING__', async () => {
    return router.ok({ pong: true, instanceId: NS.__backgroundInstanceId });
  });

  registerConversationHandlers(router);
  registerWebArticleHandlers(router);
  registerSettingsHandlers(router);
  registerSyncHandlers(router);

  return router;
}
