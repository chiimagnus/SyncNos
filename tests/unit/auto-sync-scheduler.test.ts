import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAutoSyncSchedulerCore,
  type AutoSyncSchedulerInfra,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';

function makeInfra(startNow = 1_000_000) {
  let now = startNow;
  const storage: Record<string, any> = {};
  const alarm = {
    name: '',
    when: 0,
    cleared: false,
  };

  const infra: AutoSyncSchedulerInfra = {
    now: () => now,
    storage: {
      get: async (keys) => {
        const out: Record<string, any> = {};
        for (const key of keys) out[key] = storage[key];
        return out;
      },
      set: async (patch) => {
        Object.assign(storage, patch);
      },
    },
    alarms: {
      isAvailable: () => true,
      create: (name, info) => {
        alarm.name = name;
        alarm.when = info.when;
        alarm.cleared = false;
        return true;
      },
      clear: async (name) => {
        if (alarm.name === name) alarm.cleared = true;
        return true;
      },
    },
  };

  return {
    infra,
    storage,
    alarm,
    advance: (ms: number) => {
      now += ms;
    },
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('auto-sync-scheduler-core', () => {
  const QUEUE_KEY = 'queue_key';
  const ENABLED_KEY = 'enabled_key';
  const ALARM_NAME = 'alarm_name';

  let infraPack: ReturnType<typeof makeInfra>;
  let isProviderEnabled: ReturnType<typeof vi.fn>;
  let syncConversations: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    infraPack = makeInfra();
    isProviderEnabled = vi.fn().mockResolvedValue(true);
    syncConversations = vi.fn().mockResolvedValue(undefined);
  });

  it('does not floor fractional ids into another conversation', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    infraPack.storage[QUEUE_KEY] = { '1.5': infraPack.infra.now() - 1 };
    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-fractional',
      isProviderEnabled,
      syncConversations,
    });

    await scheduler.enqueue(2.5, 'invalid');
    await scheduler.flush();

    expect(syncConversations).not.toHaveBeenCalled();
    expect(infraPack.storage[QUEUE_KEY]).toEqual({ '1.5': infraPack.infra.now() - 1 });
  });

  it('updates dueAt on repeated enqueue for same conversation', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-1',
      isProviderEnabled,
      syncConversations,
    });

    await scheduler.enqueue(1, 'a');
    const firstDueAt = infraPack.storage[QUEUE_KEY]['1'];
    infraPack.advance(5_000);
    await scheduler.enqueue(1, 'b');
    const secondDueAt = infraPack.storage[QUEUE_KEY]['1'];
    expect(secondDueAt).toBeGreaterThan(firstDueAt);
  });

  it('schedules alarm at earliest dueAt across ids', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-1',
      isProviderEnabled,
      syncConversations,
    });

    await scheduler.enqueue(1, 'a'); // due at now+60s
    infraPack.advance(10_000);
    await scheduler.enqueue(2, 'a'); // due at now+60s, later than id1
    expect(infraPack.alarm.name).toBe(ALARM_NAME);
    expect(infraPack.alarm.when).toBe(infraPack.storage[QUEUE_KEY]['1']);
  });

  it('flush processes due items and removes them from queue', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    infraPack.storage[QUEUE_KEY] = { '1': infraPack.infra.now() - 1, '2': infraPack.infra.now() + 10_000 };
    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-2',
      isProviderEnabled,
      syncConversations,
    });

    await scheduler.flush();
    expect(syncConversations).toHaveBeenCalledWith([1], 'i-2');
    expect(infraPack.storage[QUEUE_KEY]).toEqual({ '2': infraPack.storage[QUEUE_KEY]['2'] });
  });

  it('flush does not sync when provider is disabled, but clears due items', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    infraPack.storage[QUEUE_KEY] = { '1': infraPack.infra.now() - 1 };
    isProviderEnabled.mockResolvedValue(false);
    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-3',
      isProviderEnabled,
      syncConversations,
    });

    await scheduler.flush();
    expect(syncConversations).not.toHaveBeenCalled();
    expect(infraPack.storage[QUEUE_KEY]).toEqual({});
  });

  it('dedupes concurrent flush calls (non-reentrant)', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    infraPack.storage[QUEUE_KEY] = { '1': infraPack.infra.now() - 1 };

    let resolveSync: (() => void) | null = null;
    const syncPromise = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });
    let markSyncCalled: (() => void) | null = null;
    const syncCalled = new Promise<void>((resolve) => {
      markSyncCalled = resolve;
    });
    syncConversations.mockImplementation(() => {
      markSyncCalled?.();
      return syncPromise;
    });

    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-6',
      isProviderEnabled,
      syncConversations,
    });

    const p1 = scheduler.flush();
    const p2 = scheduler.flush();
    expect(p2).toBe(p1);
    await syncCalled;
    expect(syncConversations).toHaveBeenCalledTimes(1);

    resolveSync?.();
    await p1;
    expect(infraPack.storage[QUEUE_KEY]).toEqual({});
  });

  it('keeps queue when sync_already_running is thrown (reschedules due items)', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    infraPack.storage[QUEUE_KEY] = { '1': infraPack.infra.now() - 1 };
    const err: any = new Error('sync already in progress');
    err.code = 'sync_already_running';
    syncConversations.mockRejectedValue(err);

    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-4',
      isProviderEnabled,
      syncConversations,
    });

    const before = infraPack.storage[QUEUE_KEY]['1'];
    await scheduler.flush();
    const after = infraPack.storage[QUEUE_KEY]['1'];
    expect(after).toBeGreaterThan(before);
  });

  it('optionally retains due items with a caller-defined retry delay after sync failure', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    infraPack.storage[QUEUE_KEY] = { '1': infraPack.infra.now() - 1, '2': infraPack.infra.now() + 30_000 };
    const err: any = new Error('temporary failure');
    err.code = 'temporary';
    syncConversations.mockRejectedValue(err);
    const getFailureRetryDelayMs = vi.fn(() => 120_000);
    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-retry',
      isProviderEnabled,
      syncConversations,
      getFailureRetryDelayMs,
    });

    const now = infraPack.infra.now();
    await scheduler.flush();

    expect(getFailureRetryDelayMs).toHaveBeenCalledWith(err);
    expect(infraPack.storage[QUEUE_KEY]).toEqual({ '1': now + 120_000, '2': now + 30_000 });
    expect(infraPack.alarm.when).toBe(now + 30_000);
  });

  it('preserves existing failure removal behavior when no retry policy is configured', async () => {
    infraPack.storage[ENABLED_KEY] = true;
    infraPack.storage[QUEUE_KEY] = { '1': infraPack.infra.now() - 1 };
    syncConversations.mockRejectedValue(new Error('ordinary provider failure'));
    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-default',
      isProviderEnabled,
      syncConversations,
    });

    await scheduler.flush();

    expect(infraPack.storage[QUEUE_KEY]).toEqual({});
  });

  it('flushes due items on enqueue when alarms are unavailable (best-effort fallback)', async () => {
    infraPack.storage[ENABLED_KEY] = true;

    // Make alarms unavailable.
    (infraPack.infra.alarms as any).isAvailable = () => false;

    // Seed a due item (e.g. queued while background was asleep).
    infraPack.storage[QUEUE_KEY] = { '1': infraPack.infra.now() - 1 };

    const scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-5',
      isProviderEnabled,
      syncConversations,
    });

    await scheduler.enqueue(2, 'activity');
    expect(syncConversations).toHaveBeenCalledWith([1], 'i-5');
  });
});
