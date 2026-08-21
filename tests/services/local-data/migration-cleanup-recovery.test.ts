import { describe, expect, it, vi } from 'vitest';

import {
  advanceMigrationJournal,
  beginMigrationJournal,
  readMigrationJournal,
  type MigrationJournalRuntime,
} from '@platform/local-data/migration-journal';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseMigrationProfileReferencePatch,
  type FactsMigrationReceipt,
  type MigrationProfileReferencePatch,
} from '@services/local-data/contracts';
import { sha256Hex } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { createFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';
import {
  createMigrationCoordinator,
  type MigrationRuntimeEnvironment,
} from '@services/local-data/migration-coordinator';
import type { ProfileReferenceRebase } from '@services/local-data/profile-reference-rebase';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';

const MIGRATION_ID = '11111111-1111-4111-8111-111111111111';
const ZERO_COUNTS = Object.freeze({
  conversations: 0,
  sync_mappings: 0,
  messages: 0,
  image_cache: 0,
  article_comments: 0,
});
const FACT_COUNTS = Object.freeze({
  conversations: 2,
  sync_mappings: 1,
  messages: 3,
  image_cache: 1,
  article_comments: 2,
});

function environment(): MigrationRuntimeEnvironment {
  return { browser: 'chrome', officialIdentity: true, platform: 'unknown', supported: true };
}

function manifest(): FactsManifest {
  return createFactsManifest({
    migrationId: MIGRATION_ID,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    factCounts: FACT_COUNTS,
    streamBytes: FACT_COUNTS,
    orderedFrameDigest: 'a'.repeat(64),
  });
}

function patch(): MigrationProfileReferencePatch {
  return parseMigrationProfileReferencePatch({
    version: 1,
    diagnostics: { staleQueueEntriesDropped: { notion: 0, obsidian: 0, feishu: 0 } },
    queues: {
      notion: [{ source: 'chatgpt', conversationKey: 'c1', dueAt: 100 }],
      obsidian: [],
      feishu: [],
    },
    syncJobs: { notion: null, obsidian: null, feishu: null },
  });
}

async function receiptFor(value: FactsManifest, overrides: Partial<FactsMigrationReceipt> = {}) {
  return {
    alreadyCommitted: true,
    commentAmbiguity: { groupCount: 0, samples: [] },
    complete: true,
    factCounts: value.factCounts,
    factsRevision: 5,
    manifestDigest: await sha256Hex(nodeDigestProvider, encodeCanonicalJson(value).bytes),
    migrationId: value.migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    ...overrides,
  } as FactsMigrationReceipt;
}

function runtime(): MigrationJournalRuntime {
  const values = new Map<string, unknown>();
  let timestamp = 100;
  return {
    digestProvider: nodeDigestProvider,
    now: () => ++timestamp,
    randomUUID: () => MIGRATION_ID,
    storage: {
      async get(keys) {
        return Object.fromEntries(
          keys.filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))]),
        );
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
      },
    },
  };
}

async function seedStage(
  journalRuntime: MigrationJournalRuntime,
  stage: 'remote_committed' | 'profile_refs_pending' | 'cleanup_pending',
) {
  const staging = await beginMigrationJournal(journalRuntime);
  const remote = await advanceMigrationJournal(
    { expected: staging, stage: 'remote_committed', manifest: manifest() },
    journalRuntime,
  );
  if (stage === 'remote_committed') return remote;
  const profile = await advanceMigrationJournal(
    { expected: remote, stage: 'profile_refs_pending', referencePatch: patch() },
    journalRuntime,
  );
  if (stage === 'profile_refs_pending') return profile;
  return await advanceMigrationJournal({ expected: profile, stage: 'cleanup_pending' }, journalRuntime);
}

