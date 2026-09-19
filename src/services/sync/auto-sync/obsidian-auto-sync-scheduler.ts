import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import { storageGet, storageSet } from '@services/shared/storage';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';

import type { ObsidianSyncOrchestrator } from '@services/bootstrap/background-services';
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
} from '@services/sync/auto-sync/auto-sync-scheduler-core';

export type ObsidianAutoSyncScheduler = AutoSyncScheduler;

export function createObsidianAutoSyncScheduler(
  deps: {
    getInstanceId: () => string;
    obsidianSyncOrchestrator: ObsidianSyncOrchestrator;
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
    syncConversations: (conversationIds, instanceId) =>
      deps.obsidianSyncOrchestrator.syncConversations({ conversationIds, instanceId } as any) as any,
    getFailureRetryDelayMs: (error) =>
      String((error as any)?.code || '').trim() === 'obsidian_sync_job_persist_failed'
        ? OBSIDIAN_AUTO_SYNC_DEBOUNCE_MS
        : null,
  });
}
