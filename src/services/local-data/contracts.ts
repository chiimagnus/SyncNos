import { nativeHostContract } from './native-host-contract';

export const LOCAL_DATA_PROTOCOL_VERSION = nativeHostContract.host.protocolVersion;
export const LOCAL_DATA_SCHEMA_VERSION = nativeHostContract.host.schemaVersion;

const KIBIBYTE = 1024;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;
const MAX_PROTOCOL_TEXT_LENGTH = 4096;
const MAX_CURSOR_LENGTH = 4096;
const MAX_PAGE_LIMIT = 200;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const MAX_STREAM_FRAME_BYTES = 512 * KIBIBYTE;
export const MAX_CAPTURE_SNAPSHOT_BYTES = 64 * MEBIBYTE;
export const MAX_DETAIL_PREVIEW_BYTES = 64 * MEBIBYTE;
export const MAX_IMAGE_ASSET_BYTES = 64 * MEBIBYTE;
export const MAX_ZIP_STREAM_BYTES = 512 * MEBIBYTE;
export const MAX_MIGRATION_FACT_RECORD_BYTES = 64 * MEBIBYTE;
export const MAX_MIGRATION_IMAGE_ASSET_BYTES = 64 * MEBIBYTE;
export const MAX_NATIVE_IMAGE_SLICE_BYTES = 256 * KIBIBYTE;
export const MAX_SEARCH_QUERY_SCALARS = 512;

export const LOCAL_DATA_STREAM_OPERATIONS = Object.freeze([
  'capture-snapshot',
  'conversation-detail',
  'image-asset',
  'zip-backup',
  'migration-fact-record',
  'migration-image-asset',
] as const);

export type LocalDataStreamOperation = (typeof LOCAL_DATA_STREAM_OPERATIONS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export const LOCAL_DATA_ERROR_CODES = Object.freeze([
  'HOST_UNAVAILABLE',
  'ORIGIN_DENIED',
  'PROTOCOL_MISMATCH',
  'SCHEMA_MISMATCH',
  'BUSY',
  'MIGRATION_IN_PROGRESS',
  'MIGRATION_RECEIPT_MISMATCH',
  'MIGRATION_VALIDATION_FAILED',
  'FTS_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'STALE_BACKEND_EPOCH',
  'STALE_REFERENCE',
  'STALE_SEARCH_CURSOR',
  'DATABASE_NOT_INITIALIZED',
  'UNSUPPORTED_PLATFORM',
  'JOURNAL_CORRUPT',
  'INVALID_ARGUMENT',
] as const);

export type LocalDataErrorCode = (typeof LOCAL_DATA_ERROR_CODES)[number];

export type LocalDataDiagnosticKey =
  | 'actualBytes'
  | 'declaredBytes'
  | 'expectedSchemaVersion'
  | 'expectedProtocolVersion'
  | 'field'
  | 'limitBytes'
  | 'operation'
  | 'receivedSchemaVersion'
  | 'receivedProtocolVersion'
  | 'retryAfterMs'
  | 'stage';

export type LocalDataDiagnostics = Readonly<Partial<Record<LocalDataDiagnosticKey, string | number | boolean>>>;

export type LocalDataError = Readonly<{
  code: LocalDataErrorCode;
  message: string;
  retryable: boolean;
  diagnostics?: LocalDataDiagnostics;
}>;

const LOCAL_DATA_ERROR_MESSAGES: Readonly<Record<LocalDataErrorCode, string>> = {
  HOST_UNAVAILABLE: 'Local data host is unavailable.',
  ORIGIN_DENIED: 'This extension is not allowed to use the local data host.',
  PROTOCOL_MISMATCH: 'The local data protocol versions do not match.',
  SCHEMA_MISMATCH: 'The local data schema versions do not match.',
  BUSY: 'The local data store is busy.',
  MIGRATION_IN_PROGRESS: 'A local data migration is in progress.',
  MIGRATION_RECEIPT_MISMATCH: 'The migration receipt does not match the requested facts.',
  MIGRATION_VALIDATION_FAILED: 'The migration facts could not be validated.',
  FTS_UNAVAILABLE: 'Full-text search is currently unavailable.',
  PAYLOAD_TOO_LARGE: 'The local data payload exceeds its safe limit.',
  STALE_BACKEND_EPOCH: 'The local data view is stale. Refresh and try again.',
  STALE_REFERENCE: 'The requested local data reference is no longer current.',
  STALE_SEARCH_CURSOR: 'The search results changed. Run the search again.',
  DATABASE_NOT_INITIALIZED: 'The local data database has not been initialized.',
  UNSUPPORTED_PLATFORM: 'This platform is not supported by the local data host.',
  JOURNAL_CORRUPT: 'The local data migration journal is invalid.',
  INVALID_ARGUMENT: 'The local data request is invalid.',
};

const RETRYABLE_ERROR_CODES = new Set<LocalDataErrorCode>([
  'HOST_UNAVAILABLE',
  'BUSY',
  'MIGRATION_IN_PROGRESS',
  'FTS_UNAVAILABLE',
  'STALE_BACKEND_EPOCH',
  'STALE_SEARCH_CURSOR',
]);

const DIAGNOSTIC_KEYS = new Set<LocalDataDiagnosticKey>([
  'actualBytes',
  'declaredBytes',
  'expectedSchemaVersion',
  'expectedProtocolVersion',
  'field',
  'limitBytes',
  'operation',
  'receivedSchemaVersion',
  'receivedProtocolVersion',
  'retryAfterMs',
  'stage',
]);

const NUMERIC_DIAGNOSTIC_KEYS = new Set<LocalDataDiagnosticKey>([
  'actualBytes',
  'declaredBytes',
  'expectedSchemaVersion',
  'expectedProtocolVersion',
  'limitBytes',
  'retryAfterMs',
]);

const RECEIVED_VERSION_DIAGNOSTIC_KEYS = new Set<LocalDataDiagnosticKey>([
  'receivedSchemaVersion',
  'receivedProtocolVersion',
]);

export const MIGRATION_JOURNAL_STAGES = Object.freeze([
  'not_started',
  'staging',
  'remote_committed',
  'profile_refs_pending',
  'cleanup_pending',
  'active',
] as const);

export type MigrationJournalStage = (typeof MIGRATION_JOURNAL_STAGES)[number];

const MIGRATION_DIAGNOSTIC_STAGES = MIGRATION_JOURNAL_STAGES;

export class LocalDataContractError extends Error {
  readonly code: LocalDataErrorCode;
  readonly diagnostics?: LocalDataDiagnostics;

  constructor(code: LocalDataErrorCode, diagnostics?: unknown) {
    super(LOCAL_DATA_ERROR_MESSAGES[code]);
    this.name = 'LocalDataContractError';
    this.code = code;
    this.diagnostics = diagnostics === undefined ? undefined : parseDiagnostics(diagnostics);
  }
}

function fail(code: LocalDataErrorCode = 'INVALID_ARGUMENT', diagnostics?: LocalDataDiagnostics): never {
  throw new LocalDataContractError(code, diagnostics);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail();
  return value;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail();
}

function hasC0OrC1Control(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
  }
  return false;
}

function parseText(value: unknown, maxLength = MAX_PROTOCOL_TEXT_LENGTH): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || hasC0OrC1Control(value)) fail();
  return value;
}

function parseOptionalText(
  value: Record<string, unknown>,
  key: string,
  maxLength = MAX_PROTOCOL_TEXT_LENGTH,
): string | undefined {
  return hasOwn(value, key) ? parseText(value[key], maxLength) : undefined;
}

function parseFactText(value: unknown): string {
  if (typeof value !== 'string') fail();
  return value;
}

function parseNonNegativeSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail();
  return Number(value);
}

function parsePositiveSafeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) fail();
  return Number(value);
}

function parseOptionalBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  if (!hasOwn(value, key)) return undefined;
  if (typeof value[key] !== 'boolean') fail();
  return value[key] as boolean;
}

function parseEnum<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail();
  return value as T;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

function parseJsonValue(value: unknown): JsonValue {
  const stack: unknown[] = [value];
  const seen = new Set<object>();

  while (stack.length) {
    const current = stack.pop();
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) fail();
      continue;
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) fail();
      seen.add(current);
      for (const item of current) stack.push(item);
      continue;
    }
    if (!isRecord(current)) fail();
    if (seen.has(current)) fail();
    seen.add(current);
    for (const key of Object.keys(current)) stack.push(current[key]);
  }

  return value as JsonValue;
}

function parseJsonObject(value: unknown): JsonObject {
  const object = record(value);
  parseJsonValue(object);
  return object as JsonObject;
}

