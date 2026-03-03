import { startBackgroundBootstrap } from '../src/bootstrap/background.ts';
import { registerConversationHandlers } from '../src/conversations/background-handlers';
import { registerSettingsHandlers } from '../src/settings/background-handlers';
import { registerSyncHandlers } from '../src/sync/background-handlers';
import { createBackgroundRouter } from '../src/platform/messaging/background-router';
import { registerWebArticleHandlers } from '../src/collectors/web/article-fetch-background-handlers';
import {
  ensureDefaultNotionOAuthClientId,
  setupNotionOAuthNavigationListener,
} from '../src/sync/notion/auth/oauth';
import runtimeContext from '../src/runtime-context.ts';
import { getBackgroundInstanceId } from '../src/bootstrap/background-instance.ts';

export default defineBackground(() => {
  startBackgroundBootstrap();

  const router = createBackgroundRouter({
    fallback: (msg) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  // Migration-only utility; routed through platform router (and/or legacy router ping handler).
  router.register('__WXT_PING__', async () => {
    const instanceId = getBackgroundInstanceId();
    return router.ok({ pong: true, instanceId });
  });

  registerConversationHandlers(router);
  registerWebArticleHandlers(router);
  registerSettingsHandlers(router, { getInstanceId: getBackgroundInstanceId });
  registerSyncHandlers(router, { getInstanceId: getBackgroundInstanceId });

  // Keep legacy "start" side-effects that are not message handlers.
  try {
    ensureDefaultNotionOAuthClientId().catch(() => {});
    setupNotionOAuthNavigationListener();
    browser.runtime.onInstalled.addListener(() => ensureDefaultNotionOAuthClientId().catch(() => {}));
  } catch (_e) {
    // ignore
  }

  try {
    const id = getBackgroundInstanceId();
    runtimeContext.notionSyncJobStore?.abortRunningJobIfFromOtherInstance?.(id)?.catch?.(() => {});
  } catch (_e) {
    // ignore
  }

  router.start();
});
