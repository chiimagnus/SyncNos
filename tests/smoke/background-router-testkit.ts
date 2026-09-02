import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { registerSyncHandlers } from '@services/sync/background-handlers';
import { registerWebArticleHandlers } from '../../src/collectors/web/article-fetch-background-handlers';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { conversationKinds } from '@services/protocols/conversation-kinds.ts';
import { registerUiMessageHandlers } from '../../src/platform/messaging/ui-background-handlers';
import { createNotionSyncOrchestrator } from '@services/sync/notion/notion-sync-orchestrator.ts';
import { getNotionOAuthToken } from '@services/sync/notion/auth/token-store';
import { backgroundStorage } from '@services/conversations/background/storage';
import * as notionDbManager from '@services/sync/notion/notion-db-manager.ts';
import { createSyncJobStore } from '@services/sync/sync-job-store';
import * as notionSyncService from '@services/sync/notion/notion-sync-service.ts';
import { registerNotionSettingsHandlers } from '@services/sync/notion/settings-background-handlers';
import {
  clearSyncStatus as clearObsidianSyncStatus,
  getSyncStatus as getObsidianSyncStatus,
  isRunActive as isObsidianRunActive,
  syncConversations as obsidianSyncConversations,
  testConnection as testObsidianConnection,
} from '@services/sync/obsidian/obsidian-sync-orchestrator.ts';
import { registerObsidianSettingsHandlers } from '@services/sync/obsidian/settings-background-handlers';

export function createTestBackgroundRouter(
  options: { onArticleConversationChanged?: (conversationId: number, reason: string) => void | Promise<void> } = {},
) {
  const instanceId = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  const notionSyncJobStore = createSyncJobStore('notion');
  const notionSyncOrchestrator = createNotionSyncOrchestrator({
    tokenStore: { getToken: getNotionOAuthToken },
    storage: backgroundStorage,
    conversationKinds,
    dbManager: notionDbManager,
    syncService: notionSyncService,
    jobStore: notionSyncJobStore,
  });

  registerConversationHandlers(router, {
    onConversationChanged: async () => {},
    onRemoteCleanupPending: async () => {},
  });
  registerWebArticleHandlers(router, { onConversationChanged: options.onArticleConversationChanged });
  registerNotionSettingsHandlers(router, {
    conversationKinds,
    runExclusiveMaintenance: notionSyncOrchestrator.runExclusiveMaintenance,
  });
  registerObsidianSettingsHandlers(router, { getInstanceId: () => instanceId, testObsidianConnection });
  registerUiMessageHandlers(router);
  registerSyncHandlers(router, {
    getInstanceId: () => instanceId,
    notionSyncOrchestrator,
    obsidianSyncOrchestrator: {
      clearSyncStatus: clearObsidianSyncStatus,
      syncConversations: obsidianSyncConversations,
      getSyncStatus: getObsidianSyncStatus,
      isRunActive: isObsidianRunActive,
    },
    feishuSyncOrchestrator: {
      getSyncStatus: async () => ({ provider: 'feishu', job: null }),
      clearSyncStatus: async () => ({ provider: 'feishu', job: null }),
      syncConversations: async () => ({ provider: 'feishu', okCount: 0, failCount: 0, results: [] }),
      isRunActive: () => false,
    },
    githubSyncOrchestrator: {
      getSyncStatus: async () => ({ job: null }),
      clearSyncStatus: async () => ({ job: null }),
      sync: async () => ({ summary: { syncedCount: 0, failedCount: 0 } }),
      isRunActive: () => false,
    },
  });

  return router;
}
