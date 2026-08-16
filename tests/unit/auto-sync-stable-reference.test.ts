import { describe, expect, it, vi } from 'vitest';

import {
  createAutoSyncSchedulerCore,
  type AutoSyncSchedulerInfra,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

function setup(initialQueue: unknown = undefined) {
  let now = 1_000;
  const store: Record<string, any> = { enabled: true, ...(initialQueue === undefined ? {} : { queue: initialQueue }) };
  const infra: AutoSyncSchedulerInfra = {
    now: () => now,
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
  const gate = new FactsOperationGate();
  gate.reopenForJournalState({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null });
  return { infra, store, gate, setNow: (value: number) => (now = value) };
}

function create(pack: ReturnType<typeof setup>, resolveConversationId = vi.fn(async () => 91)) {
  const syncConversations = vi.fn(async () => {});
  return {
    syncConversations,
    scheduler: createAutoSyncSchedulerCore({
      queueStorageKey: 'queue',
      enabledStorageKey: 'enabled',
      alarmName: 'alarm',
      debounceMs: 100,
      maxItems: 200,
      infra: pack.infra,
      getInstanceId: () => 'bg',
      isProviderEnabled: async () => true,
      runFactsOperation: pack.gate.runFactsOperation.bind(pack.gate),
      resolveConversationId,
      syncConversations,
    }),
  };
}

describe('auto-sync stable references', () => {
  it('persists and dedupes the queue by source + conversationKey without a numeric ID', async () => {
    const pack = setup();
    const { scheduler } = create(pack);
    const reference = { source: 'chatgpt', conversationKey: 'thread-stable' };

    await pack.gate.runFactsOperation('enqueue', async (lease) => {
      await scheduler.enqueue(reference, 'first', lease);
      pack.setNow(1_050);
      await scheduler.enqueue(reference, 'second', lease);
    });

    expect(pack.store.queue).toEqual({
      version: 2,
      entries: [{ source: 'chatgpt', conversationKey: 'thread-stable', dueAt: 1_150 }],
    });
    expect(JSON.stringify(pack.store.queue)).not.toContain('conversationId');
  });

  it('re-resolves a queued stable identity to the replacement row ID at flush time', async () => {
    const pack = setup({
      version: 2,
      entries: [{ source: 'chatgpt', conversationKey: 'thread-stable', dueAt: 1 }],
    });
    const resolveConversationId = vi.fn(async () => 204);
    const { scheduler, syncConversations } = create(pack, resolveConversationId);

    await scheduler.flush();

    expect(resolveConversationId).toHaveBeenCalledWith(
      { source: 'chatgpt', conversationKey: 'thread-stable', dueAt: 1 },
      expect.any(Object),
    );
    expect(syncConversations).toHaveBeenCalledWith(
      [{ source: 'chatgpt', conversationKey: 'thread-stable', dueAt: 1, conversationId: 204 }],
      'bg',
      expect.any(Object),
    );
    expect(pack.store.queue).toEqual({ version: 2, entries: [] });
  });

  it('drops only an identity that no longer exists and never invokes the provider with a stale numeric handle', async () => {
    const pack = setup({
      version: 2,
      entries: [{ source: 'chatgpt', conversationKey: 'deleted-thread', dueAt: 1 }],
    });
    const { scheduler, syncConversations } = create(
      pack,
      vi.fn(async () => null),
    );

    await scheduler.flush();

    expect(syncConversations).not.toHaveBeenCalled();
    expect(pack.store.queue).toEqual({ version: 2, entries: [] });
  });
});
