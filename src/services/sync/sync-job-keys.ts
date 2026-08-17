import type { SyncProvider } from '@services/sync/models';

/** Browser-profile-local runtime pointers. They are never user-backup settings. */
export const SYNC_JOB_STORAGE_KEYS: Readonly<Record<SyncProvider, string>> = Object.freeze({
  notion: 'notion_sync_job_v1',
  obsidian: 'obsidian_sync_job_v1',
  feishu: 'feishu_sync_job_v1',
});
