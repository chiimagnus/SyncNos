import {
  SYNC_JOB_STORAGE_KEYS,
  type ReconcileRunningSyncJobOptions,
  abortRunningSyncJobIfFromOtherInstance,
  getSyncJob,
  isRunningSyncJob,
  setSyncJob,
} from '@services/sync/sync-job-store';

export const GITHUB_SYNC_JOB_KEY = SYNC_JOB_STORAGE_KEYS.github;

export async function getJob() {
  return getSyncJob('github');
}

export async function setJob(job: any) {
  return setSyncJob('github', job);
}

export function isRunningJob(job: any, staleMs?: number) {
  return isRunningSyncJob(job, staleMs);
}

export async function abortRunningJobIfFromOtherInstance(
  instanceId: string,
  options?: number | ReconcileRunningSyncJobOptions,
) {
  return abortRunningSyncJobIfFromOtherInstance('github', instanceId, options);
}

const api = {
  GITHUB_SYNC_JOB_KEY,
  getJob,
  setJob,
  isRunningJob,
  abortRunningJobIfFromOtherInstance,
};

export default api;
