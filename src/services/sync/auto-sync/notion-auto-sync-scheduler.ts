import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import { storageGet, storageSet } from '@services/shared/storage';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';

import type { NotionSyncOrchestrator } from '@services/bootstrap/background-services';
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
} from '@services/sync/auto-sync/auto-sync-scheduler-core';

export type NotionAutoSyncScheduler = AutoSyncScheduler;

export function createNotionAutoSyncScheduler(
  deps: {
    getInstanceId: () => string;
    notionSyncOrchestrator: NotionSyncOrchestrator;
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
    syncConversations: (conversationIds, instanceId) =>
      deps.notionSyncOrchestrator.syncConversations({ conversationIds, instanceId } as any) as any,
  });
}
