import {
  LOCAL_DATA_ERROR_CODES,
  createLocalDataError,
  parseLocalDataError,
  parseMigrationJournalStage,
  type LocalDataError,
  type LocalDataErrorCode,
  type MigrationJournalStage,
} from './contracts';

export const LOCAL_DATA_MIGRATION_BROWSERS = Object.freeze([
  'chrome',
  'edge',
  'firefox',
  'safari',
  'development',
] as const);
export type LocalDataMigrationBrowser = (typeof LOCAL_DATA_MIGRATION_BROWSERS)[number];

export type LocalDataMigrationCapability = Readonly<{
  browser: LocalDataMigrationBrowser;
  officialIdentity: boolean;
  supported: boolean;
}>;

export type LocalDataMigrationHostStatus = Readonly<{
  compatibility: 'compatible' | 'protocol_mismatch' | 'schema_mismatch' | 'unsupported' | 'unknown';
  registration: 'available' | 'unavailable' | 'not_applicable';
}>;

export type LocalDataMigrationDatabaseStatus = Readonly<{
  factsHealth: 'healthy' | 'missing' | 'incompatible' | 'unknown';
  factsRevision?: number;
  ftsAvailable?: boolean;
  presence: 'present' | 'missing' | 'unknown';
}>;

export type LocalDataMigrationJournalStatus = Readonly<{
  mode: 'not_started' | 'transitional' | 'active' | 'blocked';
  stage: MigrationJournalStage | null;
  terminalCode?: LocalDataErrorCode;
}>;

export type LocalDataProfileState =
  | 'setup_required'
  | 'join_existing_required'
  | 'migration_in_progress'
  | 'active'
  | 'blocked'
  | 'unavailable';

export type LocalDataMigrationStatus = Readonly<{
  actions: Readonly<{
    canResume: boolean;
    canStart: boolean;
  }>;
  capability: LocalDataMigrationCapability;
  database: LocalDataMigrationDatabaseStatus;
  diagnostics: readonly LocalDataError[];
  host: LocalDataMigrationHostStatus;
  journal: LocalDataMigrationJournalStatus;
  profileState: LocalDataProfileState;
  resumeReceipt: 'matching' | 'absent' | 'mismatch' | 'unknown' | 'not_applicable';
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid local data migration status');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('invalid local data migration status');
  }
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('invalid local data migration status');
  return value;
}

function enumeration<T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new Error('invalid local data migration status');
  }
  return value as T[number];
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('invalid local data migration status');
  return Number(value);
}

function capability(value: unknown): LocalDataMigrationCapability {
  const input = record(value);
  exactKeys(input, ['browser', 'officialIdentity', 'supported']);
  return Object.freeze({
    browser: enumeration(input.browser, LOCAL_DATA_MIGRATION_BROWSERS),
    officialIdentity: boolean(input.officialIdentity),
    supported: boolean(input.supported),
  });
}

function host(value: unknown): LocalDataMigrationHostStatus {
  const input = record(value);
  exactKeys(input, ['compatibility', 'registration']);
  return Object.freeze({
    compatibility: enumeration(input.compatibility, [
      'compatible',
      'protocol_mismatch',
      'schema_mismatch',
      'unsupported',
      'unknown',
    ] as const),
    registration: enumeration(input.registration, ['available', 'unavailable', 'not_applicable'] as const),
  });
}

