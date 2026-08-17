import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseMigrationProfileReferencePatch,
  type FactsMigrationReceipt,
  type MigrationId,
} from '@services/local-data/contracts';
import { sha256Hex } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { createFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';
import {
  createMigrationCoordinator,
  type MigrationCoordinator,
  type MigrationRuntimeEnvironment,
} from '@services/local-data/migration-coordinator';
import type { ProfileReferenceRebase } from '@services/local-data/profile-reference-rebase';
import { readMigrationJournal, type MigrationJournalRuntime } from '@platform/local-data/migration-journal';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';

const PROFILE_A_ID = '11111111-1111-4111-8111-111111111111' as MigrationId;
const PROFILE_B_ID = '22222222-2222-4222-8222-222222222222' as MigrationId;
const REINSTALL_ID = '33333333-3333-4333-8333-333333333333' as MigrationId;
const PROFILE_C_ID = '44444444-4444-4444-8444-444444444444' as MigrationId;
const ZERO_COUNTS = Object.freeze({
  conversations: 0,
  sync_mappings: 0,
  messages: 0,
  image_cache: 0,
  article_comments: 0,
});

function supportedEnvironment(): MigrationRuntimeEnvironment {
  return { browser: 'chrome', officialIdentity: true, platform: 'unknown', supported: true };
}

function migrationManifest(migrationId: MigrationId, conversationCount = 1): FactsManifest {
  return createFactsManifest({
    migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    factCounts: { ...ZERO_COUNTS, conversations: conversationCount },
    streamBytes: { ...ZERO_COUNTS, conversations: conversationCount * 32 },
    orderedFrameDigest: migrationId.replaceAll('-', '').padEnd(64, '0').slice(0, 64),
  });
}

async function receiptFor(manifest: FactsManifest, factsRevision: number): Promise<FactsMigrationReceipt> {
  return {
    alreadyCommitted: false,
    commentAmbiguity: { groupCount: 0, samples: [] },
    complete: true,
    factCounts: manifest.factCounts,
    factsRevision,
    manifestDigest: await sha256Hex(nodeDigestProvider, encodeCanonicalJson(manifest).bytes),
    migrationId: manifest.migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
  };
}

function createJournalRuntime(migrationId: MigrationId): MigrationJournalRuntime {
  const values = new Map<string, unknown>();
  let now = 100;
  return {
    digestProvider: nodeDigestProvider,
    now: () => ++now,
    randomUUID: () => migrationId,
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

function createGate() {
  return {
    closeAdmissions: vi.fn(),
    reopenForJournalState: vi.fn(),
    waitForDrained: vi.fn(async () => {}),
  };
}

function createProfileReferences() {
  const patch = parseMigrationProfileReferencePatch({
    version: 1,
    diagnostics: { staleQueueEntriesDropped: { notion: 0, obsidian: 0, feishu: 0 } },
    queues: { notion: [], obsidian: [], feishu: [] },
    syncJobs: { notion: null, obsidian: null, feishu: null },
  });
  return {
    buildPatch: vi.fn(async () => patch),
    applyAndVerify: vi.fn(async () => {}),
    verifyApplied: vi.fn(async () => {}),
  } satisfies ProfileReferenceRebase;
}

function createSharedHost(profileFacts: Readonly<Record<string, readonly string[]>>) {
  let available = true;
  let busy = false;
  let databaseExists = false;
  let factsRevision = 0;
  let blockMigrationId: MigrationId | null = null;
  let releaseBlocked: (() => void) | null = null;
  let busyEnteredResolve: (() => void) | null = null;
  let busyEntered = Promise.resolve();
  const facts = new Set<string>();
  const receipts = new Map<string, FactsMigrationReceipt>();
  const importCalls = new Map<string, number>();

  const nativeRequest = vi.fn(async (command: string, payload: Record<string, unknown>) => {
    if (!available) throw new LocalDataContractError('HOST_UNAVAILABLE');
    if (command === 'GET_STATUS') {
      if (!databaseExists) throw new LocalDataContractError('DATABASE_NOT_INITIALIZED');
      return { databaseUuid: 'private-shared-db', factsRevision, fts: { available: true, reason: null } };
    }
    if (command === 'GET_FACTS_REVISION') {
      if (!databaseExists) throw new LocalDataContractError('DATABASE_NOT_INITIALIZED');
      return { factsRevision };
    }
    if (command === 'GET_MIGRATION_RECEIPT') return receipts.get(String(payload.migrationId || '')) ?? null;
    throw new Error(`unexpected Host command: ${command}`);
  });

  const nativeImport = vi.fn(async ({ migrationId, produce }: any) => {
    if (!available) throw new LocalDataContractError('HOST_UNAVAILABLE');
    importCalls.set(migrationId, (importCalls.get(migrationId) ?? 0) + 1);
    if (busy) throw new LocalDataContractError('BUSY');
    busy = true;
    try {
      if (blockMigrationId === migrationId) {
        busyEnteredResolve?.();
        await new Promise<void>((resolve) => {
          releaseBlocked = resolve;
        });
      }
      const manifest = await produce({ onFrame: async () => {}, signal: new AbortController().signal });
      for (const stableIdentity of profileFacts[migrationId] ?? []) facts.add(stableIdentity);
      databaseExists = true;
      factsRevision += 1;
      const receipt = await receiptFor(manifest, factsRevision);
      receipts.set(migrationId, receipt);
      return receipt;
    } finally {
      busy = false;
      releaseBlocked = null;
    }
  });

  return {
    facts,
    receipts,
    nativeImport,
    nativeRequest,
    get factsRevision() {
      return factsRevision;
    },
    getImportCalls(migrationId: MigrationId) {
      return importCalls.get(migrationId) ?? 0;
    },
    setAvailable(next: boolean) {
      available = next;
    },
    blockNextImport(migrationId: MigrationId) {
      blockMigrationId = migrationId;
      busyEntered = new Promise<void>((resolve) => {
        busyEnteredResolve = resolve;
      });
    },
    async waitUntilBusy() {
      await busyEntered;
    },
    releaseImport() {
      blockMigrationId = null;
      releaseBlocked?.();
    },
  };
}

type ProfileHarness = Readonly<{
  clearSourceFacts: ReturnType<typeof vi.fn>;
  coordinator: MigrationCoordinator;
  journalRuntime: MigrationJournalRuntime;
  profileReferences: ReturnType<typeof createProfileReferences>;
}>;

function createProfileHarness(input: {
  host: ReturnType<typeof createSharedHost>;
  migrationId: MigrationId;
  conversationCount?: number;
}): ProfileHarness {
  const journalRuntime = createJournalRuntime(input.migrationId);
  const profileReferences = createProfileReferences();
  const clearSourceFacts = vi.fn(async () => {
    if (!input.host.receipts.has(input.migrationId)) {
      throw new Error('source facts cleared before matching profile receipt existed');
    }
  });
  const manifest = migrationManifest(input.migrationId, input.conversationCount ?? 1);
  const coordinator = createMigrationCoordinator({
    clearSourceFacts,
    digestProvider: nodeDigestProvider,
    gate: createGate(),
    journalRuntime,
    nativeImport: input.host.nativeImport,
    nativeRequest: input.host.nativeRequest,
    profileReferences,
    readEnvironment: supportedEnvironment,
    transferFacts: async () => manifest,
    verifySourceFactsEmpty: async () => ({ counts: ZERO_COUNTS, empty: true }),
  });
  return { clearSourceFacts, coordinator, journalRuntime, profileReferences };
}

async function expectActive(profile: ProfileHarness, migrationId: MigrationId) {
  const snapshot = await readMigrationJournal(profile.journalRuntime);
  expect(snapshot).toMatchObject({ mode: 'active', factsEpoch: `native:${migrationId}` });
}

describe('local data explicit profile lifecycle', () => {
  it('requires profile B to explicitly join an existing healthy DB and conservatively preserves the union with isolated receipts', async () => {
    const host = createSharedHost({
      [PROFILE_A_ID]: ['chatgpt\0a-only', 'web\0shared'],
      [PROFILE_B_ID]: ['gemini\0b-only', 'web\0shared'],
    });
    const profileA = createProfileHarness({ host, migrationId: PROFILE_A_ID, conversationCount: 2 });
    const profileB = createProfileHarness({ host, migrationId: PROFILE_B_ID, conversationCount: 2 });

    await expect(profileA.coordinator.getStatus()).resolves.toMatchObject({
      journal: { mode: 'not_started' },
      profileState: 'setup_required',
      database: { presence: 'missing' },
    });
    await profileA.coordinator.start();
    await expectActive(profileA, PROFILE_A_ID);
    expect(host.facts).toEqual(new Set(['chatgpt\0a-only', 'web\0shared']));

    const beforeJoin = await profileB.coordinator.getStatus();
    expect(beforeJoin).toMatchObject({
      journal: { mode: 'not_started', stage: 'not_started' },
      profileState: 'join_existing_required',
      database: { presence: 'present', factsHealth: 'healthy', factsRevision: 1 },
      actions: { canStart: true },
    });
    expect(profileB.clearSourceFacts).not.toHaveBeenCalled();
    expect(host.getImportCalls(PROFILE_B_ID)).toBe(0);
    const hostCallsBeforeInactiveRevision = host.nativeRequest.mock.calls.length;
    await expect(profileB.coordinator.getFactsRevision()).resolves.toBeNull();
    expect(host.nativeRequest.mock.calls.length).toBe(hostCallsBeforeInactiveRevision);

    await profileB.coordinator.start();
    await expectActive(profileB, PROFILE_B_ID);
    expect(host.facts).toEqual(new Set(['chatgpt\0a-only', 'web\0shared', 'gemini\0b-only']));
    expect(host.receipts.get(PROFILE_A_ID)?.migrationId).toBe(PROFILE_A_ID);
    expect(host.receipts.get(PROFILE_B_ID)?.migrationId).toBe(PROFILE_B_ID);
    expect(profileA.clearSourceFacts).toHaveBeenCalledTimes(1);
    expect(profileB.clearSourceFacts).toHaveBeenCalledTimes(1);
    expect(profileA.profileReferences.buildPatch).toHaveBeenCalledTimes(1);
    expect(profileB.profileReferences.buildPatch).toHaveBeenCalledTimes(1);
    expect(await profileA.coordinator.getFactsRevision()).toBe(2);
  });

  it('preserves the same union when profile B joins first and profile A explicitly joins second', async () => {
    const host = createSharedHost({
      [PROFILE_A_ID]: ['chatgpt\0a-only', 'web\0shared'],
      [PROFILE_B_ID]: ['gemini\0b-only', 'web\0shared'],
    });
    const profileA = createProfileHarness({ host, migrationId: PROFILE_A_ID, conversationCount: 2 });
    const profileB = createProfileHarness({ host, migrationId: PROFILE_B_ID, conversationCount: 2 });

    await profileB.coordinator.start();
    await expect(profileA.coordinator.getStatus()).resolves.toMatchObject({
      profileState: 'join_existing_required',
      journal: { mode: 'not_started' },
    });
    await profileA.coordinator.start();

    expect(host.facts).toEqual(new Set(['chatgpt\0a-only', 'web\0shared', 'gemini\0b-only']));
    expect(host.receipts.has(PROFILE_A_ID)).toBe(true);
    expect(host.receipts.has(PROFILE_B_ID)).toBe(true);
    await expectActive(profileA, PROFILE_A_ID);
    await expectActive(profileB, PROFILE_B_ID);
  });

  it('serializes concurrent profile confirmation at the Host import boundary and requires explicit resume after BUSY', async () => {
    const host = createSharedHost({
      [PROFILE_A_ID]: ['chatgpt\0a'],
      [PROFILE_B_ID]: ['gemini\0b'],
    });
    host.blockNextImport(PROFILE_A_ID);
    const profileA = createProfileHarness({ host, migrationId: PROFILE_A_ID });
    const profileB = createProfileHarness({ host, migrationId: PROFILE_B_ID });

    const startA = profileA.coordinator.start();
    await host.waitUntilBusy();
    await expect(profileB.coordinator.start()).rejects.toMatchObject({ code: 'BUSY' });
    expect(profileB.clearSourceFacts).not.toHaveBeenCalled();
    expect(host.getImportCalls(PROFILE_B_ID)).toBe(1);
    const blockedB = await readMigrationJournal(profileB.journalRuntime);
    expect(blockedB).toMatchObject({ mode: 'transitional', journal: { stage: 'staging', terminalCode: 'BUSY' } });

    host.releaseImport();
    await startA;
    expect(host.facts).toEqual(new Set(['chatgpt\0a']));

    await profileB.coordinator.resume();
    expect(host.getImportCalls(PROFILE_B_ID)).toBe(2);
    expect(host.facts).toEqual(new Set(['chatgpt\0a', 'gemini\0b']));
    expect(profileB.clearSourceFacts).toHaveBeenCalledTimes(1);
    await expectActive(profileB, PROFILE_B_ID);
  });

  it('models extension reinstall as lost profile journal: an existing SQLite DB requires confirmation again and is never auto-owned', async () => {
    const host = createSharedHost({
      [PROFILE_A_ID]: ['chatgpt\0preserved'],
      [REINSTALL_ID]: [],
    });
    const original = createProfileHarness({ host, migrationId: PROFILE_A_ID });
    await original.coordinator.start();
    expect(host.facts).toEqual(new Set(['chatgpt\0preserved']));

    const reinstalled = createProfileHarness({ host, migrationId: REINSTALL_ID, conversationCount: 0 });
    const status = await reinstalled.coordinator.getStatus();
    expect(status).toMatchObject({
      journal: { mode: 'not_started' },
      profileState: 'join_existing_required',
      actions: { canStart: true },
    });
    expect(host.getImportCalls(REINSTALL_ID)).toBe(0);
    expect(reinstalled.clearSourceFacts).not.toHaveBeenCalled();

    await reinstalled.coordinator.start();
    await expectActive(reinstalled, REINSTALL_ID);
    expect(host.facts).toEqual(new Set(['chatgpt\0preserved']));
    expect(host.receipts.has(REINSTALL_ID)).toBe(true);
  });

  it('treats unregister/register as Host availability only: shared SQLite facts survive and a journal-less profile still requires join', async () => {
    const host = createSharedHost({ [PROFILE_A_ID]: ['web\0kept'], [PROFILE_C_ID]: ['gemini\0new'] });
    const profileA = createProfileHarness({ host, migrationId: PROFILE_A_ID });
    await profileA.coordinator.start();
    const preserved = new Set(host.facts);

    const profileC = createProfileHarness({ host, migrationId: PROFILE_C_ID });
    host.setAvailable(false);
    await expect(profileC.coordinator.getStatus()).resolves.toMatchObject({
      journal: { mode: 'not_started' },
      profileState: 'unavailable',
      host: { registration: 'unavailable' },
      actions: { canStart: false },
    });
    expect(host.facts).toEqual(preserved);

    host.setAvailable(true);
    await expect(profileC.coordinator.getStatus()).resolves.toMatchObject({
      journal: { mode: 'not_started' },
      profileState: 'join_existing_required',
      host: { registration: 'available', compatibility: 'compatible' },
      actions: { canStart: true },
    });
    expect(host.facts).toEqual(preserved);
    expect(host.getImportCalls(PROFILE_C_ID)).toBe(0);
  });

  it('keeps active ownership profile-local even when registration becomes temporarily unavailable', async () => {
    const host = createSharedHost({ [PROFILE_A_ID]: ['web\0kept'] });
    const profileA = createProfileHarness({ host, migrationId: PROFILE_A_ID });
    await profileA.coordinator.start();
    host.setAvailable(false);

    const status = await profileA.coordinator.getStatus();

    expect(status.journal).toMatchObject({ mode: 'active', stage: 'active' });
    expect(status.profileState).toBe('active');
    await expectActive(profileA, PROFILE_A_ID);
  });
});
