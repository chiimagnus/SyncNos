import { startBackgroundBootstrap } from '../src/bootstrap/background.ts';
import { registerConversationHandlers } from '../src/conversations/background-handlers';
import { registerSettingsHandlers } from '../src/settings/background-handlers';
import { registerSyncHandlers } from '../src/sync/background-handlers';
import { createBackgroundRouter } from '../src/platform/messaging/background-router';
import { registerWebArticleHandlers } from '../src/integrations/web-article/background-handlers';
import {
  ensureDefaultNotionOAuthClientId,
  setupNotionOAuthNavigationListener,
} from '../src/integrations/notion/oauth';
import runtimeContext from '../src/runtime-context.ts';

export default defineBackground(() => {
  startBackgroundBootstrap();

  if (!runtimeContext.__backgroundInstanceId) {
    runtimeContext.__backgroundInstanceId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  const router = createBackgroundRouter({
    fallback: (msg) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  // Migration-only utility; routed through platform router (and/or legacy router ping handler).
  router.register('__WXT_PING__', async () => {
    const instanceId = runtimeContext.__backgroundInstanceId ?? null;
    return router.ok({ pong: true, instanceId });
  });

  registerConversationHandlers(router);
  registerWebArticleHandlers(router);
  registerSettingsHandlers(router);
  registerSyncHandlers(router);

  // Keep legacy "start" side-effects that are not message handlers.
  try {
    ensureDefaultNotionOAuthClientId().catch(() => {});
    setupNotionOAuthNavigationListener();
    browser.runtime.onInstalled.addListener(() => ensureDefaultNotionOAuthClientId().catch(() => {}));
  } catch (_e) {
    // ignore
  }

  try {
    const id = runtimeContext.__backgroundInstanceId;
    runtimeContext.notionSyncJobStore?.abortRunningJobIfFromOtherInstance?.(id)?.catch?.(() => {});
  } catch (_e) {
    // ignore
  }

  router.start();
  runtimeContext.__backgroundReady = true;
});
