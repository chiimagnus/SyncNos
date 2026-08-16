import type { StableConversationReference } from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';

export type AutoSyncSchedulerInfra = {
  now: () => number;
  storage: {
    get: (keys: string[]) => Promise<Record<string, unknown>>;
    set: (patch: Record<string, unknown>) => Promise<void>;
  };
  alarms: {
    isAvailable: () => boolean;
    create: (name: string, info: { when: number }) => boolean;
    clear: (name: string) => Promise<boolean>;
  };
};

export type AutoSyncQueueEntry = StableConversationReference & Readonly<{ dueAt: number }>;
export type ResolvedAutoSyncQueueEntry = AutoSyncQueueEntry & Readonly<{ conversationId: number }>;

export type AutoSyncScheduler = {
  enqueue: (reference: StableConversationReference, reason: string, lease: FactsOperationLease) => Promise<void>;
  flush: () => Promise<void>;
  rearm: () => Promise<void>;
};

type StoredQueueV2 = Readonly<{
  version: 2;
  entries: AutoSyncQueueEntry[];
}>;

function normalizeReference(value: unknown): StableConversationReference | null {
  const source = String((value as any)?.source || '').trim();
  const conversationKey = String((value as any)?.conversationKey || '').trim();
  return source && conversationKey ? { source, conversationKey } : null;
}

function normalizeDueAt(value: unknown): number | null {
  const dueAt = Number(value);
  return Number.isFinite(dueAt) && dueAt > 0 ? Math.floor(dueAt) : null;
}

function entryKey(reference: StableConversationReference): string {
  return `${reference.source}\u0000${reference.conversationKey}`;
}

function normalizeV2Queue(value: unknown): AutoSyncQueueEntry[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Number((value as any).version) !== 2) return null;
  const rows = Array.isArray((value as any).entries) ? (value as any).entries : [];
  const byKey = new Map<string, AutoSyncQueueEntry>();
  for (const row of rows) {
    const reference = normalizeReference(row);
    const dueAt = normalizeDueAt((row as any)?.dueAt);
    if (!reference || dueAt == null) continue;
    const key = entryKey(reference);
    const previous = byKey.get(key);
    if (!previous || previous.dueAt < dueAt) byKey.set(key, { ...reference, dueAt });
  }
  return [...byKey.values()];
}

function normalizeLegacyNumericQueue(value: unknown): Array<Readonly<{ conversationId: number; dueAt: number }>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: Array<Readonly<{ conversationId: number; dueAt: number }>> = [];
  for (const [key, rawDueAt] of Object.entries(value as Record<string, unknown>)) {
    const conversationId = Number(key);
    const dueAt = normalizeDueAt(rawDueAt);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0 || dueAt == null) continue;
    out.push({ conversationId, dueAt });
  }
  return out;
}

function trimQueue(entries: AutoSyncQueueEntry[], maxItems: number): AutoSyncQueueEntry[] {
  const max = Number.isFinite(Number(maxItems)) ? Math.max(1, Math.floor(Number(maxItems))) : 200;
  if (entries.length <= max) return entries;
  return entries
    .slice()
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, max);
}

function pickEarliestDueAt(entries: readonly AutoSyncQueueEntry[]): number | null {
  let earliest: number | null = null;
  for (const entry of entries) {
    if (earliest == null || entry.dueAt < earliest) earliest = entry.dueAt;
  }
  return earliest;
}

function isAlreadyRunningError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim();
  if (code === 'sync_already_running') return true;
  const message = error instanceof Error ? error.message : String(error || '').trim();
  return message.toLowerCase().includes('sync already in progress');
}

