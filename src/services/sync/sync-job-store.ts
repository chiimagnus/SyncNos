import { storageGet, storageSet } from '@platform/storage/local';
import type { SyncJobSnapshot, SyncPerConversationResult, SyncProvider, SyncWarning } from '@services/sync/models';

export const SYNC_JOB_STORAGE_KEYS: Record<SyncProvider, string> = {
  notion: 'notion_sync_job_v2',
  obsidian: 'obsidian_sync_job_v2',
  feishu: 'feishu_sync_job_v2',
  github: 'github_sync_job_v2',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function parseWarnings(value: unknown): SyncWarning[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const warnings: SyncWarning[] = [];
  for (const warning of value) {
    if (!isRecord(warning) || typeof warning.code !== 'string' || typeof warning.message !== 'string') return null;
    warnings.push({
      code: warning.code,
      message: warning.message,
      ...(warning.extra === undefined ? {} : { extra: warning.extra }),
    });
  }
  return warnings;
}

function parseConversationIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const id of value) {
    if (!isPositiveSafeInteger(id) || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parsePerConversation(value: unknown): SyncPerConversationResult[] | null {
  if (!Array.isArray(value)) return null;
  const rows: SyncPerConversationResult[] = [];
  const seen = new Set<number>();
  for (const row of value) {
    if (!isRecord(row) || !isPositiveSafeInteger(row.conversationId) || seen.has(row.conversationId)) return null;
    seen.add(row.conversationId);
    if (!isOptionalString(row.conversationTitle)) return null;
    if (typeof row.ok !== 'boolean' || typeof row.mode !== 'string') return null;
    if (typeof row.appended !== 'number' || !Number.isFinite(row.appended)) return null;
    if (typeof row.error !== 'string' || !isNonNegativeFiniteNumber(row.at)) return null;
    const warnings = parseWarnings(row.warnings);
    if (warnings === null) return null;
    rows.push({
      conversationId: row.conversationId,
      conversationTitle: row.conversationTitle,
      ok: row.ok,
      mode: row.mode,
      appended: row.appended,
      error: row.error,
      warnings,
      at: row.at,
    });
  }
  return rows;
}

export function normalizeSyncJobSnapshot(provider: SyncProvider, job: unknown): SyncJobSnapshot | null {
  if (!isRecord(job) || job.provider !== provider) return null;
  const status = job.status;
  if (status !== 'running' && status !== 'done' && status !== 'aborted') return null;
  if (!isOptionalString(job.id) || !isOptionalString(job.instanceId)) return null;
  if (!isNonNegativeFiniteNumber(job.startedAt) || !isNonNegativeFiniteNumber(job.updatedAt)) return null;
  let finishedAt: number | null;
  if (status === 'running') {
    if (job.finishedAt !== null) return null;
    finishedAt = null;
  } else {
    if (!isNonNegativeFiniteNumber(job.finishedAt)) return null;
    finishedAt = job.finishedAt;
  }
  if (!isNonNegativeSafeInteger(job.totalCount)) return null;
  if (!isNonNegativeSafeInteger(job.okCount) || !isNonNegativeSafeInteger(job.failCount)) return null;
  if (job.currentConversationId !== undefined && !isPositiveSafeInteger(job.currentConversationId)) return null;
  if (!isOptionalString(job.currentConversationTitle) || !isOptionalString(job.currentStage)) return null;
  if (!isOptionalString(job.abortedReason)) return null;

  const conversationIds = parseConversationIds(job.conversationIds);
  const perConversation = parsePerConversation(job.perConversation);
  if (conversationIds === null || perConversation === null) return null;
  if (status !== 'done' && (conversationIds.length > 0 || perConversation.length > 0)) return null;
  if (status === 'done') {
    if (conversationIds.length !== job.totalCount || perConversation.length !== job.totalCount) return null;
    if (job.okCount + job.failCount !== job.totalCount) return null;
    const resultIds = new Set(perConversation.map((row) => row.conversationId));
    if (conversationIds.some((id) => !resultIds.has(id))) return null;
  }

  return {
    id: job.id,
    provider,
    instanceId: job.instanceId,
    status,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt,
    totalCount: job.totalCount,
    conversationIds,
    currentConversationId: job.currentConversationId,
    currentConversationTitle: job.currentConversationTitle,
    currentStage: job.currentStage,
    okCount: job.okCount,
    failCount: job.failCount,
    perConversation,
    abortedReason: job.abortedReason,
  };
}

async function getSyncJob(provider: SyncProvider): Promise<SyncJobSnapshot | null> {
  const key = SYNC_JOB_STORAGE_KEYS[provider];
  const res = await storageGet([key]);
  return normalizeSyncJobSnapshot(provider, res?.[key] ?? null);
}

async function setSyncJob(provider: SyncProvider, job: SyncJobSnapshot | null): Promise<boolean> {
  const key = SYNC_JOB_STORAGE_KEYS[provider];
  try {
    await storageSet({ [key]: job || null });
    return true;
  } catch (_error) {
    return false;
  }
}

async function abortRunningSyncJob(provider: SyncProvider): Promise<SyncJobSnapshot | null> {
  const current = await getSyncJob(provider);
  if (!current || current.status !== 'running') return current;

  const now = Date.now();
  const aborted: SyncJobSnapshot = {
    ...current,
    provider,
    status: 'aborted',
    updatedAt: now,
    finishedAt: now,
    abortedReason: 'extension reloaded',
  };
  return (await setSyncJob(provider, aborted)) ? aborted : current;
}

export type SyncJobStore = {
  getJob: () => Promise<SyncJobSnapshot | null>;
  setJob: (job: SyncJobSnapshot | null) => Promise<boolean>;
  abortRunningJob: () => Promise<SyncJobSnapshot | null>;
};

export function createSyncJobStore(provider: SyncProvider): SyncJobStore {
  return {
    getJob: () => getSyncJob(provider),
    setJob: (job) => setSyncJob(provider, job),
    abortRunningJob: () => abortRunningSyncJob(provider),
  };
}
