import articleFetchService from '@collectors/web/article-fetch-service.ts';

import notionSyncJobStore from '@services/sync/notion/notion-sync-job-store.ts';
import { createNotionSyncOrchestrator } from '@services/sync/notion/notion-sync-orchestrator.ts';
import { getNotionOAuthToken } from '@services/sync/notion/auth/token-store';
import notionDbManager from '@services/sync/notion/notion-db-manager.ts';
import notionSyncService from '@services/sync/notion/notion-sync-service.ts';
import notionApi from '@services/sync/notion/notion-api.ts';
import notionFilesApi from '@services/sync/notion/notion-files-api.ts';

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
  FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
  FEISHU_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  NOTION_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
  type AutoSyncConversationChangedReason,
} from '@services/sync/auto-sync/auto-sync-keys';
import type { ResolvedAutoSyncQueueEntry } from '@services/sync/auto-sync/auto-sync-scheduler-core';
import { storageGet } from '@services/shared/storage';
import { createBackgroundStorage } from '@services/conversations/background/storage';
import { openConversationReadRepository } from '@services/conversations/data/storage';
import type { ResolvedConversationReference } from '@services/conversations/data/storage-native';
import { LocalDataContractError, type StableConversationReference } from '@services/local-data/contracts';
import type { FactsOperationLease } from '@services/local-data/facts-operation-gate';

export type FactsOperationRunner = Readonly<{
  runFactsOperation: <T>(kind: string, fn: (lease: FactsOperationLease) => Promise<T> | T) => Promise<T>;
}>;

export type NotionSyncOrchestrator = {
  syncConversations: (input: {
    conversations: ResolvedConversationReference[];
    instanceId: string;
    lease: FactsOperationLease;
  }) => Promise<unknown>;
  getSyncJobStatus: (input: { instanceId: string }) => Promise<unknown>;
  clearSyncJobStatus: (input: { instanceId: string }) => Promise<unknown>;
};

export type ObsidianSyncOrchestrator = {
  syncConversations: (input: {
    conversations: ResolvedConversationReference[];
    forceFullConversations?: ResolvedConversationReference[];
    instanceId: string;
    lease: FactsOperationLease;
  }) => Promise<unknown>;
  getSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  clearSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  testConnection: (input: { instanceId: string }) => Promise<unknown>;
};

export type FeishuSyncOrchestrator = {
  syncConversations: (input: {
    conversations: ResolvedConversationReference[];
    instanceId: string;
    lease: FactsOperationLease;
  }) => Promise<unknown>;
  getSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  clearSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
};

export type BackgroundServices = {
  resolveConversationReferences: (
    expectedFactsEpoch: string,
    references: readonly StableConversationReference[],
    lease: FactsOperationLease,
  ) => Promise<ResolvedConversationReference[]>;
  articleFetchService: typeof articleFetchService;
  conversationKinds: typeof conversationKinds;
  notionSyncJobStore: typeof notionSyncJobStore;
  notionSyncOrchestrator: NotionSyncOrchestrator;
  obsidianSyncOrchestrator: ObsidianSyncOrchestrator;
  feishuSyncOrchestrator: FeishuSyncOrchestrator;
  autoSync: {
    notionScheduler: NotionAutoSyncScheduler;
    obsidianScheduler: ObsidianAutoSyncScheduler;
    feishuScheduler: FeishuAutoSyncScheduler;
    onConversationChanged: (
      reference: StableConversationReference,
      reason: AutoSyncConversationChangedReason,
      lease: FactsOperationLease,
    ) => Promise<void>;
    handleAlarm: (name: string) => Promise<void>;
  };
};

function stableReference(value: unknown): StableConversationReference | null {
  const source = String((value as any)?.source || '').trim();
  const conversationKey = String((value as any)?.conversationKey || '').trim();
  return source && conversationKey ? { source, conversationKey } : null;
}