function database(value: unknown): LocalDataMigrationDatabaseStatus {
  const input = record(value);
  const allowed = ['factsHealth', 'factsRevision', 'ftsAvailable', 'presence'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('invalid local data migration status');
  const factsRevision = optionalNonNegativeInteger(input.factsRevision);
  const ftsAvailable = input.ftsAvailable === undefined ? undefined : boolean(input.ftsAvailable);
  return Object.freeze({
    factsHealth: enumeration(input.factsHealth, ['healthy', 'missing', 'incompatible', 'unknown'] as const),
    ...(factsRevision === undefined ? {} : { factsRevision }),
    ...(ftsAvailable === undefined ? {} : { ftsAvailable }),
    presence: enumeration(input.presence, ['present', 'missing', 'unknown'] as const),
  });
}

function journal(value: unknown): LocalDataMigrationJournalStatus {
  const input = record(value);
  const allowed = ['mode', 'stage', 'terminalCode'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('invalid local data migration status');
  const mode = enumeration(input.mode, ['not_started', 'transitional', 'active', 'blocked'] as const);
  const stage = input.stage === null ? null : parseMigrationJournalStage(input.stage);
  let terminalCode: LocalDataErrorCode | undefined;
  if (input.terminalCode !== undefined) {
    terminalCode = enumeration(input.terminalCode, LOCAL_DATA_ERROR_CODES);
  }
  if ((mode === 'not_started' && stage !== 'not_started') || (mode === 'blocked' && stage !== null)) {
    throw new Error('invalid local data migration status');
  }
  if ((mode === 'transitional' || mode === 'active') && (stage === null || stage === 'not_started')) {
    throw new Error('invalid local data migration status');
  }
  return Object.freeze({ mode, stage, ...(terminalCode ? { terminalCode } : {}) });
}

export function parseLocalDataMigrationStatus(value: unknown): LocalDataMigrationStatus {
  const input = record(value);
  exactKeys(input, [
    'actions',
    'capability',
    'database',
    'diagnostics',
    'host',
    'journal',
    'profileState',
    'resumeReceipt',
  ]);
  const actionsInput = record(input.actions);
  exactKeys(actionsInput, ['canResume', 'canStart']);
  if (!Array.isArray(input.diagnostics)) throw new Error('invalid local data migration status');
  const parsedCapability = capability(input.capability);
  const parsedDatabase = database(input.database);
  const parsedHost = host(input.host);
  const parsedJournal = journal(input.journal);
  const profileState = enumeration(input.profileState, [
    'setup_required',
    'join_existing_required',
    'migration_in_progress',
    'active',
    'blocked',
    'unavailable',
  ] as const);
  if (
    (parsedJournal.mode === 'active' && profileState !== 'active') ||
    (parsedJournal.mode === 'transitional' && profileState !== 'migration_in_progress') ||
    (parsedJournal.mode === 'blocked' && profileState !== 'blocked') ||
    (parsedJournal.mode === 'not_started' && ['active', 'migration_in_progress', 'blocked'].includes(profileState)) ||
    (profileState === 'join_existing_required' &&
      (parsedJournal.mode !== 'not_started' ||
        parsedDatabase.presence !== 'present' ||
        parsedDatabase.factsHealth !== 'healthy')) ||
    (profileState === 'setup_required' &&
      (parsedJournal.mode !== 'not_started' || parsedDatabase.presence !== 'missing'))
  ) {
    throw new Error('invalid local data migration status');
  }
  return Object.freeze({
    actions: Object.freeze({ canResume: boolean(actionsInput.canResume), canStart: boolean(actionsInput.canStart) }),
    capability: parsedCapability,
    database: parsedDatabase,
    diagnostics: Object.freeze(input.diagnostics.map((entry) => parseLocalDataError(entry))),
    host: parsedHost,
    journal: parsedJournal,
    profileState,
    resumeReceipt: enumeration(input.resumeReceipt, [
      'matching',
      'absent',
      'mismatch',
      'unknown',
      'not_applicable',
    ] as const),
  });
}

export function safeMigrationDiagnostic(error: unknown, fallback: LocalDataErrorCode): LocalDataError {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && (LOCAL_DATA_ERROR_CODES as readonly string[]).includes(code)) {
      const diagnostics = 'diagnostics' in error ? (error as { diagnostics?: unknown }).diagnostics : undefined;
      return createLocalDataError(code as LocalDataErrorCode, diagnostics);
    }
  }
  return createLocalDataError(fallback);
}
