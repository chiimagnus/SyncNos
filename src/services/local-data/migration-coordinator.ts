import { LOCAL_DATA_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import {
  beginMigrationJournal,
  readMigrationJournal,
  recordMigrationJournalFailure,
  type MigrationJournal,
  type MigrationJournalRuntime,
  type MigrationJournalSnapshot,
} from '@platform/local-data/migration-journal';
import { sendNativeMessage } from '@platform/local-data/native-client';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  createLocalDataError,
  parseBrowserRuntimeFactsRequest,
  parseMigrationId,
  type BrowserRuntimeFactsCommand,
  type LocalDataError,
  type LocalDataErrorCode,
} from './contracts';
import type { FactsOperationGate } from './facts-operation-gate';
import {
  safeMigrationDiagnostic,
  type LocalDataMigrationBrowser,
  type LocalDataMigrationCapability,
  type LocalDataMigrationDatabaseStatus,
  type LocalDataMigrationHostStatus,
  type LocalDataMigrationJournalStatus,
  type LocalDataMigrationStatus,
} from './migration-status';
import { nativeHostContract } from './native-host-contract';

export type MigrationRuntimeEnvironment = Readonly<{
  browser: LocalDataMigrationBrowser;
  officialIdentity: boolean;
  supported: boolean;
}>;