export function createAutoSyncSchedulerCore(config: {
  queueStorageKey: string;
  enabledStorageKey: string;
  alarmName: string;
  debounceMs: number;
  maxItems: number;
  infra: AutoSyncSchedulerInfra;
  getInstanceId: () => string;
  isProviderEnabled: () => Promise<boolean>;
  runFactsOperation: <T>(kind: string, fn: (lease: FactsOperationLease) => Promise<T> | T) => Promise<T>;
  resolveConversationId: (reference: StableConversationReference, lease: FactsOperationLease) => Promise<number | null>;
  resolveLegacyConversationId?: (
    conversationId: number,
    lease: FactsOperationLease,
  ) => Promise<StableConversationReference | null>;
  canConvertLegacyQueue?: (lease: FactsOperationLease) => Promise<boolean>;
  syncConversations: (
    entries: ResolvedAutoSyncQueueEntry[],
    instanceId: string,
    lease: FactsOperationLease,
  ) => Promise<void>;
  onPreflightFailed?: (args: {
    entries: ResolvedAutoSyncQueueEntry[];
    instanceId: string;
    error: string;
  }) => Promise<void>;
  onReferenceDropped?: (reference: StableConversationReference) => void;
}): AutoSyncScheduler {
  const {
    queueStorageKey,
    enabledStorageKey,
    alarmName,
    debounceMs,
    maxItems,
    infra,
    getInstanceId,
    isProviderEnabled,
    runFactsOperation,
    resolveConversationId,
    resolveLegacyConversationId,
    canConvertLegacyQueue,
    syncConversations,
    onPreflightFailed,
    onReferenceDropped,
  } = config;

  const readRawQueue = async (): Promise<unknown> => {
    const res = await infra.storage.get([queueStorageKey]).catch(() => ({}) as any);
    return (res as any)?.[queueStorageKey];
  };

  const writeQueue = async (entries: AutoSyncQueueEntry[]): Promise<void> => {
    const stored: StoredQueueV2 = { version: 2, entries };
    await infra.storage.set({ [queueStorageKey]: stored });
  };

  const readQueue = async (lease: FactsOperationLease): Promise<AutoSyncQueueEntry[]> => {
    assertFactsOperationLease(lease);
    const raw = await readRawQueue();
    assertFactsOperationLease(lease);
    const v2 = normalizeV2Queue(raw);
    if (v2) return v2;
    if (!resolveLegacyConversationId) return [];
    if (canConvertLegacyQueue && !(await canConvertLegacyQueue(lease))) return [];

    const legacy = normalizeLegacyNumericQueue(raw);
    if (!legacy.length) return [];
    const converted: AutoSyncQueueEntry[] = [];
    for (const row of legacy) {
      assertFactsOperationLease(lease);
      const reference = await resolveLegacyConversationId(row.conversationId, lease);
      if (reference) converted.push({ ...reference, dueAt: row.dueAt });
    }
    const normalized = trimQueue(converted, maxItems);
    await writeQueue(normalized);
    return normalized;
  };

  const scheduleNextAlarm = async (entries: readonly AutoSyncQueueEntry[]): Promise<void> => {
    const earliestDueAt = pickEarliestDueAt(entries);
    if (earliestDueAt == null) {
      if (infra.alarms.isAvailable()) await infra.alarms.clear(alarmName);
      return;
    }
    if (!infra.alarms.isAvailable()) return;
    infra.alarms.create(alarmName, { when: earliestDueAt });
  };

  const flushInLease = async (lease: FactsOperationLease) => {
    assertFactsOperationLease(lease);
    const now = infra.now();
    const instanceId = getInstanceId();
    const queue = await readQueue(lease);
    const dueEntries = queue.filter((entry) => entry.dueAt <= now);
    if (!dueEntries.length) {
      await scheduleNextAlarm(queue);
      return;
    }

    const local = await infra.storage.get([enabledStorageKey]).catch(() => ({}) as any);
    const autoSyncEnabled = (local as any)?.[enabledStorageKey] === true;
    const providerEnabled = await isProviderEnabled().catch(() => false);
    const dueKeys = new Set(dueEntries.map(entryKey));
    const restQueue = queue.filter((entry) => !dueKeys.has(entryKey(entry)));

    if (!providerEnabled || !autoSyncEnabled) {
      await writeQueue(restQueue);
      await scheduleNextAlarm(restQueue);
      return;
    }

    const resolvedEntries: ResolvedAutoSyncQueueEntry[] = [];
    for (const entry of dueEntries) {
      assertFactsOperationLease(lease);
      const conversationId = await resolveConversationId(entry, lease);
      if (conversationId == null) {
        onReferenceDropped?.(entry);
        continue;
      }
      resolvedEntries.push({ ...entry, conversationId });
    }

    if (!resolvedEntries.length) {
      await writeQueue(restQueue);
      await scheduleNextAlarm(restQueue);
      return;
    }

    try {
      await syncConversations(resolvedEntries, instanceId, lease);
      await writeQueue(restQueue);
      await scheduleNextAlarm(restQueue);
    } catch (error) {
      if (isAlreadyRunningError(error)) {
        const delayedDueAt = now + debounceMs;
        const delayed = dueEntries.map((entry) => ({ ...entry, dueAt: delayedDueAt }));
        const merged = new Map<string, AutoSyncQueueEntry>();
        for (const entry of [...restQueue, ...delayed]) merged.set(entryKey(entry), entry);
        const nextQueue = trimQueue([...merged.values()], maxItems);
        await writeQueue(nextQueue);
        await scheduleNextAlarm(nextQueue);
        return;
      }

      if (onPreflightFailed) {
        const text = error instanceof Error ? error.message : String(error || '').trim();
        await onPreflightFailed({ entries: resolvedEntries, instanceId, error: text || 'sync failed' }).catch(() => {});
      }
      await writeQueue(restQueue);
      await scheduleNextAlarm(restQueue);
    }
  };

  const enqueue = async (reference: StableConversationReference, _reason: string, lease: FactsOperationLease) => {
    assertFactsOperationLease(lease);
    const normalizedReference = normalizeReference(reference);
    if (!normalizedReference) return;

    const local = await infra.storage.get([enabledStorageKey]).catch(() => ({}) as any);
    const autoSyncEnabled = (local as any)?.[enabledStorageKey] === true;
    if (!autoSyncEnabled) return;
    const providerEnabled = await isProviderEnabled().catch(() => false);
    if (!providerEnabled) return;

    const nextDueAt = infra.now() + debounceMs;
    const queue = await readQueue(lease);
    const key = entryKey(normalizedReference);
    const previous = queue.find((entry) => entryKey(entry) === key);
    if (previous && previous.dueAt >= nextDueAt) {
      await scheduleNextAlarm(queue);
      return;
    }

    const nextByKey = new Map<string, AutoSyncQueueEntry>();
    for (const entry of queue) nextByKey.set(entryKey(entry), entry);
    nextByKey.set(key, { ...normalizedReference, dueAt: nextDueAt });
    const nextQueue = trimQueue([...nextByKey.values()], maxItems);
    await writeQueue(nextQueue);
    await scheduleNextAlarm(nextQueue);

    // ponytail: without alarms, reuse the caller's admitted lease so a migration close cannot
    // split queue persistence from the opportunistic flush by rejecting a nested admission.
    if (!infra.alarms.isAvailable()) await flushInLease(lease);
  };

  let flushRun: Promise<void> | null = null;
  const flush = () => {
    if (flushRun) return flushRun;
    const run = runFactsOperation('auto-sync-flush', flushInLease);
    flushRun = run;
    void run
      .finally(() => {
        if (flushRun === run) flushRun = null;
      })
      .catch(() => {});
    return run;
  };

  const rearm = async () => {
    const raw = await readRawQueue();
    const queue = normalizeV2Queue(raw) ?? [];
    await scheduleNextAlarm(queue);
  };

  return { enqueue, flush, rearm };
}