function gate(events: string[] = []) {
  return {
    closeAdmissions: vi.fn(() => events.push('gate:close')),
    waitForDrained: vi.fn(async () => events.push('gate:drain')),
    reopenForJournalState: vi.fn((snapshot: any) =>
      events.push(`gate:${snapshot.mode}:${snapshot.journal?.stage ?? 'none'}`),
    ),
  };
}

function profileReferences(overrides: Partial<ProfileReferenceRebase> = {}) {
  return {
    buildPatch: vi.fn(async () => patch()),
    applyAndVerify: vi.fn(async () => {}),
    verifyApplied: vi.fn(async () => {}),
    ...overrides,
  } as ProfileReferenceRebase;
}

function nativeRequest(receipt: FactsMigrationReceipt | null) {
  return vi.fn(async (command: string) => {
    if (command === 'GET_STATUS')
      return { databaseUuid: 'private', factsRevision: 5, fts: { available: true, reason: null } };
    if (command === 'GET_MIGRATION_RECEIPT') return receipt;
    throw new Error(`unexpected command ${command}`);
  });
}

function cleanupDependencies(input: {
  journalRuntime: MigrationJournalRuntime;
  profile?: ProfileReferenceRebase;
  receipt: FactsMigrationReceipt | null;
  clearSourceFacts?: () => Promise<void>;
  verifySourceFactsEmpty?: () => Promise<{ counts: typeof ZERO_COUNTS; empty: boolean }>;
  events?: string[];
  rearmSchedulers?: () => Promise<void>;
  onActivated?: () => void | Promise<void>;
}) {
  return {
    digestProvider: nodeDigestProvider,
    gate: gate(input.events),
    journalRuntime: input.journalRuntime,
    nativeRequest: nativeRequest(input.receipt),
    profileReferences: input.profile ?? profileReferences(),
    readEnvironment: environment,
    clearSourceFacts: input.clearSourceFacts ?? vi.fn(async () => {}),
    verifySourceFactsEmpty: input.verifySourceFactsEmpty ?? vi.fn(async () => ({ counts: ZERO_COUNTS, empty: true })),
    rearmSchedulers: input.rearmSchedulers ?? vi.fn(async () => {}),
    onActivated: input.onActivated ?? vi.fn(async () => {}),
  };
}

async function expectActive(journalRuntime: MigrationJournalRuntime) {
  const snapshot = await readMigrationJournal(journalRuntime);
  expect(snapshot.mode).toBe('active');
  if (snapshot.mode === 'active') {
    expect(snapshot.journal).toMatchObject({
      migrationId: MIGRATION_ID,
      stage: 'active',
      profileReferencesCompleted: true,
    });
    expect(snapshot.factsEpoch).toBe(`native:${MIGRATION_ID}`);
  }
}

async function expectStage(journalRuntime: MigrationJournalRuntime, stage: string, terminalCode?: string) {
  const snapshot = await readMigrationJournal(journalRuntime);
  expect(snapshot.mode).toBe(terminalCode ? 'failed' : 'transitional');
  if (snapshot.mode === 'transitional' || snapshot.mode === 'failed') {
    expect(snapshot.journal).toMatchObject({ stage, ...(terminalCode ? { terminalCode } : {}) });
  }
}

