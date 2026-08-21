import {
  IDB_FACTS_EPOCH,
  LOCAL_DATA_ERROR_CODES,
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  createLocalDataError,
  parseMigrationId,
  parseMigrationJournalStage,
  parseMigrationProfileReferencePatch,
  parseOrderedFrameDigest,
  serializeMigrationProfileReferencePatch,
  type FactsEpoch,
  type LocalDataDiagnostics,
  type LocalDataError,
  type LocalDataErrorCode,
  type MigrationId,
  type MigrationJournalStage,
  type MigrationProfileReferencePatch,
} from '@services/local-data/contracts';
import { sha256Hex, type DigestProvider } from '@services/local-data/digest';
import { parseFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';

import { storageGet, storageSet } from '../storage/local';
import { browserDigestProvider } from './browser-digest';

export const MIGRATION_JOURNAL_STORAGE_KEY = 'syncnos_local_data_migration_journal_v1' as const;
export const MIGRATION_JOURNAL_VERSION = 1 as const;

type PersistedMigrationJournalStage = Exclude<MigrationJournalStage, 'not_started'>;

type MigrationJournalBase<TStage extends PersistedMigrationJournalStage> = Readonly<{
  createdAt: number;
  migrationId: MigrationId;
  protocolVersion: typeof LOCAL_DATA_PROTOCOL_VERSION;
  schemaVersion: typeof LOCAL_DATA_SCHEMA_VERSION;
  stage: TStage;
  terminalCode?: LocalDataErrorCode;
  terminalDiagnostics?: LocalDataDiagnostics;
  updatedAt: number;
  version: typeof MIGRATION_JOURNAL_VERSION;
}>;

export type StagingMigrationJournal = MigrationJournalBase<'staging'>;

export type RemoteCommittedMigrationJournal = MigrationJournalBase<'remote_committed'> &
  Readonly<{
    manifest: FactsManifest;
  }>;

export type ProfileReferencesPendingMigrationJournal = MigrationJournalBase<'profile_refs_pending'> &
  Readonly<{
    manifest: FactsManifest;
    referencePatch: MigrationProfileReferencePatch;
    referencePatchDigest: string;
  }>;

export type CleanupPendingMigrationJournal = MigrationJournalBase<'cleanup_pending'> &
  Readonly<{
    manifest: FactsManifest;
    referencePatch: MigrationProfileReferencePatch;
    referencePatchDigest: string;
  }>;

export type ActiveMigrationJournal = Omit<MigrationJournalBase<'active'>, 'terminalCode' | 'terminalDiagnostics'> &
  Readonly<{
    manifest: FactsManifest;
    profileReferencesCompleted: true;
    referencePatchDigest: string;
  }>;

export type MigrationJournal =
  | StagingMigrationJournal
  | RemoteCommittedMigrationJournal
  | ProfileReferencesPendingMigrationJournal
  | CleanupPendingMigrationJournal
  | ActiveMigrationJournal;

export type MigrationJournalStorage = Readonly<{
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}>;

export type MigrationJournalRuntime = Readonly<{
  digestProvider?: DigestProvider;
  now?: () => number;
  randomUUID?: () => string;
  storage?: MigrationJournalStorage;
}>;

type ResolvedMigrationJournalRuntime = Readonly<{
  digestProvider: DigestProvider;
  now: () => number;
  randomUUID?: () => string;
  storage: MigrationJournalStorage;
}>;

export type MigrationJournalMode = 'not_started' | 'transitional' | 'failed' | 'active' | 'blocked';

export type MigrationJournalSnapshot =
  | Readonly<{
      error: null;
      factsEpoch: typeof IDB_FACTS_EPOCH;
      journal: null;
      mode: 'not_started';
    }>
  | Readonly<{
      error: null;
      factsEpoch: null;
      journal: Exclude<MigrationJournal, ActiveMigrationJournal>;
      mode: 'transitional';
    }>
  | Readonly<{
      error: LocalDataError;
      factsEpoch: null;
      journal: Exclude<MigrationJournal, ActiveMigrationJournal>;
      mode: 'failed';
    }>
  | Readonly<{
      error: null;
      factsEpoch: `native:${MigrationId}`;
      journal: ActiveMigrationJournal;
      mode: 'active';
    }>
  | Readonly<{
      error: LocalDataError;
      factsEpoch: null;
      journal: null;
      mode: 'blocked';
    }>;

export type AdvanceMigrationJournalInput = Readonly<{
  expected: MigrationJournal;
  manifest?: FactsManifest;
  referencePatch?: MigrationProfileReferencePatch;
  stage: PersistedMigrationJournalStage;
}>;

export type RecordMigrationJournalFailureInput = Readonly<{
  expected: Exclude<MigrationJournal, ActiveMigrationJournal>;
  terminalCode: LocalDataErrorCode;
  terminalDiagnostics?: LocalDataDiagnostics;
}>;

const textEncoder = new TextEncoder();

const JOURNAL_BASE_KEYS = [
  'version',
  'stage',
  'migrationId',
  'protocolVersion',
  'schemaVersion',
  'createdAt',
  'updatedAt',
] as const;

const LEGAL_NEXT_STAGES: Readonly<Record<PersistedMigrationJournalStage, readonly PersistedMigrationJournalStage[]>> = {
  staging: ['staging', 'remote_committed'],
  remote_committed: ['remote_committed', 'profile_refs_pending'],
  profile_refs_pending: ['profile_refs_pending', 'cleanup_pending'],
  cleanup_pending: ['cleanup_pending', 'active'],
  active: ['active'],
};

function journalFailure(): never {
  throw new LocalDataContractError('JOURNAL_CORRUPT');
}

function invalidTransition(): never {
  throw new LocalDataContractError('MIGRATION_IN_PROGRESS');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) journalFailure();
  return value;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) journalFailure();
}

function parseNonNegativeSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) journalFailure();
  return Number(value);
}

function parseTerminalCode(value: unknown): LocalDataErrorCode {
  if (typeof value !== 'string' || !LOCAL_DATA_ERROR_CODES.includes(value as LocalDataErrorCode)) journalFailure();
  return value as LocalDataErrorCode;
}

function parseJournalBase(
  value: Record<string, unknown>,
  stage: PersistedMigrationJournalStage,
): MigrationJournalBase<PersistedMigrationJournalStage> {
  const terminalCode = hasOwn(value, 'terminalCode') ? parseTerminalCode(value.terminalCode) : undefined;
  if (hasOwn(value, 'terminalDiagnostics') && !terminalCode) journalFailure();
  const terminalDiagnostics = hasOwn(value, 'terminalDiagnostics')
    ? createLocalDataError(terminalCode!, value.terminalDiagnostics).diagnostics
    : undefined;
  if (value.version !== MIGRATION_JOURNAL_VERSION) journalFailure();
  if (value.stage !== stage) journalFailure();
  if (value.protocolVersion !== LOCAL_DATA_PROTOCOL_VERSION || value.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION)
    journalFailure();
  const createdAt = parseNonNegativeSafeInteger(value.createdAt);
  const updatedAt = parseNonNegativeSafeInteger(value.updatedAt);
  if (createdAt > updatedAt) journalFailure();
  return Object.freeze({
    version: MIGRATION_JOURNAL_VERSION,
    stage,
    migrationId: parseMigrationId(value.migrationId),
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    createdAt,
    updatedAt,
    ...(terminalCode ? { terminalCode } : {}),
    ...(terminalDiagnostics ? { terminalDiagnostics } : {}),
  });
}

function assertManifestMatchesJournal(
  base: MigrationJournalBase<PersistedMigrationJournalStage>,
  manifest: FactsManifest,
): void {
  if (
    manifest.migrationId !== base.migrationId ||
    manifest.protocolVersion !== base.protocolVersion ||
    manifest.schemaVersion !== base.schemaVersion
  ) {
    journalFailure();
  }
}

export async function migrationProfileReferencePatchDigest(
  patch: MigrationProfileReferencePatch,
  digestProvider: DigestProvider = browserDigestProvider,
): Promise<string> {
  try {
    return await sha256Hex(digestProvider, textEncoder.encode(serializeMigrationProfileReferencePatch(patch)));
  } catch (_error) {
    journalFailure();
  }
}

