import { storageGet } from '@services/shared/storage';
import type { SyncJobSnapshot, SyncProvider } from '@services/sync/models';
import { normalizeSyncJobSnapshotsFromStorage, SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-store';
import {
  FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY,
  GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
  GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY,
  NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import { normalizeAutoSyncQueue } from '@services/sync/auto-sync/auto-sync-scheduler-core';
import { syncProviderEnabledStorageKey } from '@services/sync/sync-provider-gate';
import { AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY } from '@services/conversations/background/image-backfill-scheduler';

const PROVIDERS = Object.keys(SYNC_JOB_STORAGE_KEYS) as SyncProvider[];

const AUTO_SYNC_QUEUE_STORAGE_KEYS: Record<SyncProvider, string> = {
  notion: NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY,
  obsidian: OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY,
  feishu: FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY,
  github: GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY,
};

type BackgroundRecoveryProviderProbe = {
  runningJob: SyncJobSnapshot | null;
  hasQueuedWork: boolean;
};

type BackgroundRecoveryProbe = {
  providers: Record<SyncProvider, BackgroundRecoveryProviderProbe>;
  imageBackfillHasQueuedWork: boolean;
  githubCleanupEnabled: boolean;
};

export async function readBackgroundRecoveryProbe(): Promise<BackgroundRecoveryProbe> {
  const githubProviderEnabledKey = syncProviderEnabledStorageKey('github');
  const keys = [
    ...Object.values(SYNC_JOB_STORAGE_KEYS),
    ...Object.values(AUTO_SYNC_QUEUE_STORAGE_KEYS),
    AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY,
    GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
    githubProviderEnabledKey,
  ];
  const values = await storageGet(keys);
  const jobs = normalizeSyncJobSnapshotsFromStorage(values);

  const providers = PROVIDERS.reduce<Record<SyncProvider, BackgroundRecoveryProviderProbe>>(
    (out, provider) => {
      const job = jobs[provider];
      out[provider] = {
        runningJob: job?.status === 'running' ? job : null,
        hasQueuedWork: Object.keys(normalizeAutoSyncQueue(values[AUTO_SYNC_QUEUE_STORAGE_KEYS[provider]])).length > 0,
      };
      return out;
    },
    {} as Record<SyncProvider, BackgroundRecoveryProviderProbe>,
  );

  return {
    providers,
    imageBackfillHasQueuedWork:
      Object.keys(normalizeAutoSyncQueue(values[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY])).length > 0,
    githubCleanupEnabled:
      values[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] === true && values[githubProviderEnabledKey] !== false,
  };
}
