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
import githubSyncJobStore from '@services/sync/github/github-sync-job-store';
import { registerNotionSettingsHandlers } from '@services/sync/notion/settings-background-handlers';
import { registerObsidianSettingsHandlers } from '@services/sync/obsidian/settings-background-handlers';
import { registerFeishuSettingsHandlers } from '@services/sync/feishu/settings-background-handlers';
import { onInstalled } from '@platform/runtime/runtime';
import { openOrFocusExtensionAppTab } from '@platform/webext/extension-app';
import { registerClipperContextMenu } from '@platform/context-menus/clipper-context-menu';
import { onAlarm } from '@platform/alarms/alarms';
import { initializeLocale } from '@i18n';
import { storageOnChanged } from '@platform/storage/local';
import { GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY } from '@services/sync/auto-sync/auto-sync-keys';
import { syncProviderEnabledStorageKey } from '@services/sync/sync-provider-gate';

let backgroundInstanceId: string | null = null;
function getBackgroundInstanceId(): string {
  if (!backgroundInstanceId) backgroundInstanceId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return backgroundInstanceId;
}

async function openAboutSectionAfterInstall(): Promise<void> {
  await openOrFocusExtensionAppTab({ route: '/settings?section=aboutme' });
}

function runBestEffort(task: () => unknown | Promise<unknown>): void {
  try {
    void Promise.resolve(task()).catch(() => {});
  } catch (_error) {
    // Startup and optional listener recovery must stay isolated from siblings.
  }
}

export default defineBackground(() => {
  const localeReady = initializeLocale();
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
    onRemoteCleanupPending: () => services.autoSync.onRemoteCleanupPending(),
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
  registerUiMessageHandlers(router, { localeReady });
  registerSyncHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    notionSyncOrchestrator: services.notionSyncOrchestrator,
    obsidianSyncOrchestrator: services.obsidianSyncOrchestrator,
    feishuSyncOrchestrator: services.feishuSyncOrchestrator,
    githubSyncOrchestrator: services.githubSyncOrchestrator,
  });

  router.start();

  try {
    setupNotionOAuthNavigationListener();
  } catch (_e) {
    // optional listener registration must not block sibling listeners
  }
  try {
    setupFeishuOAuthNavigationListener();
  } catch (_e) {
    // optional listener registration must not block sibling listeners
  }
  try {
    registerClipperContextMenu({ localeReady });
  } catch (_e) {
    // optional listener registration must not block sibling listeners
  }
  try {
    onInstalled((details) => {
      ensureDefaultNotionOAuthClientId().catch(() => {});
      ensureDefaultFeishuOAuthClientId().catch(() => {});
      ensureDefaultFeishuOAuthProxyUrl().catch(() => {});
      // Do not auto-open tabs after extension updates.
      if (details?.reason !== 'install') return;
      openAboutSectionAfterInstall().catch(() => {});
    });
  } catch (_e) {
    // optional listener registration must not block sibling listeners
  }
  try {
    onAlarm((alarm) => {
      void services.autoSync.handleAlarm(String(alarm?.name || ''));
    });
  } catch (_e) {
    // optional listener registration must not block sibling listeners
  }
  try {
    const githubProviderEnabledKey = syncProviderEnabledStorageKey('github');
    storageOnChanged((changes, areaName) => {
      if (areaName !== 'local' || !changes || typeof changes !== 'object') return;
      const autoChange = (changes as any)[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY];
      const providerChange = (changes as any)[githubProviderEnabledKey];
      const autoBecameEnabled = Boolean(autoChange) && autoChange.newValue === true;
      const providerBecameEnabled = Boolean(providerChange) && providerChange.newValue !== false;
      if (!autoBecameEnabled && !providerBecameEnabled) return;
      runBestEffort(() => services.autoSync.githubScheduler.scheduleCleanup());
    });
  } catch (_e) {
    // optional listener registration must not block sibling listeners
  }

  void ensureDefaultNotionOAuthClientId().catch(() => {});
  void ensureDefaultFeishuOAuthClientId().catch(() => {});
  void ensureDefaultFeishuOAuthProxyUrl().catch(() => {});

  const id = getBackgroundInstanceId();
  runBestEffort(() => services.notionSyncJobStore.abortRunningJobIfFromOtherInstance(id, { forceAbort: true }));
  runBestEffort(() => obsidianSyncJobStore.abortRunningJobIfFromOtherInstance(id, { forceAbort: true }));
  runBestEffort(() => feishuSyncJobStore.abortRunningJobIfFromOtherInstance(id, { forceAbort: true }));
  runBestEffort(() => githubSyncJobStore.abortRunningJobIfFromOtherInstance(id, { forceAbort: true }));

  // Best-effort recovery complements alarm wakeups after MV3 worker reloads.
  // Each provider is isolated so one synchronous or asynchronous failure cannot
  // prevent sibling queues from recovering.
  runBestEffort(() => services.autoSync.notionScheduler.flush());
  runBestEffort(() => services.autoSync.obsidianScheduler.flush());
  runBestEffort(() => services.autoSync.feishuScheduler.flush());
  runBestEffort(() => services.autoSync.githubScheduler.flush());
  runBestEffort(() => services.autoSync.githubScheduler.flushCleanup());
});