export function createBackgroundServices(deps: {
  getInstanceId: () => string;
  factsOperations: FactsOperationRunner;
}): BackgroundServices {
  const runFactsOperation = deps.factsOperations.runFactsOperation.bind(deps.factsOperations);

  const resolveConversationReferences = async (
    expectedFactsEpoch: string,
    references: readonly StableConversationReference[],
    lease: FactsOperationLease,
  ): Promise<ResolvedConversationReference[]> => {
    const bound = await openConversationReadRepository(lease, expectedFactsEpoch);
    const out: ResolvedConversationReference[] = [];
    for (const reference of references) {
      const conversation = await bound.repository.getConversationByReference(reference);
      const current = stableReference(conversation);
      const conversationId = Number(conversation?.id);
      if (
        !current ||
        current.source !== reference.source ||
        current.conversationKey !== reference.conversationKey ||
        !Number.isSafeInteger(conversationId) ||
        conversationId <= 0
      ) {
        throw new LocalDataContractError('STALE_REFERENCE');
      }
      out.push({ ...current, conversationId });
    }
    return out;
  };

  const resolveConversationId = async (
    reference: StableConversationReference,
    lease: FactsOperationLease,
  ): Promise<number | null> => {
    const bound = await openConversationReadRepository(lease);
    const conversation = await bound.repository.getConversationByReference(reference);
    if (!conversation) return null;
    const current = stableReference(conversation);
    const conversationId = Number(conversation.id);
    if (
      !current ||
      current.source !== reference.source ||
      current.conversationKey !== reference.conversationKey ||
      !Number.isSafeInteger(conversationId) ||
      conversationId <= 0
    ) {
      return null;
    }
    return conversationId;
  };

  const canConvertLegacyQueue = async (lease: FactsOperationLease): Promise<boolean> =>
    (await openConversationReadRepository(lease)).mode === 'idb';

  const resolveLegacyConversationId = async (
    conversationId: number,
    lease: FactsOperationLease,
  ): Promise<StableConversationReference | null> => {
    const bound = await openConversationReadRepository(lease);
    if (bound.mode !== 'idb' || !bound.repository.findConversationById) return null;
    const conversation = await bound.repository.findConversationById(conversationId);
    return stableReference(conversation);
  };

  const notionSyncOrchestrator: NotionSyncOrchestrator = {
    syncConversations: async ({ conversations, instanceId, lease }) => {
      const storage = await createBackgroundStorage(lease, { provider: 'notion' });
      const orchestrator = createNotionSyncOrchestrator({
        tokenStore: { getToken: getNotionOAuthToken },
        storage,
        conversationKinds,
        notionApi,
        notionFilesApi,
        dbManager: notionDbManager,
        syncService: notionSyncService,
        jobStore: notionSyncJobStore,
      });
      return await orchestrator.syncConversations({ conversations, instanceId });
    },
    getSyncJobStatus: async ({ instanceId }) => {
      const job = await notionSyncJobStore.abortRunningJobIfFromOtherInstance(instanceId, { forceAbort: true });
      return { provider: 'notion', job, instanceId };
    },
    clearSyncJobStatus: async ({ instanceId }) => {
      await notionSyncJobStore.setJob(null);
      return { provider: 'notion', job: null, instanceId };
    },
  };

  const obsidianSyncOrchestrator: ObsidianSyncOrchestrator = {
    syncConversations: async ({ conversations, forceFullConversations, instanceId, lease }) =>
      await obsidianSyncConversations({
        conversations,
        ...(forceFullConversations?.length ? { forceFullConversations } : {}),
        instanceId,
        storage: await createBackgroundStorage(lease, { provider: 'obsidian' }),
      }),
    getSyncStatus: async ({ instanceId }) => await getObsidianSyncStatus({ instanceId }),
    clearSyncStatus: async ({ instanceId }) => await clearObsidianSyncStatus({ instanceId }),
    testConnection: async ({ instanceId }) => await testObsidianConnection({ instanceId }),
  };

  const feishuSyncOrchestrator: FeishuSyncOrchestrator = {
    syncConversations: async ({ conversations, instanceId, lease }) =>
      await feishuSyncConversations({
        conversations,
        instanceId,
        storage: await createBackgroundStorage(lease, { provider: 'feishu' }),
      }),
    getSyncStatus: async ({ instanceId }) => await getFeishuSyncStatus({ instanceId }),
    clearSyncStatus: async ({ instanceId }) => await clearFeishuSyncStatus({ instanceId }),
  };

  const toResolved = (entries: ResolvedAutoSyncQueueEntry[]): ResolvedConversationReference[] =>
    entries.map(({ source, conversationKey, conversationId }) => ({ source, conversationKey, conversationId }));

  const notionScheduler = createNotionAutoSyncScheduler({
    getInstanceId: deps.getInstanceId,
    runFactsOperation,
    resolveConversationId,
    resolveLegacyConversationId,
    canConvertLegacyQueue,
    syncConversations: async (entries, instanceId, lease) => {
      await notionSyncOrchestrator.syncConversations({ conversations: toResolved(entries), instanceId, lease });
    },
  });
  const obsidianScheduler = createObsidianAutoSyncScheduler({
    getInstanceId: deps.getInstanceId,
    runFactsOperation,
    resolveConversationId,
    resolveLegacyConversationId,
    canConvertLegacyQueue,
    syncConversations: async (entries, instanceId, lease) => {
      await obsidianSyncOrchestrator.syncConversations({ conversations: toResolved(entries), instanceId, lease });
    },
  });
  const feishuScheduler = createFeishuAutoSyncScheduler({
    getInstanceId: deps.getInstanceId,
    runFactsOperation,
    resolveConversationId,
    resolveLegacyConversationId,
    canConvertLegacyQueue,
    syncConversations: async (entries, instanceId, lease) => {
      await feishuSyncOrchestrator.syncConversations({ conversations: toResolved(entries), instanceId, lease });
    },
  });

  return {
    resolveConversationReferences,
    articleFetchService,
    conversationKinds,
    notionSyncJobStore,
    notionSyncOrchestrator,
    obsidianSyncOrchestrator,
    feishuSyncOrchestrator,
    autoSync: {
      notionScheduler,
      obsidianScheduler,
      feishuScheduler,
      onConversationChanged: async (reference, reason, lease) => {
        const normalized = stableReference(reference);
        if (!normalized) return;
        const local = await storageGet([
          NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
          OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
          FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
        ]).catch(() => ({}));
        const enqueues: Promise<void>[] = [];
        if ((local as any)?.[NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY] === true) {
          enqueues.push(notionScheduler.enqueue(normalized, reason, lease));
        }
        if ((local as any)?.[OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY] === true) {
          enqueues.push(obsidianScheduler.enqueue(normalized, reason, lease));
        }
        if ((local as any)?.[FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY] === true) {
          enqueues.push(feishuScheduler.enqueue(normalized, reason, lease));
        }
        await Promise.all(enqueues);
      },
      handleAlarm: async (name) => {
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
        }
      },
    },
  };
}
