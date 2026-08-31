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

export type AutoSyncScheduler = {
  enqueue: (conversationId: number, reason: string) => Promise<void>;
  flush: () => Promise<void>;
};

type QueueMap = Record<string, number>;

function normalizeQueue(value: unknown): QueueMap {
  if (!value || typeof value !== 'object') return {};
  const out: QueueMap = {};
  for (const [key, rawDueAt] of Object.entries(value as Record<string, unknown>)) {
    const conversationId = Number(key);
    if (!Number.isFinite(conversationId) || conversationId <= 0) continue;
    const dueAt = Number(rawDueAt);
    if (!Number.isFinite(dueAt) || dueAt <= 0) continue;
    out[String(conversationId)] = Math.floor(dueAt);
  }
  return out;
}

function trimQueue(queue: QueueMap, maxItems: number): QueueMap {
  const entries = Object.entries(queue);
  const max = Number.isFinite(Number(maxItems)) ? Math.max(1, Math.floor(Number(maxItems))) : 200;
  if (entries.length <= max) return queue;
  entries.sort((a, b) => a[1] - b[1]);
  const kept = entries.slice(0, max);
  const out: QueueMap = {};
  for (const [id, dueAt] of kept) out[id] = dueAt;
  return out;
}

function pickEarliestDueAt(queue: QueueMap): number | null {
  let earliest: number | null = null;
  for (const dueAt of Object.values(queue)) {
    const value = Number(dueAt);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (earliest == null || value < earliest) earliest = value;
  }
  return earliest;
}

function normalizeIds(ids: string[]) {
  return Array.from(
    new Set(
      ids
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
        .map((x) => Math.floor(x)),
    ),
  );
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
  syncConversations: (conversationIds: number[], instanceId: string) => Promise<void>;
  getFailureRetryDelayMs?: (error: unknown) => number | null | undefined;
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
    syncConversations,
    getFailureRetryDelayMs,
  } = config;

  const readQueue = async (): Promise<QueueMap> => {
    const res = await infra.storage.get([queueStorageKey]).catch(() => ({}) as any);
    return normalizeQueue((res as any)?.[queueStorageKey]);
  };

  const writeQueue = async (queue: QueueMap): Promise<void> => {
    await infra.storage.set({ [queueStorageKey]: queue }).catch(() => {});
  };

  const scheduleNextAlarm = async (queue: QueueMap): Promise<void> => {
    const earliestDueAt = pickEarliestDueAt(queue);
    if (earliestDueAt == null) {
      if (infra.alarms.isAvailable()) await infra.alarms.clear(alarmName);
      return;
    }
    if (!infra.alarms.isAvailable()) return;
    infra.alarms.create(alarmName, { when: earliestDueAt });
  };

  const enqueue = async (conversationId: number, _reason: string) => {
    const id = Number(conversationId);
    if (!Number.isFinite(id) || id <= 0) return;

    const local = await infra.storage.get([enabledStorageKey]).catch(() => ({}) as any);
    const autoSyncEnabled = (local as any)?.[enabledStorageKey] === true;
    if (!autoSyncEnabled) return;

    const providerEnabled = await isProviderEnabled().catch(() => false);
    if (!providerEnabled) return;

    const now = infra.now();
    const nextDueAt = now + debounceMs;

    const queue = await readQueue();
    const key = String(Math.floor(id));
    const prevDueAt = Number(queue[key]);
    if (Number.isFinite(prevDueAt) && prevDueAt >= nextDueAt) {
      await scheduleNextAlarm(queue);
      return;
    }

    const nextQueue = trimQueue({ ...queue, [key]: nextDueAt }, maxItems);
    await writeQueue(nextQueue);
    await scheduleNextAlarm(nextQueue);

    // Best-effort fallback when `alarms` API is unavailable: we cannot wake the
    // background to flush at `dueAt`, so we opportunistically flush any due
    // items whenever we have an activity signal (enqueue).
    if (!infra.alarms.isAvailable()) {
      await flush();
    }
  };

  let flushRun: Promise<void> | null = null;

  const flushOnce = async () => {
    const now = infra.now();
    const instanceId = getInstanceId();
    const queue = await readQueue();

    const dueKeys = Object.keys(queue).filter((key) => Number(queue[key]) <= now);
    const dueConversationIds = normalizeIds(dueKeys);
    if (!dueConversationIds.length) {
      await scheduleNextAlarm(queue);
      return;
    }

    const local = await infra.storage.get([enabledStorageKey]).catch(() => ({}) as any);
    const autoSyncEnabled = (local as any)?.[enabledStorageKey] === true;
    const providerEnabled = await isProviderEnabled().catch(() => false);

    const restQueue: QueueMap = { ...queue };
    for (const key of dueKeys) delete restQueue[key];

    if (!providerEnabled || !autoSyncEnabled) {
      await writeQueue(restQueue);
      await scheduleNextAlarm(restQueue);
      return;
    }

    try {
      await syncConversations(dueConversationIds, instanceId);
      await writeQueue(restQueue);
      await scheduleNextAlarm(restQueue);
    } catch (error) {
      if (isAlreadyRunningError(error)) {
        const delayedQueue: QueueMap = { ...queue };
        const delayedDueAt = now + debounceMs;
        for (const conversationId of dueConversationIds) delayedQueue[String(conversationId)] = delayedDueAt;
        const trimmed = trimQueue(delayedQueue, maxItems);
        await writeQueue(trimmed);
        await scheduleNextAlarm(trimmed);
        return;
      }

      const retryDelayMs = Number(getFailureRetryDelayMs?.(error));
      if (Number.isFinite(retryDelayMs) && retryDelayMs > 0) {
        const delayedQueue: QueueMap = { ...restQueue };
        const delayedDueAt = now + Math.floor(retryDelayMs);
        for (const conversationId of dueConversationIds) delayedQueue[String(conversationId)] = delayedDueAt;
        const trimmed = trimQueue(delayedQueue, maxItems);
        await writeQueue(trimmed);
        await scheduleNextAlarm(trimmed);
        return;
      }

      await writeQueue(restQueue);
      await scheduleNextAlarm(restQueue);
    }
  };

  const flush = () => {
    if (flushRun) return flushRun;
    const run = flushOnce();
    flushRun = run;
    void run.finally(() => {
      if (flushRun === run) flushRun = null;
    });
    return run;
  };

  return { enqueue, flush };
}
