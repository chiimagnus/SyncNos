import articleFetchService from '@collectors/web/article-fetch-service.ts';

import { createSyncJobStore } from '@services/sync/sync-job-store';
import { createNotionSyncOrchestrator } from '@services/sync/notion/notion-sync-orchestrator.ts';
import { getNotionOAuthToken } from '@services/sync/notion/auth/token-store';
import { backgroundStorage as notionBackgroundStorage } from '@services/conversations/background/storage';
import notionDbManager from '@services/sync/notion/notion-db-manager.ts';
import notionSyncService from '@services/sync/notion/notion-sync-service.ts';

import {
  clearSyncStatus as clearObsidianSyncStatus,
  getSyncStatus as getObsidianSyncStatus,
  syncConversations as obsidianSyncConversations,
  testConnection as testObsidianConnection,
} from '@services/sync/obsidian/obsidian-sync-orchestrator.ts';

import {
  clearSyncStatus as clearFeishuSyncStatus,
  getSyncStatus as getFeishuSyncStatus,
  syncConversations as feishuSyncConversations,
} from '@services/sync/feishu/feishu-sync-orchestrator.ts';
import { createGithubSyncOrchestrator } from '@services/sync/github/github-sync-orchestrator';

import { conversationKinds } from '@services/protocols/conversation-kinds.ts';
import {
  createNotionAutoSyncScheduler,
  type NotionAutoSyncScheduler,
} from '@services/sync/auto-sync/notion-auto-sync-scheduler';
import {
  createObsidianAutoSyncScheduler,
  type ObsidianAutoSyncScheduler,
} from '@services/sync/auto-sync/obsidian-auto-sync-scheduler';
import {
  createFeishuAutoSyncScheduler,
  type FeishuAutoSyncScheduler,
} from '@services/sync/auto-sync/feishu-auto-sync-scheduler';
import {
  createGithubAutoSyncScheduler,
  type GithubAutoSyncScheduler,
} from '@services/sync/auto-sync/github-auto-sync-scheduler';
import {
  FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
  FEISHU_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME,
  GITHUB_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
  NOTION_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
  type AutoSyncConversationChangedReason,
} from '@services/sync/auto-sync/auto-sync-keys';
import { storageGet } from '@services/shared/storage';

export type NotionSyncOrchestrator = {
  syncConversations: (input: { conversationIds?: unknown[]; instanceId: string }) => Promise<unknown>;
  getSyncJobStatus: (input: { instanceId: string }) => Promise<unknown>;
  clearSyncJobStatus: (input: { instanceId: string }) => Promise<unknown>;
};

export type ObsidianSyncOrchestrator = {
  syncConversations: (input: {
    conversationIds?: unknown[];
    forceFullConversationIds?: unknown[];
    instanceId: string;
  }) => Promise<unknown>;
  getSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  clearSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  testConnection: (input: { instanceId: string }) => Promise<unknown>;
};

export type FeishuSyncOrchestrator = {
  syncConversations: (input: { conversationIds?: unknown[]; instanceId: string }) => Promise<unknown>;
  getSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  clearSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
};

export type GithubSyncOrchestrator = ReturnType<typeof createGithubSyncOrchestrator>;

export type BackgroundServices = {
  articleFetchService: typeof articleFetchService;
  conversationKinds: typeof conversationKinds;
  notionSyncOrchestrator: NotionSyncOrchestrator;
  obsidianSyncOrchestrator: ObsidianSyncOrchestrator;
  feishuSyncOrchestrator: FeishuSyncOrchestrator;
  githubSyncOrchestrator: GithubSyncOrchestrator;
  autoSync: {
    notionScheduler: NotionAutoSyncScheduler;
    obsidianScheduler: ObsidianAutoSyncScheduler;
    feishuScheduler: FeishuAutoSyncScheduler;
    githubScheduler: GithubAutoSyncScheduler;
    onConversationChanged: (conversationId: number, reason: AutoSyncConversationChangedReason) => Promise<void>;
    onRemoteCleanupPending: () => Promise<void>;
    handleAlarm: (name: string) => Promise<void>;
  };
};

