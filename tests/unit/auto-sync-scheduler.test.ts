import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAutoSyncSchedulerCore,
  type AutoSyncScheduler,
  type AutoSyncSchedulerInfra,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

const REF_1 = { source: 'chatgpt', conversationKey: 'conversation-1' } as const;
const REF_2 = { source: 'chatgpt', conversationKey: 'conversation-2' } as const;

function makeInfra(startNow = 1_000_000) {
  let now = startNow;
  const storage: Record<string, any> = {};
  const alarm = { name: '', when: 0, cleared: false };
  const infra: AutoSyncSchedulerInfra = {
    now: () => now,
    storage: {
      get: async (keys) => Object.fromEntries(keys.map((key) => [key, storage[key]])),
      set: async (patch) => Object.assign(storage, patch),
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
  };
}

function entries(storage: Record<string, any>, key: string) {
  return storage[key]?.entries ?? [];
}

function makeGate() {
  const gate = new FactsOperationGate({
    readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
  });
  return gate;
}

describe('auto-sync-scheduler-core', () => {
  const QUEUE_KEY = 'queue_key';
  const ENABLED_KEY = 'enabled_key';
  const ALARM_NAME = 'alarm_name';

  let infraPack: ReturnType<typeof makeInfra>;
  let gate: FactsOperationGate;
  let isProviderEnabled: ReturnType<typeof vi.fn>;
  let syncConversations: ReturnType<typeof vi.fn>;
  let scheduler: AutoSyncScheduler;

  beforeEach(async () => {
    infraPack = makeInfra();
    infraPack.storage[ENABLED_KEY] = true;
    gate = makeGate();
    await gate.initializeFromJournal();
    isProviderEnabled = vi.fn().mockResolvedValue(true);
    syncConversations = vi.fn().mockResolvedValue(undefined);
    scheduler = createAutoSyncSchedulerCore({
      queueStorageKey: QUEUE_KEY,
      enabledStorageKey: ENABLED_KEY,
      alarmName: ALARM_NAME,
      debounceMs: 60_000,
      maxItems: 200,
      infra: infraPack.infra,
      getInstanceId: () => 'i-1',
      isProviderEnabled,
      runFactsOperation: gate.runFactsOperation.bind(gate),
      resolveConversationId: async (reference) => (reference.conversationKey === REF_1.conversationKey ? 1 : 2),
      syncConversations,
    });
  });

  const enqueue = async (target: typeof REF_1 | typeof REF_2, reason = 'activity') =>
    await gate.runFactsOperation('test-mutation', async (lease) => await scheduler.enqueue(target, reason, lease));

  it('updates dueAt on repeated enqueue for the same stable conversation', async () => {
    await enqueue(REF_1, 'a');
    const firstDueAt = entries(infraPack.storage, QUEUE_KEY)[0].dueAt;
    infraPack.advance(5_000);
    await enqueue(REF_1, 'b');
    const queue = entries(infraPack.storage, QUEUE_KEY);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject(REF_1);
    expect(queue[0].dueAt).toBeGreaterThan(firstDueAt);
  });

  it('schedules the alarm at the earliest stable entry dueAt', async () => {
    await enqueue(REF_1);
    infraPack.advance(10_000);
    await enqueue(REF_2);
    const queue = entries(infraPack.storage, QUEUE_KEY);
    expect(infraPack.alarm.name).toBe(ALARM_NAME);
    expect(infraPack.alarm.when).toBe(
      queue.find((entry: any) => entry.conversationKey === REF_1.conversationKey).dueAt,
    );
  });

  it('flush resolves due stable references inside one outer lease', async () => {
    infraPack.storage[QUEUE_KEY] = {
      version: 2,
      entries: [
        { ...REF_1, dueAt: infraPack.infra.now() - 1 },
        { ...REF_2, dueAt: infraPack.infra.now() + 10_000 },
      ],
    };
    await scheduler.flush();
    expect(syncConversations).toHaveBeenCalledTimes(1);
    expect(syncConversations.mock.calls[0][0]).toEqual([expect.objectContaining({ ...REF_1, conversationId: 1 })]);
    expect(entries(infraPack.storage, QUEUE_KEY)).toEqual([expect.objectContaining(REF_2)]);
  });

  it('drops due entries without remote sync when provider is disabled', async () => {
    infraPack.storage[QUEUE_KEY] = { version: 2, entries: [{ ...REF_1, dueAt: infraPack.infra.now() - 1 }] };
    isProviderEnabled.mockResolvedValue(false);
    await scheduler.flush();
    expect(syncConversations).not.toHaveBeenCalled();
    expect(entries(infraPack.storage, QUEUE_KEY)).toEqual([]);
  });

  it('dedupes concurrent flush calls', async () => {
    infraPack.storage[QUEUE_KEY] = { version: 2, entries: [{ ...REF_1, dueAt: infraPack.infra.now() - 1 }] };
    let resolveSync!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });
    syncConversations.mockReturnValue(pending);
    const p1 = scheduler.flush();
    const p2 = scheduler.flush();
    expect(p2).toBe(p1);
    await vi.waitFor(() => expect(syncConversations).toHaveBeenCalledTimes(1));
    resolveSync();
    await p1;
    expect(entries(infraPack.storage, QUEUE_KEY)).toEqual([]);
  });

  it('reschedules stable entries when provider reports sync_already_running', async () => {
    infraPack.storage[QUEUE_KEY] = { version: 2, entries: [{ ...REF_1, dueAt: infraPack.infra.now() - 1 }] };
    const error = Object.assign(new Error('sync already in progress'), { code: 'sync_already_running' });
    syncConversations.mockRejectedValue(error);
    const before = entries(infraPack.storage, QUEUE_KEY)[0].dueAt;
    await scheduler.flush();
    const after = entries(infraPack.storage, QUEUE_KEY)[0].dueAt;
    expect(after).toBeGreaterThan(before);
    expect(entries(infraPack.storage, QUEUE_KEY)[0]).toMatchObject(REF_1);
  });

  it('reuses the mutation lease for the no-alarms opportunistic flush', async () => {
    (infraPack.infra.alarms as any).isAvailable = () => false;
    infraPack.storage[QUEUE_KEY] = { version: 2, entries: [{ ...REF_1, dueAt: infraPack.infra.now() - 1 }] };
    await enqueue(REF_2);
    expect(syncConversations).toHaveBeenCalledTimes(1);
    expect(syncConversations.mock.calls[0][0][0]).toMatchObject(REF_1);
  });
});