export type MigrationNativeRequest = (
  command: 'GET_STATUS' | 'GET_MIGRATION_RECEIPT',
  payload: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export type MigrationCoordinatorDependencies = Readonly<{
  gate: Pick<FactsOperationGate, 'closeAdmissions' | 'reopenForJournalState' | 'waitForDrained'>;
  journalRuntime?: MigrationJournalRuntime;
  nativeRequest?: MigrationNativeRequest;
  readEnvironment?: () => Promise<MigrationRuntimeEnvironment> | MigrationRuntimeEnvironment;
}>;

export type MigrationCoordinator = Readonly<{
  getStatus: () => Promise<LocalDataMigrationStatus>;
  resume: () => Promise<LocalDataMigrationStatus>;
  start: () => Promise<LocalDataMigrationStatus>;
}>;

type MigrationRouter = Readonly<{
  err: (message: string, extra?: unknown) => unknown;
  ok: (data: unknown) => unknown;
  register: (type: string, handler: (message: unknown) => Promise<unknown> | unknown) => void;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  return value as Record<string, unknown>;
}

function defaultEnvironment(): MigrationRuntimeEnvironment {
  const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
  const runtimeId = String(runtime?.id || '').trim();
  let rootUrl = '';
  try {
    rootUrl = String(runtime?.getURL?.('') || '');
  } catch {
    rootUrl = '';
  }
  if (runtimeId === nativeHostContract.browsers.chrome.runtimeId) {
    return { browser: 'chrome', officialIdentity: true, supported: true };
  }
  if (runtimeId === nativeHostContract.browsers.edge.runtimeId) {
    return { browser: 'edge', officialIdentity: true, supported: true };
  }
  if (runtimeId === nativeHostContract.browsers.firefox.geckoId) {
    return { browser: 'firefox', officialIdentity: true, supported: true };
  }
  if (rootUrl.startsWith('safari-web-extension://')) {
    return { browser: 'safari', officialIdentity: false, supported: false };
  }
  return { browser: 'development', officialIdentity: false, supported: false };
}

async function defaultNativeRequest(
  command: 'GET_STATUS' | 'GET_MIGRATION_RECEIPT',
  payload: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  if (command === 'GET_STATUS') return await sendNativeMessage({ command: 'GET_STATUS', payload: {} });
  return await sendNativeMessage({
    command: 'GET_MIGRATION_RECEIPT',
    payload: { migrationId: parseMigrationId(payload.migrationId) },
  });
}

function assertEnvironment(environment: MigrationRuntimeEnvironment): void {
  if (environment.browser === 'safari') throw new LocalDataContractError('UNSUPPORTED_PLATFORM');
  if (!environment.supported || !environment.officialIdentity) throw new LocalDataContractError('ORIGIN_DENIED');
}

function journalStatus(snapshot: MigrationJournalSnapshot): LocalDataMigrationJournalStatus {
  if (snapshot.mode === 'not_started') return Object.freeze({ mode: 'not_started', stage: 'not_started' });
  if (snapshot.mode === 'blocked') return Object.freeze({ mode: 'blocked', stage: null });
  const terminalCode = snapshot.journal.stage === 'active' ? undefined : snapshot.journal.terminalCode;
  return Object.freeze({
    mode: snapshot.mode,
    stage: snapshot.journal.stage,
    ...(terminalCode ? { terminalCode } : {}),
  });
}

function parseHostStatus(value: unknown): Readonly<{ factsRevision: number; ftsAvailable: boolean }> {
  const input = record(value);
  const databaseUuid = String(input.databaseUuid || '').trim();
  const factsRevision = Number(input.factsRevision);
  const fts = record(input.fts);
  if (
    Object.keys(input).sort().join(',') !== 'databaseUuid,factsRevision,fts' ||
    !databaseUuid ||
    !Number.isSafeInteger(factsRevision) ||
    factsRevision < 0 ||
    Object.keys(fts).sort().join(',') !== 'available,reason' ||
    typeof fts.available !== 'boolean' ||
    !(fts.reason === null || typeof fts.reason === 'string')
  ) {
    throw new LocalDataContractError('PROTOCOL_MISMATCH');
  }
  return Object.freeze({ factsRevision, ftsAvailable: fts.available });
}

function errorCode(error: unknown, fallback: LocalDataErrorCode): LocalDataErrorCode {
  const diagnostic = safeMigrationDiagnostic(error, fallback);
  return diagnostic.code;
}

async function persistFailure(
  journal: Exclude<MigrationJournal, { stage: 'active' }>,
  error: unknown,
  dependencies: MigrationCoordinatorDependencies,
): Promise<void> {
  const terminalCode = errorCode(error, 'MIGRATION_VALIDATION_FAILED');
  const failed = await recordMigrationJournalFailure({ expected: journal, terminalCode }, dependencies.journalRuntime);
  const snapshot = await readMigrationJournal(dependencies.journalRuntime);
  if (snapshot.mode === 'transitional' && snapshot.journal.migrationId === failed.migrationId) {
    dependencies.gate.reopenForJournalState(snapshot);
  }
}

function hostErrorState(error: LocalDataError): Readonly<{
  database: LocalDataMigrationDatabaseStatus;
  host: LocalDataMigrationHostStatus;
}> {
  switch (error.code) {
    case 'DATABASE_NOT_INITIALIZED':
      return {
        host: { registration: 'available', compatibility: 'compatible' },
        database: { presence: 'missing', factsHealth: 'missing' },
      };
    case 'PROTOCOL_MISMATCH':
      return {
        host: { registration: 'available', compatibility: 'protocol_mismatch' },
        database: { presence: 'unknown', factsHealth: 'incompatible' },
      };
    case 'SCHEMA_MISMATCH':
      return {
        host: { registration: 'available', compatibility: 'schema_mismatch' },
        database: { presence: 'unknown', factsHealth: 'incompatible' },
      };
    case 'UNSUPPORTED_PLATFORM':
      return {
        host: { registration: 'available', compatibility: 'unsupported' },
        database: { presence: 'unknown', factsHealth: 'unknown' },
      };
    case 'HOST_UNAVAILABLE':
      return {
        host: { registration: 'unavailable', compatibility: 'unknown' },
        database: { presence: 'unknown', factsHealth: 'unknown' },
      };
    default:
      return {
        host: { registration: 'available', compatibility: 'unknown' },
        database: { presence: 'unknown', factsHealth: 'unknown' },
      };
  }
}

async function probeHost(
  environment: MigrationRuntimeEnvironment,
  nativeRequest: MigrationNativeRequest,
): Promise<
  Readonly<{
    database: LocalDataMigrationDatabaseStatus;
    diagnostics: readonly LocalDataError[];
    host: LocalDataMigrationHostStatus;
  }>
> {
  if (!environment.supported || !environment.officialIdentity) {
    return Object.freeze({
      host: Object.freeze({ registration: 'not_applicable', compatibility: 'unsupported' }),
      database: Object.freeze({ presence: 'unknown', factsHealth: 'unknown' }),
      diagnostics: Object.freeze([]),
    });
  }
  try {
    const status = parseHostStatus(await nativeRequest('GET_STATUS', {}));
    return Object.freeze({
      host: Object.freeze({ registration: 'available', compatibility: 'compatible' }),
      database: Object.freeze({
        presence: 'present',
        factsHealth: 'healthy',
        factsRevision: status.factsRevision,
        ftsAvailable: status.ftsAvailable,
      }),
      diagnostics: Object.freeze([]),
    });
  } catch (error) {
    const diagnostic = safeMigrationDiagnostic(error, 'HOST_UNAVAILABLE');
    const state = hostErrorState(diagnostic);
    return Object.freeze({
      host: Object.freeze(state.host),
      database: Object.freeze(state.database),
      diagnostics: Object.freeze([diagnostic]),
    });
  }
}

async function probeReceipt(
  snapshot: MigrationJournalSnapshot,
  host: LocalDataMigrationHostStatus,
  database: LocalDataMigrationDatabaseStatus,
  nativeRequest: MigrationNativeRequest,
  diagnostics: LocalDataError[],
): Promise<LocalDataMigrationStatus['resumeReceipt']> {
  if (snapshot.mode !== 'transitional') return 'not_applicable';
  if (host.registration !== 'available' || host.compatibility !== 'compatible') return 'unknown';
  if (database.presence === 'missing') return 'absent';
  if (database.presence !== 'present') return 'unknown';
  try {
    const receipt = await nativeRequest('GET_MIGRATION_RECEIPT', { migrationId: snapshot.journal.migrationId });
    if (receipt == null) return 'absent';
    const input = record(receipt);
    if (String(input.migrationId || '').trim() !== snapshot.journal.migrationId) {
      diagnostics.push(createLocalDataError('MIGRATION_RECEIPT_MISMATCH'));
      return 'mismatch';
    }
    return 'matching';
  } catch (error) {
    diagnostics.push(safeMigrationDiagnostic(error, 'HOST_UNAVAILABLE'));
    return 'unknown';
  }
}

function migrationError(error: unknown): LocalDataContractError {
  if (error instanceof LocalDataContractError) return error;
  return new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
}

export function createMigrationCoordinator(dependencies: MigrationCoordinatorDependencies): MigrationCoordinator {
  const nativeRequest = dependencies.nativeRequest ?? defaultNativeRequest;
  const readEnvironment = dependencies.readEnvironment ?? defaultEnvironment;
  let transitionRunning = false;

  const getStatus = async (): Promise<LocalDataMigrationStatus> => {
    const environment = await readEnvironment();
    const snapshot = await readMigrationJournal(dependencies.journalRuntime);
    const capability: LocalDataMigrationCapability = Object.freeze({
      browser: environment.browser,
      officialIdentity: environment.officialIdentity,
      supported: environment.supported,
    });
    const hostProbe = await probeHost(environment, nativeRequest);
    const diagnostics = [...hostProbe.diagnostics];
    if (snapshot.mode === 'blocked') diagnostics.unshift(snapshot.error);
    if (snapshot.mode === 'transitional' && snapshot.journal.terminalCode) {
      diagnostics.unshift(createLocalDataError(snapshot.journal.terminalCode, { stage: snapshot.journal.stage }));
    }
    const resumeReceipt = await probeReceipt(snapshot, hostProbe.host, hostProbe.database, nativeRequest, diagnostics);
    const hostReady = hostProbe.host.registration === 'available' && hostProbe.host.compatibility === 'compatible';
    return Object.freeze({
      actions: Object.freeze({
        canStart: snapshot.mode === 'not_started' && capability.supported && capability.officialIdentity && hostReady,
        canResume: snapshot.mode === 'transitional' && capability.supported && capability.officialIdentity && hostReady,
      }),
      capability,
      database: hostProbe.database,
      diagnostics: Object.freeze(diagnostics),
      host: hostProbe.host,
      journal: journalStatus(snapshot),
      resumeReceipt,
    });
  };

  const runTransition = async (kind: 'start' | 'resume'): Promise<LocalDataMigrationStatus> => {
    if (transitionRunning) throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
    transitionRunning = true;
    let journal: Exclude<MigrationJournal, { stage: 'active' }> | null = null;
    try {
      const environment = await readEnvironment();
      assertEnvironment(environment);
      if (kind === 'start') {
        journal = await beginMigrationJournal(dependencies.journalRuntime);
      } else {
        const snapshot = await readMigrationJournal(dependencies.journalRuntime);
        if (snapshot.mode === 'blocked')
          throw new LocalDataContractError(snapshot.error.code, snapshot.error.diagnostics);
        if (snapshot.mode !== 'transitional') throw new LocalDataContractError('INVALID_ARGUMENT');
        journal = snapshot.journal;
      }

      dependencies.gate.closeAdmissions();
      const persisted = await readMigrationJournal(dependencies.journalRuntime);
      if (persisted.mode !== 'transitional' || persisted.journal.migrationId !== journal.migrationId) {
        throw new LocalDataContractError('JOURNAL_CORRUPT');
      }
      dependencies.gate.reopenForJournalState(persisted);
      await dependencies.gate.waitForDrained();
      return await getStatus();
    } catch (error) {
      const safeError = migrationError(error);
      if (journal) {
        try {
          await persistFailure(journal, safeError, dependencies);
        } catch {
          throw new LocalDataContractError('JOURNAL_CORRUPT');
        }
      }
      throw safeError;
    } finally {
      transitionRunning = false;
    }
  };

  return Object.freeze({
    getStatus,
    start: async () => await runTransition('start'),
    resume: async () => await runTransition('resume'),
  });
}

function parseEmptyMigrationMessage(message: unknown, command: BrowserRuntimeFactsCommand): void {
  if (!message || typeof message !== 'object' || Array.isArray(message))
    throw new LocalDataContractError('INVALID_ARGUMENT');
  const input = message as Record<string, unknown>;
  const { type: _type, ...payload } = input;
  parseBrowserRuntimeFactsRequest({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: 'migration-runtime',
    command,
    payload,
  });
}

function handlerError(router: MigrationRouter, error: unknown): unknown {
  const diagnostic = safeMigrationDiagnostic(error, 'MIGRATION_VALIDATION_FAILED');
  return router.err(diagnostic.message, { code: diagnostic.code, diagnostics: diagnostic.diagnostics ?? null });
}

export function registerMigrationCoordinatorHandlers(router: MigrationRouter, coordinator: MigrationCoordinator): void {
  router.register(LOCAL_DATA_MESSAGE_TYPES.GET_STATUS, async (message) => {
    try {
      parseEmptyMigrationMessage(message, 'GET_LOCAL_DATA_STATUS');
      return router.ok(await coordinator.getStatus());
    } catch (error) {
      return handlerError(router, error);
    }
  });
  router.register(LOCAL_DATA_MESSAGE_TYPES.START_MIGRATION, async (message) => {
    try {
      parseEmptyMigrationMessage(message, 'START_LOCAL_DATA_MIGRATION');
      return router.ok(await coordinator.start());
    } catch (error) {
      return handlerError(router, error);
    }
  });
  router.register(LOCAL_DATA_MESSAGE_TYPES.RESUME_MIGRATION, async (message) => {
    try {
      parseEmptyMigrationMessage(message, 'RESUME_LOCAL_DATA_MIGRATION');
      return router.ok(await coordinator.resume());
    } catch (error) {
      return handlerError(router, error);
    }
  });
}
