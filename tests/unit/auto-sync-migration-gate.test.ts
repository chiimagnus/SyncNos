import { describe, expect, it, vi } from 'vitest';

import {
  createAutoSyncSchedulerCore,
  type AutoSyncSchedulerInfra,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

function infraPack(queue: unknown) {
  const store: Record<string, unknown> = { queue, enabled: true };
  const infra: AutoSyncSchedulerInfra = {
    now: () => 10_000,
    storage: {
      get: vi.fn(async (keys) => Object.fromEntries(keys.map((key) => [key, store[key]]))),
      set: vi.fn(async (patch) => Object.assign(store, patch)),
    },
    alarms: {
      isAvailable: () => true,
      create: vi.fn(() => true),
      clear: vi.fn(async () => true),
    },
  };
  return { infra, store };
}

function scheduler(gate: FactsOperationGate, pack: ReturnType<typeof infraPack>, extra: Record<string, any> = {}) {
  return createAutoSyncSchedulerCore({
    queueStorageKey: 'queue',
    enabledStorageKey: 'enabled',
    alarmName: 'alarm',
    debounceMs: 100,
    maxItems: 200,
    infra: pack.infra,
    getInstanceId: () => 'bg-1',
    isProviderEnabled: async () => true,
    runFactsOperation: gate.runFactsOperation.bind(gate),
    resolveConversationId: vi.fn(async () => 9),
    syncConversations: vi.fn(async () => {}),
    ...extra,
  });
}

describe('auto-sync migration gate', () => {
  it('mutates neither queue, alarm nor provider when migration has already closed admissions', async () => {
    const initial = { version: 2, entries: [{ source: 'chatgpt', conversationKey: 'thread', dueAt: 1 }] };
    const pack = infraPack(initial);
    const gate = new FactsOperationGate();
    gate.reopenForJournalState({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null });
    gate.closeAdmissions();
    const syncConversations = vi.fn(async () => {});
    const instance = scheduler(gate, pack, { syncConversations });

    await expect(instance.flush()).rejects.toMatchObject({ code: 'MIGRATION_IN_PROGRESS' });

    expect(pack.store.queue).toBe(initial);
    expect(pack.infra.storage.set).not.toHaveBeenCalled();
    expect(pack.infra.alarms.create).not.toHaveBeenCalled();
    expect(pack.infra.alarms.clear).not.toHaveBeenCalled();
    expect(syncConversations).not.toHaveBeenCalled();
  });

  it('never converts an old numeric queue after the Host backend is active', async () => {
    const legacy = { '7': 1 };
    const pack = infraPack(legacy);
    const gate = new FactsOperationGate();
    gate.reopenForJournalState({
      mode: 'active',
      journal: { stage: 'active' },
      factsEpoch: 'native:epoch',
      error: null,
    } as any);
    const resolveLegacyConversationId = vi.fn(async () => ({ source: 'chatgpt', conversationKey: 'thread' }));
    const syncConversations = vi.fn(async () => {});
    const instance = scheduler(gate, pack, {
      canConvertLegacyQueue: vi.fn(async () => false),
      resolveLegacyConversationId,
      syncConversations,
    });

    await instance.flush();

    expect(resolveLegacyConversationId).not.toHaveBeenCalled();
    expect(pack.infra.storage.set).not.toHaveBeenCalled();
    expect(pack.store.queue).toBe(legacy);
    expect(syncConversations).not.toHaveBeenCalled();
  });
});
