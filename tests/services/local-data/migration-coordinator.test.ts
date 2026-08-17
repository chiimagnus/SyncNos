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
import { LocalDataContractError } from '@services/local-data/contracts';
import { nativeHostContract } from '@services/local-data/native-host-contract';
import { LOCAL_DATA_MESSAGE_TYPES } from '@platform/messaging/message-contracts';

const MIGRATION_ID = '11111111-1111-4111-8111-111111111111';

function supportedEnvironment(): MigrationRuntimeEnvironment {
  return { browser: 'chrome', officialIdentity: true, supported: true };
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
      actions: { canStart: false, canResume: false },
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
      capability: { browser: 'chrome', officialIdentity: true, supported: true },
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

  it('persists staging before closing admissions, then drains accepted facts work', async () => {
    const events: string[] = [];
    const journal = createJournalRuntime(events);
    const gate = createGate(events);
    const coordinator = createMigrationCoordinator({
      gate,
      journalRuntime: journal.runtime,
      nativeRequest: nativeStatusRequest(),
      readEnvironment: supportedEnvironment,
    });

    const status = await coordinator.start();

    expect(events.indexOf('journal:set:staging')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('journal:set:staging')).toBeLessThan(events.indexOf('gate:close'));
    expect(events).toContain('gate:drain');
    expect(status.journal).toMatchObject({ mode: 'transitional', stage: 'staging' });
    const snapshot = await readMigrationJournal(journal.runtime);
    expect(snapshot.mode).toBe('transitional');
    if (snapshot.mode === 'transitional') expect(snapshot.journal.migrationId).toBe(MIGRATION_ID);
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
    });

    const first = coordinator.start();
    await expect(coordinator.start()).rejects.toMatchObject({ code: 'MIGRATION_IN_PROGRESS' });
    releaseDrain();
    await first;

    const snapshot = await readMigrationJournal(journal.runtime);
    expect(snapshot.mode).toBe('transitional');
    if (snapshot.mode === 'transitional') expect(snapshot.journal.migrationId).toBe(MIGRATION_ID);
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
    expect(snapshot.mode).toBe('transitional');
    if (snapshot.mode === 'transitional') {
      expect(snapshot.journal).toMatchObject({ stage: 'staging', terminalCode: 'MIGRATION_VALIDATION_FAILED' });
    }
    expect(gate.isClosed()).toBe(true);
  });

  it('restores a transitional journal after service-worker restart and resumes with admissions still closed', async () => {
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
    });

    const status = await coordinator.resume();

    expect(status.journal).toMatchObject({ mode: 'transitional', stage: 'staging' });
    expect(gate.allowsFactsOperations).toBe(false);
  });

  it('reports only whether the current transitional migration has a matching Host receipt', async () => {
    const journal = createJournalRuntime();
    await beginMigrationJournal(journal.runtime);
    const nativeRequest = vi.fn(async (command: string) => {
      if (command === 'GET_STATUS') return hostStatus();
      if (command === 'GET_MIGRATION_RECEIPT') return { migrationId: MIGRATION_ID, privateReceiptData: 'not exposed' };
      throw new Error('unexpected command');
    });
    const coordinator = createMigrationCoordinator({
      gate: createGate(),
      journalRuntime: journal.runtime,
      nativeRequest,
      readEnvironment: supportedEnvironment,
    });

    const status = await coordinator.getStatus();

    expect(status.resumeReceipt).toBe('matching');
    expect(JSON.stringify(status)).not.toContain('privateReceiptData');
    expect(nativeRequest.mock.calls.map((call) => call[0])).toEqual(['GET_STATUS', 'GET_MIGRATION_RECEIPT']);
  });

  it('rejects Safari before journal creation or Native access', async () => {
    delete (globalThis as any).browser;
    (globalThis as any).chrome = {
      runtime: {
        id: 'safari-runtime',
        getURL: () => 'safari-web-extension://com.syncnos.webclipper/',
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
    expect(status.capability).toMatchObject({ browser: 'safari', officialIdentity: false, supported: false });
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
    expect(status.capability).toMatchObject({ browser: 'development', officialIdentity: false, supported: false });
    expect(nativeRequest).not.toHaveBeenCalled();
    await expect(coordinator.start()).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    expect((await readMigrationJournal(journal.runtime)).mode).toBe('not_started');
  });

  it('registers strict empty status/start/resume messages and surfaces typed error codes', async () => {
    const coordinator = {
      getStatus: vi.fn(async () => ({ ok: 'status' })),
      start: vi.fn(async () => {
        throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
      }),
      resume: vi.fn(async () => ({ ok: 'resume' })),
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
