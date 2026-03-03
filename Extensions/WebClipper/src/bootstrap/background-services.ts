import backgroundInpageWebVisibility from './background-inpage-web-visibility.ts';

import articleFetchService from '../collectors/web/article-fetch-service.ts';

import notionSyncJobStore from '../sync/notion/notion-sync-job-store.ts';
import {
  getSyncJobStatus as getNotionSyncJobStatus,
  syncConversations as syncNotionConversations,
} from '../sync/notion/notion-sync-orchestrator.ts';

import {
  getObsidianSyncStatus,
  obsidianSyncConversations,
  testObsidianConnection,
} from '../sync/obsidian/orchestrator.ts';

import { conversationKinds } from '../protocols/conversation-kinds.ts';

export function createBackgroundServices() {
  return {
    backgroundInpageWebVisibility,
    articleFetchService,
    conversationKinds,
    notionSyncJobStore,
    notionSyncOrchestrator: {
      syncConversations: (input: { conversationIds?: unknown[]; instanceId: string }) =>
        syncNotionConversations({ conversationIds: input.conversationIds, instanceId: input.instanceId } as any),
      getSyncJobStatus: getNotionSyncJobStatus,
    },
    obsidianSyncOrchestrator: {
      syncConversations: obsidianSyncConversations,
      getSyncStatus: getObsidianSyncStatus,
      testConnection: testObsidianConnection,
    },
  };
}

export type BackgroundServices = ReturnType<typeof createBackgroundServices>;
