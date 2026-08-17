import { describe, expect, it, vi } from 'vitest';

import {
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
} from '@services/local-data/contracts';
import { sha256Hex } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { createFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';
import {
  createMigrationCoordinator,
  type MigrationRuntimeEnvironment,
} from '@services/local-data/migration-coordinator';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';

const MIGRATION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_MIGRATION_ID = '22222222-2222-4222-8222-222222222222';
const FACT_COUNTS = Object.freeze({
  conversations: 2,
  sync_mappings: 1,
  messages: 3,
  image_cache: 1,
  article_comments: 2,
});
const ZERO_COUNTS = Object.freeze({
  conversations: 0,
  sync_mappings: 0,
  messages: 0,
  image_cache: 0,
  article_comments: 0,
});
const STREAM_BYTES = Object.freeze({
  conversations: 101,
  sync_mappings: 102,
  messages: 103,
  image_cache: 104,
  article_comments: 105,
});

function supportedEnvironment(): MigrationRuntimeEnvironment {
  return { browser: 'chrome', officialIdentity: true, supported: true };
}

function manifest(): FactsManifest {
  return createFactsManifest({
    migrationId: MIGRATION_ID,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    factCounts: FACT_COUNTS,
    streamBytes: STREAM_BYTES,
    orderedFrameDigest: 'a'.repeat(64),
  });
}

async function receiptFor(
  value: FactsManifest,
  overrides: Partial<FactsMigrationReceipt> = {},
): Promise<FactsMigrationReceipt> {
  return {
    alreadyCommitted: false,
    commentAmbiguity: { groupCount: 0, samples: [] },
    complete: true,
    factCounts: value.factCounts,
    factsRevision: 9,
    manifestDigest: await sha256Hex(nodeDigestProvider, encodeCanonicalJson(value).bytes),
    migrationId: value.migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    ...overrides,
  } as FactsMigrationReceipt;
}

function journalRuntime(events: string[] = []): MigrationJournalRuntime {
  const state: Record<string, unknown> = {};
  let now = 100;
  return {
    now: () => ++now,
    randomUUID: () => MIGRATION_ID,
    storage: {
      async get(keys) {
        return Object.fromEntries(
          keys.filter((key) => Object.hasOwn(state, key)).map((key) => [key, structuredClone(state[key])]),
        );
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) {
          state[key] = structuredClone(value);
          const stage =
            value && typeof value === 'object' ? String((value as Record<string, unknown>).stage || '') : '';
          events.push(stage ? `journal:${stage}` : 'journal:set');
        }
      },
    },
  };
}

function gate(events: string[] = []) {
  return {
    closeAdmissions: vi.fn(() => events.push('gate:close')),
    reopenForJournalState: vi.fn(() => events.push('gate:journal')),
    waitForDrained: vi.fn(async () => {
      events.push('gate:drain');
    }),
  };
}

function hostStatus() {
  return { databaseUuid: 'private', factsRevision: 9, fts: { available: true, reason: null } };
}

function completionDependencies() {
  const referencePatch = parseMigrationProfileReferencePatch({
    version: 1,
    diagnostics: { staleQueueEntriesDropped: { notion: 0, obsidian: 0, feishu: 0 } },
    queues: { notion: [], obsidian: [], feishu: [] },
    syncJobs: { notion: null, obsidian: null, feishu: null },
  });
  return {
    profileReferences: {
      buildPatch: vi.fn(async () => referencePatch),
      applyAndVerify: vi.fn(async () => {}),
      verifyApplied: vi.fn(async () => {}),
    },
    clearSourceFacts: vi.fn(async () => {}),
    verifySourceFactsEmpty: vi.fn(async () => ({ counts: ZERO_COUNTS, empty: true })),
  };
}

function hostRequest(receipt: FactsMigrationReceipt | null) {
  return vi.fn(async (command: string) => {
    if (command === 'GET_STATUS') return hostStatus();
    if (command === 'GET_MIGRATION_RECEIPT') return receipt;
    throw new Error(`unexpected Host command: ${command}`);
  });
}

async function stagingSnapshot(runtime: MigrationJournalRuntime) {
  const snapshot = await readMigrationJournal(runtime);
  expect(snapshot.mode).toBe('transitional');
  if (snapshot.mode !== 'transitional') throw new Error('expected transitional journal');
  return snapshot.journal;
}

