import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import { storageGet, storageSet } from '@services/shared/storage';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';

import type { FeishuSyncOrchestrator } from '@services/bootstrap/background-services';
import {
  FEISHU_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  FEISHU_AUTO_SYNC_DEBOUNCE_MS,
  FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
  FEISHU_AUTO_SYNC_QUEUE_MAX_ITEMS,
  FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  createAutoSyncSchedulerCore,
  type AutoSyncScheduler,
  type AutoSyncSchedulerInfra,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';

export type FeishuAutoSyncScheduler = AutoSyncScheduler;

export function createFeishuAutoSyncScheduler(
  deps: {
    getInstanceId: () => string;
    feishuSyncOrchestrator: FeishuSyncOrchestrator;
  },
  infraOverrides?: Partial<AutoSyncSchedulerInfra>,
): FeishuAutoSyncScheduler {
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
    queueStorageKey: FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY,
    enabledStorageKey: FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
    alarmName: FEISHU_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
    debounceMs: FEISHU_AUTO_SYNC_DEBOUNCE_MS,
    maxItems: FEISHU_AUTO_SYNC_QUEUE_MAX_ITEMS,
    infra,
    getInstanceId: deps.getInstanceId,
    isProviderEnabled: () => isSyncProviderEnabled('feishu'),
    syncConversations: (conversationIds, instanceId) =>
      deps.feishuSyncOrchestrator.syncConversations({ conversationIds, instanceId } as any) as any,
    getFailureRetryDelayMs: (error) =>
      String((error as any)?.code || '').trim() === 'feishu_sync_job_persist_failed'
        ? FEISHU_AUTO_SYNC_DEBOUNCE_MS
        : null,
  });
}
