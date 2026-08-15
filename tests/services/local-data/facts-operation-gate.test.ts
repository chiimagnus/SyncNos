import { describe, expect, it } from 'vitest';

import {
  FactsOperationGate,
  assertFactsOperationLease,
  type FactsOperationLease,
} from '@services/local-data/facts-operation-gate';
import type { MigrationJournalSnapshot } from '@platform/local-data/migration-journal';

const notStarted: MigrationJournalSnapshot = {
  mode: 'not_started',
  journal: null,
  factsEpoch: 'idb-v1',
  error: null,
};

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

const blocked = {
  mode: 'blocked',
  factsEpoch: null,
  journal: null,
  error: { code: 'JOURNAL_CORRUPT', message: 'Local data migration journal is invalid.', retryable: false },
} as MigrationJournalSnapshot;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('facts operation gate', () => {
  it('initializes from the durable journal and expires each lease after its callback', async () => {
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await expect(gate.initializeFromJournal()).resolves.toBe(notStarted);
    expect(gate.allowsFactsOperations).toBe(true);

    let lease: FactsOperationLease | null = null;
    await expect(
      gate.runFactsOperation('conversation-read', async (currentLease) => {
        lease = currentLease;
        assertFactsOperationLease(currentLease);
        return 'ok';
      }),
    ).resolves.toBe('ok');

    let expiredError: unknown;
    try {
      assertFactsOperationLease(lease!);
    } catch (error) {
      expiredError = error;
    }
    expect(expiredError).toMatchObject({ code: 'MIGRATION_IN_PROGRESS' });
  });

  it('closes admissions immediately and waits for every accepted operation to drain', async () => {
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();
    const started = deferred<void>();
    const release = deferred<void>();
    const running = gate.runFactsOperation('capture', async (lease) => {
      assertFactsOperationLease(lease);
      started.resolve();
      await release.promise;
      assertFactsOperationLease(lease);
      return 'saved';
    });
    await started.promise;

    gate.closeAdmissions();
    await expect(gate.runFactsOperation('later-read', async () => 'unsafe')).rejects.toMatchObject({
      code: 'MIGRATION_IN_PROGRESS',
    });

    let drained = false;
    const wait = gate.waitForDrained().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    release.resolve();
    await expect(running).resolves.toBe('saved');
    await wait;
    expect(drained).toBe(true);
  });

  it('keeps restart, transitional, and corrupt journals fail-closed until an allowed state is reopened', async () => {
    const gate = new FactsOperationGate({ readJournal: async () => transitional });
    await gate.initializeFromJournal();

    await expect(gate.runFactsOperation('restart-read', async () => 'unsafe')).rejects.toMatchObject({
      code: 'MIGRATION_IN_PROGRESS',
    });

    gate.reopenForJournalState(active);
    await expect(gate.runFactsOperation('native-read', async () => 'safe')).resolves.toBe('safe');

    gate.reopenForJournalState(blocked);
    await expect(gate.runFactsOperation('corrupt-read', async () => 'unsafe')).rejects.toMatchObject({
      code: 'JOURNAL_CORRUPT',
    });
  });

  it('treats a journal read failure as corrupt and keeps admissions closed', async () => {
    const gate = new FactsOperationGate({
      readJournal: async () => {
        throw new Error('storage unavailable');
      },
    });

    await expect(gate.initializeFromJournal()).resolves.toMatchObject({
      mode: 'blocked',
      error: { code: 'JOURNAL_CORRUPT' },
    });
    await expect(gate.runFactsOperation('unsafe-recovery', async () => 'unsafe')).rejects.toMatchObject({
      code: 'JOURNAL_CORRUPT',
    });
  });
});
