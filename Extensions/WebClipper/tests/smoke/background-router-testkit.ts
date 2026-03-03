import { registerConversationHandlers } from '../../src/conversations/background-handlers';
import { registerSettingsHandlers } from '../../src/settings/background-handlers';
import { registerSyncHandlers } from '../../src/sync/background-handlers';
import { registerWebArticleHandlers } from '../../src/collectors/web/article-fetch-background-handlers';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { conversationKinds } from '../../src/protocols/conversation-kinds.ts';
import notionSyncJobStore from '../../src/sync/notion/notion-sync-job-store.ts';
import {
  getSyncJobStatus as getNotionSyncJobStatus,
  syncConversations as syncNotionConversations,
} from '../../src/sync/notion/notion-sync-orchestrator.ts';
import {
  getSyncStatus as getObsidianSyncStatus,
  syncConversations as obsidianSyncConversations,
  testConnection as testObsidianConnection,
} from '../../src/sync/obsidian/obsidian-sync-orchestrator.ts';
import backgroundInpageWebVisibility from '../../src/bootstrap/background-inpage-web-visibility.ts';

export function createTestBackgroundRouter() {
  const instanceId = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  router.register('__WXT_PING__', async () => {
    return router.ok({ pong: true, instanceId });
  });

  registerConversationHandlers(router);
  registerWebArticleHandlers(router);
  registerSettingsHandlers(router, {
    getInstanceId: () => instanceId,
    testObsidianConnection,
    notionSyncJobStore,
    conversationKinds,
    backgroundInpageWebVisibility,
  });
  registerSyncHandlers(router, {
    getInstanceId: () => instanceId,
    notionSyncOrchestrator: {
      syncConversations: syncNotionConversations,
      getSyncJobStatus: getNotionSyncJobStatus,
    },
    obsidianSyncOrchestrator: {
      syncConversations: obsidianSyncConversations,
      getSyncStatus: getObsidianSyncStatus,
    },
  });

  return router;
}
