import { createBackgroundServices } from '@services/bootstrap/background-services.ts';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { registerDataRevisionHandlers } from '@services/data-revisions/background-handlers';
import { registerSyncHandlers } from '@services/sync/background-handlers';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerWebArticleHandlers } from '@collectors/web/article-fetch-background-handlers';
import { registerChatgptDeepResearchHandlers } from '@collectors/chatgpt/chatgpt-deep-research-background-handlers';
import { registerChatgptImageHandlers } from '@services/integrations/chatgpt/image-background-handlers';
import { registerUiMessageHandlers } from '@platform/messaging/ui-background-handlers';
import { registerArticleCommentsHandlers } from '@services/comments/background/handlers';
import { registerItemMentionHandlers } from '@services/integrations/item-mention/background-handlers';
import { setupNotionOAuthNavigationListener } from '@services/sync/notion/auth/oauth';
import { setupFeishuOAuthNavigationListener } from '@services/sync/feishu/auth/oauth';
import { registerNotionSettingsHandlers } from '@services/sync/notion/settings-background-handlers';
import { registerObsidianSettingsHandlers } from '@services/sync/obsidian/settings-background-handlers';
import { registerFeishuSettingsHandlers } from '@services/sync/feishu/settings-background-handlers';
import { registerGithubSettingsHandlers } from '@services/sync/github/settings-background-handlers';
import { onInstalled } from '@platform/runtime/runtime';
import { openOrFocusExtensionAppTab } from '@platform/webext/extension-app';
import { registerClipperContextMenu } from '@platform/context-menus/clipper-context-menu';
import { onAlarm } from '@platform/alarms/alarms';
import { initializeLocale } from '@i18n';
import { storageOnChanged } from '@platform/storage/local';
import { GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY } from '@services/sync/auto-sync/auto-sync-keys';
import { syncProviderEnabledStorageKey } from '@services/sync/sync-provider-gate';
import { readEffectiveInpageDisplayMode, setCanonicalInpageDisplayMode } from '@services/shared/inpage-display-mode';
import { startCliNativeBridge } from '@services/cli/native-bridge';
import { registerPublicSettingsHandlers } from '@services/settings/background-handlers';
import { registerOpenTargetHandlers } from '@services/integrations/openin/background-handlers';
import { registerBackgroundKeyboardShortcuts } from '@services/bootstrap/background-keyboard-shortcuts';
import { readBackgroundRecoveryProbe } from '@services/bootstrap/background-recovery-probe';

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
  const ensureBackgroundLocaleReady = () => initializeLocale();
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
    scheduleImageBackfill: (conversationId) =>
      services.autoSync.imageBackfillScheduler.enqueue(conversationId, 'chat_image'),
  });
  registerDataRevisionHandlers(router);
  registerItemMentionHandlers(router);
  registerArticleCommentsHandlers(router, {
    onConversationChanged: (conversationId, reason) => services.autoSync.onConversationChanged(conversationId, reason),
  });
  registerWebArticleHandlers(router, {
    onConversationChanged: (conversationId, reason) => services.autoSync.onConversationChanged(conversationId, reason),
  });
  registerChatgptDeepResearchHandlers(router);
  registerChatgptImageHandlers(router);
  registerNotionSettingsHandlers(router, {
    runExclusiveMaintenance: services.notionSyncOrchestrator.runExclusiveMaintenance,
  });
  registerFeishuSettingsHandlers(router, {
    runExclusiveMaintenance: services.feishuSyncOrchestrator.runExclusiveMaintenance,
  });
  registerObsidianSettingsHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    testObsidianConnection: (input) => services.obsidianSyncOrchestrator.testConnection(input),
  });
  registerGithubSettingsHandlers(router, {
    runExclusiveMaintenance: services.githubSyncOrchestrator.runExclusiveMaintenance,
  });
  registerUiMessageHandlers(router, { ensureLocaleReady: ensureBackgroundLocaleReady });
  registerPublicSettingsHandlers(router);
  registerOpenTargetHandlers(router);
  registerSyncHandlers(router, {
    getInstanceId: getBackgroundInstanceId,
    notionSyncOrchestrator: services.notionSyncOrchestrator,
    obsidianSyncOrchestrator: services.obsidianSyncOrchestrator,
    feishuSyncOrchestrator: services.feishuSyncOrchestrator,
    githubSyncOrchestrator: services.githubSyncOrchestrator,
  });
  registerBackgroundKeyboardShortcuts({
    dispatchMessage: (message) => router.dispatch(message),
    openApp: () => openOrFocusExtensionAppTab({ route: '/' }),
  });

  router.start();

  startCliNativeBridge(router);
  setupNotionOAuthNavigationListener();
  setupFeishuOAuthNavigationListener();

  const contextMenuController = registerClipperContextMenu({
    ensureReady: ensureBackgroundLocaleReady,
    readDisplayMode: readEffectiveInpageDisplayMode,
    setDisplayMode: setCanonicalInpageDisplayMode,
  });

  onInstalled((details) => {
    const reason = String(details?.reason || '');
    if (reason === 'install' || reason === 'update') {
      runBestEffort(() => contextMenuController.installOrRefresh());
    }
    if (reason === 'install') {
      runBestEffort(() => openAboutSectionAfterInstall());
    }
  });

  onAlarm((alarm) => {
    void services.autoSync.handleAlarm(String(alarm?.name || ''));
  });

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

  const providerRecovery = {
    notion: {
      isRunActive: () => services.notionSyncOrchestrator.isRunActive(),
      reconcile: () => services.notionSyncOrchestrator.reconcileStartupSyncJob(),
      flush: () => services.autoSync.notionScheduler.flush(),
    },
    obsidian: {
      isRunActive: () => services.obsidianSyncOrchestrator.isRunActive(),
      reconcile: () => services.obsidianSyncOrchestrator.reconcileStartupSyncJob(),
      flush: () => services.autoSync.obsidianScheduler.flush(),
    },
    feishu: {
      isRunActive: () => services.feishuSyncOrchestrator.isRunActive(),
      reconcile: () => services.feishuSyncOrchestrator.reconcileStartupSyncJob(),
      flush: () => services.autoSync.feishuScheduler.flush(),
    },
    github: {
      isRunActive: () => services.githubSyncOrchestrator.isRunActive(),
      reconcile: () => services.githubSyncOrchestrator.reconcileStartupSyncJob(),
      flush: () => services.autoSync.githubScheduler.flush(),
    },
  } as const;

  type RecoveryProvider = keyof typeof providerRecovery;
  const recoveryProviders = Object.keys(providerRecovery) as RecoveryProvider[];

  const recoverProviderJob = (provider: RecoveryProvider) => {
    const recovery = providerRecovery[provider];
    runBestEffort(async () => {
      if (recovery.isRunActive()) return;
      await recovery.reconcile();
    });
  };

  const recoverAllStartupWork = () => {
    for (const provider of recoveryProviders) recoverProviderJob(provider);
    for (const provider of recoveryProviders) runBestEffort(providerRecovery[provider].flush);
    runBestEffort(() => services.autoSync.githubScheduler.flushCleanup());
    runBestEffort(() => services.autoSync.imageBackfillScheduler.flush());
  };

  const recoverStartup = async () => {
    let probe;
    try {
      probe = await readBackgroundRecoveryProbe();
    } catch (_error) {
      recoverAllStartupWork();
      return;
    }

    for (const provider of recoveryProviders) {
      const providerProbe = probe.providers[provider];
      const runningJob = providerProbe.runningJob;
      if (runningJob && runningJob.instanceId !== getBackgroundInstanceId()) recoverProviderJob(provider);
      if (providerProbe.hasQueuedWork) runBestEffort(providerRecovery[provider].flush);
    }
    if (probe.githubCleanupEnabled) runBestEffort(() => services.autoSync.githubScheduler.flushCleanup());
    if (probe.imageBackfillHasQueuedWork) runBestEffort(() => services.autoSync.imageBackfillScheduler.flush());
  };

  runBestEffort(() => recoverStartup());
});
