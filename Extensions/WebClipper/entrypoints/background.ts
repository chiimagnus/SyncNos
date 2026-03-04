import { startBackgroundBootstrap } from '../src/bootstrap/background.ts';
import { registerConversationHandlers } from '../src/conversations/background/handlers';
import { registerSyncHandlers } from '../src/sync/background-handlers';
import { createBackgroundRouter } from '../src/platform/messaging/background-router';
import { registerWebArticleHandlers } from '../src/collectors/web/article-fetch-background-handlers';
import { registerUiMessageHandlers } from '../src/platform/messaging/ui-background-handlers';
import {
  ensureDefaultNotionOAuthClientId,
  setupNotionOAuthNavigationListener,
} from '../src/sync/notion/auth/oauth';
import { getBackgroundInstanceId } from '../src/bootstrap/background-instance.ts';
import { registerNotionSettingsHandlers } from '../src/sync/notion/settings-background-handlers';
import { registerObsidianSettingsHandlers } from '../src/sync/obsidian/settings-background-handlers';

export default defineBackground(() => {
  const services = startBackgroundBootstrap();

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
  registerNotionSettingsHandlers(router, {
    notionSyncJobStore: services.notionSyncJobStore,
    conversationKinds: services.conversationKinds,
  });
  registerObsidianSettingsHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    testObsidianConnection: (input) => services.obsidianSyncOrchestrator.testConnection(input),
  });
  registerUiMessageHandlers(router, { backgroundInpageWebVisibility: services.backgroundInpageWebVisibility });
  registerSyncHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    notionSyncOrchestrator: services.notionSyncOrchestrator,
    obsidianSyncOrchestrator: services.obsidianSyncOrchestrator,
  });

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
    services?.notionSyncJobStore?.abortRunningJobIfFromOtherInstance?.(id)?.catch?.(() => {});
  } catch (_e) {
    // ignore
  }

  router.start();
});
