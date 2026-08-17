import { storageGet, storageSet } from '@platform/storage/local';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-keys';
import type { SyncConversationReference, SyncJobSnapshot, SyncProvider } from '@services/sync/models';

export { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-keys';

const DEFAULT_STALE_MS = 5 * 60 * 1000;

function normalizeSyncReference(value: unknown): SyncConversationReference | null {
  const source = String((value as any)?.source || '').trim();
  const conversationKey = String((value as any)?.conversationKey || '').trim();
  if (!source || !conversationKey) return null;
  const conversationId = Number((value as any)?.conversationId);
  return {
    source,
    conversationKey,
    ...(Number.isSafeInteger(conversationId) && conversationId > 0 ? { conversationId } : {}),
  };
}

function normalizeConversationReferences(value: unknown): SyncConversationReference[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, SyncConversationReference>();
  for (const item of value) {
    const reference = normalizeSyncReference(item);
    if (!reference) continue;
    byKey.set(`${reference.source}\u0000${reference.conversationKey}`, reference);
  }
  return [...byKey.values()];
}

function normalizePerConversation(rows: unknown) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const value = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    return {
      conversationId: Number(value.conversationId) || 0,
      conversationTitle: value.conversationTitle == null ? undefined : String(value.conversationTitle || ''),
      ...(normalizeSyncReference(value.reference) ? { reference: normalizeSyncReference(value.reference)! } : {}),
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
  const conversations = normalizeConversationReferences(value.conversations);
  const currentConversation = normalizeSyncReference(value.currentConversation);
  const okCount = Number(value.okCount);
  const failCount = Number(value.failCount);
  const status = String(value.status || '');
  if (status !== 'running' && status !== 'done' && status !== 'aborted') return null;

  return {
    id: value.id == null ? undefined : String(value.id || ''),
    provider,
    instanceId: value.instanceId == null ? undefined : String(value.instanceId || ''),
    status,
    startedAt: Number(value.startedAt) || 0,
    updatedAt: Number(value.updatedAt) || Date.now(),
    finishedAt: value.finishedAt == null ? null : Number(value.finishedAt) || null,
    conversations,
    conversationIds: conversations.flatMap((reference) => (reference.conversationId ? [reference.conversationId] : [])),
    ...(currentConversation ? { currentConversation } : {}),
    currentConversationId: currentConversation?.conversationId,
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

export type ReconcileRunningSyncJobOptions = {
  staleMs?: number;
  forceAbort?: boolean;
};

export async function abortRunningSyncJobIfFromOtherInstance(
  provider: SyncProvider,
  instanceId: string,
  options?: number | ReconcileRunningSyncJobOptions,
): Promise<SyncJobSnapshot | null> {
  const current = await getSyncJob(provider);
  if (!current || current.status !== 'running') return current;
  const jobInstanceId = current.instanceId ? String(current.instanceId) : '';
  if (!jobInstanceId || jobInstanceId === String(instanceId || '')) return current;

  const normalizedOptions =
    typeof options === 'number' ? ({ staleMs: options } satisfies ReconcileRunningSyncJobOptions) : options || {};
  const forceAbort = normalizedOptions.forceAbort === true;
  const staleMs = normalizedOptions.staleMs;

  // Do not abort a still-active job from another background instance. Treat it as running
  // unless it is stale, otherwise concurrent background contexts could keep aborting each
  // other's jobs and cause duplicate sync writes.
  if (!forceAbort && isRunningSyncJob(current, staleMs)) return current;

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
