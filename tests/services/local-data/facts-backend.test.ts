import { describe, expect, it, vi } from 'vitest';

import type { MigrationJournalSnapshot } from '@platform/local-data/migration-journal';
import { FactsBackend } from '@services/local-data/facts-backend';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

const notStarted = {
  mode: 'not_started',
  journal: null,
  factsEpoch: 'idb-v1',
  error: null,
} as const satisfies MigrationJournalSnapshot;

const active = {
  mode: 'active',
  factsEpoch: 'native:550e8400-e29b-41d4-a716-446655440000',
  error: null,
  journal: { stage: 'active' },
} as unknown as MigrationJournalSnapshot;

const transitional = {
  mode: 'transitional',
  factsEpoch: null,
  error: null,
  journal: { stage: 'staging' },
} as unknown as MigrationJournalSnapshot;

describe('facts backend', () => {
  it('chooses exactly one lease-bound repository from the durable journal', async () => {
    const createIdbRepository = vi.fn(() => ({ kind: 'idb' }));
    const createNativeRepository = vi.fn(() => ({ kind: 'native' }));
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();
    const backend = new FactsBackend({
      createIdbRepository,
      createNativeRepository,
      readJournal: async () => notStarted,
    });

    await gate.runFactsOperation('idb-read', async (lease) => {
      await expect(backend.open(lease)).resolves.toMatchObject({ factsEpoch: 'idb-v1', mode: 'idb' });
    });

    expect(createIdbRepository).toHaveBeenCalledOnce();
    expect(createNativeRepository).not.toHaveBeenCalled();
  });

  it('uses Native only for an active journal and validates a caller epoch before opening it', async () => {
    const createIdbRepository = vi.fn(() => ({ kind: 'idb' }));
    const createNativeRepository = vi.fn(() => ({ kind: 'native' }));
    const gate = new FactsOperationGate({ readJournal: async () => active });
    await gate.initializeFromJournal();
    const backend = new FactsBackend({ createIdbRepository, createNativeRepository, readJournal: async () => active });

    await gate.runFactsOperation('native-read', async (lease) => {
      await expect(backend.open(lease, active.factsEpoch)).resolves.toMatchObject({
        factsEpoch: active.factsEpoch,
        mode: 'native',
      });
      await expect(backend.open(lease, 'idb-v1')).rejects.toMatchObject({ code: 'STALE_BACKEND_EPOCH' });
    });

    expect(createNativeRepository).toHaveBeenCalledOnce();
    expect(createIdbRepository).not.toHaveBeenCalled();
  });

  it('rejects transitional and unreadable journals before either repository can be created', async () => {
    const createIdbRepository = vi.fn(() => ({ kind: 'idb' }));
    const createNativeRepository = vi.fn(() => ({ kind: 'native' }));
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();

    const transitionalBackend = new FactsBackend({
      createIdbRepository,
      createNativeRepository,
      readJournal: async () => transitional,
    });
    const brokenBackend = new FactsBackend({
      createIdbRepository,
      createNativeRepository,
      readJournal: async () => {
        throw new Error('journal unavailable');
      },
    });

    await gate.runFactsOperation('blocked-read', async (lease) => {
      await expect(transitionalBackend.open(lease)).rejects.toMatchObject({ code: 'MIGRATION_IN_PROGRESS' });
      await expect(brokenBackend.open(lease)).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
    });

    expect(createIdbRepository).not.toHaveBeenCalled();
    expect(createNativeRepository).not.toHaveBeenCalled();
  });
});