describe('local data migration transfer', () => {
  it('opens Host staging before the first facts read and advances only after the full receipt matches', async () => {
    const events: string[] = [];
    const runtime = journalRuntime(events);
    const expectedManifest = manifest();
    const receipt = await receiptFor(expectedManifest);
    const transferFacts = vi.fn(async (input: any) => {
      events.push('facts:read');
      expect(input.signal).toBeInstanceOf(AbortSignal);
      expect(input.signal.aborted).toBe(false);
      return expectedManifest;
    });
    const nativeImport = vi.fn(async ({ produce }: any) => {
      events.push('host:staging-open');
      events.push('host:accepted');
      const produced = await produce({ onFrame: async () => {}, signal: new AbortController().signal });
      expect(produced).toEqual(expectedManifest);
      events.push('host:receipt');
      return receipt;
    });
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate: gate(events),
      journalRuntime: runtime,
      nativeImport,
      nativeRequest: hostRequest(receipt),
      readEnvironment: supportedEnvironment,
      transferFacts,
      ...completionDependencies(),
    });

    const status = await coordinator.start();

    expect(events.indexOf('journal:staging')).toBeLessThan(events.indexOf('gate:close'));
    expect(events.indexOf('gate:drain')).toBeLessThan(events.indexOf('host:staging-open'));
    expect(events.indexOf('host:accepted')).toBeLessThan(events.indexOf('facts:read'));
    expect(events.indexOf('facts:read')).toBeLessThan(events.indexOf('host:receipt'));
    expect(events.indexOf('host:receipt')).toBeLessThan(events.indexOf('journal:remote_committed'));
    expect(status.journal).toMatchObject({ mode: 'active', stage: 'active' });
    const active = await readMigrationJournal(runtime);
    expect(active.mode).toBe('active');
    expect(nativeImport).toHaveBeenCalledTimes(1);
    expect(transferFacts).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'manifest digest',
      async (base: FactsMigrationReceipt) => ({ ...base, manifestDigest: 'b'.repeat(64) }),
      'MIGRATION_RECEIPT_MISMATCH',
    ],
    [
      'one fact count',
      async (base: FactsMigrationReceipt) => ({
        ...base,
        factCounts: { ...base.factCounts, messages: base.factCounts.messages + 1 },
      }),
      'MIGRATION_RECEIPT_MISMATCH',
    ],
    [
      'migration id',
      async (base: FactsMigrationReceipt) => ({ ...base, migrationId: OTHER_MIGRATION_ID }),
      'MIGRATION_RECEIPT_MISMATCH',
    ],
    [
      'complete indicator',
      async (base: FactsMigrationReceipt) => ({ ...base, complete: false }),
      'MIGRATION_RECEIPT_MISMATCH',
    ],
    [
      'protocol version',
      async (base: FactsMigrationReceipt) => ({ ...base, protocolVersion: LOCAL_DATA_PROTOCOL_VERSION + 1 }),
      'PROTOCOL_MISMATCH',
    ],
    [
      'schema version',
      async (base: FactsMigrationReceipt) => ({ ...base, schemaVersion: LOCAL_DATA_SCHEMA_VERSION + 1 }),
      'SCHEMA_MISMATCH',
    ],
  ])('keeps staging when the Host receipt mismatches %s', async (_label, mutate, expectedCode) => {
    const runtime = journalRuntime();
    const expectedManifest = manifest();
    const baseReceipt = await receiptFor(expectedManifest);
    const badReceipt = await mutate(baseReceipt);
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate: gate(),
      journalRuntime: runtime,
      nativeImport: async ({ produce }) => {
        await produce({ onFrame: async () => {}, signal: new AbortController().signal });
        return badReceipt;
      },
      nativeRequest: hostRequest(null),
      readEnvironment: supportedEnvironment,
      transferFacts: async () => expectedManifest,
    });

    await expect(coordinator.start()).rejects.toMatchObject({ code: expectedCode });

    expect(await stagingSnapshot(runtime)).toMatchObject({ stage: 'staging', terminalCode: expectedCode });
  });

  it.each([
    ['Host busy before staging accepts facts', 'BUSY'],
    ['staging EOF/disconnect', 'HOST_UNAVAILABLE'],
    ['Host merge validation failure', 'MIGRATION_VALIDATION_FAILED'],
    ['incompatible database schema', 'SCHEMA_MISMATCH'],
  ] as const)('preserves staging on %s', async (_label, code) => {
    const runtime = journalRuntime();
    const transferFacts = vi.fn(async () => manifest());
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate: gate(),
      journalRuntime: runtime,
      nativeImport: async () => {
        throw new LocalDataContractError(code);
      },
      nativeRequest: hostRequest(null),
      readEnvironment: supportedEnvironment,
      transferFacts,
    });

    await expect(coordinator.start()).rejects.toMatchObject({ code });

    expect(await stagingSnapshot(runtime)).toMatchObject({ stage: 'staging', terminalCode: code });
    expect(transferFacts).not.toHaveBeenCalled();
  });

  it('keeps staging when the drained IndexedDB producer fails after Host acceptance', async () => {
    const runtime = journalRuntime();
    const nativeImport = vi.fn(
      async ({ produce }: any) => await produce({ onFrame: async () => {}, signal: new AbortController().signal }),
    );
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate: gate(),
      journalRuntime: runtime,
      nativeImport,
      nativeRequest: hostRequest(null),
      readEnvironment: supportedEnvironment,
      transferFacts: async () => {
        throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      },
    });

    await expect(coordinator.start()).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });

    expect(nativeImport).toHaveBeenCalledTimes(1);
    expect(await stagingSnapshot(runtime)).toMatchObject({
      stage: 'staging',
      terminalCode: 'MIGRATION_VALIDATION_FAILED',
    });
  });

  it('keeps source facts untouched when transfer succeeds but Host completion fails', async () => {
    const runtime = journalRuntime();
    const sourceFacts = structuredClone(FACT_COUNTS);
    const before = structuredClone(sourceFacts);
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate: gate(),
      journalRuntime: runtime,
      nativeImport: async ({ produce }) => {
        await produce({ onFrame: async () => {}, signal: new AbortController().signal });
        throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      },
      nativeRequest: hostRequest(null),
      readEnvironment: supportedEnvironment,
      transferFacts: async () => {
        expect(sourceFacts).toEqual(before);
        return manifest();
      },
    });

    await expect(coordinator.start()).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });

    expect(sourceFacts).toEqual(before);
    expect(await stagingSnapshot(runtime)).toMatchObject({
      stage: 'staging',
      terminalCode: 'MIGRATION_VALIDATION_FAILED',
    });
  });

  it('resumes a service-worker restart from a matching durable receipt without importing twice', async () => {
    const runtime = journalRuntime();
    await beginMigrationJournal(runtime);
    const expectedManifest = manifest();
    const receipt = await receiptFor(expectedManifest, { alreadyCommitted: true });
    const nativeImport = vi.fn();
    const transferFacts = vi.fn(async () => expectedManifest);
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate: gate(),
      journalRuntime: runtime,
      nativeImport,
      nativeRequest: hostRequest(receipt),
      readEnvironment: supportedEnvironment,
      transferFacts,
      ...completionDependencies(),
    });

    const status = await coordinator.resume();

    expect(status.journal).toMatchObject({ mode: 'active', stage: 'active' });
    expect(nativeImport).not.toHaveBeenCalled();
    expect(transferFacts).toHaveBeenCalledTimes(1);
  });

  it('opens a fresh staging session on explicit resume only when no receipt exists', async () => {
    const runtime = journalRuntime();
    await beginMigrationJournal(runtime);
    const expectedManifest = manifest();
    const receipt = await receiptFor(expectedManifest);
    let receiptReads = 0;
    const nativeRequest = vi.fn(async (command: string) => {
      if (command === 'GET_STATUS') return hostStatus();
      if (command === 'GET_MIGRATION_RECEIPT') return receiptReads++ === 0 ? null : receipt;
      throw new Error(`unexpected Host command: ${command}`);
    });
    const nativeImport = vi.fn(async ({ produce }: any) => {
      await produce({ onFrame: async () => {}, signal: new AbortController().signal });
      return receipt;
    });
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate: gate(),
      journalRuntime: runtime,
      nativeImport,
      nativeRequest,
      readEnvironment: supportedEnvironment,
      transferFacts: async () => expectedManifest,
      ...completionDependencies(),
    });

    await coordinator.resume();

    expect(nativeImport).toHaveBeenCalledTimes(1);
    expect((await readMigrationJournal(runtime)).mode).toBe('active');
  });

  it('blocks a conflicting durable receipt on resume instead of opening another import session', async () => {
    const runtime = journalRuntime();
    await beginMigrationJournal(runtime);
    const expectedManifest = manifest();
    const conflictingReceipt = await receiptFor(expectedManifest, { manifestDigest: 'c'.repeat(64) });
    const nativeImport = vi.fn();
    const transferFacts = vi.fn(async () => expectedManifest);
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate: gate(),
      journalRuntime: runtime,
      nativeImport,
      nativeRequest: hostRequest(conflictingReceipt),
      readEnvironment: supportedEnvironment,
      transferFacts,
    });

    await expect(coordinator.resume()).rejects.toMatchObject({ code: 'MIGRATION_RECEIPT_MISMATCH' });

    expect(nativeImport).not.toHaveBeenCalled();
    expect(transferFacts).toHaveBeenCalledTimes(1);
    expect(await stagingSnapshot(runtime)).toMatchObject({
      stage: 'staging',
      terminalCode: 'MIGRATION_RECEIPT_MISMATCH',
    });
  });
});
