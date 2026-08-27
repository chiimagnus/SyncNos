import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import type { GithubSyncOrchestrator } from '@services/bootstrap/background-services';
import { storageGet, storageSet } from '@services/shared/storage';
import {
  GITHUB_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
  GITHUB_AUTO_SYNC_DEBOUNCE_MS,
  GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
  GITHUB_AUTO_SYNC_QUEUE_MAX_ITEMS,
  GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  createAutoSyncSchedulerCore,
  type AutoSyncScheduler,
  type AutoSyncSchedulerInfra,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';

export const GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS = 2 * 60_000;
export const GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS = 15 * 60_000;

const TRANSIENT_CODES = new Set([
  'github_network_error',
  'github_timeout',
  'github_rate_limited',
  'github_outcome_unknown',
  'github_http_error',
  'github_git_branch_race',
  'github_git_branch_race_exhausted',
]);

export function getGithubAutoSyncFailureRetryDelayMs(error: unknown): number | undefined {
  const code = String((error as any)?.code || '').trim();
  if (!code.startsWith('github_')) return undefined;
  return TRANSIENT_CODES.has(code) ? GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS : GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS;
}

function firstTransportFailureCode(result: any): string {
  if (result?.transport?.status !== 'failed') return '';
  const item = Array.isArray(result?.items) ? result.items.find((row: any) => row?.status === 'failed') : null;
  return String(item?.error || 'github_transport_failed').trim() || 'github_transport_failed';
}

export type GithubAutoSyncScheduler = AutoSyncScheduler;

export function createGithubAutoSyncScheduler(
  deps: { getInstanceId: () => string; githubSyncOrchestrator: GithubSyncOrchestrator },
  infraOverrides?: Partial<AutoSyncSchedulerInfra>,
): GithubAutoSyncScheduler {
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
    queueStorageKey: GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY,
    enabledStorageKey: GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
    alarmName: GITHUB_AUTO_SYNC_DEBOUNCE_ALARM_NAME,
    debounceMs: GITHUB_AUTO_SYNC_DEBOUNCE_MS,
    maxItems: GITHUB_AUTO_SYNC_QUEUE_MAX_ITEMS,
    infra,
    getInstanceId: deps.getInstanceId,
    isProviderEnabled: () => isSyncProviderEnabled('github'),
    syncConversations: async (conversationIds, instanceId) => {
      const result = await deps.githubSyncOrchestrator.sync({ conversationIds, mode: 'incremental', instanceId });
      const code = firstTransportFailureCode(result);
      if (code) throw Object.assign(new Error(code), { code });
    },
    getFailureRetryDelayMs: getGithubAutoSyncFailureRetryDelayMs,
  });
}
