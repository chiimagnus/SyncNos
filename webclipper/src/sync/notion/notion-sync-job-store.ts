import {
  SYNC_JOB_STORAGE_KEYS,
  abortRunningSyncJobIfFromOtherInstance,
  getSyncJob,
  isRunningSyncJob,
  setSyncJob,
} from '../sync-job-store.ts';

export const NOTION_SYNC_JOB_KEY = SYNC_JOB_STORAGE_KEYS.notion;

export async function getJob() {
  return getSyncJob('notion');
}

export async function setJob(job: any) {
  return setSyncJob('notion', job);
}

export function isRunningJob(job: any, staleMs?: number) {
  return isRunningSyncJob(job, staleMs);
}

export async function abortRunningJobIfFromOtherInstance(instanceId: string) {
  return abortRunningSyncJobIfFromOtherInstance('notion', instanceId);
}

const api = {
  NOTION_SYNC_JOB_KEY,
  getJob,
  setJob,
  isRunningJob,
  abortRunningJobIfFromOtherInstance,
};

export default api;
