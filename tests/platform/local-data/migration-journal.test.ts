import { describe, expect, it } from 'vitest';

import {
  IDB_FACTS_EPOCH,
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseMigrationProfileReferencePatch,
  type MigrationProfileReferencePatch,
} from '@services/local-data/contracts';
import { FACT_STREAM_KINDS, createFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';
import {
  MIGRATION_JOURNAL_STORAGE_KEY,
  advanceMigrationJournal,
  beginMigrationJournal,
  factsEpochForMigrationJournal,
  migrationJournalResumeAction,
  readMigrationJournal,
  recordMigrationJournalFailure,
  type MigrationJournal,
  type MigrationJournalRuntime,
  type MigrationJournalStorage,
} from '../../../src/platform/local-data/migration-journal';

const MIGRATION_ID = '4a0bc3c9-02d8-4b92-8275-4279ae8af5e2';
const ORDERED_FRAME_DIGEST = 'a'.repeat(64);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemoryStorage implements MigrationJournalStorage {
  readonly getCalls: string[][] = [];
  readonly setCalls: Record<string, unknown>[] = [];
  failGet = false;
  failSet = false;
  rewrite: ((value: Record<string, unknown>) => Record<string, unknown>) | null = null;
  private readonly values = new Map<string, unknown>();

  async get(keys: string[]): Promise<Record<string, unknown>> {
    this.getCalls.push([...keys]);
    if (this.failGet) throw new Error('storage get failed');
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.values.has(key)) result[key] = clone(this.values.get(key));
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.setCalls.push(clone(items));
    if (this.failSet) throw new Error('storage set failed');
    const next = this.rewrite ? this.rewrite(clone(items)) : clone(items);
    for (const [key, value] of Object.entries(next)) this.values.set(key, clone(value));
  }

  raw(): unknown {
    return clone(this.values.get(MIGRATION_JOURNAL_STORAGE_KEY));
  }

  replaceRaw(value: unknown): void {
    this.values.set(MIGRATION_JOURNAL_STORAGE_KEY, clone(value));
  }
}

function createRuntime(storage: MemoryStorage): MigrationJournalRuntime {
  let timestamp = 10_000;
  return {
    storage,
    digestProvider: nodeDigestProvider,
    now: () => timestamp++,
    randomUUID: () => MIGRATION_ID,
  };
}

function counts(value: number): Record<(typeof FACT_STREAM_KINDS)[number], number> {
  return Object.fromEntries(FACT_STREAM_KINDS.map((kind) => [kind, value])) as Record<
    (typeof FACT_STREAM_KINDS)[number],
    number
  >;
}

function manifest(): FactsManifest {
  return createFactsManifest({
    migrationId: MIGRATION_ID,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    factCounts: counts(2),
    streamBytes: counts(64),
    orderedFrameDigest: ORDERED_FRAME_DIGEST,
  });
}

function referencePatch(): MigrationProfileReferencePatch {
  return parseMigrationProfileReferencePatch({
    version: 1,
    diagnostics: {
      staleQueueEntriesDropped: { notion: 0, obsidian: 1, feishu: 0 },
    },
    queues: {
      notion: [
        { source: 'chatgpt', conversationKey: 'conversation-z', dueAt: 40 },
        { source: 'chatgpt', conversationKey: 'conversation-a', dueAt: 20 },
      ],
      obsidian: [{ source: 'web', conversationKey: 'article-a', dueAt: 50 }],
      feishu: [],
    },
    syncJobs: {
      notion: {
        provider: 'notion',
        status: 'aborted',
        startedAt: 1,
        updatedAt: 2,
        finishedAt: 3,
        okCount: 4,
        failCount: 5,
        abortedReason: 'local_data_migration',
      },
      obsidian: {
        provider: 'obsidian',
        status: 'done',
        startedAt: 1,
        updatedAt: 2,
        finishedAt: 3,
        okCount: 4,
        failCount: 5,
      },
      feishu: null,
    },
  });
}

