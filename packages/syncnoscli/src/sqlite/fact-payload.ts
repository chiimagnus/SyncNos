import { decodeCanonicalJson, encodeCanonicalJson } from '@services/local-data/facts-archive';
import { LocalDataContractError, type JsonObject, type JsonValue } from '@services/local-data/contracts';

export type JsonRecord = Record<string, JsonValue>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(code: 'INVALID_ARGUMENT' | 'SCHEMA_MISMATCH'): never {
  throw new LocalDataContractError(code);
}

/** Canonical JSON is the single payload representation persisted beside indexed columns. */
export function canonicalJsonRecord(value: unknown, omittedFields: readonly string[] = []): JsonRecord {
  const parsed = decodeCanonicalJson(encodeCanonicalJson(value).bytes);
  if (!isRecord(parsed)) fail('INVALID_ARGUMENT');
  const record = { ...(parsed as JsonObject) } as JsonRecord;
  for (const field of omittedFields) delete (record as Record<string, JsonValue | undefined>)[field];
  return record;
}

export function readCanonicalJsonRecord(value: unknown): JsonRecord {
  if (typeof value !== 'string') fail('SCHEMA_MISMATCH');
  try {
    const parsed = decodeCanonicalJson(new TextEncoder().encode(value));
    if (!isRecord(parsed)) fail('SCHEMA_MISMATCH');
    return { ...(parsed as JsonObject) } as JsonRecord;
  } catch (_error) {
    fail('SCHEMA_MISMATCH');
  }
}

export function canonicalJsonText(value: Record<string, unknown>): string {
  return encodeCanonicalJson(value).text;
}

export function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function safeString(value: unknown): string {
  return String(value ?? '').trim();
}
