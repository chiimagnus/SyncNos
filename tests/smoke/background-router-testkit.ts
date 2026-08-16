import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import { registerSyncHandlers } from '@services/sync/background-handlers';
import { registerWebArticleHandlers } from '../../src/collectors/web/article-fetch-background-handlers';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { conversationKinds } from '@services/protocols/conversation-kinds.ts';
import { registerUiMessageHandlers } from '../../src/platform/messaging/ui-background-handlers';
import { registerChatWithBackgroundHandlers } from '../../src/services/integrations/chatwith/chatwith-background-handlers';
import notionSyncJobStore from '@services/sync/notion/notion-sync-job-store.ts';
import { createBackgroundServices } from '@services/bootstrap/background-services';
import { registerNotionSettingsHandlers } from '@services/sync/notion/settings-background-handlers';
import { registerObsidianSettingsHandlers } from '@services/sync/obsidian/settings-background-handlers';

export function createTestBackgroundRouter() {
  const instanceId = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const gate = new FactsOperationGate({
    readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
  });
  const initialized = gate.initializeFromJournal();
  const runWithLease = async (kind: string, read: (backend: any) => Promise<unknown>, repository: unknown) => {
    await initialized;
    return await gate.runFactsOperation(
      kind,
      async (lease) => await read({ factsEpoch: 'idb-v1', lease, mode: 'idb', repository }),
    );
  };

  const services = createBackgroundServices({ getInstanceId: () => instanceId, factsOperations: gate });

  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  registerConversationHandlers(router, {
    conversationReadRunner: {
      run: async ({ kind, read }: any) =>
        await runWithLease(kind, read, {
          findConversationById: async () => null,
          findConversationBySourceAndKey: async () => null,
          getConversationByReference: async () => null,
          getConversationDetail: async () => ({ conversationId: 1, messages: [] }),
          getConversationListBootstrap: async () => ({
            items: [],
            cursor: null,
            hasMore: false,
            summary: { totalCount: 0, todayCount: 0 },
            facets: { sources: [], sites: [] },
          }),
          getConversationListPage: async () => ({
            items: [],
            cursor: null,
            hasMore: false,
            summary: { totalCount: 0, todayCount: 0 },
            facets: { sources: [], sites: [] },
          }),
          getConversationTailWindow: async () => ({ conversationId: 1, messages: [] }),
          searchConversationMentionCandidates: async () => ({
            candidates: [],
            scannedCount: 0,
            truncatedByScanLimit: false,
          }),
        }),
    },
    onConversationChanged: async () => {},
    streamRouter: { register: () => {} },
  });
  let articleConversation: any = null;
  registerWebArticleHandlers(router, {
    conversationReadRunner: {
      run: async ({ kind, read }: any) =>
        await runWithLease(kind, read, {
          getConversationByReference: async () => articleConversation,
          syncConversationMessages: async () => ({ deleted: 0, upserted: 0 }),
          upsertConversation: async (conversation: any) => {
            articleConversation = { ...conversation, id: 1 };
            return articleConversation;
          },
        }),
    },
    onConversationChanged: async () => {},
  });
  registerChatWithBackgroundHandlers(router);
  registerNotionSettingsHandlers(router, { notionSyncJobStore, conversationKinds });
  registerObsidianSettingsHandlers(router, {
    getInstanceId: () => instanceId,
    testObsidianConnection: services.obsidianSyncOrchestrator.testConnection,
  });
  registerUiMessageHandlers(router);
  registerSyncHandlers(router, {
    getInstanceId: () => instanceId,
    factsOperations: gate,
    notionSyncOrchestrator: services.notionSyncOrchestrator,
    obsidianSyncOrchestrator: services.obsidianSyncOrchestrator,
    feishuSyncOrchestrator: services.feishuSyncOrchestrator,
  });

  return router;
}