function parseDiagnostics(value: unknown): LocalDataDiagnostics {
  const input = record(value);
  const diagnostics: Partial<Record<LocalDataDiagnosticKey, string | number | boolean>> = {};
  for (const [key, rawValue] of Object.entries(input)) {
    const diagnosticKey = key as LocalDataDiagnosticKey;
    if (!DIAGNOSTIC_KEYS.has(diagnosticKey)) fail();
    if (NUMERIC_DIAGNOSTIC_KEYS.has(diagnosticKey)) {
      diagnostics[diagnosticKey] = parseNonNegativeSafeInteger(rawValue);
      continue;
    }
    if (RECEIVED_VERSION_DIAGNOSTIC_KEYS.has(diagnosticKey)) {
      if (rawValue === 'invalid') diagnostics[diagnosticKey] = rawValue;
      else diagnostics[diagnosticKey] = parseNonNegativeSafeInteger(rawValue);
      continue;
    }
    if (diagnosticKey === 'operation') {
      diagnostics.operation = parseEnum(rawValue, LOCAL_DATA_STREAM_OPERATIONS);
      continue;
    }
    if (diagnosticKey === 'stage') {
      diagnostics.stage = parseEnum(rawValue, MIGRATION_DIAGNOSTIC_STAGES);
      continue;
    }
    if (diagnosticKey === 'field') {
      const field = parseText(rawValue, 64);
      if (!/^[a-z][a-zA-Z0-9.-]*$/.test(field)) fail();
      diagnostics.field = field;
      continue;
    }
    fail();
  }
  return diagnostics;
}

export function createLocalDataError(code: LocalDataErrorCode, diagnostics?: unknown): LocalDataError {
  const safeDiagnostics = diagnostics === undefined ? undefined : parseDiagnostics(diagnostics);
  return safeDiagnostics && Object.keys(safeDiagnostics).length
    ? {
        code,
        message: LOCAL_DATA_ERROR_MESSAGES[code],
        retryable: RETRYABLE_ERROR_CODES.has(code),
        diagnostics: safeDiagnostics,
      }
    : {
        code,
        message: LOCAL_DATA_ERROR_MESSAGES[code],
        retryable: RETRYABLE_ERROR_CODES.has(code),
      };
}

export function parseLocalDataError(value: unknown): LocalDataError {
  const input = record(value);
  const hasDiagnostics = hasOwn(input, 'diagnostics');
  exactKeys(input, hasDiagnostics ? ['code', 'message', 'retryable', 'diagnostics'] : ['code', 'message', 'retryable']);
  const code = parseEnum(input.code, LOCAL_DATA_ERROR_CODES);
  const error = createLocalDataError(code, hasDiagnostics ? input.diagnostics : undefined);
  if (input.message !== error.message || input.retryable !== error.retryable) fail();
  return error;
}

export type MigrationId = string;

export function parseMigrationId(value: unknown): MigrationId {
  const migrationId = parseText(value, 36);
  if (!UUID_V4_PATTERN.test(migrationId)) fail();
  return migrationId;
}

export function parseOrderedFrameDigest(value: unknown): string {
  const digest = parseText(value, 64);
  if (!SHA256_PATTERN.test(digest)) fail();
  return digest;
}

export const IDB_FACTS_EPOCH = 'idb-v1' as const;
export type FactsEpoch = typeof IDB_FACTS_EPOCH | `native:${MigrationId}`;

export function parseFactsEpoch(value: unknown): FactsEpoch {
  if (value === IDB_FACTS_EPOCH) return IDB_FACTS_EPOCH;
  const epoch = parseText(value, 43);
  if (!epoch.startsWith('native:')) fail('STALE_BACKEND_EPOCH');
  return `native:${parseMigrationId(epoch.slice('native:'.length))}`;
}

export function assertFactsEpochMatches(expected: FactsEpoch, received: unknown): FactsEpoch {
  let actual: FactsEpoch;
  try {
    actual = parseFactsEpoch(received);
  } catch (_error) {
    fail('STALE_BACKEND_EPOCH');
  }
  if (actual !== expected) fail('STALE_BACKEND_EPOCH');
  return actual;
}

export const MIGRATION_PROFILE_REFERENCE_PATCH_VERSION = 1 as const;
export const MIGRATION_PROFILE_PROVIDERS = Object.freeze(['notion', 'obsidian', 'feishu'] as const);
export const MAX_MIGRATION_PROFILE_QUEUE_ITEMS = 200;
export const MAX_MIGRATION_PROFILE_REFERENCE_PATCH_BYTES = 2 * MEBIBYTE;

export type MigrationProfileProvider = (typeof MIGRATION_PROFILE_PROVIDERS)[number];

export type MigrationProfileQueueEntry = Readonly<{
  conversationKey: string;
  dueAt: number;
  source: string;
}>;

export type MigrationReferenceFreeSyncJob =
  | Readonly<{
      failCount: number;
      finishedAt: number;
      okCount: number;
      provider: MigrationProfileProvider;
      startedAt: number;
      status: 'done';
      updatedAt: number;
    }>
  | Readonly<{
      abortedReason: 'local_data_migration';
      failCount: number;
      finishedAt: number;
      okCount: number;
      provider: MigrationProfileProvider;
      startedAt: number;
      status: 'aborted';
      updatedAt: number;
    }>;

export type MigrationProfileReferencePatch = Readonly<{
  queues: Readonly<Record<MigrationProfileProvider, readonly MigrationProfileQueueEntry[]>>;
  syncJobs: Readonly<Record<MigrationProfileProvider, MigrationReferenceFreeSyncJob>>;
  version: typeof MIGRATION_PROFILE_REFERENCE_PATCH_VERSION;
}>;

export function parseMigrationJournalStage(value: unknown): MigrationJournalStage {
  return parseEnum(value, MIGRATION_JOURNAL_STAGES);
}

function parseMigrationProfileProvider(value: unknown): MigrationProfileProvider {
  return parseEnum(value, MIGRATION_PROFILE_PROVIDERS);
}

function parseMigrationProfileText(value: unknown, maximumLength: number): string {
  const text = parseText(value, maximumLength);
  if (hasUnpairedSurrogate(text)) fail();
  return text;
}

function compareMigrationProfileQueueEntries(
  left: MigrationProfileQueueEntry,
  right: MigrationProfileQueueEntry,
): number {
  if (left.source !== right.source) return left.source < right.source ? -1 : 1;
  if (left.conversationKey !== right.conversationKey) return left.conversationKey < right.conversationKey ? -1 : 1;
  return left.dueAt - right.dueAt;
}

function parseMigrationProfileQueueEntry(value: unknown): MigrationProfileQueueEntry {
  const input = record(value);
  exactKeys(input, ['source', 'conversationKey', 'dueAt']);
  return Object.freeze({
    source: parseMigrationProfileText(input.source, 256),
    conversationKey: parseMigrationProfileText(input.conversationKey, 2048),
    dueAt: parsePositiveSafeInteger(input.dueAt),
  });
}

function parseMigrationProfileQueues(
  value: unknown,
): Readonly<Record<MigrationProfileProvider, readonly MigrationProfileQueueEntry[]>> {
  const input = record(value);
  exactKeys(input, MIGRATION_PROFILE_PROVIDERS);
  const queues = {} as Record<MigrationProfileProvider, readonly MigrationProfileQueueEntry[]>;
  for (const provider of MIGRATION_PROFILE_PROVIDERS) {
    const rows = input[provider];
    if (!Array.isArray(rows) || rows.length > MAX_MIGRATION_PROFILE_QUEUE_ITEMS) fail();
    const entries = rows.map(parseMigrationProfileQueueEntry);
    const identities = new Set<string>();
    for (const entry of entries) {
      const identity = `${entry.source}\u0000${entry.conversationKey}`;
      if (identities.has(identity)) fail();
      identities.add(identity);
    }
    entries.sort(compareMigrationProfileQueueEntries);
    queues[provider] = Object.freeze(entries);
  }
  return Object.freeze(queues);
}

function parseMigrationReferenceFreeSyncJob(
  value: unknown,
  provider: MigrationProfileProvider,
): MigrationReferenceFreeSyncJob {
  const input = record(value);
  const status = input.status;
  if (status !== 'done' && status !== 'aborted') fail();
  exactKeys(
    input,
    status === 'done'
      ? ['provider', 'status', 'startedAt', 'updatedAt', 'finishedAt', 'okCount', 'failCount']
      : ['provider', 'status', 'startedAt', 'updatedAt', 'finishedAt', 'okCount', 'failCount', 'abortedReason'],
  );
  if (parseMigrationProfileProvider(input.provider) !== provider) fail();
  const startedAt = parseNonNegativeSafeInteger(input.startedAt);
  const updatedAt = parseNonNegativeSafeInteger(input.updatedAt);
  const finishedAt = parseNonNegativeSafeInteger(input.finishedAt);
  const okCount = parseNonNegativeSafeInteger(input.okCount);
  const failCount = parseNonNegativeSafeInteger(input.failCount);
  if (startedAt > updatedAt || updatedAt > finishedAt) fail();
  if (status === 'done') {
    return Object.freeze({ provider, status, startedAt, updatedAt, finishedAt, okCount, failCount });
  }
  if (input.abortedReason !== 'local_data_migration') fail();
  return Object.freeze({
    provider,
    status,
    startedAt,
    updatedAt,
    finishedAt,
    okCount,
    failCount,
    abortedReason: 'local_data_migration',
  });
}

