import { LOCAL_DATA_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { browserDigestProvider } from '@platform/local-data/browser-digest';
import {
  advanceMigrationJournal,
  beginMigrationJournal,
  readMigrationJournal,
  recordMigrationJournalFailure,
  type MigrationJournal,
  type MigrationJournalRuntime,
  type MigrationJournalSnapshot,
} from '@platform/local-data/migration-journal';
import { connectNative, importNativeFacts, sendNativeMessage } from '@platform/local-data/native-client';
import type { NativeFactsImportProducer } from '@platform/local-data/native-port';
import {
  clearFacts,
  readLegacyFactConversationReferences,
  transferIndexedDbFacts,
  verifyFactsEmpty,
  type FactsEmptyVerification,
  type IndexedDbFactsTransferInput,
} from '@platform/idb/facts-transfer';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  MIGRATION_FACT_KINDS,
  LocalDataContractError,
  parseBrowserRuntimeFactsRequest,
  parseFactsMigrationReceipt,
  parseMigrationId,
  type BrowserRuntimeFactsCommand,
  type FactsMigrationReceipt,
  type LocalDataError,
  type MigrationId,
  type StableConversationReference,
} from './contracts';
import { sha256Hex, type DigestProvider } from './digest';
import { encodeCanonicalJson } from './facts-archive';
import { parseFactsManifest, type FactsManifest } from './facts-manifest';
import type { FactsOperationGate } from './facts-operation-gate';
import {
  safeMigrationDiagnostic,
  type LocalDataMigrationBrowser,
  type LocalDataMigrationCapability,
  type LocalDataMigrationDatabaseStatus,
  type LocalDataMigrationHostStatus,
  type LocalDataMigrationJournalStatus,
  type LocalDataMigrationStatus,
  type LocalDataProfileState,
  type LocalDataMigrationPlatform,
} from './migration-status';
import { nativeHostContract } from './native-host-contract';
import { createProfileReferenceRebase, type ProfileReferenceRebase } from './profile-reference-rebase';

export type MigrationRuntimeEnvironment = Readonly<{
  browser: LocalDataMigrationBrowser;
  officialIdentity: boolean;
  platform: LocalDataMigrationPlatform;
  supported: boolean;
}>;

