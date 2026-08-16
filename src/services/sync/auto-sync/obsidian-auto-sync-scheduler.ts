import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import { storageGet, storageSet } from '@services/shared/storage';
import type { StableConversationReference } from '@services/local-data/contracts';
import type { FactsOperationLease } from '@services/local-data/facts-operation-gate';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';

import {
  OBSIDIAN_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  OBSIDIAN_AUTO_SYNC_DEBOUNCE_MS,
  OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_QUEUE_MAX_ITEMS,
  OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  createAutoSyncSchedulerCore,
  type AutoSyncScheduler,
  type AutoSyncSchedulerInfra,
  type ResolvedAutoSyncQueueEntry,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';

export type ObsidianAutoSyncScheduler = AutoSyncScheduler;

export function createObsidianAutoSyncScheduler(
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
): ObsidianAutoSyncScheduler {
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
    queueStorageKey: OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY,
    enabledStorageKey: OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
    alarmName: OBSIDIAN_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
    debounceMs: OBSIDIAN_AUTO_SYNC_DEBOUNCE_MS,
    maxItems: OBSIDIAN_AUTO_SYNC_QUEUE_MAX_ITEMS,
    infra,
    getInstanceId: deps.getInstanceId,
    isProviderEnabled: () => isSyncProviderEnabled('obsidian'),
    runFactsOperation: deps.runFactsOperation,
    resolveConversationId: deps.resolveConversationId,
    ...(deps.resolveLegacyConversationId ? { resolveLegacyConversationId: deps.resolveLegacyConversationId } : {}),
    ...(deps.canConvertLegacyQueue ? { canConvertLegacyQueue: deps.canConvertLegacyQueue } : {}),
    syncConversations: deps.syncConversations,
  });
}
