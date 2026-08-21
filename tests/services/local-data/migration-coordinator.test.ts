import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginMigrationJournal,
  readMigrationJournal,
  type MigrationJournalRuntime,
} from '@platform/local-data/migration-journal';
import {
  createMigrationCoordinator,
  registerMigrationCoordinatorHandlers,
  type MigrationRuntimeEnvironment,
} from '@services/local-data/migration-coordinator';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseMigrationProfileReferencePatch,
} from '@services/local-data/contracts';
import { sha256Hex } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { createFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';
import { nativeHostContract } from '@services/local-data/native-host-contract';
import { LOCAL_DATA_MESSAGE_TYPES } from '@platform/messaging/message-contracts';

const MIGRATION_ID = '11111111-1111-4111-8111-111111111111';
const EMPTY_COUNTS = Object.freeze({
  conversations: 0,
  sync_mappings: 0,
  messages: 0,
  image_cache: 0,
  article_comments: 0,
});

function emptyManifest(): FactsManifest {
  return createFactsManifest({
    migrationId: MIGRATION_ID,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    factCounts: EMPTY_COUNTS,
    streamBytes: EMPTY_COUNTS,
    orderedFrameDigest: '0'.repeat(64),
  });
}

async function receiptFor(manifest: FactsManifest) {
  return {
    alreadyCommitted: false,
    commentAmbiguity: { groupCount: 0, samples: [] },
    complete: true,
    factCounts: manifest.factCounts,
    factsRevision: 1,
    manifestDigest: await sha256Hex(nodeDigestProvider, encodeCanonicalJson(manifest).bytes),
    migrationId: manifest.migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
  };
}

function successfulMigrationIo() {
  const manifest = emptyManifest();
  let committedReceipt: Awaited<ReturnType<typeof receiptFor>> | null = null;
  const referencePatch = parseMigrationProfileReferencePatch({
    version: 1,
    diagnostics: { staleQueueEntriesDropped: { notion: 0, obsidian: 0, feishu: 0 } },
    queues: { notion: [], obsidian: [], feishu: [] },
    syncJobs: { notion: null, obsidian: null, feishu: null },
  });
  return {
    digestProvider: nodeDigestProvider,
    transferFacts: vi.fn(async () => manifest),
    nativeImport: vi.fn(async ({ produce }: any) => {
      const produced = await produce({ onFrame: async () => {}, signal: new AbortController().signal });
      committedReceipt = await receiptFor(produced);
      return committedReceipt;
    }),
    nativeRequest: vi.fn(async (command: string) => {
      if (command === 'GET_STATUS') return hostStatus();
      if (command === 'GET_MIGRATION_RECEIPT') return committedReceipt;
      throw new Error(`unexpected command ${command}`);
    }),
    profileReferences: {
      buildPatch: vi.fn(async () => referencePatch),
      applyAndVerify: vi.fn(async () => {}),
      verifyApplied: vi.fn(async () => {}),
    },
    clearSourceFacts: vi.fn(async () => {}),
    verifySourceFactsEmpty: vi.fn(async () => ({ counts: EMPTY_COUNTS, empty: true })),
  };
}

function supportedEnvironment(): MigrationRuntimeEnvironment {
  return { browser: 'chrome', officialIdentity: true, platform: 'unknown', supported: true };
}

function hostStatus(factsRevision = 7) {
  return {
    databaseUuid: 'not-exposed-to-ui',
    factsRevision,
    fts: { available: true, reason: null },
  };
}

function createJournalRuntime(events: string[] = []): {
  runtime: MigrationJournalRuntime;
  readRaw: () => Record<string, unknown>;
} {
  const values: Record<string, unknown> = {};
  return {
    runtime: {
      now: (() => {
        let now = 100;
        return () => ++now;
      })(),
      randomUUID: () => MIGRATION_ID,
      storage: {
        async get(keys) {
          const out: Record<string, unknown> = {};
          for (const key of keys) if (Object.hasOwn(values, key)) out[key] = structuredClone(values[key]);
          return out;
        },
        async set(items) {
          for (const [key, value] of Object.entries(items)) {
            values[key] = structuredClone(value);
            const stage =
              value && typeof value === 'object' ? String((value as Record<string, unknown>).stage || '') : '';
            events.push(stage ? `journal:set:${stage}` : 'journal:set');
          }
        },
      },
    },
    readRaw: () => structuredClone(values),
  };
}

function createGate(events: string[] = [], waitForDrained: () => Promise<void> = async () => {}) {
  let closed = false;
  return {
    closeAdmissions: vi.fn(() => {
      closed = true;
      events.push('gate:close');
    }),
    reopenForJournalState: vi.fn(() => {
      events.push('gate:journal');
    }),
    waitForDrained: vi.fn(async () => {
      events.push('gate:drain');
      await waitForDrained();
    }),
    isClosed: () => closed,
  };
}

function nativeStatusRequest(result: unknown = hostStatus()) {
  return vi.fn(async (command: string) => {
    if (command === 'GET_STATUS') return result;
    return null;
  });
}

const originalBrowser = (globalThis as any).browser;
const originalChrome = (globalThis as any).chrome;

afterEach(() => {
  if (originalBrowser === undefined) delete (globalThis as any).browser;
  else (globalThis as any).browser = originalBrowser;
  if (originalChrome === undefined) delete (globalThis as any).chrome;
  else (globalThis as any).chrome = originalChrome;
});

describe('local data migration coordinator', () => {
  it('reports Host unavailable without creating a journal or attempting a write command', async () => {
    const journal = createJournalRuntime();
    const nativeRequest = vi.fn(async (command: string) => {
      expect(command).toBe('GET_STATUS');
      throw new LocalDataContractError('HOST_UNAVAILABLE');
    });
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      nativeRequest,
      readEnvironment: supportedEnvironment,
    });

    const status = await coordinator.getStatus();

    expect(status).toMatchObject({
      journal: { mode: 'not_started', stage: 'not_started' },
      host: { registration: 'unavailable', compatibility: 'unknown' },
      database: { presence: 'unknown', factsHealth: 'unknown' },
      actions: { canStart: false },
    });
    expect(status.diagnostics[0]?.code).toBe('HOST_UNAVAILABLE');
    expect(journal.readRaw()).toEqual({});
    expect(nativeRequest).toHaveBeenCalledTimes(1);
  });

  it('treats a read-only DATABASE_NOT_INITIALIZED response as a registered compatible Host with no database', async () => {
    const journal = createJournalRuntime();
    const nativeRequest = vi.fn(async () => {
      throw new LocalDataContractError('DATABASE_NOT_INITIALIZED');
    });
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      nativeRequest,
      readEnvironment: supportedEnvironment,
    });

    const status = await coordinator.getStatus();

    expect(status).toMatchObject({
      host: { registration: 'available', compatibility: 'compatible' },
      database: { presence: 'missing', factsHealth: 'missing' },
      actions: { canStart: true },
    });
    expect(journal.readRaw()).toEqual({});
  });

  it('reports an existing healthy database without returning its UUID or any path', async () => {
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: createJournalRuntime().runtime,
      nativeRequest: nativeStatusRequest(hostStatus(19)),
      readEnvironment: supportedEnvironment,
    });

    const status = await coordinator.getStatus();

    expect(status).toMatchObject({
      capability: { browser: 'chrome', officialIdentity: true, platform: 'unknown', supported: true },
      host: { registration: 'available', compatibility: 'compatible' },
      database: { presence: 'present', factsHealth: 'healthy', factsRevision: 19, ftsAvailable: true },
      actions: { canStart: true },
    });
    expect(JSON.stringify(status)).not.toContain('not-exposed-to-ui');
    expect(JSON.stringify(status)).not.toContain('/Users/');
  });

  it('status uses only bounded read-only Host commands and does not create migration state', async () => {
    const journal = createJournalRuntime();
    const commands: string[] = [];
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      nativeRequest: async (command) => {
        commands.push(command);
        return hostStatus();
      },
      readEnvironment: supportedEnvironment,
    });

    await coordinator.getStatus();

    expect(commands).toEqual(['GET_STATUS']);
    expect(journal.readRaw()).toEqual({});
  });

  it('persists staging before closing admissions, drains accepted facts work, then commits only after transfer receipt', async () => {
    const events: string[] = [];
    const journal = createJournalRuntime(events);
    const gate = createGate(events);
    const coordinator = createMigrationCoordinator({
      gate,
      journalRuntime: journal.runtime,
      nativeRequest: nativeStatusRequest(),
      readEnvironment: supportedEnvironment,
      ...successfulMigrationIo(),
    });

    const status = await coordinator.start();

    expect(events.indexOf('journal:set:staging')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('journal:set:staging')).toBeLessThan(events.indexOf('gate:close'));
    expect(events).toContain('gate:drain');
    expect(status.journal).toMatchObject({ mode: 'active', stage: 'active' });
    const snapshot = await readMigrationJournal(journal.runtime);
    expect(snapshot.mode).toBe('active');
    if (snapshot.mode === 'active') {
      expect(snapshot.journal).toMatchObject({ migrationId: MIGRATION_ID, stage: 'active' });
    }
  });

  it('rejects a concurrent start deterministically and creates only one migration UUID', async () => {
    const journal = createJournalRuntime();
    let releaseDrain!: () => void;
    const drain = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const gate = createGate([], async () => await drain);
    const coordinator = createMigrationCoordinator({
      gate,
      journalRuntime: journal.runtime,
      nativeRequest: nativeStatusRequest(),
      readEnvironment: supportedEnvironment,
      ...successfulMigrationIo(),
    });

    const first = coordinator.start();
    await expect(coordinator.start()).rejects.toMatchObject({ code: 'MIGRATION_IN_PROGRESS' });
    releaseDrain();
    await first;

    const snapshot = await readMigrationJournal(journal.runtime);
    expect(snapshot.mode).toBe('active');
    if (snapshot.mode === 'active') expect(snapshot.journal.migrationId).toBe(MIGRATION_ID);
  });

  it('records a drain failure on staging and never reopens admissions', async () => {
    const journal = createJournalRuntime();
    const gate = createGate([], async () => {
      throw new Error('drain failed');
    });
    const coordinator = createMigrationCoordinator({
      gate,
      journalRuntime: journal.runtime,
      nativeRequest: nativeStatusRequest(),
      readEnvironment: supportedEnvironment,
    });

    await expect(coordinator.start()).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });

    const snapshot = await readMigrationJournal(journal.runtime);
    expect(snapshot.mode).toBe('failed');
    if (snapshot.mode === 'failed') {
      expect(snapshot.journal).toMatchObject({ stage: 'staging', terminalCode: 'MIGRATION_VALIDATION_FAILED' });
      expect(snapshot.error.code).toBe('MIGRATION_VALIDATION_FAILED');
    }
    expect(gate.isClosed()).toBe(true);
  });

  it('persists safe fact diagnostics and reports validation as a terminal retry state instead of in-progress', async () => {
    const journal = createJournalRuntime();
    const io = successfulMigrationIo();
    io.transferFacts.mockRejectedValueOnce(
      new LocalDataContractError('MIGRATION_VALIDATION_FAILED', {
        factKind: 'messages',
        sourceLocalId: 20,
        stage: 'staging',
      }),
    );
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      nativeRequest: io.nativeRequest,
      readEnvironment: supportedEnvironment,
      ...io,
    });

    await expect(coordinator.start()).rejects.toMatchObject({
      code: 'MIGRATION_VALIDATION_FAILED',
      diagnostics: { factKind: 'messages', sourceLocalId: 20, stage: 'staging' },
    });

    const status = await coordinator.getStatus();
    expect(status).toMatchObject({
      profileState: 'migration_failed',
      actions: { canStart: true },
      journal: { mode: 'failed', stage: 'staging', terminalCode: 'MIGRATION_VALIDATION_FAILED' },
      diagnostics: [
        {
          code: 'MIGRATION_VALIDATION_FAILED',
          diagnostics: { factKind: 'messages', sourceLocalId: 20, stage: 'staging' },
        },
      ],
    });
    expect(io.transferFacts).toHaveBeenCalledTimes(1);

    await coordinator.recover();
    expect(io.transferFacts).toHaveBeenCalledTimes(1);
    expect((await coordinator.getStatus()).profileState).toBe('migration_failed');

    await coordinator.start();
    expect(io.transferFacts).toHaveBeenCalledTimes(2);
    expect((await coordinator.getStatus()).profileState).toBe('active');
  });

  it('retries a failed first migration from IndexedDB when the receipt probe reports that SQLite does not exist yet', async () => {
    const journal = createJournalRuntime();
    const io = successfulMigrationIo();
    io.nativeImport.mockRejectedValueOnce(new LocalDataContractError('DATABASE_NOT_INITIALIZED'));
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      readEnvironment: supportedEnvironment,
      ...io,
    });

    await expect(coordinator.start()).rejects.toMatchObject({ code: 'DATABASE_NOT_INITIALIZED' });
    expect(await readMigrationJournal(journal.runtime)).toMatchObject({
      mode: 'failed',
      journal: { stage: 'staging', terminalCode: 'DATABASE_NOT_INITIALIZED' },
    });

    io.nativeRequest
      .mockImplementationOnce(async (command: string) => {
        expect(command).toBe('GET_STATUS');
        throw new LocalDataContractError('DATABASE_NOT_INITIALIZED');
      })
      .mockImplementationOnce(async (command: string) => {
        expect(command).toBe('GET_MIGRATION_RECEIPT');
        throw new LocalDataContractError('DATABASE_NOT_INITIALIZED');
      });

    const failedStatus = await coordinator.getStatus();
    expect(failedStatus).toMatchObject({
      profileState: 'migration_failed',
      database: { presence: 'missing', factsHealth: 'missing' },
      diagnostics: [{ code: 'DATABASE_NOT_INITIALIZED' }],
    });
    expect(failedStatus.diagnostics).toHaveLength(1);

    await expect(coordinator.start()).resolves.toMatchObject({ profileState: 'active' });
    expect(io.nativeImport).toHaveBeenCalledTimes(2);
    expect(io.transferFacts).toHaveBeenCalledTimes(1);
    expect(await readMigrationJournal(journal.runtime)).toMatchObject({ mode: 'active' });
  });

  it('restores a transitional journal after service-worker restart and reopens admissions only after full activation', async () => {
    const journal = createJournalRuntime();
    await beginMigrationJournal(journal.runtime);
    const gate = new FactsOperationGate({ readJournal: async () => await readMigrationJournal(journal.runtime) });
    const initialized = await gate.initializeFromJournal();
    expect(initialized.mode).toBe('transitional');
    expect(gate.allowsFactsOperations).toBe(false);
    const coordinator = createMigrationCoordinator({
      gate,
      journalRuntime: journal.runtime,
      nativeRequest: nativeStatusRequest(),
      readEnvironment: supportedEnvironment,
      ...successfulMigrationIo(),
    });

    await coordinator.recover();
    const status = await coordinator.getStatus();

    expect(status.journal).toMatchObject({ mode: 'active', stage: 'active' });
    expect(gate.allowsFactsOperations).toBe(true);
  });

  it('keeps receipt reconciliation internal instead of exposing it through status', async () => {
    const journal = createJournalRuntime();
    await beginMigrationJournal(journal.runtime);
    const receipt = await receiptFor(emptyManifest());
    const nativeRequest = vi.fn(async (command: string) => {
      if (command === 'GET_STATUS') return hostStatus();
      if (command === 'GET_MIGRATION_RECEIPT') return receipt;
      throw new Error('unexpected command');
    });
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      nativeRequest,
      readEnvironment: supportedEnvironment,
    });

    const status = await coordinator.getStatus();

    expect(status.profileState).toBe('migration_in_progress');
    expect(JSON.stringify(status)).not.toContain(receipt.manifestDigest);
    expect(JSON.stringify(status)).not.toContain('resume');
    expect(nativeRequest.mock.calls.map((call) => call[0])).toEqual(['GET_STATUS']);
  });

  it('rejects Safari before journal creation or Native access', async () => {
    delete (globalThis as any).browser;
    (globalThis as any).chrome = {
      runtime: {
        id: 'safari-runtime',
        getURL: () => 'safari-web-extension://com.syncnos.webclipper/',
        getPlatformInfo: (callback: (info: unknown) => void) => callback({ os: 'mac' }),
      },
    };
    const journal = createJournalRuntime();
    const nativeRequest = vi.fn();
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      nativeRequest,
    });

    const status = await coordinator.getStatus();
    expect(status.capability).toMatchObject({
      browser: 'safari',
      officialIdentity: false,
      platform: 'mac',
      supported: false,
    });
    expect(nativeRequest).not.toHaveBeenCalled();
    await expect(coordinator.start()).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM' });
    expect((await readMigrationJournal(journal.runtime)).mode).toBe('not_started');
  });

  it('rejects development extension identities instead of bypassing the official allowlist', async () => {
    delete (globalThis as any).browser;
    (globalThis as any).chrome = {
      runtime: {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        getURL: () => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
        getPlatformInfo: (callback: (info: unknown) => void) => callback({ os: 'linux' }),
      },
    };
    expect((globalThis as any).chrome.runtime.id).not.toBe(nativeHostContract.browsers.chrome.runtimeId);
    expect((globalThis as any).chrome.runtime.id).not.toBe(nativeHostContract.browsers.edge.runtimeId);
    const journal = createJournalRuntime();
    const nativeRequest = vi.fn();
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      nativeRequest,
    });

    const status = await coordinator.getStatus();
    expect(status.capability).toMatchObject({
      browser: 'development',
      officialIdentity: false,
      platform: 'linux',
      supported: false,
    });
    expect(nativeRequest).not.toHaveBeenCalled();
    await expect(coordinator.start()).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    expect((await readMigrationJournal(journal.runtime)).mode).toBe('not_started');
  });

  it('registers strict empty status/start messages and surfaces typed error codes', async () => {
    const coordinator = {
      getStatus: vi.fn(async () => ({ ok: 'status' })),
      start: vi.fn(async () => {
        throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
      }),
      recover: vi.fn(async () => {}),
    } as any;
    const handlers = new Map<string, (message: unknown) => Promise<unknown>>();
    const router = {
      register: (type: string, handler: (message: unknown) => Promise<unknown>) => handlers.set(type, handler),
      ok: (data: unknown) => ({ ok: true, data, error: null }),
      err: (message: string, extra?: unknown) => ({ ok: false, data: null, error: { message, extra: extra ?? null } }),
    };
    registerMigrationCoordinatorHandlers(router, coordinator);

    await expect(
      handlers.get(LOCAL_DATA_MESSAGE_TYPES.GET_STATUS)!({ type: LOCAL_DATA_MESSAGE_TYPES.GET_STATUS, extra: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { extra: { code: 'INVALID_ARGUMENT' } },
    });
    await expect(
      handlers.get(LOCAL_DATA_MESSAGE_TYPES.START_MIGRATION)!({ type: LOCAL_DATA_MESSAGE_TYPES.START_MIGRATION }),
    ).resolves.toMatchObject({
      ok: false,
      error: { extra: { code: 'MIGRATION_IN_PROGRESS' } },
    });
  });
});
