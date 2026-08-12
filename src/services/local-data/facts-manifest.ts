import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseMigrationId,
  parseOrderedFrameDigest,
  type MigrationId,
} from './contracts';

export const FACT_STREAM_KINDS = Object.freeze([
  'conversations',
  'sync_mappings',
  'messages',
  'image_cache',
  'article_comments',
] as const);

export type FactStreamKind = (typeof FACT_STREAM_KINDS)[number];

export type FactsManifest = Readonly<{
  factCounts: Readonly<Record<FactStreamKind, number>>;
  migrationId: MigrationId;
  orderedFrameDigest: string;
  protocolVersion: number;
  schemaVersion: number;
  streamBytes: Readonly<Record<FactStreamKind, number>>;
}>;

function fail(): never {
  throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
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

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
}

function parseCountMap(value: unknown): Readonly<Record<FactStreamKind, number>> {
  const input = record(value);
  exactKeys(input, FACT_STREAM_KINDS);
  const result = {} as Record<FactStreamKind, number>;
  for (const kind of FACT_STREAM_KINDS) {
    const count = input[kind];
    if (!Number.isSafeInteger(count) || Number(count) < 0) fail();
    result[kind] = Number(count);
  }
  return Object.freeze(result);
}

export function parseFactsManifest(value: unknown): FactsManifest {
  try {
    const input = record(value);
    exactKeys(input, [
      'migrationId',
      'protocolVersion',
      'schemaVersion',
      'factCounts',
      'streamBytes',
      'orderedFrameDigest',
    ]);
    if (input.protocolVersion !== LOCAL_DATA_PROTOCOL_VERSION || input.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION)
      fail();
    return Object.freeze({
      migrationId: parseMigrationId(input.migrationId),
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      factCounts: parseCountMap(input.factCounts),
      streamBytes: parseCountMap(input.streamBytes),
      orderedFrameDigest: parseOrderedFrameDigest(input.orderedFrameDigest),
    });
  } catch (_error) {
    fail();
  }
}

export function createFactsManifest(input: FactsManifest): FactsManifest {
  return parseFactsManifest(input);
}
