/* global chrome */

(function () {
  const NS = require("../../runtime-context.js");

  const NOTION_SYNC_JOB_KEY = "notion_sync_job_v1";
  const DEFAULT_STALE_MS = 20 * 60 * 1000;

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (res) => resolve(res || {})));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve(true)));
  }

  async function getJob() {
    try {
      const res = await storageGet([NOTION_SYNC_JOB_KEY]);
      const job = res && res[NOTION_SYNC_JOB_KEY] ? res[NOTION_SYNC_JOB_KEY] : null;
      return job && typeof job === "object" ? job : null;
    } catch (_e) {
      return null;
    }
  }

  async function setJob(job) {
    try {
      await storageSet({ [NOTION_SYNC_JOB_KEY]: job || null });
      return true;
    } catch (_e) {
      return false;
    }
  }

  function isRunningJob(job, staleMs) {
    if (!job || typeof job !== "object") return false;
    if (job.status !== "running") return false;
    const updatedAt = Number(job.updatedAt) || 0;
    if (!updatedAt) return true;
    const ms = Number.isFinite(Number(staleMs)) ? Math.max(60_000, Number(staleMs)) : DEFAULT_STALE_MS;
    return (Date.now() - updatedAt) < ms;
  }

  async function abortRunningJobIfFromOtherInstance(instanceId) {
    const current = await getJob();
    if (!current || typeof current !== "object") return null;
    if (current.status !== "running") return current;
    const jobInstanceId = current.instanceId ? String(current.instanceId) : "";
    if (!jobInstanceId || jobInstanceId !== String(instanceId || "")) {
      const now = Date.now();
      const aborted = {
        ...current,
        status: "aborted",
        updatedAt: now,
        finishedAt: now,
        abortedReason: "extension reloaded"
      };
      await setJob(aborted);
      return aborted;
    }
    return current;
  }

  const api = {
    NOTION_SYNC_JOB_KEY,
    getJob,
    setJob,
    isRunningJob,
    abortRunningJobIfFromOtherInstance
  };
  NS.notionSyncJobStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