function parseMigrationReferenceFreeSyncJobs(
  value: unknown,
): Readonly<Record<MigrationProfileProvider, MigrationReferenceFreeSyncJob>> {
  const input = record(value);
  exactKeys(input, MIGRATION_PROFILE_PROVIDERS);
  const jobs = {} as Record<MigrationProfileProvider, MigrationReferenceFreeSyncJob>;
  for (const provider of MIGRATION_PROFILE_PROVIDERS) {
    jobs[provider] = parseMigrationReferenceFreeSyncJob(input[provider], provider);
  }
  return Object.freeze(jobs);
}

function parseMigrationProfileReferencePatchInternal(value: unknown): MigrationProfileReferencePatch {
  const input = record(value);
  exactKeys(input, ['version', 'queues', 'syncJobs']);
  if (input.version !== MIGRATION_PROFILE_REFERENCE_PATCH_VERSION) fail();
  return Object.freeze({
    version: MIGRATION_PROFILE_REFERENCE_PATCH_VERSION,
    queues: parseMigrationProfileQueues(input.queues),
    syncJobs: parseMigrationReferenceFreeSyncJobs(input.syncJobs),
  });
}

function serializeParsedMigrationProfileReferencePatch(value: MigrationProfileReferencePatch): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') fail();
  if (new TextEncoder().encode(serialized).byteLength > MAX_MIGRATION_PROFILE_REFERENCE_PATCH_BYTES) {
    fail('PAYLOAD_TOO_LARGE');
  }
  return serialized;
}

export function parseMigrationProfileReferencePatch(value: unknown): MigrationProfileReferencePatch {
  const patch = parseMigrationProfileReferencePatchInternal(value);
  serializeParsedMigrationProfileReferencePatch(patch);
  return patch;
}

export function serializeMigrationProfileReferencePatch(value: unknown): string {
  return serializeParsedMigrationProfileReferencePatch(parseMigrationProfileReferencePatchInternal(value));
}

export type SearchMode = 'literal-fallback' | 'fts-phrase';

export type NormalizedSearchQuery =
  | Readonly<{
      literal: string;
      scalarCount: number;
      mode: 'literal-fallback';
    }>
  | Readonly<{
      literal: string;
      scalarCount: number;
      mode: 'fts-phrase';
      ftsPhrase: string;
    }>;

export function quoteFtsPhrase(literal: string): string {
  return `"${literal.replaceAll('"', '""')}"`;
}

export function normalizeSearchQuery(input: unknown): NormalizedSearchQuery {
  if (typeof input !== 'string' || hasUnpairedSurrogate(input)) fail();
  const nfc = input.normalize('NFC');
  if (hasC0OrC1Control(nfc)) fail();
  const literal = nfc.replace(/\p{White_Space}+/gu, ' ').trim();
  if (!literal || hasUnpairedSurrogate(literal)) fail();
  const scalarCount = Array.from(literal).length;
  if (scalarCount > MAX_SEARCH_QUERY_SCALARS) fail();
  if (scalarCount <= 2) return { literal, scalarCount, mode: 'literal-fallback' };
  return { literal, scalarCount, mode: 'fts-phrase', ftsPhrase: quoteFtsPhrase(literal) };
}

export function parseNormalizedSearchQuery(value: unknown): NormalizedSearchQuery {
  const input = record(value);
  const mode = parseEnum(input.mode, ['literal-fallback', 'fts-phrase'] as const);
  exactKeys(
    input,
    mode === 'fts-phrase' ? ['literal', 'scalarCount', 'mode', 'ftsPhrase'] : ['literal', 'scalarCount', 'mode'],
  );
  const normalized = normalizeSearchQuery(input.literal);
  if (input.scalarCount !== normalized.scalarCount || normalized.mode !== mode) fail();
  if (normalized.mode === 'fts-phrase' && input.ftsPhrase !== normalized.ftsPhrase) fail();
  return normalized;
}

export type SearchCursorBinding = Readonly<{
  literal: string;
  token: string;
}>;

export function createSearchCursorBinding(query: NormalizedSearchQuery, token: unknown): SearchCursorBinding {
  return { literal: query.literal, token: parseText(token, MAX_CURSOR_LENGTH) };
}

function parseSearchCursorBinding(value: unknown, query: NormalizedSearchQuery): SearchCursorBinding {
  const input = record(value);
  exactKeys(input, ['literal', 'token']);
  const literal = normalizeSearchQuery(input.literal).literal;
  if (literal !== input.literal || literal !== query.literal) fail('STALE_SEARCH_CURSOR');
  return { literal, token: parseText(input.token, MAX_CURSOR_LENGTH) };
}

export type PlainSnippetHighlight = Readonly<{
  start: number;
  end: number;
}>;

export const SEARCH_HIGHLIGHT_OFFSET_UNIT = 'utf16-code-unit' as const;
export const SEARCH_HIGHLIGHT_RANGE = '[start,end)' as const;

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

export function parsePlainSnippetHighlights(snippet: unknown, value: unknown): PlainSnippetHighlight[] {
  if (typeof snippet !== 'string' || !Array.isArray(value)) fail();
  const highlights: PlainSnippetHighlight[] = [];
  let previousEnd = 0;
  for (const rawRange of value) {
    const range = record(rawRange);
    exactKeys(range, ['start', 'end']);
    const start = parseNonNegativeSafeInteger(range.start);
    const end = parseNonNegativeSafeInteger(range.end);
    if (start >= end || end > snippet.length || start < previousEnd) fail();
    if (!isUtf16Boundary(snippet, start) || !isUtf16Boundary(snippet, end)) fail();
    highlights.push({ start, end });
    previousEnd = end;
  }
  return highlights;
}

export const STREAM_OPERATION_LIMITS: Readonly<Record<LocalDataStreamOperation, number>> = Object.freeze({
  'capture-snapshot': MAX_CAPTURE_SNAPSHOT_BYTES,
  'conversation-detail': MAX_DETAIL_PREVIEW_BYTES,
  'image-asset': MAX_IMAGE_ASSET_BYTES,
  'zip-backup': MAX_ZIP_STREAM_BYTES,
  'migration-fact-record': MAX_MIGRATION_FACT_RECORD_BYTES,
  'migration-image-asset': MAX_MIGRATION_IMAGE_ASSET_BYTES,
});

const STREAM_OPERATIONS = LOCAL_DATA_STREAM_OPERATIONS;

export type StreamDescriptor = Readonly<{
  operation: LocalDataStreamOperation;
  declaredTotalBytes: number;
}>;

export type StreamChunkAccounting = StreamDescriptor &
  Readonly<{
    accumulatedBytes: number;
    incomingBytes: number;
    serializedFrameBytes: number;
  }>;

export function getStreamByteLimit(operation: LocalDataStreamOperation): number {
  return STREAM_OPERATION_LIMITS[operation];
}

export function parseStreamDescriptor(
  value: unknown,
  allowedOperations: readonly LocalDataStreamOperation[] = STREAM_OPERATIONS,
): StreamDescriptor {
  const input = record(value);
  exactKeys(input, ['operation', 'declaredTotalBytes']);
  const operation = parseEnum(input.operation, allowedOperations);
  const declaredTotalBytes = parseNonNegativeSafeInteger(input.declaredTotalBytes);
  if (declaredTotalBytes > getStreamByteLimit(operation)) {
    fail('PAYLOAD_TOO_LARGE', {
      operation,
      declaredBytes: declaredTotalBytes,
      limitBytes: getStreamByteLimit(operation),
    });
  }
  return { operation, declaredTotalBytes };
}

export function assertStreamChunkWithinLimits(input: StreamChunkAccounting): void {
  const operation = parseEnum(input.operation, STREAM_OPERATIONS);
  const limitBytes = getStreamByteLimit(operation);
  const declaredTotalBytes = parseNonNegativeSafeInteger(input.declaredTotalBytes);
  const accumulatedBytes = parseNonNegativeSafeInteger(input.accumulatedBytes);
  const incomingBytes = parseNonNegativeSafeInteger(input.incomingBytes);
  const serializedFrameBytes = parseNonNegativeSafeInteger(input.serializedFrameBytes);

  if (
    declaredTotalBytes > limitBytes ||
    accumulatedBytes > declaredTotalBytes ||
    incomingBytes > declaredTotalBytes - accumulatedBytes ||
    accumulatedBytes + incomingBytes > limitBytes
  ) {
    fail('PAYLOAD_TOO_LARGE', {
      operation,
      declaredBytes: declaredTotalBytes,
      actualBytes: accumulatedBytes + incomingBytes,
      limitBytes,
    });
  }
  if (serializedFrameBytes > MAX_STREAM_FRAME_BYTES) {
    fail('PAYLOAD_TOO_LARGE', {
      operation,
      actualBytes: serializedFrameBytes,
      limitBytes: MAX_STREAM_FRAME_BYTES,
    });
  }
}

