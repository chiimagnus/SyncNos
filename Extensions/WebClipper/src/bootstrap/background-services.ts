import backgroundInpageWebVisibility from './background-inpage-web-visibility.ts';

import articleFetchService from '../collectors/web/article-fetch-service.ts';

import notionSyncJobStore from '../sync/notion/notion-sync-job-store.ts';
import { createNotionSyncOrchestrator } from '../sync/notion/notion-sync-orchestrator.ts';
import { getNotionOAuthToken } from '../sync/notion/auth/token-store';
import { backgroundStorage as notionBackgroundStorage } from '../conversations/background/storage';
import notionDbManager from '../sync/notion/notion-db-manager.ts';
import notionSyncService from '../sync/notion/notion-sync-service.ts';
import notionApi from '../sync/notion/notion-api.ts';
import notionFilesApi from '../sync/notion/notion-files-api.ts';

import {
  getSyncStatus as getObsidianSyncStatus,
  syncConversations as obsidianSyncConversations,
  testConnection as testObsidianConnection,
} from '../sync/obsidian/obsidian-sync-orchestrator.ts';

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
  const notionSyncOrchestrator = createNotionSyncOrchestrator({
    tokenStore: { getToken: getNotionOAuthToken },
    storage: notionBackgroundStorage,
    conversationKinds,
    notionApi,
    notionFilesApi,
    dbManager: notionDbManager,
    syncService: notionSyncService,
    jobStore: notionSyncJobStore,
  });

  return {
    backgroundInpageWebVisibility,
    articleFetchService,
    conversationKinds,
    notionSyncJobStore,
    notionSyncOrchestrator,
    obsidianSyncOrchestrator: {
      syncConversations: obsidianSyncConversations,
      getSyncStatus: async (input: { instanceId: string }) => getObsidianSyncStatus(input as any),
      testConnection: testObsidianConnection,
    },
  };
}
