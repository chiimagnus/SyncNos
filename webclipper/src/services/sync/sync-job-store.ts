import { storageGet, storageSet } from '@platform/storage/local';
import type { SyncJobSnapshot, SyncProvider } from '@services/sync/models';

const DEFAULT_STALE_MS = 20 * 60 * 1000;

export const SYNC_JOB_STORAGE_KEYS: Record<SyncProvider, string> = {
  notion: 'notion_sync_job_v1',
  obsidian: 'obsidian_sync_job_v1',
};

function normalizeConversationIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
}

function normalizePerConversation(rows: unknown) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const value = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    return {
      conversationId: Number(value.conversationId) || 0,
      conversationTitle: value.conversationTitle == null ? undefined : String(value.conversationTitle || ''),
      ok: value.ok === true,
      mode: String(value.mode || (value.ok === true ? 'ok' : 'failed')),
      appended: Number(value.appended) || 0,
      error: String(value.error || ''),
      warnings: Array.isArray(value.warnings) ? value.warnings : undefined,
      at: Number(value.at) || Date.now(),
    };
  });
}

export function normalizeSyncJobSnapshot(provider: SyncProvider, job: unknown): SyncJobSnapshot | null {
  if (!job || typeof job !== 'object') return null;
  const value = job as Record<string, unknown>;
  const perConversation = normalizePerConversation(value.perConversation);
  const okCount = Number(value.okCount);
  const failCount = Number(value.failCount);
  const status = String(value.status || 'done');

  return {
    id: value.id == null ? undefined : String(value.id || ''),
    provider,
    instanceId: value.instanceId == null ? undefined : String(value.instanceId || ''),
    status: status === 'finished' ? 'done' : (status as SyncJobSnapshot['status']),
    startedAt: Number(value.startedAt) || 0,
    updatedAt: Number(value.updatedAt) || Date.now(),
    finishedAt: value.finishedAt == null ? null : Number(value.finishedAt) || null,
    conversationIds: normalizeConversationIds(value.conversationIds),
    currentConversationId: Number.isFinite(Number(value.currentConversationId))
      ? Number(value.currentConversationId)
      : undefined,
    currentConversationTitle:
      value.currentConversationTitle == null ? undefined : String(value.currentConversationTitle || ''),
    currentStage: value.currentStage == null ? undefined : String(value.currentStage || ''),
    okCount: Number.isFinite(okCount) ? okCount : perConversation.filter((row) => row.ok).length,
    failCount: Number.isFinite(failCount) ? failCount : perConversation.filter((row) => !row.ok).length,
    perConversation,
    abortedReason: value.abortedReason == null ? undefined : String(value.abortedReason || ''),
  };
}

export async function getSyncJob(provider: SyncProvider): Promise<SyncJobSnapshot | null> {
  const key = SYNC_JOB_STORAGE_KEYS[provider];
  try {
    const res = await storageGet([key]);
    return normalizeSyncJobSnapshot(provider, res?.[key] ?? null);
  } catch (_error) {
    return null;
  }
}

export async function setSyncJob(provider: SyncProvider, job: SyncJobSnapshot | null): Promise<boolean> {
  const key = SYNC_JOB_STORAGE_KEYS[provider];
  try {
    await storageSet({ [key]: job || null });
    return true;
  } catch (_error) {
    return false;
  }
}

export function isRunningSyncJob(job: SyncJobSnapshot | null | undefined, staleMs?: number): boolean {
  if (!job || job.status !== 'running') return false;
  const updatedAt = Number(job.updatedAt) || 0;
  if (!updatedAt) return true;
  const maxAge = Number.isFinite(Number(staleMs)) ? Math.max(60_000, Number(staleMs)) : DEFAULT_STALE_MS;
  return Date.now() - updatedAt < maxAge;
}

export async function abortRunningSyncJobIfFromOtherInstance(
  provider: SyncProvider,
  instanceId: string,
): Promise<SyncJobSnapshot | null> {
  const current = await getSyncJob(provider);
  if (!current || current.status !== 'running') return current;
  const jobInstanceId = current.instanceId ? String(current.instanceId) : '';
  if (!jobInstanceId || jobInstanceId !== String(instanceId || '')) {
    const now = Date.now();
    const aborted: SyncJobSnapshot = {
      ...current,
      provider,
      status: 'aborted',
      updatedAt: now,
      finishedAt: now,
      abortedReason: 'extension reloaded',
    };
    await setSyncJob(provider, aborted);
    return aborted;
  }
  return current;
}