export type MigrationNativeRequest = (
  command: 'GET_STATUS' | 'GET_FACTS_REVISION' | 'GET_MIGRATION_RECEIPT',
  payload: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export type MigrationNativeImport = (
  input: Readonly<{
    migrationId: MigrationId;
    produce: NativeFactsImportProducer;
  }>,
) => Promise<unknown>;

export type MigrationFactsTransfer = (input: IndexedDbFactsTransferInput) => Promise<FactsManifest>;

export type MigrationCoordinatorDependencies = Readonly<{
  clearSourceFacts?: () => Promise<void>;
  digestProvider?: DigestProvider;
  gate: Pick<FactsOperationGate, 'closeAdmissions' | 'reopenForJournalState' | 'waitForDrained'>;
  journalRuntime?: MigrationJournalRuntime;
  nativeImport?: MigrationNativeImport;
  nativeRequest?: MigrationNativeRequest;
  onActivated?: () => void | Promise<void>;
  profileReferences?: ProfileReferenceRebase;
  readEnvironment?: () => Promise<MigrationRuntimeEnvironment> | MigrationRuntimeEnvironment;
  rearmSchedulers?: () => Promise<void>;
  transferFacts?: MigrationFactsTransfer;
  verifySourceFactsEmpty?: () => Promise<FactsEmptyVerification>;
}>;

export type MigrationCoordinator = Readonly<{
  getFactsRevision: () => Promise<number | null>;
  getStatus: () => Promise<LocalDataMigrationStatus>;
  recover: () => Promise<void>;
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

async function readRuntimePlatform(runtime: any): Promise<LocalDataMigrationPlatform> {
  if (typeof runtime?.getPlatformInfo !== 'function') return 'unknown';
  try {
    const info = await new Promise<any>((resolve, reject) => {
      const browserRuntime = (globalThis as any).browser?.runtime;
      if (browserRuntime === runtime) {
        Promise.resolve(runtime.getPlatformInfo()).then(resolve, reject);
        return;
      }
      runtime.getPlatformInfo((value: unknown) => {
        const lastError = runtime?.lastError;
        if (lastError) reject(lastError);
        else resolve(value);
      });
    });
    switch (String(info?.os || '')) {
      case 'mac':
        return 'mac';
      case 'win':
        return 'windows';
      case 'linux':
        return 'linux';
      default:
        return 'unknown';
    }
  } catch {
    return 'unknown';
  }
}

async function defaultEnvironment(): Promise<MigrationRuntimeEnvironment> {
  const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
  const platform = await readRuntimePlatform(runtime);
  const runtimeId = String(runtime?.id || '').trim();
  let rootUrl = '';
  try {
    rootUrl = String(runtime?.getURL?.('') || '');
  } catch {
    rootUrl = '';
  }
  if (runtimeId === nativeHostContract.browsers.chrome.runtimeId) {
    return { browser: 'chrome', officialIdentity: true, platform, supported: true };
  }
  if (runtimeId === nativeHostContract.browsers.edge.runtimeId) {
    return { browser: 'edge', officialIdentity: true, platform, supported: true };
  }
  if (runtimeId === nativeHostContract.browsers.firefox.geckoId) {
    return { browser: 'firefox', officialIdentity: true, platform, supported: true };
  }
  if (rootUrl.startsWith('safari-web-extension://')) {
    return { browser: 'safari', officialIdentity: false, platform, supported: false };
  }
  return { browser: 'development', officialIdentity: false, platform, supported: false };
}

async function defaultNativeRequest(
  command: 'GET_STATUS' | 'GET_FACTS_REVISION' | 'GET_MIGRATION_RECEIPT',
  payload: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  if (command === 'GET_STATUS') return await sendNativeMessage({ command: 'GET_STATUS', payload: {} });
  if (command === 'GET_FACTS_REVISION') {
    return await sendNativeMessage({ command: 'GET_FACTS_REVISION', payload: {} });
  }
  return await sendNativeMessage({
    command: 'GET_MIGRATION_RECEIPT',
    payload: { migrationId: parseMigrationId(payload.migrationId) },
  });
}

async function defaultNativeImport(
  input: Readonly<{
    migrationId: MigrationId;
    produce: NativeFactsImportProducer;
  }>,
): Promise<FactsMigrationReceipt> {
  return await importNativeFacts(input);
}

async function defaultValidateNativeReference(reference: StableConversationReference): Promise<boolean> {
  try {
    const value = record(
      await connectNative({
        command: 'CONVERSATION_LOOKUP',
        payload: { source: reference.source, conversationKey: reference.conversationKey },
      }),
    );
    if (
      String(value.source || '').trim() !== reference.source ||
      String(value.conversationKey || '').trim() !== reference.conversationKey
    ) {
      throw new LocalDataContractError('PROTOCOL_MISMATCH');
    }
    return true;
  } catch (error) {
    if (error instanceof LocalDataContractError && error.code === 'STALE_REFERENCE') return false;
    throw error;
  }
}

function parseReceipt(value: unknown): FactsMigrationReceipt {
  try {
    return parseFactsMigrationReceipt(value);
  } catch (error) {
    if (error instanceof LocalDataContractError) {
      if (error.code === 'PROTOCOL_MISMATCH' || error.code === 'SCHEMA_MISMATCH') throw error;
    }
    throw new LocalDataContractError('MIGRATION_RECEIPT_MISMATCH');
  }
}

async function requireMatchingReceipt(
  value: unknown,
  manifestValue: unknown,
  digestProvider: DigestProvider,
): Promise<FactsMigrationReceipt> {
  const manifest = parseFactsManifest(manifestValue);
  const receipt = parseReceipt(value);
  const manifestDigest = await sha256Hex(digestProvider, encodeCanonicalJson(manifest).bytes);
  if (
    receipt.migrationId !== manifest.migrationId ||
    receipt.protocolVersion !== manifest.protocolVersion ||
    receipt.schemaVersion !== manifest.schemaVersion ||
    receipt.manifestDigest !== manifestDigest ||
    MIGRATION_FACT_KINDS.some((kind) => receipt.factCounts[kind] !== manifest.factCounts[kind])
  ) {
    throw new LocalDataContractError('MIGRATION_RECEIPT_MISMATCH');
  }
  return receipt;
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

async function persistFailure(
  journal: Exclude<MigrationJournal, { stage: 'active' }>,
  error: unknown,
  dependencies: MigrationCoordinatorDependencies,
): Promise<void> {
  const diagnostic = safeMigrationDiagnostic(error, 'MIGRATION_VALIDATION_FAILED');
  const terminalDiagnostics = { ...(diagnostic.diagnostics ?? {}), stage: journal.stage };
  const failed = await recordMigrationJournalFailure(
    {
      expected: journal,
      terminalCode: diagnostic.code,
      terminalDiagnostics,
    },
    dependencies.journalRuntime,
  );
  const snapshot = await readMigrationJournal(dependencies.journalRuntime);
  if (snapshot.mode === 'failed' && snapshot.journal.migrationId === failed.migrationId) {
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

function migrationError(error: unknown): LocalDataContractError {
  if (error instanceof LocalDataContractError) return error;
  return new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
}

export function createMigrationCoordinator(dependencies: MigrationCoordinatorDependencies): MigrationCoordinator {
  const digestProvider = dependencies.digestProvider ?? browserDigestProvider;
  const nativeImport = dependencies.nativeImport ?? defaultNativeImport;
  const nativeRequest = dependencies.nativeRequest ?? defaultNativeRequest;
  const readEnvironment = dependencies.readEnvironment ?? defaultEnvironment;
  const transferFacts = dependencies.transferFacts ?? transferIndexedDbFacts;
  const clearSourceFacts = dependencies.clearSourceFacts ?? (async () => await clearFacts());
  const verifySourceFactsEmpty = dependencies.verifySourceFactsEmpty ?? (async () => await verifyFactsEmpty());
  const profileReferences =
    dependencies.profileReferences ??
    createProfileReferenceRebase({
      digestProvider,
      resolveLegacyConversationReferences: async (conversationIds) =>
        await readLegacyFactConversationReferences(conversationIds),
      validateNativeReference: defaultValidateNativeReference,
    });
  const rearmSchedulers = dependencies.rearmSchedulers ?? (async () => {});
  const onActivated = dependencies.onActivated ?? (async () => {});
  let transitionRunning = false;

  const getFactsRevision = async (): Promise<number | null> => {
    const snapshot = await readMigrationJournal(dependencies.journalRuntime);
    if (snapshot.mode !== 'active') return null;
    const environment = await readEnvironment();
    assertEnvironment(environment);
    const value = record(await nativeRequest('GET_FACTS_REVISION', {}));
    if (Object.keys(value).sort().join(',') !== 'factsRevision') {
      throw new LocalDataContractError('PROTOCOL_MISMATCH');
    }
    const factsRevision = Number(value.factsRevision);
    if (!Number.isSafeInteger(factsRevision) || factsRevision < 0) {
      throw new LocalDataContractError('PROTOCOL_MISMATCH');
    }
    return factsRevision;
  };

  const getStatus = async (): Promise<LocalDataMigrationStatus> => {
    const environment = await readEnvironment();
    const snapshot = await readMigrationJournal(dependencies.journalRuntime);
    const capability: LocalDataMigrationCapability = Object.freeze({
      browser: environment.browser,
      officialIdentity: environment.officialIdentity,
      platform: environment.platform,
      supported: environment.supported,
    });
    const hostProbe = await probeHost(environment, nativeRequest);
    const diagnostics =
      snapshot.mode === 'blocked' || snapshot.mode === 'failed'
        ? [snapshot.error, ...hostProbe.diagnostics.filter((diagnostic) => diagnostic.code !== snapshot.error.code)]
        : [...hostProbe.diagnostics];
    const hostReady = hostProbe.host.registration === 'available' && hostProbe.host.compatibility === 'compatible';
    const profileState: LocalDataProfileState = (() => {
      if (snapshot.mode === 'blocked') return 'blocked';
      if (snapshot.mode === 'failed') return 'migration_failed';
      if (snapshot.mode === 'active') return 'active';
      if (snapshot.mode === 'transitional') return 'migration_in_progress';
      if (!capability.supported || !capability.officialIdentity || !hostReady) return 'unavailable';
      return hostProbe.database.presence === 'present' && hostProbe.database.factsHealth === 'healthy'
        ? 'join_existing_required'
        : 'setup_required';
    })();
    return Object.freeze({
      actions: Object.freeze({
        canStart:
          (snapshot.mode === 'not_started' || snapshot.mode === 'failed') &&
          capability.supported &&
          capability.officialIdentity &&
          hostReady,
      }),
      capability,
      database: hostProbe.database,
      diagnostics: Object.freeze(diagnostics),
      host: hostProbe.host,
      journal: journalStatus(snapshot),
      profileState,
    });
  };

  const produceManifest = async (
    migrationId: MigrationId,
    input: Readonly<{
      onFrame: IndexedDbFactsTransferInput['onFrame'];
      signal?: AbortSignal;
    }>,
  ): Promise<FactsManifest> =>
    parseFactsManifest(
      await transferFacts({
        digestProvider,
        migrationId,
        onFrame: input.onFrame,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );

  const streamStaging = async (migrationId: MigrationId): Promise<FactsManifest> => {
    let producedManifest: FactsManifest | null = null;
    const rawReceipt = await nativeImport({
      migrationId,
      produce: async ({ onFrame, signal }) => {
        producedManifest = await produceManifest(migrationId, { onFrame, signal });
        return producedManifest;
      },
    });
    if (!producedManifest) throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
    await requireMatchingReceipt(rawReceipt, producedManifest, digestProvider);
    return producedManifest;
  };

  const readMigrationReceipt = async (migrationId: MigrationId): Promise<unknown | null> => {
    try {
      return await nativeRequest('GET_MIGRATION_RECEIPT', { migrationId });
    } catch (error) {
      if (error instanceof LocalDataContractError && error.code === 'DATABASE_NOT_INITIALIZED') return null;
      throw error;
    }
  };

  const recoverStaging = async (migrationId: MigrationId): Promise<FactsManifest> => {
    const rawReceipt = await readMigrationReceipt(migrationId);
    if (rawReceipt == null) return await streamStaging(migrationId);

    const receipt = parseReceipt(rawReceipt);
    if (receipt.migrationId !== migrationId) throw new LocalDataContractError('MIGRATION_RECEIPT_MISMATCH');
    const manifest = await produceManifest(migrationId, { onFrame: async () => {} });
    await requireMatchingReceipt(receipt, manifest, digestProvider);
    return manifest;
  };

  const requireDurableReceipt = async (manifest: FactsManifest): Promise<FactsMigrationReceipt> => {
    const rawReceipt = await readMigrationReceipt(manifest.migrationId);
    if (rawReceipt == null) throw new LocalDataContractError('MIGRATION_RECEIPT_MISMATCH');
    return await requireMatchingReceipt(rawReceipt, manifest, digestProvider);
  };

  const requireTransitionalJournal = async (
    migrationId: MigrationId,
    stage?: Exclude<MigrationJournal['stage'], 'active'>,
  ): Promise<Exclude<MigrationJournal, { stage: 'active' }>> => {
    const snapshot = await readMigrationJournal(dependencies.journalRuntime);
    if (
      snapshot.mode !== 'transitional' ||
      snapshot.journal.migrationId !== migrationId ||
      (stage !== undefined && snapshot.journal.stage !== stage)
    ) {
      throw new LocalDataContractError('JOURNAL_CORRUPT');
    }
    dependencies.gate.reopenForJournalState(snapshot);
    return snapshot.journal;
  };

  const runTransition = async (kind: 'start' | 'recover'): Promise<LocalDataMigrationStatus> => {
    if (transitionRunning) throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
    transitionRunning = true;
    let journal: Exclude<MigrationJournal, { stage: 'active' }> | null = null;
    try {
      const environment = await readEnvironment();
      assertEnvironment(environment);
      const initial = await readMigrationJournal(dependencies.journalRuntime);
      let recoveringExistingJournal = false;
      if (kind === 'start') {
        if (initial.mode === 'blocked') {
          throw new LocalDataContractError(initial.error.code, initial.error.diagnostics);
        }
        if (initial.mode === 'not_started') {
          journal = await beginMigrationJournal(dependencies.journalRuntime);
        } else if (initial.mode === 'failed') {
          journal = initial.journal;
          recoveringExistingJournal = true;
        } else {
          throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
        }
      } else {
        if (initial.mode !== 'transitional') throw new LocalDataContractError('INVALID_ARGUMENT');
        journal = initial.journal;
        recoveringExistingJournal = true;
      }

      if (initial.mode === 'failed') {
        journal = (await advanceMigrationJournal(
          { expected: journal, stage: journal.stage },
          dependencies.journalRuntime,
        )) as Exclude<MigrationJournal, { stage: 'active' }>;
      }

      dependencies.gate.closeAdmissions();
      const persisted = await readMigrationJournal(dependencies.journalRuntime);
      if (persisted.mode !== 'transitional' || persisted.journal.migrationId !== journal.migrationId) {
        throw new LocalDataContractError('JOURNAL_CORRUPT');
      }
      dependencies.gate.reopenForJournalState(persisted);
      await dependencies.gate.waitForDrained();

      if (journal.stage === 'staging') {
        const manifest = recoveringExistingJournal
          ? await recoverStaging(journal.migrationId)
          : await streamStaging(journal.migrationId);
        const migrationId = journal.migrationId;
        await advanceMigrationJournal(
          { expected: journal, stage: 'remote_committed', manifest },
          dependencies.journalRuntime,
        );
        journal = await requireTransitionalJournal(migrationId, 'remote_committed');
      }

      if (journal.stage === 'remote_committed') {
        await requireDurableReceipt(journal.manifest);
        const referencePatch = await profileReferences.buildPatch();
        const migrationId = journal.migrationId;
        await advanceMigrationJournal(
          { expected: journal, stage: 'profile_refs_pending', referencePatch },
          dependencies.journalRuntime,
        );
        journal = await requireTransitionalJournal(migrationId, 'profile_refs_pending');
      }

      if (journal.stage === 'profile_refs_pending') {
        await profileReferences.applyAndVerify(journal.referencePatch, journal.referencePatchDigest);
        const migrationId = journal.migrationId;
        await advanceMigrationJournal({ expected: journal, stage: 'cleanup_pending' }, dependencies.journalRuntime);
        journal = await requireTransitionalJournal(migrationId, 'cleanup_pending');
      }

      if (journal.stage === 'cleanup_pending') {
        await requireDurableReceipt(journal.manifest);
        await profileReferences.verifyApplied(journal.referencePatch, journal.referencePatchDigest);
        await clearSourceFacts();
        const verification = await verifySourceFactsEmpty();
        if (!verification.empty || MIGRATION_FACT_KINDS.some((kind) => verification.counts[kind] !== 0)) {
          throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
        }

        const migrationId = journal.migrationId;
        await advanceMigrationJournal({ expected: journal, stage: 'active' }, dependencies.journalRuntime);
        journal = null;
        const active = await readMigrationJournal(dependencies.journalRuntime);
        if (active.mode !== 'active' || active.journal.migrationId !== migrationId) {
          throw new LocalDataContractError('JOURNAL_CORRUPT');
        }
        dependencies.gate.reopenForJournalState(active);
        await rearmSchedulers().catch(() => {});
        await Promise.resolve(onActivated()).catch(() => {});
      }

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
    getFactsRevision,
    getStatus,
    recover: async () => {
      const snapshot = await readMigrationJournal(dependencies.journalRuntime);
      if (snapshot.mode !== 'transitional') return;
      await runTransition('recover');
    },
    start: async () => await runTransition('start'),
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
  router.register(LOCAL_DATA_MESSAGE_TYPES.GET_FACTS_REVISION, async (message) => {
    try {
      parseEmptyMigrationMessage(message, 'GET_FACTS_REVISION');
      return router.ok({ factsRevision: await coordinator.getFactsRevision() });
    } catch (error) {
      return handlerError(router, error);
    }
  });
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
}