export function serializedJsonUtf8ByteLength(value: JsonValue): number {
  const serialized = JSON.stringify(parseJsonValue(value));
  if (typeof serialized !== 'string') fail();
  return new TextEncoder().encode(serialized).byteLength;
}

export type StableConversationReference = Readonly<{
  source: string;
  conversationKey: string;
}>;

export type BrowserConversationReference = StableConversationReference &
  Readonly<{
    conversationId?: number;
  }>;

export type HostConversationReference = StableConversationReference &
  Readonly<{
    backendConversationId?: number;
  }>;

export type BrowserCommentContext = Readonly<{
  canonicalUrl: string;
  conversation?: BrowserConversationReference;
}>;

export type HostCommentContext = Readonly<{
  canonicalUrl: string;
  conversation?: HostConversationReference;
}>;

export type ConversationListRequestPayload = Readonly<{
  cursor?: string;
  limit?: number;
  siteKey?: string;
  sourceKey?: string;
}>;

export type ConversationTailRequestPayload<TReference extends StableConversationReference> = Readonly<{
  afterMessageKey?: string;
  conversation: TReference;
  limit?: number;
}>;

export type CaptureSnapshotRequestPayload = Readonly<{
  snapshot: JsonValue;
  transfer: StreamDescriptor;
}>;

export type SyncMessagesRequestPayload<TReference extends StableConversationReference> = Readonly<{
  conversation: TReference;
  messages: JsonValue;
  transfer: StreamDescriptor;
}>;

export type MergeConversationsRequestPayload<TReference extends StableConversationReference> = Readonly<{
  source: TReference;
  target: TReference;
}>;

export type MappingRequestPayload<TReference extends StableConversationReference> = Readonly<{
  conversation: TReference;
  provider: string;
}>;

export type PatchMappingRequestPayload<TReference extends StableConversationReference> =
  MappingRequestPayload<TReference> &
    Readonly<{
      patch: JsonObject;
    }>;

export type UpdateArticleUrlRequestPayload<TReference extends StableConversationReference> = Readonly<{
  conversation?: TReference;
  fromCanonicalUrl: string;
  toCanonicalUrl: string;
}>;

export type ListArticleCommentsRequestPayload<TContext extends BrowserCommentContext | HostCommentContext> = Readonly<{
  context: TContext;
  fallbackPolicy: 'none' | 'include-orphan-url';
}>;

export type AddArticleCommentRequestPayload<TContext extends BrowserCommentContext | HostCommentContext> = Readonly<{
  commentText: string;
  context: TContext;
  locator?: JsonObject;
  quoteText: string;
}>;

export type AddArticleCommentReplyRequestPayload<TContext extends BrowserCommentContext | HostCommentContext> =
  Readonly<{
    commentText: string;
    context: TContext;
    parentId: number;
  }>;

export type DeleteArticleCommentRequestPayload<TContext extends BrowserCommentContext | HostCommentContext> = Readonly<{
  commentId: number;
  context: TContext;
}>;

export type HostAddArticleCommentReplyRequestPayload = Readonly<{
  backendParentId: number;
  commentText: string;
  context: HostCommentContext;
}>;

export type HostDeleteArticleCommentRequestPayload = Readonly<{
  backendCommentId: number;
  context: HostCommentContext;
}>;

export type MigrateArticleCommentUrlRequestPayload<TReference extends StableConversationReference> =
  UpdateArticleUrlRequestPayload<TReference>;

export type EnsureArticleCommentContextRequestPayload = Readonly<{
  canonicalUrlFallback?: string;
  ensureArticle?: boolean;
  tabId?: number;
}>;

export type BrowserImageAssetRequestPayload = Readonly<{
  assetId: number;
  owner: BrowserConversationReference;
  transfer: StreamDescriptor;
}>;

export type BrowserPutImageAssetRequestPayload = Readonly<{
  assetId?: number;
  metadata: JsonObject;
  owner: BrowserConversationReference;
  transfer: StreamDescriptor;
}>;

export type HostImageAssetRequestPayload = Readonly<{
  backendAssetId: number;
  owner: HostConversationReference;
  transfer: StreamDescriptor;
}>;

export type HostPutImageAssetRequestPayload = Readonly<{
  backendAssetId?: number;
  metadata: JsonObject;
  owner: HostConversationReference;
  transfer: StreamDescriptor;
}>;

export type MigrationStreamRequestPayload = Readonly<{
  manifestDigest: string;
  migrationId: MigrationId;
  transfer: StreamDescriptor;
}>;

export type BackupStreamRequestPayload = Readonly<{
  transfer: StreamDescriptor;
}>;

export type LocalDataSearchSort = 'best' | 'recent';

export type SearchRequestPayload = Readonly<{
  cursor?: SearchCursorBinding;
  limit?: number;
  query: NormalizedSearchQuery;
  siteKey?: string;
  sort?: LocalDataSearchSort;
  sourceKey?: string;
}>;

export const BROWSER_RUNTIME_FACTS_COMMANDS = Object.freeze([
  'GET_LOCAL_DATA_STATUS',
  'START_LOCAL_DATA_MIGRATION',
  'RESUME_LOCAL_DATA_MIGRATION',
  'GET_FACTS_REVISION',
  'CONVERSATION_BOOTSTRAP',
  'CONVERSATION_LOAD_MORE',
  'CONVERSATION_DETAIL',
  'CONVERSATION_TAIL',
  'SAVE_CONVERSATION_SNAPSHOT',
  'DELETE_CONVERSATION',
  'MERGE_CONVERSATIONS',
  'SYNC_CONVERSATION_MESSAGES',
  'GET_SYNC_MAPPING',
  'PATCH_SYNC_MAPPING',
  'CLEAR_SYNC_MAPPING',
  'UPDATE_ARTICLE_URL',
  'LIST_ARTICLE_COMMENTS',
  'ADD_ARTICLE_COMMENT',
  'ADD_ARTICLE_COMMENT_REPLY',
  'DELETE_ARTICLE_COMMENT',
  'MIGRATE_ARTICLE_COMMENT_URL',
  'ENSURE_ARTICLE_COMMENT_CONTEXT',
  'GET_IMAGE_ASSET',
  'PUT_IMAGE_ASSET',
  'BACKFILL_CONVERSATION_IMAGES',
  'FACTS_IMPORT',
  'FACTS_EXPORT',
  'BACKUP_IMPORT',
  'BACKUP_EXPORT',
  'GET_INSIGHT_STATS',
  'SEARCH_CONVERSATIONS',
  'GET_MIGRATION_RECEIPT',
] as const);

export type BrowserRuntimeFactsCommand = (typeof BROWSER_RUNTIME_FACTS_COMMANDS)[number];

export type BrowserRuntimeFactsPayloadByCommand = {
  GET_LOCAL_DATA_STATUS: EmptyPayload;
  START_LOCAL_DATA_MIGRATION: EmptyPayload;
  RESUME_LOCAL_DATA_MIGRATION: EmptyPayload;
  GET_FACTS_REVISION: EmptyPayload;
  CONVERSATION_BOOTSTRAP: ConversationListRequestPayload;
  CONVERSATION_LOAD_MORE: ConversationListRequestPayload;
  CONVERSATION_DETAIL: BrowserConversationReference;
  CONVERSATION_TAIL: ConversationTailRequestPayload<BrowserConversationReference>;
  SAVE_CONVERSATION_SNAPSHOT: CaptureSnapshotRequestPayload;
  DELETE_CONVERSATION: BrowserConversationReference;
  MERGE_CONVERSATIONS: MergeConversationsRequestPayload<BrowserConversationReference>;
  SYNC_CONVERSATION_MESSAGES: SyncMessagesRequestPayload<BrowserConversationReference>;
  GET_SYNC_MAPPING: MappingRequestPayload<BrowserConversationReference>;
  PATCH_SYNC_MAPPING: PatchMappingRequestPayload<BrowserConversationReference>;
  CLEAR_SYNC_MAPPING: MappingRequestPayload<BrowserConversationReference>;
  UPDATE_ARTICLE_URL: UpdateArticleUrlRequestPayload<BrowserConversationReference>;
  LIST_ARTICLE_COMMENTS: ListArticleCommentsRequestPayload<BrowserCommentContext>;
  ADD_ARTICLE_COMMENT: AddArticleCommentRequestPayload<BrowserCommentContext>;
  ADD_ARTICLE_COMMENT_REPLY: AddArticleCommentReplyRequestPayload<BrowserCommentContext>;
  DELETE_ARTICLE_COMMENT: DeleteArticleCommentRequestPayload<BrowserCommentContext>;
  MIGRATE_ARTICLE_COMMENT_URL: MigrateArticleCommentUrlRequestPayload<BrowserConversationReference>;
  ENSURE_ARTICLE_COMMENT_CONTEXT: EnsureArticleCommentContextRequestPayload;
  GET_IMAGE_ASSET: BrowserImageAssetRequestPayload;
  PUT_IMAGE_ASSET: BrowserPutImageAssetRequestPayload;
  BACKFILL_CONVERSATION_IMAGES: BrowserConversationReference;
  FACTS_IMPORT: MigrationStreamRequestPayload;
  FACTS_EXPORT: MigrationStreamRequestPayload;
  BACKUP_IMPORT: BackupStreamRequestPayload;
  BACKUP_EXPORT: BackupStreamRequestPayload;
  GET_INSIGHT_STATS: EmptyPayload;
  SEARCH_CONVERSATIONS: SearchRequestPayload;
  GET_MIGRATION_RECEIPT: Readonly<{ migrationId: MigrationId }>;
};