async function parseMigrationJournal(value: unknown, digestProvider: DigestProvider): Promise<MigrationJournal> {
  try {
    const input = record(value);
    const stage = parseMigrationJournalStage(input.stage);
    if (stage === 'not_started') journalFailure();

    const hasTerminalCode = hasOwn(input, 'terminalCode');
    const hasTerminalDiagnostics = hasOwn(input, 'terminalDiagnostics');
    if (hasTerminalDiagnostics && !hasTerminalCode) journalFailure();
    const keys = (extra: readonly string[]) => [
      ...JOURNAL_BASE_KEYS,
      ...extra,
      ...(hasTerminalCode ? ['terminalCode'] : []),
      ...(hasTerminalDiagnostics ? ['terminalDiagnostics'] : []),
    ];
    switch (stage) {
      case 'staging': {
        exactKeys(input, keys([]));
        return parseJournalBase(input, stage) as StagingMigrationJournal;
      }
      case 'remote_committed': {
        exactKeys(input, keys(['manifest']));
        const base = parseJournalBase(input, stage);
        const manifest = parseFactsManifest(input.manifest);
        assertManifestMatchesJournal(base, manifest);
        return Object.freeze({ ...base, stage: 'remote_committed', manifest }) as RemoteCommittedMigrationJournal;
      }
      case 'profile_refs_pending':
      case 'cleanup_pending': {
        exactKeys(input, keys(['manifest', 'referencePatch', 'referencePatchDigest']));
        const base = parseJournalBase(input, stage);
        const manifest = parseFactsManifest(input.manifest);
        assertManifestMatchesJournal(base, manifest);
        const referencePatch = parseMigrationProfileReferencePatch(input.referencePatch);
        const expectedDigest = parseOrderedFrameDigest(input.referencePatchDigest);
        if ((await migrationProfileReferencePatchDigest(referencePatch, digestProvider)) !== expectedDigest)
          journalFailure();
        return Object.freeze({ ...base, manifest, referencePatch, referencePatchDigest: expectedDigest }) as
          | ProfileReferencesPendingMigrationJournal
          | CleanupPendingMigrationJournal;
      }
      case 'active': {
        exactKeys(input, [...JOURNAL_BASE_KEYS, 'manifest', 'referencePatchDigest', 'profileReferencesCompleted']);
        const base = parseJournalBase(input, stage);
        const manifest = parseFactsManifest(input.manifest);
        assertManifestMatchesJournal(base, manifest);
        if (input.profileReferencesCompleted !== true) journalFailure();
        return Object.freeze({
          ...base,
          stage: 'active',
          manifest,
          referencePatchDigest: parseOrderedFrameDigest(input.referencePatchDigest),
          profileReferencesCompleted: true,
        }) as ActiveMigrationJournal;
      }
    }
  } catch (_error) {
    journalFailure();
  }
}

function serializeMigrationJournal(value: MigrationJournal): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') journalFailure();
  return serialized;
}

function sameJournal(left: MigrationJournal | null, right: MigrationJournal | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return serializeMigrationJournal(left) === serializeMigrationJournal(right);
}

function resolveRuntime(runtime: MigrationJournalRuntime = {}): ResolvedMigrationJournalRuntime {
  return {
    storage: runtime.storage ?? { get: storageGet, set: storageSet },
    digestProvider: runtime.digestProvider ?? browserDigestProvider,
    now: runtime.now ?? (() => Date.now()),
    randomUUID: runtime.randomUUID ?? globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
  };
}

function now(runtime: ResolvedMigrationJournalRuntime, minimum = 0): number {
  try {
    return Math.max(parseNonNegativeSafeInteger(runtime.now()), minimum);
  } catch (_error) {
    journalFailure();
  }
}

async function readPersistedMigrationJournal(
  runtime: ResolvedMigrationJournalRuntime,
): Promise<MigrationJournal | null> {
  try {
    const stored = record(await runtime.storage.get([MIGRATION_JOURNAL_STORAGE_KEY]));
    if (!hasOwn(stored, MIGRATION_JOURNAL_STORAGE_KEY)) return null;
    return await parseMigrationJournal(stored[MIGRATION_JOURNAL_STORAGE_KEY], runtime.digestProvider);
  } catch (_error) {
    journalFailure();
  }
}

async function persistMigrationJournal(input: {
  expected: MigrationJournal | null;
  next: MigrationJournal;
  runtime: ResolvedMigrationJournalRuntime;
}): Promise<MigrationJournal> {
  const expected = input.expected
    ? await parseMigrationJournal(input.expected, input.runtime.digestProvider).catch(() => journalFailure())
    : null;
  const next = await parseMigrationJournal(input.next, input.runtime.digestProvider).catch(() => journalFailure());
  const current = await readPersistedMigrationJournal(input.runtime);
  if (!sameJournal(current, expected)) invalidTransition();

  try {
    await input.runtime.storage.set({ [MIGRATION_JOURNAL_STORAGE_KEY]: JSON.parse(serializeMigrationJournal(next)) });
  } catch (_error) {
    journalFailure();
  }

  const readBack = await readPersistedMigrationJournal(input.runtime);
  if (!sameJournal(readBack, next)) journalFailure();
  return readBack!;
}

