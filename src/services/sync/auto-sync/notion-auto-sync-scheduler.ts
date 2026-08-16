import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import { storageGet, storageSet } from '@services/shared/storage';
import type { StableConversationReference } from '@services/local-data/contracts';
import type { FactsOperationLease } from '@services/local-data/facts-operation-gate';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import { getNotionOAuthToken } from '@services/sync/notion/auth/token-store';
import notionSyncJobStore from '@services/sync/notion/notion-sync-job-store';

import {
  NOTION_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  NOTION_AUTO_SYNC_DEBOUNCE_MS,
  NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
  NOTION_AUTO_SYNC_QUEUE_MAX_ITEMS,
  NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  createAutoSyncSchedulerCore,
  type AutoSyncScheduler,
  type AutoSyncSchedulerInfra,
  type ResolvedAutoSyncQueueEntry,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';

async function writePreflightFailureJob(
  entries: ResolvedAutoSyncQueueEntry[],
  instanceId: string,
  error: string,
  now: number,
) {
  const conversationIds = entries.map((entry) => entry.conversationId);
  await notionSyncJobStore
    .setJob({
      id: `${now}_autosync_preflight`,
      provider: 'notion',
      instanceId,
      status: 'done',
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
      conversations: entries.map(({ source, conversationKey, conversationId }) => ({
        source,
        conversationKey,
        conversationId,
      })),
      conversationIds,
      currentConversation: entries[0]
        ? {
            source: entries[0].source,
            conversationKey: entries[0].conversationKey,
            conversationId: entries[0].conversationId,
          }
        : undefined,
      currentConversationId: conversationIds[0] || undefined,
      currentStage: 'preparing_sync',
      okCount: 0,
      failCount: conversationIds.length,
      perConversation: entries.map((entry) => ({
        conversationId: entry.conversationId,
        reference: {
          source: entry.source,
          conversationKey: entry.conversationKey,
          conversationId: entry.conversationId,
        },
        conversationTitle: '',
        ok: false,
        mode: 'failed',
        appended: 0,
        error,
        warnings: [],
        at: now,
      })),
    })
    .catch(() => {});
}

export type NotionAutoSyncScheduler = AutoSyncScheduler;

export function createNotionAutoSyncScheduler(
  deps: {
    getInstanceId: () => string;
    runFactsOperation: <T>(kind: string, fn: (lease: FactsOperationLease) => Promise<T> | T) => Promise<T>;
    resolveConversationId: (
      reference: StableConversationReference,
      lease: FactsOperationLease,
    ) => Promise<number | null>;
    resolveLegacyConversationId?: (
      conversationId: number,
      lease: FactsOperationLease,
    ) => Promise<StableConversationReference | null>;
    canConvertLegacyQueue?: (lease: FactsOperationLease) => Promise<boolean>;
    syncConversations: (
      entries: ResolvedAutoSyncQueueEntry[],
      instanceId: string,
      lease: FactsOperationLease,
    ) => Promise<void>;
  },
  infraOverrides?: Partial<AutoSyncSchedulerInfra>,
): NotionAutoSyncScheduler {
  const infra: AutoSyncSchedulerInfra = {
    now: () => Date.now(),
    storage: { get: storageGet as any, set: storageSet as any },
    alarms: {
      isAvailable: () => isAlarmsAvailable(),
      create: (name, info) => create(name, info),
      clear: (name) => clear(name),
    },
    ...infraOverrides,
  };

  return createAutoSyncSchedulerCore({
    queueStorageKey: NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY,
    enabledStorageKey: NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
    alarmName: NOTION_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
    debounceMs: NOTION_AUTO_SYNC_DEBOUNCE_MS,
    maxItems: NOTION_AUTO_SYNC_QUEUE_MAX_ITEMS,
    infra,
    getInstanceId: deps.getInstanceId,
    isProviderEnabled: () => isSyncProviderEnabled('notion'),
    runFactsOperation: deps.runFactsOperation,
    resolveConversationId: deps.resolveConversationId,
    ...(deps.resolveLegacyConversationId ? { resolveLegacyConversationId: deps.resolveLegacyConversationId } : {}),
    ...(deps.canConvertLegacyQueue ? { canConvertLegacyQueue: deps.canConvertLegacyQueue } : {}),
    syncConversations: async (entries, instanceId, lease) => {
      const local = await infra.storage.get(['notion_parent_page_id']).catch(() => ({}) as any);
      const token = await getNotionOAuthToken().catch(() => null);
      const parentPageId = String((local as any)?.notion_parent_page_id || '').trim();
      if (!token || !(token as any).accessToken) throw new Error('notion not connected');
      if (!parentPageId) throw new Error('missing parentPageId');
      await deps.syncConversations(entries, instanceId, lease);
    },
    onPreflightFailed: async ({ entries, instanceId, error }) => {
      await writePreflightFailureJob(entries, instanceId, error, infra.now());
    },
  });
}