export const HOST_FACTS_COMMANDS = Object.freeze([
  'GET_STATUS',
  'GET_FACTS_REVISION',
  'CONVERSATION_BOOTSTRAP',
  'CONVERSATION_LOAD_MORE',
  'CONVERSATION_DETAIL',
  'CONVERSATION_TAIL',
  'SAVE_CONVERSATION_SNAPSHOT',
  'DELETE_CONVERSATION',
  'MERGE_CONVERSATIONS',
  'SYNC_CONVERSATION_MESSAGES',
  'GET_SYNC_MAPPING',
  'PATCH_SYNC_MAPPING',
  'CLEAR_SYNC_MAPPING',
  'UPDATE_ARTICLE_URL',
  'LIST_ARTICLE_COMMENTS',
  'ADD_ARTICLE_COMMENT',
  'ADD_ARTICLE_COMMENT_REPLY',
  'DELETE_ARTICLE_COMMENT',
  'MIGRATE_ARTICLE_COMMENT_URL',
  'ENSURE_ARTICLE_COMMENT_CONTEXT',
  'GET_IMAGE_ASSET',
  'PUT_IMAGE_ASSET',
  'BACKFILL_CONVERSATION_IMAGES',
  'IMPORT_FACTS',
  'EXPORT_FACTS',
  'IMPORT_BACKUP',
  'EXPORT_BACKUP',
  'GET_INSIGHT_STATS',
  'SEARCH_CONVERSATIONS',
  'GET_MIGRATION_RECEIPT',
] as const);

export type HostFactsCommand = (typeof HOST_FACTS_COMMANDS)[number];

export type HostFactsPayloadByCommand = {
  GET_STATUS: EmptyPayload;
  GET_FACTS_REVISION: EmptyPayload;
  CONVERSATION_BOOTSTRAP: ConversationListRequestPayload;
  CONVERSATION_LOAD_MORE: ConversationListRequestPayload;
  CONVERSATION_DETAIL: HostConversationReference;
  CONVERSATION_TAIL: ConversationTailRequestPayload<HostConversationReference>;
  SAVE_CONVERSATION_SNAPSHOT: CaptureSnapshotRequestPayload;
  DELETE_CONVERSATION: HostConversationReference;
  MERGE_CONVERSATIONS: MergeConversationsRequestPayload<HostConversationReference>;
  SYNC_CONVERSATION_MESSAGES: SyncMessagesRequestPayload<HostConversationReference>;
  GET_SYNC_MAPPING: MappingRequestPayload<HostConversationReference>;
  PATCH_SYNC_MAPPING: PatchMappingRequestPayload<HostConversationReference>;
  CLEAR_SYNC_MAPPING: MappingRequestPayload<HostConversationReference>;
  UPDATE_ARTICLE_URL: UpdateArticleUrlRequestPayload<HostConversationReference>;
  LIST_ARTICLE_COMMENTS: ListArticleCommentsRequestPayload<HostCommentContext>;
  ADD_ARTICLE_COMMENT: AddArticleCommentRequestPayload<HostCommentContext>;
  ADD_ARTICLE_COMMENT_REPLY: HostAddArticleCommentReplyRequestPayload;
  DELETE_ARTICLE_COMMENT: HostDeleteArticleCommentRequestPayload;
  MIGRATE_ARTICLE_COMMENT_URL: MigrateArticleCommentUrlRequestPayload<HostConversationReference>;
  ENSURE_ARTICLE_COMMENT_CONTEXT: EnsureArticleCommentContextRequestPayload;
  GET_IMAGE_ASSET: HostImageAssetRequestPayload;
  PUT_IMAGE_ASSET: HostPutImageAssetRequestPayload;
  BACKFILL_CONVERSATION_IMAGES: HostConversationReference;
  IMPORT_FACTS: MigrationStreamRequestPayload;
  EXPORT_FACTS: MigrationStreamRequestPayload;
  IMPORT_BACKUP: BackupStreamRequestPayload;
  EXPORT_BACKUP: BackupStreamRequestPayload;
  GET_INSIGHT_STATS: EmptyPayload;
  SEARCH_CONVERSATIONS: SearchRequestPayload;
  GET_MIGRATION_RECEIPT: Readonly<{ migrationId: MigrationId }>;
};

export const CLI_FACTS_COMMANDS = Object.freeze([
  'DOCTOR',
  'CONVERSATIONS_LIST',
  'CONVERSATIONS_GET',
  'STATS',
  'SEARCH_CONVERSATIONS',
] as const);

export type CliFactsCommand = (typeof CLI_FACTS_COMMANDS)[number];

export type CliFactsPayloadByCommand = {
  DOCTOR: Readonly<{ fix?: boolean }>;
  CONVERSATIONS_LIST: ConversationListRequestPayload;
  CONVERSATIONS_GET: Readonly<{ id: number }>;
  STATS: EmptyPayload;
  SEARCH_CONVERSATIONS: SearchRequestPayload;
};

export type EmptyPayload = Readonly<Record<string, never>>;

type RequestFromPayloadMap<TPayloads extends Record<string, unknown>> = {
  [TCommand in keyof TPayloads & string]: Readonly<{
    command: TCommand;
    payload: TPayloads[TCommand];
    protocolVersion: number;
    requestId: string;
    schemaVersion: number;
  }>;
}[keyof TPayloads & string];

export type BrowserRuntimeFactsRequest = RequestFromPayloadMap<BrowserRuntimeFactsPayloadByCommand> &
  Readonly<{
    factsEpoch?: FactsEpoch;
  }>;

export type HostFactsRequest = RequestFromPayloadMap<HostFactsPayloadByCommand>;
export type CliFactsRequest = RequestFromPayloadMap<CliFactsPayloadByCommand>;

type RequestHeader<TCommand extends string> = Readonly<{
  command: TCommand;
  factsEpoch?: FactsEpoch;
  payload: unknown;
  requestId: string;
}>;

function parseRequestId(value: unknown): string {
  const requestId = parseText(value, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) fail();
  return requestId;
}

function parseRequestHeader<TCommand extends string>(
  value: unknown,
  commands: readonly TCommand[],
  allowsFactsEpoch: boolean,
): RequestHeader<TCommand> {
  const input = record(value);
  exactKeys(
    input,
    allowsFactsEpoch
      ? ['protocolVersion', 'schemaVersion', 'requestId', 'command', 'payload', 'factsEpoch'].filter(
          (key) => key !== 'factsEpoch' || hasOwn(input, key),
        )
      : ['protocolVersion', 'schemaVersion', 'requestId', 'command', 'payload'],
  );
  if (input.protocolVersion !== LOCAL_DATA_PROTOCOL_VERSION) {
    fail('PROTOCOL_MISMATCH', {
      expectedProtocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      receivedProtocolVersion:
        typeof input.protocolVersion === 'number' &&
        Number.isSafeInteger(input.protocolVersion) &&
        input.protocolVersion >= 0
          ? input.protocolVersion
          : 'invalid',
    });
  }
  if (input.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION) {
    fail('SCHEMA_MISMATCH', {
      expectedSchemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      receivedSchemaVersion:
        typeof input.schemaVersion === 'number' && Number.isSafeInteger(input.schemaVersion) && input.schemaVersion >= 0
          ? input.schemaVersion
          : 'invalid',
    });
  }
  const factsEpoch = allowsFactsEpoch && hasOwn(input, 'factsEpoch') ? parseFactsEpoch(input.factsEpoch) : undefined;
  return {
    command: parseEnum(input.command, commands),
    payload: input.payload,
    requestId: parseRequestId(input.requestId),
    ...(factsEpoch ? { factsEpoch } : {}),
  };
}

