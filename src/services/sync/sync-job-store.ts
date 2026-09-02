import { storageGet, storageSet } from '@platform/storage/local';
import type { SyncJobSnapshot, SyncPerConversationResult, SyncProvider, SyncWarning } from '@services/sync/models';

export const SYNC_JOB_STORAGE_KEYS: Record<SyncProvider, string> = {
  notion: 'notion_sync_job_v1',
  obsidian: 'obsidian_sync_job_v1',
  feishu: 'feishu_sync_job_v1',
  github: 'github_sync_job_v1',
};

function positiveSafeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function nonNegativeFinite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeConversationIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of ids) {
    const id = positiveSafeInteger(value);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeWarnings(value: unknown): SyncWarning[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((warning) => warning && typeof warning === 'object' && !Array.isArray(warning))
    .map((warning) => {
      const raw = warning as Record<string, unknown>;
      return {
        code: String(raw.code || '').trim(),
        message: String(raw.message || '').trim(),
        ...(raw.extra === undefined ? {} : { extra: raw.extra }),
      };
    });
}

function normalizePerConversation(rows: unknown): SyncPerConversationResult[] {
  if (!Array.isArray(rows)) return [];
  const out: SyncPerConversationResult[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const value = row as Record<string, unknown>;
    const conversationId = positiveSafeInteger(value.conversationId);
    if (conversationId == null) continue;
    const appended = Number(value.appended);
    out.push({
      conversationId,
      conversationTitle: value.conversationTitle == null ? undefined : String(value.conversationTitle || ''),
      ok: value.ok === true,
      mode: String(value.mode || (value.ok === true ? 'ok' : 'failed')),
      appended: Number.isFinite(appended) ? appended : 0,
      error: String(value.error || ''),
      warnings: normalizeWarnings(value.warnings),
      at: nonNegativeFinite(value.at) ?? 0,
    });
  }
  return out;
}

export function normalizeSyncJobSnapshot(provider: SyncProvider, job: unknown): SyncJobSnapshot | null {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
  const value = job as Record<string, unknown>;
  const status = value.status;
  if (status !== 'running' && status !== 'done' && status !== 'aborted') return null;

  const perConversation = normalizePerConversation(value.perConversation);
  const startedAt = nonNegativeFinite(value.startedAt) ?? 0;
  const finishedAt = value.finishedAt == null ? null : nonNegativeFinite(value.finishedAt);
  const updatedAt = nonNegativeFinite(value.updatedAt) ?? Math.max(startedAt, finishedAt ?? 0);
  const okCount = nonNegativeSafeInteger(value.okCount) ?? perConversation.filter((row) => row.ok).length;
  const failCount = nonNegativeSafeInteger(value.failCount) ?? perConversation.filter((row) => !row.ok).length;
  const totalCount = nonNegativeSafeInteger(value.totalCount);
  const currentConversationId = positiveSafeInteger(value.currentConversationId);

  return {
    id: value.id == null ? undefined : String(value.id || ''),
    provider,
    instanceId: value.instanceId == null ? undefined : String(value.instanceId || ''),
    status,
    startedAt,
    updatedAt,
    finishedAt,
    ...(totalCount == null ? {} : { totalCount }),
    conversationIds: normalizeConversationIds(value.conversationIds),
    currentConversationId: currentConversationId ?? undefined,
    currentConversationTitle:
      value.currentConversationTitle == null ? undefined : String(value.currentConversationTitle || ''),
    currentStage: value.currentStage == null ? undefined : String(value.currentStage || ''),
    okCount,
    failCount,
    perConversation,
    abortedReason: value.abortedReason == null ? undefined : String(value.abortedReason || ''),
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