async function advanceToRemote(storage: MemoryStorage, runtime: MigrationJournalRuntime): Promise<MigrationJournal> {
  const staging = await beginMigrationJournal(runtime);
  return await advanceMigrationJournal({ expected: staging, stage: 'remote_committed', manifest: manifest() }, runtime);
}

async function expectErrorCode(callback: () => Promise<unknown>, code: LocalDataContractError['code']): Promise<void> {
  await expect(callback()).rejects.toMatchObject({ code });
}

describe('migration journal', () => {
  it('persists only legal durable stages and derives the facts epoch from validated state', async () => {
    const storage = new MemoryStorage();
    const runtime = createRuntime(storage);

    const notStarted = await readMigrationJournal(runtime);
    expect(notStarted).toEqual({ mode: 'not_started', journal: null, factsEpoch: IDB_FACTS_EPOCH, error: null });
    expect(factsEpochForMigrationJournal(notStarted)).toBe(IDB_FACTS_EPOCH);
    expect(migrationJournalResumeAction(notStarted)).toBe('start');

    const staging = await beginMigrationJournal(runtime);
    expect(staging).toMatchObject({
      version: 1,
      stage: 'staging',
      migrationId: MIGRATION_ID,
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    });
    expect(storage.setCalls).toHaveLength(1);
    expect(storage.setCalls[0]).toHaveProperty(MIGRATION_JOURNAL_STORAGE_KEY);

    const remote = await advanceMigrationJournal(
      { expected: staging, stage: 'remote_committed', manifest: manifest() },
      runtime,
    );
    expect(remote.stage).toBe('remote_committed');
    if (remote.stage !== 'remote_committed') throw new Error('expected remote_committed');
    expect(remote.manifest).toEqual(manifest());

    const profileRefsPending = await advanceMigrationJournal(
      { expected: remote, stage: 'profile_refs_pending', referencePatch: referencePatch() },
      runtime,
    );
    expect(profileRefsPending.stage).toBe('profile_refs_pending');
    if (profileRefsPending.stage !== 'profile_refs_pending') throw new Error('expected profile_refs_pending');
    expect(profileRefsPending.referencePatch.queues.notion.map((entry) => entry.conversationKey)).toEqual([
      'conversation-a',
      'conversation-z',
    ]);
    expect(profileRefsPending.referencePatchDigest).toMatch(/^[a-f0-9]{64}$/);

    const cleanupPending = await advanceMigrationJournal(
      { expected: profileRefsPending, stage: 'cleanup_pending' },
      runtime,
    );
    expect(cleanupPending.stage).toBe('cleanup_pending');
    if (cleanupPending.stage !== 'cleanup_pending') throw new Error('expected cleanup_pending');
    expect(cleanupPending.referencePatch).toEqual(profileRefsPending.referencePatch);
    expect(cleanupPending.referencePatchDigest).toBe(profileRefsPending.referencePatchDigest);

    const active = await advanceMigrationJournal({ expected: cleanupPending, stage: 'active' }, runtime);
    expect(active.stage).toBe('active');
    if (active.stage !== 'active') throw new Error('expected active');
    expect(active).toMatchObject({
      migrationId: MIGRATION_ID,
      profileReferencesCompleted: true,
      referencePatchDigest: cleanupPending.referencePatchDigest,
    });
    expect(active).not.toHaveProperty('referencePatch');

    const activeSnapshot = await readMigrationJournal(createRuntime(storage));
    expect(activeSnapshot.mode).toBe('active');
    expect(activeSnapshot.factsEpoch).toBe(`native:${MIGRATION_ID}`);
    expect(factsEpochForMigrationJournal(activeSnapshot)).toBe(`native:${MIGRATION_ID}`);
    expect(migrationJournalResumeAction(activeSnapshot)).toBe('active');

    const storedActive = JSON.stringify(storage.raw());
    expect(storedActive).not.toContain('conversation-a');
    expect(storedActive).not.toContain('conversation-z');
    expect(storedActive).not.toMatch(/conversationId|backendConversationId|oauth|token|\/Users\//i);
    for (const keys of storage.getCalls) expect(keys).toEqual([MIGRATION_JOURNAL_STORAGE_KEY]);
  });

  it('rejects skipped, stale, and backward transitions without replacing the committed journal', async () => {
    const storage = new MemoryStorage();
    const runtime = createRuntime(storage);
    const remote = await advanceToRemote(storage, runtime);
    const rawRemote = storage.raw();

    await expectErrorCode(
      () => advanceMigrationJournal({ expected: remote, stage: 'cleanup_pending' }, runtime),
      'MIGRATION_IN_PROGRESS',
    );
    await expectErrorCode(
      () => advanceMigrationJournal({ expected: remote, stage: 'active' }, runtime),
      'MIGRATION_IN_PROGRESS',
    );
    expect(storage.raw()).toEqual(rawRemote);

    const profileRefsPending = await advanceMigrationJournal(
      { expected: remote, stage: 'profile_refs_pending', referencePatch: referencePatch() },
      runtime,
    );
    await expectErrorCode(
      () =>
        advanceMigrationJournal(
          { expected: remote, stage: 'profile_refs_pending', referencePatch: referencePatch() },
          runtime,
        ),
      'MIGRATION_IN_PROGRESS',
    );

    const restarted = await readMigrationJournal(createRuntime(storage));
    expect(restarted.mode).toBe('transitional');
    expect(migrationJournalResumeAction(restarted)).toBe('apply-profile-reference-patch');
    expect(restarted.journal).toEqual(profileRefsPending);

    const retried = await advanceMigrationJournal(
      { expected: profileRefsPending, stage: 'profile_refs_pending' },
      runtime,
    );
    expect(retried.stage).toBe('profile_refs_pending');

    const cleanupPending = await advanceMigrationJournal({ expected: retried, stage: 'cleanup_pending' }, runtime);
    const active = await advanceMigrationJournal({ expected: cleanupPending, stage: 'active' }, runtime);
    await expectErrorCode(
      () => advanceMigrationJournal({ expected: active, stage: 'staging' }, runtime),
      'MIGRATION_IN_PROGRESS',
    );
    const activeRetry = await advanceMigrationJournal({ expected: active, stage: 'active' }, runtime);
    expect(activeRetry).toEqual(active);
    expect((await readMigrationJournal(runtime)).factsEpoch).toBe(`native:${MIGRATION_ID}`);
  });

  it('retains recoverable errors at their stage but never uses an error as a fallback mode', async () => {
    const storage = new MemoryStorage();
    const runtime = createRuntime(storage);
    const remote = await advanceToRemote(storage, runtime);
    const failed = await recordMigrationJournalFailure({ expected: remote, terminalCode: 'HOST_UNAVAILABLE' }, runtime);

    expect(failed).toMatchObject({ stage: 'remote_committed', terminalCode: 'HOST_UNAVAILABLE' });
    const snapshot = await readMigrationJournal(runtime);
    expect(snapshot.mode).toBe('transitional');
    expect(snapshot.factsEpoch).toBeNull();
    expect(migrationJournalResumeAction(snapshot)).toBe('verify-remote-receipt-and-create-profile-reference-patch');

    const resumed = await advanceMigrationJournal({ expected: failed, stage: 'remote_committed' }, runtime);
    expect(resumed.stage).toBe('remote_committed');
    expect(resumed).not.toHaveProperty('terminalCode');
  });

  it('fails closed on storage failures, partial rewrites, and malformed existing records', async () => {
    const failedStorage = new MemoryStorage();
    const failedRuntime = createRuntime(failedStorage);
    failedStorage.failSet = true;
    await expectErrorCode(() => beginMigrationJournal(failedRuntime), 'JOURNAL_CORRUPT');
    failedStorage.failSet = false;
    expect(await readMigrationJournal(failedRuntime)).toEqual({
      mode: 'not_started',
      journal: null,
      factsEpoch: IDB_FACTS_EPOCH,
      error: null,
    });

    const partialStorage = new MemoryStorage();
    const partialRuntime = createRuntime(partialStorage);
    partialStorage.rewrite = () => ({ [MIGRATION_JOURNAL_STORAGE_KEY]: { version: 1, stage: 'staging' } });
    await expectErrorCode(() => beginMigrationJournal(partialRuntime), 'JOURNAL_CORRUPT');
    partialStorage.rewrite = null;
    const partialSnapshot = await readMigrationJournal(partialRuntime);
    expect(partialSnapshot.mode).toBe('blocked');
    expect(partialSnapshot.factsEpoch).toBeNull();
    expect(partialSnapshot.error.code).toBe('JOURNAL_CORRUPT');

    const storage = new MemoryStorage();
    const runtime = createRuntime(storage);
    const remote = await advanceToRemote(storage, runtime);
    const malformed = storage.raw() as Record<string, unknown>;
    malformed.protocolVersion = LOCAL_DATA_PROTOCOL_VERSION + 1;
    storage.replaceRaw(malformed);
    const protocolMismatch = await readMigrationJournal(runtime);
    expect(protocolMismatch).toMatchObject({ mode: 'blocked', factsEpoch: null, error: { code: 'JOURNAL_CORRUPT' } });

    storage.replaceRaw({ ...remote, version: 999 });
    expect((await readMigrationJournal(runtime)).mode).toBe('blocked');
    storage.failGet = true;
    expect((await readMigrationJournal(runtime)).mode).toBe('blocked');
  });

  it('does not advance cleanup when writing the profile patch fails or is only partially stored', async () => {
    const storage = new MemoryStorage();
    const runtime = createRuntime(storage);
    const remote = await advanceToRemote(storage, runtime);
    const rawRemote = storage.raw();

    storage.failSet = true;
    await expectErrorCode(
      () =>
        advanceMigrationJournal(
          { expected: remote, stage: 'profile_refs_pending', referencePatch: referencePatch() },
          runtime,
        ),
      'JOURNAL_CORRUPT',
    );
    storage.failSet = false;
    expect(storage.raw()).toEqual(rawRemote);
    expect(migrationJournalResumeAction(await readMigrationJournal(runtime))).toBe(
      'verify-remote-receipt-and-create-profile-reference-patch',
    );

    storage.rewrite = (items) => ({
      [MIGRATION_JOURNAL_STORAGE_KEY]: {
        ...(items[MIGRATION_JOURNAL_STORAGE_KEY] as Record<string, unknown>),
        referencePatch: { version: 1 },
      },
    });
    await expectErrorCode(
      () =>
        advanceMigrationJournal(
          { expected: remote, stage: 'profile_refs_pending', referencePatch: referencePatch() },
          runtime,
        ),
      'JOURNAL_CORRUPT',
    );
    storage.rewrite = null;
    const blocked = await readMigrationJournal(runtime);
    expect(blocked).toMatchObject({ mode: 'blocked', factsEpoch: null, error: { code: 'JOURNAL_CORRUPT' } });
    expect(migrationJournalResumeAction(blocked)).toBe('blocked');
  });

  it('treats a tampered profile patch or digest as blocked and leaves it in place for recovery', async () => {
    const storage = new MemoryStorage();
    const runtime = createRuntime(storage);
    const remote = await advanceToRemote(storage, runtime);
    const profileRefsPending = await advanceMigrationJournal(
      { expected: remote, stage: 'profile_refs_pending', referencePatch: referencePatch() },
      runtime,
    );
    if (profileRefsPending.stage !== 'profile_refs_pending') throw new Error('expected profile_refs_pending');

    const tampered = storage.raw() as Record<string, any>;
    tampered.referencePatch.queues.notion[0].conversationKey = 'different-conversation';
    storage.replaceRaw(tampered);
    const blocked = await readMigrationJournal(runtime);
    expect(blocked).toMatchObject({ mode: 'blocked', factsEpoch: null, error: { code: 'JOURNAL_CORRUPT' } });
    expect(storage.raw()).toMatchObject({ referencePatchDigest: profileRefsPending.referencePatchDigest });
    await expectErrorCode(
      () => advanceMigrationJournal({ expected: profileRefsPending, stage: 'cleanup_pending' }, runtime),
      'JOURNAL_CORRUPT',
    );
  });
});