function parseEmptyPayload(value: unknown): EmptyPayload {
  exactKeys(record(value), []);
  return {};
}

function parseConversationListPayload(value: unknown): ConversationListRequestPayload {
  const input = record(value);
  allowedKeys(input, ['cursor', 'limit', 'siteKey', 'sourceKey']);
  const cursor = parseOptionalText(input, 'cursor', MAX_CURSOR_LENGTH);
  const limit = hasOwn(input, 'limit') ? parsePositiveSafeInteger(input.limit, MAX_PAGE_LIMIT) : undefined;
  const siteKey = parseOptionalText(input, 'siteKey');
  const sourceKey = parseOptionalText(input, 'sourceKey');
  return {
    ...(cursor ? { cursor } : {}),
    ...(limit ? { limit } : {}),
    ...(siteKey ? { siteKey } : {}),
    ...(sourceKey ? { sourceKey } : {}),
  };
}

function parseBrowserConversationReference(value: unknown): BrowserConversationReference {
  const input = record(value);
  allowedKeys(input, ['source', 'conversationKey', 'conversationId']);
  const source = parseText(input.source);
  const conversationKey = parseText(input.conversationKey);
  const conversationId = hasOwn(input, 'conversationId') ? parsePositiveSafeInteger(input.conversationId) : undefined;
  return { source, conversationKey, ...(conversationId ? { conversationId } : {}) };
}

function parseHostConversationReference(value: unknown): HostConversationReference {
  const input = record(value);
  allowedKeys(input, ['source', 'conversationKey', 'backendConversationId']);
  const source = parseText(input.source);
  const conversationKey = parseText(input.conversationKey);
  const backendConversationId = hasOwn(input, 'backendConversationId')
    ? parsePositiveSafeInteger(input.backendConversationId)
    : undefined;
  return { source, conversationKey, ...(backendConversationId ? { backendConversationId } : {}) };
}

function parseConversationTailPayload<TReference extends StableConversationReference>(
  value: unknown,
  parseReference: (input: unknown) => TReference,
): ConversationTailRequestPayload<TReference> {
  const input = record(value);
  allowedKeys(input, ['conversation', 'afterMessageKey', 'limit']);
  const afterMessageKey = parseOptionalText(input, 'afterMessageKey');
  const limit = hasOwn(input, 'limit') ? parsePositiveSafeInteger(input.limit, MAX_PAGE_LIMIT) : undefined;
  return {
    conversation: parseReference(input.conversation),
    ...(afterMessageKey ? { afterMessageKey } : {}),
    ...(limit ? { limit } : {}),
  };
}

function parseCaptureSnapshotPayload(value: unknown): CaptureSnapshotRequestPayload {
  const input = record(value);
  exactKeys(input, ['snapshot', 'transfer']);
  return {
    snapshot: parseJsonValue(input.snapshot),
    transfer: parseStreamDescriptor(input.transfer, ['capture-snapshot']),
  };
}

function parseSyncMessagesPayload<TReference extends StableConversationReference>(
  value: unknown,
  parseReference: (input: unknown) => TReference,
): SyncMessagesRequestPayload<TReference> {
  const input = record(value);
  exactKeys(input, ['conversation', 'messages', 'transfer']);
  return {
    conversation: parseReference(input.conversation),
    messages: parseJsonValue(input.messages),
    transfer: parseStreamDescriptor(input.transfer, ['capture-snapshot']),
  };
}

function parseMergeConversationsPayload<TReference extends StableConversationReference>(
  value: unknown,
  parseReference: (input: unknown) => TReference,
): MergeConversationsRequestPayload<TReference> {
  const input = record(value);
  exactKeys(input, ['source', 'target']);
  return { source: parseReference(input.source), target: parseReference(input.target) };
}

function parseMappingPayload<TReference extends StableConversationReference>(
  value: unknown,
  parseReference: (input: unknown) => TReference,
  requiresPatch: boolean,
): MappingRequestPayload<TReference> | PatchMappingRequestPayload<TReference> {
  const input = record(value);
  exactKeys(input, requiresPatch ? ['conversation', 'provider', 'patch'] : ['conversation', 'provider']);
  const base = { conversation: parseReference(input.conversation), provider: parseText(input.provider) };
  return requiresPatch ? { ...base, patch: parseJsonObject(input.patch) } : base;
}

function parseBrowserCommentContext(value: unknown): BrowserCommentContext {
  const input = record(value);
  allowedKeys(input, ['canonicalUrl', 'conversation']);
  const conversation = hasOwn(input, 'conversation')
    ? parseBrowserConversationReference(input.conversation)
    : undefined;
  return { canonicalUrl: parseText(input.canonicalUrl), ...(conversation ? { conversation } : {}) };
}

function parseHostCommentContext(value: unknown): HostCommentContext {
  const input = record(value);
  allowedKeys(input, ['canonicalUrl', 'conversation']);
  const conversation = hasOwn(input, 'conversation') ? parseHostConversationReference(input.conversation) : undefined;
  return { canonicalUrl: parseText(input.canonicalUrl), ...(conversation ? { conversation } : {}) };
}

function parseUpdateArticleUrlPayload<TReference extends StableConversationReference>(
  value: unknown,
  parseReference: (input: unknown) => TReference,
): UpdateArticleUrlRequestPayload<TReference> {
  const input = record(value);
  allowedKeys(input, ['fromCanonicalUrl', 'toCanonicalUrl', 'conversation']);
  const conversation = hasOwn(input, 'conversation') ? parseReference(input.conversation) : undefined;
  return {
    fromCanonicalUrl: parseText(input.fromCanonicalUrl),
    toCanonicalUrl: parseText(input.toCanonicalUrl),
    ...(conversation ? { conversation } : {}),
  };
}

function parseListArticleCommentsPayload<TContext extends BrowserCommentContext | HostCommentContext>(
  value: unknown,
  parseContext: (input: unknown) => TContext,
): ListArticleCommentsRequestPayload<TContext> {
  const input = record(value);
  exactKeys(input, ['context', 'fallbackPolicy']);
  return {
    context: parseContext(input.context),
    fallbackPolicy: parseEnum(input.fallbackPolicy, ['none', 'include-orphan-url'] as const),
  };
}

function parseAddArticleCommentPayload<TContext extends BrowserCommentContext | HostCommentContext>(
  value: unknown,
  parseContext: (input: unknown) => TContext,
): AddArticleCommentRequestPayload<TContext> {
  const input = record(value);
  allowedKeys(input, ['context', 'quoteText', 'commentText', 'locator']);
  const locator = hasOwn(input, 'locator') ? parseJsonObject(input.locator) : undefined;
  return {
    context: parseContext(input.context),
    quoteText: parseFactText(input.quoteText),
    commentText: parseFactText(input.commentText),
    ...(locator ? { locator } : {}),
  };
}

function parseAddArticleCommentReplyPayload<TContext extends BrowserCommentContext | HostCommentContext>(
  value: unknown,
  parseContext: (input: unknown) => TContext,
): AddArticleCommentReplyRequestPayload<TContext> {
  const input = record(value);
  exactKeys(input, ['context', 'commentText', 'parentId']);
  return {
    context: parseContext(input.context),
    commentText: parseFactText(input.commentText),
    parentId: parsePositiveSafeInteger(input.parentId),
  };
}

function parseDeleteArticleCommentPayload<TContext extends BrowserCommentContext | HostCommentContext>(
  value: unknown,
  parseContext: (input: unknown) => TContext,
): DeleteArticleCommentRequestPayload<TContext> {
  const input = record(value);
  exactKeys(input, ['context', 'commentId']);
  return {
    context: parseContext(input.context),
    commentId: parsePositiveSafeInteger(input.commentId),
  };
}

function parseHostAddArticleCommentReplyPayload(value: unknown): HostAddArticleCommentReplyRequestPayload {
  const input = record(value);
  exactKeys(input, ['context', 'commentText', 'backendParentId']);
  return {
    context: parseHostCommentContext(input.context),
    commentText: parseFactText(input.commentText),
    backendParentId: parsePositiveSafeInteger(input.backendParentId),
  };
}

function parseHostDeleteArticleCommentPayload(value: unknown): HostDeleteArticleCommentRequestPayload {
  const input = record(value);
  exactKeys(input, ['context', 'backendCommentId']);
  return {
    context: parseHostCommentContext(input.context),
    backendCommentId: parsePositiveSafeInteger(input.backendCommentId),
  };
}

