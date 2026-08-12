import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseMigrationId,
  parseOrderedFrameDigest,
  type MigrationId,
} from './contracts';
import { OrderedFrameDigestAccumulator, type DigestProvider } from './digest';

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

export type FactsManifestFrame = Readonly<{
  byteLength: number;
  digest: string;
  kind: FactStreamKind;
  manifestSequence: number;
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

function emptyCountMap(): Record<FactStreamKind, number> {
  return Object.fromEntries(FACT_STREAM_KINDS.map((kind) => [kind, 0])) as Record<FactStreamKind, number>;
}

function parseFactStreamKind(value: unknown): FactStreamKind {
  if (typeof value !== 'string' || !FACT_STREAM_KINDS.includes(value as FactStreamKind)) fail();
  return value as FactStreamKind;
}

function parseNonNegativeSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail();
  return Number(value);
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

export class FactsManifestAccumulator {
  #finalized = false;
  private readonly factCounts = emptyCountMap();
  private readonly streamBytes = emptyCountMap();

  private constructor(
    private readonly migrationId: MigrationId,
    private readonly digest: OrderedFrameDigestAccumulator,
  ) {}

  static async create(input: {
    migrationId: MigrationId;
    provider: DigestProvider;
  }): Promise<FactsManifestAccumulator> {
    return new FactsManifestAccumulator(
      parseMigrationId(input.migrationId),
      await OrderedFrameDigestAccumulator.create(input.provider),
    );
  }

  addFact(kind: FactStreamKind): void {
    if (this.#finalized) fail();
    const parsedKind = parseFactStreamKind(kind);
    if (this.factCounts[parsedKind] >= Number.MAX_SAFE_INTEGER) fail();
    this.factCounts[parsedKind] += 1;
  }

  async appendFrame(frame: FactsManifestFrame): Promise<void> {
    if (this.#finalized) fail();
    const kind = parseFactStreamKind(frame.kind);
    const byteLength = parseNonNegativeSafeInteger(frame.byteLength);
    if (this.streamBytes[kind] > Number.MAX_SAFE_INTEGER - byteLength) fail();
    await this.digest.append({
      sequence: parseNonNegativeSafeInteger(frame.manifestSequence),
      byteLength,
      digest: parseOrderedFrameDigest(frame.digest),
    });
    this.streamBytes[kind] += byteLength;
  }

  finalize(): FactsManifest {
    if (this.#finalized) fail();
    this.#finalized = true;
    return createFactsManifest({
      migrationId: this.migrationId,
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      factCounts: this.factCounts,
      streamBytes: this.streamBytes,
      orderedFrameDigest: this.digest.finalize(),
    });
  }
}
