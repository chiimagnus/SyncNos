import { createBackgroundServices } from '@services/bootstrap/background-services.ts';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { registerSyncHandlers } from '@services/sync/background-handlers';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerWebArticleHandlers } from '@collectors/web/article-fetch-background-handlers';
import { registerChatgptDeepResearchHandlers } from '@collectors/chatgpt/chatgpt-deep-research-background-handlers';
import { registerUiMessageHandlers } from '@platform/messaging/ui-background-handlers';
import { registerArticleCommentsHandlers } from '@services/comments/background/handlers';
import { registerItemMentionHandlers } from '@services/integrations/item-mention/background-handlers';
import { ensureDefaultNotionOAuthClientId, setupNotionOAuthNavigationListener } from '@services/sync/notion/auth/oauth';
import obsidianSyncJobStore from '@services/sync/obsidian/obsidian-sync-job-store.ts';
import { registerNotionSettingsHandlers } from '@services/sync/notion/settings-background-handlers';
import { registerObsidianSettingsHandlers } from '@services/sync/obsidian/settings-background-handlers';
import { onInstalled } from '@platform/runtime/runtime';
import { openOrFocusExtensionAppTab } from '@platform/webext/extension-app';
import { registerClipperContextMenu } from '@platform/context-menus/clipper-context-menu';

let backgroundInstanceId: string | null = null;
function getBackgroundInstanceId(): string {
  if (!backgroundInstanceId) backgroundInstanceId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return backgroundInstanceId;
}

async function openAboutSectionAfterInstall(): Promise<void> {
  await openOrFocusExtensionAppTab({ route: '/settings?section=aboutme' });
}

export default defineBackground(() => {
  const services = createBackgroundServices();

  const router = createBackgroundRouter({
    fallback: (msg) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  registerConversationHandlers(router);
  registerItemMentionHandlers(router);
  registerArticleCommentsHandlers(router);
  registerWebArticleHandlers(router);
  registerChatgptDeepResearchHandlers(router);
  registerNotionSettingsHandlers(router, {
    notionSyncJobStore: services.notionSyncJobStore,
    conversationKinds: services.conversationKinds,
  });
  registerObsidianSettingsHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    testObsidianConnection: (input) => services.obsidianSyncOrchestrator.testConnection(input),
  });
  registerUiMessageHandlers(router);
  registerSyncHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    notionSyncOrchestrator: services.notionSyncOrchestrator,
    obsidianSyncOrchestrator: services.obsidianSyncOrchestrator,
  });

  // Keep legacy "start" side-effects that are not message handlers.
  try {
    ensureDefaultNotionOAuthClientId().catch(() => {});
    setupNotionOAuthNavigationListener();
    registerClipperContextMenu();
    onInstalled((details) => {
      ensureDefaultNotionOAuthClientId().catch(() => {});
      // Do not auto-open tabs after extension updates.
      if (details?.reason !== 'install') return;
      openAboutSectionAfterInstall().catch(() => {});
    });
  } catch (_e) {
    // ignore
  }

  try {
    const id = getBackgroundInstanceId();
    services?.notionSyncJobStore?.abortRunningJobIfFromOtherInstance?.(id)?.catch?.(() => {});
    obsidianSyncJobStore.abortRunningJobIfFromOtherInstance(id).catch(() => {});
  } catch (_e) {
    // ignore
  }

  router.start();
});