function parseEnsureArticleCommentContextPayload(value: unknown): EnsureArticleCommentContextRequestPayload {
  const input = record(value);
  allowedKeys(input, ['tabId', 'canonicalUrlFallback', 'ensureArticle']);
  const tabId = hasOwn(input, 'tabId') ? parseNonNegativeSafeInteger(input.tabId) : undefined;
  const canonicalUrlFallback = parseOptionalText(input, 'canonicalUrlFallback');
  const ensureArticle = parseOptionalBoolean(input, 'ensureArticle');
  return {
    ...(tabId === undefined ? {} : { tabId }),
    ...(canonicalUrlFallback ? { canonicalUrlFallback } : {}),
    ...(ensureArticle === undefined ? {} : { ensureArticle }),
  };
}

function parseBrowserImageAssetPayload(value: unknown): BrowserImageAssetRequestPayload {
  const input = record(value);
  exactKeys(input, ['owner', 'assetId', 'transfer']);
  return {
    owner: parseBrowserConversationReference(input.owner),
    assetId: parsePositiveSafeInteger(input.assetId),
    transfer: parseStreamDescriptor(input.transfer, ['image-asset']),
  };
}

function parseBrowserPutImageAssetPayload(value: unknown): BrowserPutImageAssetRequestPayload {
  const input = record(value);
  allowedKeys(input, ['owner', 'assetId', 'metadata', 'transfer']);
  const assetId = hasOwn(input, 'assetId') ? parsePositiveSafeInteger(input.assetId) : undefined;
  return {
    owner: parseBrowserConversationReference(input.owner),
    metadata: parseJsonObject(input.metadata),
    transfer: parseStreamDescriptor(input.transfer, ['image-asset']),
    ...(assetId ? { assetId } : {}),
  };
}

function parseHostImageAssetPayload(value: unknown): HostImageAssetRequestPayload {
  const input = record(value);
  exactKeys(input, ['owner', 'backendAssetId', 'transfer']);
  return {
    owner: parseHostConversationReference(input.owner),
    backendAssetId: parsePositiveSafeInteger(input.backendAssetId),
    transfer: parseStreamDescriptor(input.transfer, ['image-asset']),
  };
}

function parseHostPutImageAssetPayload(value: unknown): HostPutImageAssetRequestPayload {
  const input = record(value);
  allowedKeys(input, ['owner', 'backendAssetId', 'metadata', 'transfer']);
  const backendAssetId = hasOwn(input, 'backendAssetId') ? parsePositiveSafeInteger(input.backendAssetId) : undefined;
  return {
    owner: parseHostConversationReference(input.owner),
    metadata: parseJsonObject(input.metadata),
    transfer: parseStreamDescriptor(input.transfer, ['image-asset']),
    ...(backendAssetId ? { backendAssetId } : {}),
  };
}

function parseMigrationStreamPayload(value: unknown): MigrationStreamRequestPayload {
  const input = record(value);
  exactKeys(input, ['migrationId', 'manifestDigest', 'transfer']);
  return {
    migrationId: parseMigrationId(input.migrationId),
    manifestDigest: parseOrderedFrameDigest(input.manifestDigest),
    transfer: parseStreamDescriptor(input.transfer, ['migration-fact-record', 'migration-image-asset']),
  };
}

function parseBackupStreamPayload(value: unknown): BackupStreamRequestPayload {
  const input = record(value);
  exactKeys(input, ['transfer']);
  return { transfer: parseStreamDescriptor(input.transfer, ['zip-backup']) };
}

function parseSearchRequestPayload(value: unknown): SearchRequestPayload {
  const input = record(value);
  allowedKeys(input, ['query', 'cursor', 'limit', 'siteKey', 'sort', 'sourceKey']);
  const query = parseNormalizedSearchQuery(input.query);
  const cursor = hasOwn(input, 'cursor') ? parseSearchCursorBinding(input.cursor, query) : undefined;
  const limit = hasOwn(input, 'limit') ? parsePositiveSafeInteger(input.limit, MAX_PAGE_LIMIT) : undefined;
  const siteKey = parseOptionalText(input, 'siteKey');
  const sort = hasOwn(input, 'sort') ? parseEnum(input.sort, ['best', 'recent'] as const) : undefined;
  const sourceKey = parseOptionalText(input, 'sourceKey');
  return {
    query,
    ...(cursor ? { cursor } : {}),
    ...(limit ? { limit } : {}),
    ...(siteKey ? { siteKey } : {}),
    ...(sort ? { sort } : {}),
    ...(sourceKey ? { sourceKey } : {}),
  };
}

function parseMigrationReceiptPayload(value: unknown): Readonly<{ migrationId: MigrationId }> {
  const input = record(value);
  exactKeys(input, ['migrationId']);
  return { migrationId: parseMigrationId(input.migrationId) };
}

