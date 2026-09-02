import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import type { GithubSyncOrchestrator } from '@services/bootstrap/background-services';
import { storageGet, storageSet } from '@services/shared/storage';
import {
  GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME,
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
export const GITHUB_CLEANUP_BATCH_CONTINUE_DELAY_MS = 1_000;
export const GITHUB_CLEANUP_BUSY_RETRY_MS = 60_000;
export const GITHUB_CLEANUP_UNKNOWN_FAILURE_RETRY_MS = 5 * 60_000;

const TRANSIENT_CODES = new Set([
  'github_network_error',
  'github_timeout',
  'github_rate_limited',
  'github_outcome_unknown',
  'github_http_error',
  'github_git_branch_race',
  'github_git_branch_race_exhausted',
  'github_transport_resolution_incomplete',
  'github_sync_job_persist_failed',
]);

export function getGithubAutoSyncFailureRetryDelayMs(error: unknown): number {
  const code = String((error as any)?.code || '').trim();
  return code.startsWith('github_') && TRANSIENT_CODES.has(code)
    ? GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS
    : GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS;
}

function resultFailureCode(result: any): string {
  const items = Array.isArray(result?.items) ? result.items : [];
  for (const item of items) {
    if (item?.status !== 'failed' && item?.status !== 'mapping_failed') continue;
    const code = String(item?.error || '').trim();
    return code.startsWith('github_') ? code : 'github_sync_item_failed';
  }

  const transportStatus = String(result?.transport?.status || '').trim();
  if (transportStatus === 'invalid_resolution') return 'github_transport_resolution_incomplete';
  if (transportStatus === 'failed') return 'github_transport_failed';
  return '';
}

function normalizePositiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((candidate) => Number(candidate))
        .filter((candidate): candidate is number => Number.isSafeInteger(candidate) && candidate > 0),
    ),
  ];
}

export type GithubAutoSyncScheduler = AutoSyncScheduler & {
  scheduleCleanup: (when?: number) => Promise<void>;
  flushCleanup: () => Promise<void>;
};

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

  const normalScheduler = createAutoSyncSchedulerCore({
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
      const code = resultFailureCode(result);
      if (code) throw Object.assign(new Error(code), { code });
    },
    getFailureRetryDelayMs: getGithubAutoSyncFailureRetryDelayMs,
  });

  const cleanupEnabled = async () => {
    const local = await infra.storage.get([GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY]).catch(() => ({}) as any);
    if ((local as any)?.[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] !== true) return false;
    return await isSyncProviderEnabled('github').catch(() => false);
  };

  const scheduleCleanup = async (when = infra.now()) => {
    if (!(await cleanupEnabled())) return;
    if (!infra.alarms.isAvailable()) return;
    const candidate = Number(when);
    const now = infra.now();
    const dueAt = Number.isFinite(candidate) && candidate > now ? Math.floor(candidate) : now;
    infra.alarms.create(GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME, { when: dueAt });
  };

  const scheduleCleanupFailure = async (error: unknown) => {
    const code = String((error as any)?.code || '').trim();
    const delay =
      code === 'sync_already_running'
        ? GITHUB_CLEANUP_BUSY_RETRY_MS
        : getGithubAutoSyncFailureRetryDelayMs(error) || GITHUB_CLEANUP_UNKNOWN_FAILURE_RETRY_MS;
    await scheduleCleanup(infra.now() + delay);
  };

  let cleanupRun: Promise<void> | null = null;
  const flushCleanupOnce = async () => {
    if (!(await cleanupEnabled())) return;
    try {
      const result: any = await deps.githubSyncOrchestrator.sync({
        conversationIds: [],
        mode: 'incremental',
        instanceId: deps.getInstanceId(),
      });
      if (result?.transport?.status === 'failed' || result?.transport?.status === 'invalid_resolution') {
        throw Object.assign(new Error('github_cleanup_transport_failed'), { code: 'github_cleanup_transport_failed' });
      }

      const replacementIds = normalizePositiveIds(result?.deferredReplacementConversationIds);
      for (const conversationId of replacementIds) {
        await normalScheduler.enqueue(conversationId, 'github_cleanup_replacement');
      }

      if (result?.cleanupHasMoreDue === true) {
        await scheduleCleanup(infra.now() + GITHUB_CLEANUP_BATCH_CONTINUE_DELAY_MS);
        return;
      }
      const nextCleanupDueAt = Number(result?.nextCleanupDueAt);
      if (Number.isFinite(nextCleanupDueAt) && nextCleanupDueAt > 0) {
        await scheduleCleanup(nextCleanupDueAt);
        return;
      }
      if (infra.alarms.isAvailable()) await infra.alarms.clear(GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME);
    } catch (error) {
      await scheduleCleanupFailure(error);
    }
  };

  const flushCleanup = () => {
    if (cleanupRun) return cleanupRun;
    const run = flushCleanupOnce();
    cleanupRun = run;
    void run.finally(() => {
      if (cleanupRun === run) cleanupRun = null;
    });
    return run;
  };

  return { ...normalScheduler, scheduleCleanup, flushCleanup };
}
