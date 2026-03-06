import { registerConversationHandlers } from '../../src/conversations/background/handlers';
import { registerSyncHandlers } from '../../src/sync/background-handlers';
import { registerWebArticleHandlers } from '../../src/collectors/web/article-fetch-background-handlers';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { conversationKinds } from '../../src/protocols/conversation-kinds.ts';
import { registerUiMessageHandlers } from '../../src/platform/messaging/ui-background-handlers';
import notionSyncJobStore from '../../src/sync/notion/notion-sync-job-store.ts';
import {
  clearSyncJobStatus as clearNotionSyncJobStatus,
  getSyncJobStatus as getNotionSyncJobStatus,
  syncConversations as syncNotionConversations,
} from '../../src/sync/notion/notion-sync-orchestrator.ts';
import { registerNotionSettingsHandlers } from '../../src/sync/notion/settings-background-handlers';
import {
  clearSyncStatus as clearObsidianSyncStatus,
  getSyncStatus as getObsidianSyncStatus,
  syncConversations as obsidianSyncConversations,
  testConnection as testObsidianConnection,
} from '../../src/sync/obsidian/obsidian-sync-orchestrator.ts';
import { registerObsidianSettingsHandlers } from '../../src/sync/obsidian/settings-background-handlers';

export function createTestBackgroundRouter() {
  const instanceId = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  registerConversationHandlers(router);
  registerWebArticleHandlers(router);
  registerNotionSettingsHandlers(router, { notionSyncJobStore, conversationKinds });
  registerObsidianSettingsHandlers(router, { getInstanceId: () => instanceId, testObsidianConnection });
  registerUiMessageHandlers(router);
  registerSyncHandlers(router, {
    getInstanceId: () => instanceId,
    notionSyncOrchestrator: {
      syncConversations: syncNotionConversations,
      clearSyncJobStatus: clearNotionSyncJobStatus,
      getSyncJobStatus: getNotionSyncJobStatus,
    },
    obsidianSyncOrchestrator: {
      clearSyncStatus: clearObsidianSyncStatus,
      syncConversations: obsidianSyncConversations,
      getSyncStatus: getObsidianSyncStatus,
    },
  });

  return router;
}
