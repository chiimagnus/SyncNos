import {
  SYNC_JOB_STORAGE_KEYS,
  abortRunningSyncJobIfFromOtherInstance,
  getSyncJob,
  isRunningSyncJob,
  setSyncJob,
} from '@services/sync/sync-job-store.ts';

export const OBSIDIAN_SYNC_JOB_KEY = SYNC_JOB_STORAGE_KEYS.obsidian;

export async function getJob() {
  return getSyncJob('obsidian');
}

export async function setJob(job: any) {
  return setSyncJob('obsidian', job);
}

export function isRunningJob(job: any, staleMs?: number) {
  return isRunningSyncJob(job, staleMs);
}

export async function abortRunningJobIfFromOtherInstance(instanceId: string) {
  return abortRunningSyncJobIfFromOtherInstance('obsidian', instanceId);
}

const api = {
  OBSIDIAN_SYNC_JOB_KEY,
  getJob,
  setJob,
  isRunningJob,
  abortRunningJobIfFromOtherInstance,
};

export default api;
