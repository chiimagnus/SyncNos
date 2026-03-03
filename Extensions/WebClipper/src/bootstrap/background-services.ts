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

export type NotionSyncOrchestrator = {
  syncConversations: (input: { conversationIds?: unknown[]; instanceId: string }) => Promise<unknown>;
  getSyncJobStatus: (input: { instanceId: string }) => Promise<unknown>;
};

export type ObsidianSyncOrchestrator = {
  syncConversations: (input: {
    conversationIds?: unknown[];
    forceFullConversationIds?: unknown[];
    instanceId: string;
  }) => Promise<unknown>;
  getSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  testConnection: (input: { instanceId: string }) => Promise<unknown>;
};

export type BackgroundServices = {
  backgroundInpageWebVisibility: typeof backgroundInpageWebVisibility;
  articleFetchService: typeof articleFetchService;
  conversationKinds: typeof conversationKinds;
  notionSyncJobStore: typeof notionSyncJobStore;
  notionSyncOrchestrator: NotionSyncOrchestrator;
  obsidianSyncOrchestrator: ObsidianSyncOrchestrator;
};

export function createBackgroundServices(): BackgroundServices {
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
