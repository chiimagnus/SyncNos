import { readMigrationJournal, type MigrationJournalSnapshot } from '@platform/local-data/migration-journal';
import { LocalDataContractError, assertFactsEpochMatches, createLocalDataError, type FactsEpoch } from './contracts';
import { assertFactsOperationLease, type FactsOperationLease } from './facts-operation-gate';

export type FactsBackendMode = 'idb' | 'native';

export type BoundFactsRepository<TRepository> = Readonly<{
  factsEpoch: FactsEpoch;
  mode: FactsBackendMode;
  repository: TRepository;
}>;

export type FactsBackendDependencies<TRepository> = Readonly<{
  createIdbRepository: (lease: FactsOperationLease) => TRepository;
  createNativeRepository: (lease: FactsOperationLease) => TRepository;
  readJournal?: () => Promise<MigrationJournalSnapshot>;
}>;

function blockedJournalSnapshot(): MigrationJournalSnapshot {
  return {
    mode: 'blocked',
    journal: null,
    factsEpoch: null,
    error: createLocalDataError('JOURNAL_CORRUPT'),
  };
}

function journalError(snapshot: MigrationJournalSnapshot): LocalDataContractError {
  if (snapshot.mode === 'blocked') return new LocalDataContractError(snapshot.error.code, snapshot.error.diagnostics);
  return new LocalDataContractError('MIGRATION_IN_PROGRESS');
}

/** Chooses facts storage only after a live lease and the durable journal agree on one backend. */
export class FactsBackend<TRepository> {
  constructor(private readonly dependencies: FactsBackendDependencies<TRepository>) {}

  async open(lease: FactsOperationLease, expectedFactsEpoch?: unknown): Promise<BoundFactsRepository<TRepository>> {
    assertFactsOperationLease(lease);
    let snapshot: MigrationJournalSnapshot;
    try {
      snapshot = await (this.dependencies.readJournal ?? readMigrationJournal)();
    } catch {
      snapshot = blockedJournalSnapshot();
    }
    assertFactsOperationLease(lease);

    if (snapshot.mode !== 'not_started' && snapshot.mode !== 'active') throw journalError(snapshot);
    if (expectedFactsEpoch !== undefined) assertFactsEpochMatches(snapshot.factsEpoch, expectedFactsEpoch);

    return Object.freeze({
      factsEpoch: snapshot.factsEpoch,
      mode: snapshot.mode === 'not_started' ? 'idb' : 'native',
      repository:
        snapshot.mode === 'not_started'
          ? this.dependencies.createIdbRepository(lease)
          : this.dependencies.createNativeRepository(lease),
    });
  }
}