export function createBackgroundServices(deps: { getInstanceId: () => string }): BackgroundServices {
  const notionSyncJobStore = createSyncJobStore('notion');
  const notionSyncOrchestrator = createNotionSyncOrchestrator({
    tokenStore: { getToken: getNotionOAuthToken },
    storage: notionBackgroundStorage,
    conversationKinds,
    dbManager: notionDbManager,
    syncService: notionSyncService,
    jobStore: notionSyncJobStore,
  });

  const obsidianSyncOrchestrator: ObsidianSyncOrchestrator = {
    syncConversations: obsidianSyncConversations,
    getSyncStatus: getObsidianSyncStatus,
    clearSyncStatus: clearObsidianSyncStatus,
    testConnection: testObsidianConnection,
  };
  const feishuSyncOrchestrator: FeishuSyncOrchestrator = {
    syncConversations: feishuSyncConversations,
    getSyncStatus: getFeishuSyncStatus,
    clearSyncStatus: clearFeishuSyncStatus,
  };
  const githubSyncOrchestrator = createGithubSyncOrchestrator();

  const notionScheduler = createNotionAutoSyncScheduler({
    getInstanceId: deps.getInstanceId,
    notionSyncOrchestrator,
  });
  const obsidianScheduler = createObsidianAutoSyncScheduler({
    getInstanceId: deps.getInstanceId,
    obsidianSyncOrchestrator,
  });
  const feishuScheduler = createFeishuAutoSyncScheduler({
    getInstanceId: deps.getInstanceId,
    feishuSyncOrchestrator,
  });
  const githubScheduler = createGithubAutoSyncScheduler({ getInstanceId: deps.getInstanceId, githubSyncOrchestrator });

  return {
    articleFetchService,
    conversationKinds,
    notionSyncOrchestrator,
    githubSyncOrchestrator,
    autoSync: {
      notionScheduler,
      obsidianScheduler,
      feishuScheduler,
      githubScheduler,
      onConversationChanged: async (conversationId: number, reason: AutoSyncConversationChangedReason) => {
        const local = await storageGet([
          NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
          OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
          FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
          GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
        ]).catch(() => ({}));
        if ((local as any)?.[NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY] === true) {
          void notionScheduler.enqueue(conversationId, reason);
        }
        if ((local as any)?.[OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY] === true) {
          void obsidianScheduler.enqueue(conversationId, reason);
        }
        if ((local as any)?.[FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY] === true) {
          void feishuScheduler.enqueue(conversationId, reason);
        }
        if ((local as any)?.[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] === true) {
          void githubScheduler.enqueue(conversationId, reason);
        }
      },
      onRemoteCleanupPending: async () => {
        await githubScheduler.scheduleCleanup();
      },
      handleAlarm: async (name: string) => {
        const alarmName = String(name || '').trim();
        if (alarmName === NOTION_AUTO_SYNC_DEBOUNCE_ALARM_NAME) {
          await notionScheduler.flush();
          return;
        }
        if (alarmName === OBSIDIAN_AUTO_SYNC_DEBOUNCE_ALARM_NAME) {
          await obsidianScheduler.flush();
          return;
        }
        if (alarmName === FEISHU_AUTO_SYNC_DEBOUNCE_ALARM_NAME) {
          await feishuScheduler.flush();
          return;
        }
        if (alarmName === GITHUB_AUTO_SYNC_DEBOUNCE_ALARM_NAME) {
          await githubScheduler.flush();
          return;
        }
        if (alarmName === GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME) {
          await githubScheduler.flushCleanup();
        }
      },
    },
    obsidianSyncOrchestrator,
    feishuSyncOrchestrator,
  };
}