function journalBase(
  expected: MigrationJournal | null,
  stage: PersistedMigrationJournalStage,
  runtime: ResolvedMigrationJournalRuntime,
): MigrationJournalBase<PersistedMigrationJournalStage> {
  if (!expected) {
    const createdAt = now(runtime);
    let migrationId: MigrationId;
    try {
      if (typeof runtime.randomUUID !== 'function') journalFailure();
      migrationId = parseMigrationId(runtime.randomUUID());
    } catch (_error) {
      journalFailure();
    }
    return Object.freeze({
      version: MIGRATION_JOURNAL_VERSION,
      stage,
      migrationId: migrationId!,
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      createdAt,
      updatedAt: createdAt,
    });
  }
  return Object.freeze({
    version: MIGRATION_JOURNAL_VERSION,
    stage,
    migrationId: expected.migrationId,
    protocolVersion: expected.protocolVersion,
    schemaVersion: expected.schemaVersion,
    createdAt: expected.createdAt,
    updatedAt: now(runtime, expected.updatedAt),
  });
}

function transitionMigrationJournal(
  input: AdvanceMigrationJournalInput,
  runtime: ResolvedMigrationJournalRuntime,
): MigrationJournal {
  const expected = input.expected;
  const stage = input.stage;
  if (!LEGAL_NEXT_STAGES[expected.stage].includes(stage)) invalidTransition();

  const sameStage = expected.stage === stage;
  if (sameStage && (input.manifest !== undefined || input.referencePatch !== undefined)) invalidTransition();
  if (expected.stage === 'active') return expected;

  const base = journalBase(expected, stage, runtime);
  switch (stage) {
    case 'staging':
      if (!sameStage) invalidTransition();
      return base as StagingMigrationJournal;
    case 'remote_committed': {
      const manifest = sameStage
        ? (expected as RemoteCommittedMigrationJournal).manifest
        : input.manifest === undefined
          ? invalidTransition()
          : parseFactsManifest(input.manifest);
      if (input.referencePatch !== undefined) invalidTransition();
      assertManifestMatchesJournal(base, manifest);
      return Object.freeze({ ...base, stage: 'remote_committed', manifest }) as RemoteCommittedMigrationJournal;
    }
    case 'profile_refs_pending': {
      const previous = expected as RemoteCommittedMigrationJournal | ProfileReferencesPendingMigrationJournal;
      const manifest = previous.manifest;
      const referencePatch = sameStage
        ? (previous as ProfileReferencesPendingMigrationJournal).referencePatch
        : input.referencePatch === undefined
          ? invalidTransition()
          : parseMigrationProfileReferencePatch(input.referencePatch);
      if (input.manifest !== undefined) invalidTransition();
      assertManifestMatchesJournal(base, manifest);
      return Object.freeze({
        ...base,
        manifest,
        referencePatch,
        referencePatchDigest: '',
      }) as ProfileReferencesPendingMigrationJournal;
    }
    case 'cleanup_pending': {
      if (!sameStage && expected.stage !== 'profile_refs_pending') invalidTransition();
      if (input.manifest !== undefined || input.referencePatch !== undefined) invalidTransition();
      const previous = expected as ProfileReferencesPendingMigrationJournal | CleanupPendingMigrationJournal;
      assertManifestMatchesJournal(base, previous.manifest);
      return Object.freeze({
        ...base,
        stage: 'cleanup_pending',
        manifest: previous.manifest,
        referencePatch: previous.referencePatch,
        referencePatchDigest: previous.referencePatchDigest,
      }) as CleanupPendingMigrationJournal;
    }
    case 'active': {
      if (!sameStage && expected.stage !== 'cleanup_pending') invalidTransition();
      if (input.manifest !== undefined || input.referencePatch !== undefined) invalidTransition();
      const previous = expected as CleanupPendingMigrationJournal | ActiveMigrationJournal;
      assertManifestMatchesJournal(base, previous.manifest);
      return Object.freeze({
        ...base,
        stage: 'active',
        manifest: previous.manifest,
        referencePatchDigest: previous.referencePatchDigest,
        profileReferencesCompleted: true,
      }) as ActiveMigrationJournal;
    }
  }
}