function parseBrowserRuntimePayload<TCommand extends BrowserRuntimeFactsCommand>(
  command: TCommand,
  value: unknown,
): BrowserRuntimeFactsPayloadByCommand[TCommand] {
  switch (command) {
    case 'GET_LOCAL_DATA_STATUS':
    case 'START_LOCAL_DATA_MIGRATION':
    case 'RESUME_LOCAL_DATA_MIGRATION':
    case 'GET_FACTS_REVISION':
    case 'GET_INSIGHT_STATS':
      return parseEmptyPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'CONVERSATION_BOOTSTRAP':
    case 'CONVERSATION_LOAD_MORE':
      return parseConversationListPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'CONVERSATION_DETAIL':
    case 'DELETE_CONVERSATION':
    case 'BACKFILL_CONVERSATION_IMAGES':
      return parseBrowserConversationReference(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'CONVERSATION_TAIL':
      return parseConversationTailPayload(
        value,
        parseBrowserConversationReference,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'SAVE_CONVERSATION_SNAPSHOT':
      return parseCaptureSnapshotPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'MERGE_CONVERSATIONS':
      return parseMergeConversationsPayload(
        value,
        parseBrowserConversationReference,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'SYNC_CONVERSATION_MESSAGES':
      return parseSyncMessagesPayload(
        value,
        parseBrowserConversationReference,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'GET_SYNC_MAPPING':
    case 'CLEAR_SYNC_MAPPING':
      return parseMappingPayload(
        value,
        parseBrowserConversationReference,
        false,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'PATCH_SYNC_MAPPING':
      return parseMappingPayload(
        value,
        parseBrowserConversationReference,
        true,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'UPDATE_ARTICLE_URL':
    case 'MIGRATE_ARTICLE_COMMENT_URL':
      return parseUpdateArticleUrlPayload(
        value,
        parseBrowserConversationReference,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'LIST_ARTICLE_COMMENTS':
      return parseListArticleCommentsPayload(
        value,
        parseBrowserCommentContext,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'ADD_ARTICLE_COMMENT':
      return parseAddArticleCommentPayload(
        value,
        parseBrowserCommentContext,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'ADD_ARTICLE_COMMENT_REPLY':
      return parseAddArticleCommentReplyPayload(
        value,
        parseBrowserCommentContext,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'DELETE_ARTICLE_COMMENT':
      return parseDeleteArticleCommentPayload(
        value,
        parseBrowserCommentContext,
      ) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'ENSURE_ARTICLE_COMMENT_CONTEXT':
      return parseEnsureArticleCommentContextPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'GET_IMAGE_ASSET':
      return parseBrowserImageAssetPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'PUT_IMAGE_ASSET':
      return parseBrowserPutImageAssetPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'FACTS_IMPORT':
    case 'FACTS_EXPORT':
      return parseMigrationStreamPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'BACKUP_IMPORT':
    case 'BACKUP_EXPORT':
      return parseBackupStreamPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'SEARCH_CONVERSATIONS':
      return parseSearchRequestPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
    case 'GET_MIGRATION_RECEIPT':
      return parseMigrationReceiptPayload(value) as BrowserRuntimeFactsPayloadByCommand[TCommand];
  }
}

function parseHostFactsPayload<TCommand extends HostFactsCommand>(
  command: TCommand,
  value: unknown,
): HostFactsPayloadByCommand[TCommand] {
  switch (command) {
    case 'GET_STATUS':
    case 'GET_FACTS_REVISION':
    case 'GET_INSIGHT_STATS':
      return parseEmptyPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'CONVERSATION_BOOTSTRAP':
    case 'CONVERSATION_LOAD_MORE':
      return parseConversationListPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'CONVERSATION_DETAIL':
    case 'DELETE_CONVERSATION':
    case 'BACKFILL_CONVERSATION_IMAGES':
      return parseHostConversationReference(value) as HostFactsPayloadByCommand[TCommand];
    case 'CONVERSATION_TAIL':
      return parseConversationTailPayload(value, parseHostConversationReference) as HostFactsPayloadByCommand[TCommand];
    case 'SAVE_CONVERSATION_SNAPSHOT':
      return parseCaptureSnapshotPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'MERGE_CONVERSATIONS':
      return parseMergeConversationsPayload(
        value,
        parseHostConversationReference,
      ) as HostFactsPayloadByCommand[TCommand];
    case 'SYNC_CONVERSATION_MESSAGES':
      return parseSyncMessagesPayload(value, parseHostConversationReference) as HostFactsPayloadByCommand[TCommand];
    case 'GET_SYNC_MAPPING':
    case 'CLEAR_SYNC_MAPPING':
      return parseMappingPayload(value, parseHostConversationReference, false) as HostFactsPayloadByCommand[TCommand];
    case 'PATCH_SYNC_MAPPING':
      return parseMappingPayload(value, parseHostConversationReference, true) as HostFactsPayloadByCommand[TCommand];
    case 'UPDATE_ARTICLE_URL':
    case 'MIGRATE_ARTICLE_COMMENT_URL':
      return parseUpdateArticleUrlPayload(value, parseHostConversationReference) as HostFactsPayloadByCommand[TCommand];
    case 'LIST_ARTICLE_COMMENTS':
      return parseListArticleCommentsPayload(value, parseHostCommentContext) as HostFactsPayloadByCommand[TCommand];
    case 'ADD_ARTICLE_COMMENT':
      return parseAddArticleCommentPayload(value, parseHostCommentContext) as HostFactsPayloadByCommand[TCommand];
    case 'ADD_ARTICLE_COMMENT_REPLY':
      return parseHostAddArticleCommentReplyPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'DELETE_ARTICLE_COMMENT':
      return parseHostDeleteArticleCommentPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'ENSURE_ARTICLE_COMMENT_CONTEXT':
      return parseEnsureArticleCommentContextPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'GET_IMAGE_ASSET':
      return parseHostImageAssetPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'PUT_IMAGE_ASSET':
      return parseHostPutImageAssetPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'IMPORT_FACTS':
    case 'EXPORT_FACTS':
      return parseMigrationStreamPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'IMPORT_BACKUP':
    case 'EXPORT_BACKUP':
      return parseBackupStreamPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'SEARCH_CONVERSATIONS':
      return parseSearchRequestPayload(value) as HostFactsPayloadByCommand[TCommand];
    case 'GET_MIGRATION_RECEIPT':
      return parseMigrationReceiptPayload(value) as HostFactsPayloadByCommand[TCommand];
  }
}

function parseCliFactsPayload<TCommand extends CliFactsCommand>(
  command: TCommand,
  value: unknown,
): CliFactsPayloadByCommand[TCommand] {
  switch (command) {
    case 'DOCTOR': {
      const input = record(value);
      allowedKeys(input, ['fix']);
      const fix = parseOptionalBoolean(input, 'fix');
      return (fix === undefined ? {} : { fix }) as CliFactsPayloadByCommand[TCommand];
    }
    case 'CONVERSATIONS_LIST':
      return parseConversationListPayload(value) as CliFactsPayloadByCommand[TCommand];
    case 'CONVERSATIONS_GET': {
      const input = record(value);
      exactKeys(input, ['id']);
      return { id: parsePositiveSafeInteger(input.id) } as CliFactsPayloadByCommand[TCommand];
    }
    case 'STATS':
      return parseEmptyPayload(value) as CliFactsPayloadByCommand[TCommand];
    case 'SEARCH_CONVERSATIONS':
      return parseSearchRequestPayload(value) as CliFactsPayloadByCommand[TCommand];
  }
}

function browserPayloadCarriesNumericFactId(command: BrowserRuntimeFactsCommand, payload: unknown): boolean {
  const input = record(payload);
  const referenceHasId = (value: unknown) => isRecord(value) && hasOwn(value, 'conversationId');
  const contextHasId = (value: unknown) => isRecord(value) && referenceHasId(value.conversation);

  switch (command) {
    case 'CONVERSATION_DETAIL':
    case 'DELETE_CONVERSATION':
    case 'BACKFILL_CONVERSATION_IMAGES':
      return referenceHasId(input);
    case 'CONVERSATION_TAIL':
    case 'SYNC_CONVERSATION_MESSAGES':
    case 'GET_SYNC_MAPPING':
    case 'PATCH_SYNC_MAPPING':
    case 'CLEAR_SYNC_MAPPING':
      return referenceHasId(input.conversation);
    case 'MERGE_CONVERSATIONS':
      return referenceHasId(input.source) || referenceHasId(input.target);
    case 'UPDATE_ARTICLE_URL':
    case 'MIGRATE_ARTICLE_COMMENT_URL':
      return referenceHasId(input.conversation);
    case 'LIST_ARTICLE_COMMENTS':
    case 'ADD_ARTICLE_COMMENT':
      return contextHasId(input.context);
    case 'ADD_ARTICLE_COMMENT_REPLY':
    case 'DELETE_ARTICLE_COMMENT':
      return true;
    case 'GET_IMAGE_ASSET':
      return true;
    case 'PUT_IMAGE_ASSET':
      return hasOwn(input, 'assetId') || referenceHasId(input.owner);
    default:
      return false;
  }
}

export function parseBrowserRuntimeFactsRequest(value: unknown): BrowserRuntimeFactsRequest {
  const header = parseRequestHeader(value, BROWSER_RUNTIME_FACTS_COMMANDS, true);
  const payload = parseBrowserRuntimePayload(header.command, header.payload);
  if (browserPayloadCarriesNumericFactId(header.command, payload) && !header.factsEpoch) {
    fail('STALE_BACKEND_EPOCH');
  }
  return {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: header.requestId,
    command: header.command,
    payload,
    ...(header.factsEpoch ? { factsEpoch: header.factsEpoch } : {}),
  } as BrowserRuntimeFactsRequest;
}

export function parseHostFactsRequest(value: unknown): HostFactsRequest {
  const header = parseRequestHeader(value, HOST_FACTS_COMMANDS, false);
  return {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: header.requestId,
    command: header.command,
    payload: parseHostFactsPayload(header.command, header.payload),
  } as HostFactsRequest;
}

export function parseCliFactsRequest(value: unknown): CliFactsRequest {
  const header = parseRequestHeader(value, CLI_FACTS_COMMANDS, false);
  return {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: header.requestId,
    command: header.command,
    payload: parseCliFactsPayload(header.command, header.payload),
  } as CliFactsRequest;
}

export type LocalDataSuccess<TData> = Readonly<{
  data: TData;
  ok: true;
  protocolVersion: number;
  requestId: string;
  schemaVersion: number;
}>;

export type LocalDataFailure = Readonly<{
  error: LocalDataError;
  ok: false;
  protocolVersion: number;
  requestId: string;
  schemaVersion: number;
}>;

export type HostFactsResponse<TData> = LocalDataSuccess<TData> | LocalDataFailure;
export type CliJsonEnvelope<TData> = LocalDataSuccess<TData> | LocalDataFailure;

export type BrowserRuntimeFactsResponse<TData> =
  | (LocalDataSuccess<TData> & Readonly<{ factsEpoch?: FactsEpoch }>)
  | LocalDataFailure;

function successEnvelope<TData>(requestId: unknown, data: TData): LocalDataSuccess<TData> {
  return {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: parseRequestId(requestId),
    ok: true,
    data,
  };
}

function failureEnvelope(
  requestId: unknown,
  error: LocalDataErrorCode | LocalDataError,
  diagnostics?: unknown,
): LocalDataFailure {
  const safeError = typeof error === 'string' ? createLocalDataError(error, diagnostics) : error;
  return {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: parseRequestId(requestId),
    ok: false,
    error: safeError,
  };
}

export function createBrowserRuntimeFactsSuccess<TData>(
  requestId: unknown,
  data: TData,
  factsEpoch?: unknown,
): BrowserRuntimeFactsResponse<TData> {
  const success = successEnvelope(requestId, data);
  return factsEpoch === undefined ? success : { ...success, factsEpoch: parseFactsEpoch(factsEpoch) };
}

export function createBrowserRuntimeFactsFailure(
  requestId: unknown,
  error: LocalDataErrorCode | LocalDataError,
  diagnostics?: unknown,
): BrowserRuntimeFactsResponse<never> {
  return failureEnvelope(requestId, error, diagnostics);
}

export function createHostFactsSuccess<TData>(requestId: unknown, data: TData): HostFactsResponse<TData> {
  return successEnvelope(requestId, data);
}

export function createHostFactsFailure(
  requestId: unknown,
  error: LocalDataErrorCode | LocalDataError,
  diagnostics?: unknown,
): HostFactsResponse<never> {
  return failureEnvelope(requestId, error, diagnostics);
}

export function createCliJsonSuccess<TData>(requestId: unknown, data: TData): CliJsonEnvelope<TData> {
  return successEnvelope(requestId, data);
}

export function createCliJsonFailure(
  requestId: unknown,
  error: LocalDataErrorCode | LocalDataError,
  diagnostics?: unknown,
): CliJsonEnvelope<never> {
  return failureEnvelope(requestId, error, diagnostics);
}
