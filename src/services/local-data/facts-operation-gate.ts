import { LocalDataContractError, createLocalDataError } from './contracts';
import { readMigrationJournal, type MigrationJournalSnapshot } from '@platform/local-data/migration-journal';

const factsOperationLeaseBrand: unique symbol = Symbol('syncnos.facts-operation-lease');
const activeLeases = new WeakSet<object>();

export type FactsOperationLease = Readonly<{
  readonly [factsOperationLeaseBrand]: true;
}>;

export type FactsOperationGateDependencies = Readonly<{
  readJournal?: () => Promise<MigrationJournalSnapshot>;
}>;

function admissionError(snapshot: MigrationJournalSnapshot | null): LocalDataContractError {
  if (snapshot?.mode === 'blocked') return new LocalDataContractError(snapshot.error.code, snapshot.error.diagnostics);
  return new LocalDataContractError('MIGRATION_IN_PROGRESS');
}

function acceptsAdmissions(snapshot: MigrationJournalSnapshot): boolean {
  return snapshot.mode === 'not_started' || snapshot.mode === 'active';
}

function createLease(): FactsOperationLease {
  const lease = Object.freeze({ [factsOperationLeaseBrand]: true }) as FactsOperationLease;
  activeLeases.add(lease);
  return lease;
}

/** Rejects forged or expired capabilities before an adapter touches facts storage. */
export function assertFactsOperationLease(lease: FactsOperationLease): void {
  if (!lease || typeof lease !== 'object' || !activeLeases.has(lease)) {
    throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
  }
}

/**
 * Serializes only admission state, not facts work: accepted operations run concurrently and
 * migration waits for their complete boundary before it reads the source facts.
 */
export class FactsOperationGate {
  #admissionsClosed = true;
  #drainWaiters = new Set<() => void>();
  #inFlight = 0;
  #snapshot: MigrationJournalSnapshot | null = null;

  constructor(private readonly dependencies: FactsOperationGateDependencies = {}) {}

  get journalSnapshot(): MigrationJournalSnapshot | null {
    return this.#snapshot;
  }

  get allowsFactsOperations(): boolean {
    return !this.#admissionsClosed && this.#snapshot !== null && acceptsAdmissions(this.#snapshot);
  }

  async initializeFromJournal(): Promise<MigrationJournalSnapshot> {
    let snapshot: MigrationJournalSnapshot;
    try {
      snapshot = await (this.dependencies.readJournal ?? readMigrationJournal)();
    } catch {
      snapshot = {
        mode: 'blocked',
        journal: null,
        factsEpoch: null,
        error: createLocalDataError('JOURNAL_CORRUPT'),
      };
    }
    this.reopenForJournalState(snapshot);
    return snapshot;
  }

  closeAdmissions(): void {
    this.#admissionsClosed = true;
  }

  async waitForDrained(): Promise<void> {
    if (this.#inFlight === 0) return;
    await new Promise<void>((resolve) => this.#drainWaiters.add(resolve));
  }

  reopenForJournalState(snapshot: MigrationJournalSnapshot): void {
    this.#snapshot = snapshot;
    this.#admissionsClosed = !acceptsAdmissions(snapshot);
  }

  async runFactsOperation<T>(kind: string, fn: (lease: FactsOperationLease) => Promise<T> | T): Promise<T> {
    if (typeof kind !== 'string' || !kind.trim() || typeof fn !== 'function') {
      throw new LocalDataContractError('INVALID_ARGUMENT');
    }
    if (!this.allowsFactsOperations) throw admissionError(this.#snapshot);

    this.#inFlight += 1;
    const lease = createLease();
    try {
      return await fn(lease);
    } finally {
      activeLeases.delete(lease);
      this.#inFlight -= 1;
      if (this.#inFlight === 0) {
        for (const resolve of this.#drainWaiters) resolve();
        this.#drainWaiters.clear();
      }
    }
  }
}