async function finalizeTransitionJournal(
  journal: MigrationJournal,
  runtime: ResolvedMigrationJournalRuntime,
): Promise<MigrationJournal> {
  if (journal.stage !== 'profile_refs_pending') return journal;
  const digest = await migrationProfileReferencePatchDigest(journal.referencePatch, runtime.digestProvider);
  return Object.freeze({ ...journal, referencePatchDigest: digest });
}

export async function readMigrationJournal(runtime: MigrationJournalRuntime = {}): Promise<MigrationJournalSnapshot> {
  try {
    const journal = await readPersistedMigrationJournal(resolveRuntime(runtime));
    if (!journal) return { mode: 'not_started', journal: null, factsEpoch: IDB_FACTS_EPOCH, error: null };
    if (journal.stage === 'active') {
      return {
        mode: 'active',
        journal,
        factsEpoch: `native:${journal.migrationId}`,
        error: null,
      };
    }
    if (journal.terminalCode) {
      return {
        mode: 'failed',
        journal,
        factsEpoch: null,
        error: createLocalDataError(journal.terminalCode, journal.terminalDiagnostics),
      };
    }
    return { mode: 'transitional', journal, factsEpoch: null, error: null };
  } catch (_error) {
    return { mode: 'blocked', journal: null, factsEpoch: null, error: createLocalDataError('JOURNAL_CORRUPT') };
  }
}

export async function beginMigrationJournal(runtime: MigrationJournalRuntime = {}): Promise<StagingMigrationJournal> {
  const resolvedRuntime = resolveRuntime(runtime);
  const snapshot = await readMigrationJournal(resolvedRuntime);
  if (snapshot.mode === 'blocked') journalFailure();
  if (snapshot.mode !== 'not_started') invalidTransition();
  const journal = journalBase(null, 'staging', resolvedRuntime) as StagingMigrationJournal;
  return (await persistMigrationJournal({
    expected: null,
    next: journal,
    runtime: resolvedRuntime,
  })) as StagingMigrationJournal;
}

export async function advanceMigrationJournal(
  input: AdvanceMigrationJournalInput,
  runtime: MigrationJournalRuntime = {},
): Promise<MigrationJournal> {
  const resolvedRuntime = resolveRuntime(runtime);
  const expected = await parseMigrationJournal(input.expected, resolvedRuntime.digestProvider).catch(() =>
    journalFailure(),
  );
  const next = await finalizeTransitionJournal(
    transitionMigrationJournal({ ...input, expected }, resolvedRuntime),
    resolvedRuntime,
  );
  return await persistMigrationJournal({ expected, next, runtime: resolvedRuntime });
}

export async function recordMigrationJournalFailure(
  input: RecordMigrationJournalFailureInput,
  runtime: MigrationJournalRuntime = {},
): Promise<Exclude<MigrationJournal, ActiveMigrationJournal>> {
  const resolvedRuntime = resolveRuntime(runtime);
  const expected = await parseMigrationJournal(input.expected, resolvedRuntime.digestProvider).catch(() =>
    journalFailure(),
  );
  if (expected.stage === 'active') invalidTransition();
  const terminalCode = parseTerminalCode(input.terminalCode);
  const terminalDiagnostics = createLocalDataError(terminalCode, input.terminalDiagnostics).diagnostics;
  const base = {
    ...journalBase(expected, expected.stage, resolvedRuntime),
    terminalCode,
    ...(terminalDiagnostics ? { terminalDiagnostics } : {}),
  };
  const next = (() => {
    switch (expected.stage) {
      case 'staging':
        return Object.freeze(base) as StagingMigrationJournal;
      case 'remote_committed':
        return Object.freeze({ ...base, manifest: expected.manifest }) as RemoteCommittedMigrationJournal;
      case 'profile_refs_pending':
        return Object.freeze({
          ...base,
          manifest: expected.manifest,
          referencePatch: expected.referencePatch,
          referencePatchDigest: expected.referencePatchDigest,
        }) as ProfileReferencesPendingMigrationJournal;
      case 'cleanup_pending':
        return Object.freeze({
          ...base,
          manifest: expected.manifest,
          referencePatch: expected.referencePatch,
          referencePatchDigest: expected.referencePatchDigest,
        }) as CleanupPendingMigrationJournal;
    }
  })();
  return (await persistMigrationJournal({ expected, next, runtime: resolvedRuntime })) as Exclude<
    MigrationJournal,
    ActiveMigrationJournal
  >;
}

export function factsEpochForMigrationJournal(snapshot: MigrationJournalSnapshot): FactsEpoch | null {
  return snapshot.factsEpoch;
}