describe('migration cleanup recovery', () => {
  it('recovers remote_committed by generating a durable patch before sidecar writes, then clears and activates', async () => {
    const journalRuntime = runtime();
    await seedStage(journalRuntime, 'remote_committed');
    const receipt = await receiptFor(manifest());
    const refs = profileReferences();
    const events: string[] = [];
    refs.buildPatch = vi.fn(async () => {
      events.push('patch:build');
      return patch();
    });
    refs.applyAndVerify = vi.fn(async () => events.push('patch:apply'));
    refs.verifyApplied = vi.fn(async () => events.push('patch:verify'));
    const clearSourceFacts = vi.fn(async () => events.push('facts:clear'));
    const verifySourceFactsEmpty = vi.fn(async () => {
      events.push('facts:verify-empty');
      return { counts: ZERO_COUNTS, empty: true };
    });
    const rearmSchedulers = vi.fn(async () => events.push('schedulers:rearm'));
    const onActivated = vi.fn(async () => events.push('event:active'));
    const deps = cleanupDependencies({
      journalRuntime,
      profile: refs,
      receipt,
      clearSourceFacts,
      verifySourceFactsEmpty,
      events,
      rearmSchedulers,
      onActivated,
    });

    const coordinator = createMigrationCoordinator(deps);
    await coordinator.recover();
    const status = await coordinator.getStatus();

    expect(status.journal).toMatchObject({ mode: 'active', stage: 'active' });
    expect(events.indexOf('patch:build')).toBeLessThan(events.indexOf('patch:apply'));
    expect(events.indexOf('patch:apply')).toBeLessThan(events.indexOf('patch:verify'));
    expect(events.indexOf('patch:verify')).toBeLessThan(events.indexOf('facts:clear'));
    expect(events.indexOf('facts:clear')).toBeLessThan(events.indexOf('facts:verify-empty'));
    expect(events.indexOf('facts:verify-empty')).toBeLessThan(events.indexOf('schedulers:rearm'));
    expect(events.indexOf('schedulers:rearm')).toBeLessThan(events.indexOf('event:active'));
    expect(refs.buildPatch).toHaveBeenCalledTimes(1);
    expect(refs.applyAndVerify).toHaveBeenCalledTimes(1);
    expect(refs.verifyApplied).toHaveBeenCalledTimes(1);
    await expectActive(journalRuntime);
  });

  it('recovers profile_refs_pending by replaying only the durable patch without re-reading old numeric references', async () => {
    const journalRuntime = runtime();
    await seedStage(journalRuntime, 'profile_refs_pending');
    const refs = profileReferences();
    const deps = cleanupDependencies({ journalRuntime, profile: refs, receipt: await receiptFor(manifest()) });

    await createMigrationCoordinator(deps).recover();

    expect(refs.buildPatch).not.toHaveBeenCalled();
    expect(refs.applyAndVerify).toHaveBeenCalledTimes(1);
    expect(refs.verifyApplied).toHaveBeenCalledTimes(1);
    await expectActive(journalRuntime);
  });

  it('recovers cleanup_pending by verifying receipt and the already-applied sidecar before any clear', async () => {
    const journalRuntime = runtime();
    await seedStage(journalRuntime, 'cleanup_pending');
    const events: string[] = [];
    const refs = profileReferences({ verifyApplied: vi.fn(async () => events.push('patch:verify')) });
    const clearSourceFacts = vi.fn(async () => events.push('facts:clear'));
    const deps = cleanupDependencies({
      journalRuntime,
      profile: refs,
      receipt: await receiptFor(manifest()),
      clearSourceFacts,
      events,
    });

    await createMigrationCoordinator(deps).recover();

    expect(refs.buildPatch).not.toHaveBeenCalled();
    expect(refs.applyAndVerify).not.toHaveBeenCalled();
    expect(refs.verifyApplied).toHaveBeenCalledTimes(1);
    expect(events.indexOf('patch:verify')).toBeLessThan(events.indexOf('facts:clear'));
    await expectActive(journalRuntime);
  });

  it('never clears source facts when the durable receipt no longer matches cleanup_pending', async () => {
    const journalRuntime = runtime();
    await seedStage(journalRuntime, 'cleanup_pending');
    const badReceipt = await receiptFor(manifest(), { manifestDigest: 'b'.repeat(64) });
    const clearSourceFacts = vi.fn(async () => {});

    await expect(
      createMigrationCoordinator(
        cleanupDependencies({ journalRuntime, receipt: badReceipt, clearSourceFacts }),
      ).recover(),
    ).rejects.toMatchObject({ code: 'MIGRATION_RECEIPT_MISMATCH' });

    expect(clearSourceFacts).not.toHaveBeenCalled();
    await expectStage(journalRuntime, 'cleanup_pending', 'MIGRATION_RECEIPT_MISMATCH');
  });

  it('never clears source facts when the sidecar patch read-back is not the durable journal patch', async () => {
    const journalRuntime = runtime();
    await seedStage(journalRuntime, 'cleanup_pending');
    const clearSourceFacts = vi.fn(async () => {});
    const refs = profileReferences({
      verifyApplied: vi.fn(async () => {
        throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      }),
    });

    await expect(
      createMigrationCoordinator(
        cleanupDependencies({ journalRuntime, profile: refs, receipt: await receiptFor(manifest()), clearSourceFacts }),
      ).recover(),
    ).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });

    expect(clearSourceFacts).not.toHaveBeenCalled();
    await expectStage(journalRuntime, 'cleanup_pending', 'MIGRATION_VALIDATION_FAILED');
  });

  it('keeps cleanup_pending after clear or empty verification failure and retries explicitly from failed state', async () => {
    const journalRuntime = runtime();
    await seedStage(journalRuntime, 'cleanup_pending');
    const receipt = await receiptFor(manifest());
    const clearSourceFacts = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('power loss during clear'))
      .mockResolvedValue(undefined);
    const verifySourceFactsEmpty = vi
      .fn<() => Promise<{ counts: typeof ZERO_COUNTS; empty: boolean }>>()
      .mockResolvedValueOnce({ counts: { ...ZERO_COUNTS, messages: 1 }, empty: false })
      .mockResolvedValue({ counts: ZERO_COUNTS, empty: true });
    const deps = cleanupDependencies({
      journalRuntime,
      receipt,
      clearSourceFacts,
      verifySourceFactsEmpty,
    });
    const coordinator = createMigrationCoordinator(deps);

    await expect(coordinator.recover()).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });
    await expectStage(journalRuntime, 'cleanup_pending', 'MIGRATION_VALIDATION_FAILED');

    await expect(coordinator.start()).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });
    await expectStage(journalRuntime, 'cleanup_pending', 'MIGRATION_VALIDATION_FAILED');

    await coordinator.start();
    expect(clearSourceFacts).toHaveBeenCalledTimes(3);
    expect(verifySourceFactsEmpty).toHaveBeenCalledTimes(2);
    await expectActive(journalRuntime);
  });

  it('activates safely when a previous cleanup already emptied all five stores before the journal commit', async () => {
    const journalRuntime = runtime();
    await seedStage(journalRuntime, 'cleanup_pending');
    const clearSourceFacts = vi.fn(async () => {});
    const verifySourceFactsEmpty = vi.fn(async () => ({ counts: ZERO_COUNTS, empty: true }));

    await createMigrationCoordinator(
      cleanupDependencies({
        journalRuntime,
        receipt: await receiptFor(manifest()),
        clearSourceFacts,
        verifySourceFactsEmpty,
      }),
    ).recover();

    expect(clearSourceFacts).toHaveBeenCalledTimes(1);
    expect(verifySourceFactsEmpty).toHaveBeenCalledTimes(1);
    await expectActive(journalRuntime);
  });

  it('does not roll back an already-active journal when alarm rearm or refresh notification fails', async () => {
    const journalRuntime = runtime();
    await seedStage(journalRuntime, 'cleanup_pending');

    const coordinator = createMigrationCoordinator(
      cleanupDependencies({
        journalRuntime,
        receipt: await receiptFor(manifest()),
        rearmSchedulers: async () => {
          throw new Error('alarms unavailable');
        },
        onActivated: async () => {
          throw new Error('ui listener gone');
        },
      }),
    );
    await expect(coordinator.recover()).resolves.toBeUndefined();
    await expect(coordinator.getStatus()).resolves.toMatchObject({ journal: { mode: 'active', stage: 'active' } });

    await expectActive(journalRuntime);
  });
});
