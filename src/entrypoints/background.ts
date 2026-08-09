import { createBackgroundServices } from '@services/bootstrap/background-services.ts';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { registerSyncHandlers } from '@services/sync/background-handlers';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerWebArticleHandlers } from '@collectors/web/article-fetch-background-handlers';
import { registerChatgptDeepResearchHandlers } from '@collectors/chatgpt/chatgpt-deep-research-background-handlers';
import { registerUiMessageHandlers } from '@platform/messaging/ui-background-handlers';
import { registerArticleCommentsHandlers } from '@services/comments/background/handlers';
import { registerItemMentionHandlers } from '@services/integrations/item-mention/background-handlers';
import { registerChatWithBackgroundHandlers } from '@services/integrations/chatwith/chatwith-background-handlers';
import { ensureDefaultNotionOAuthClientId, setupNotionOAuthNavigationListener } from '@services/sync/notion/auth/oauth';
import {
  ensureDefaultFeishuOAuthClientId,
  ensureDefaultFeishuOAuthProxyUrl,
  setupFeishuOAuthNavigationListener,
} from '@services/sync/feishu/auth/oauth';
import obsidianSyncJobStore from '@services/sync/obsidian/obsidian-sync-job-store.ts';
import feishuSyncJobStore from '@services/sync/feishu/feishu-sync-job-store.ts';
import { registerNotionSettingsHandlers } from '@services/sync/notion/settings-background-handlers';
import { registerObsidianSettingsHandlers } from '@services/sync/obsidian/settings-background-handlers';
import { registerFeishuSettingsHandlers } from '@services/sync/feishu/settings-background-handlers';
import { onInstalled } from '@platform/runtime/runtime';
import { openOrFocusExtensionAppTab } from '@platform/webext/extension-app';
import { registerClipperContextMenu } from '@platform/context-menus/clipper-context-menu';
import { onAlarm } from '@platform/alarms/alarms';
import { initializeLocale } from '@i18n';

let backgroundInstanceId: string | null = null;
function getBackgroundInstanceId(): string {
  if (!backgroundInstanceId) backgroundInstanceId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return backgroundInstanceId;
}

async function openAboutSectionAfterInstall(): Promise<void> {
  await openOrFocusExtensionAppTab({ route: '/settings?section=aboutme' });
}

export default defineBackground(async () => {
  await initializeLocale();
  const services = createBackgroundServices({ getInstanceId: getBackgroundInstanceId });

  const router = createBackgroundRouter({
    fallback: (msg) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  registerConversationHandlers(router, {
    onConversationChanged: (conversationId, reason) => services.autoSync.onConversationChanged(conversationId, reason),
  });
  registerItemMentionHandlers(router);
  registerChatWithBackgroundHandlers(router);
  registerArticleCommentsHandlers(router, {
    onConversationChanged: (conversationId, reason) => services.autoSync.onConversationChanged(conversationId, reason),
  });
  registerWebArticleHandlers(router, {
    onConversationChanged: (conversationId, reason) => services.autoSync.onConversationChanged(conversationId, reason),
  });
  registerChatgptDeepResearchHandlers(router);
  registerNotionSettingsHandlers(router, {
    notionSyncJobStore: services.notionSyncJobStore,
    conversationKinds: services.conversationKinds,
  });
  registerFeishuSettingsHandlers(router);
  registerObsidianSettingsHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    testObsidianConnection: (input) => services.obsidianSyncOrchestrator.testConnection(input),
  });
  registerUiMessageHandlers(router);
  registerSyncHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    notionSyncOrchestrator: services.notionSyncOrchestrator,
    obsidianSyncOrchestrator: services.obsidianSyncOrchestrator,
    feishuSyncOrchestrator: services.feishuSyncOrchestrator,
  });

  // Keep legacy "start" side-effects that are not message handlers.
  try {
    ensureDefaultNotionOAuthClientId().catch(() => {});
    ensureDefaultFeishuOAuthClientId().catch(() => {});
    ensureDefaultFeishuOAuthProxyUrl().catch(() => {});
    setupNotionOAuthNavigationListener();
    setupFeishuOAuthNavigationListener();
    registerClipperContextMenu();
    onInstalled((details) => {
      ensureDefaultNotionOAuthClientId().catch(() => {});
      ensureDefaultFeishuOAuthClientId().catch(() => {});
      ensureDefaultFeishuOAuthProxyUrl().catch(() => {});
      // Do not auto-open tabs after extension updates.
      if (details?.reason !== 'install') return;
      openAboutSectionAfterInstall().catch(() => {});
    });
  } catch (_e) {
    // ignore
  }

  try {
    const id = getBackgroundInstanceId();
    services?.notionSyncJobStore?.abortRunningJobIfFromOtherInstance?.(id, { forceAbort: true })?.catch?.(() => {});
    obsidianSyncJobStore.abortRunningJobIfFromOtherInstance(id, { forceAbort: true }).catch(() => {});
    feishuSyncJobStore.abortRunningJobIfFromOtherInstance(id, { forceAbort: true }).catch(() => {});
  } catch (_e) {
    // ignore
  }

  try {
    onAlarm((alarm) => {
      void services.autoSync.handleAlarm(String(alarm?.name || ''));
    });
  } catch (_e) {
    // ignore
  }

  // Best-effort flush for any overdue auto-sync queue items. This complements
  // alarms-based wakeups and helps after extension reload / background restart.
  try {
    void services.autoSync.notionScheduler.flush();
    void services.autoSync.obsidianScheduler.flush();
    void services.autoSync.feishuScheduler.flush();
  } catch (_e) {
    // ignore
  }

  router.start();
});
