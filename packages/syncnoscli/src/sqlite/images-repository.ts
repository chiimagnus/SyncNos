import { Buffer } from 'node:buffer';

import { prepareMigrationImageFact, streamMigrationImageBytes } from '@services/local-data/facts-archive';
import { LocalDataContractError } from '@services/local-data/contracts';

import { mapSqliteError } from './database';
import { canonicalJsonText, positiveId, readCanonicalJsonRecord, safeString } from './fact-payload';
import { runFactsTransaction } from './revision';
import type { SyncNosSqliteDatabase } from './schema';

type ImageRow = Readonly<{
  id: number;
  conversation_id: number;
  url: string;
  content_type: string;
  byte_size: number;
  bytes: Uint8Array;
  payload_json: string;
}>;

export type SqliteImageAsset = Readonly<{
  byteSize: number;
  bytes: Uint8Array;
  contentType: string;
  conversationId: number;
  id: number;
  url: string;
}>;

export type PutImageAssetInput = Readonly<{
  blob?: unknown;
  bytes?: unknown;
  contentType?: unknown;
  conversationId: unknown;
  dataUrl?: unknown;
  metadata?: unknown;
  url?: unknown;
}>;

export type MigrationImageUpsertResult = Readonly<{
  id: number;
  reusedExistingBytes: boolean;
  url: string;
}>;

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function execute<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw mapSqliteError(error);
  }
}

function asAsset(row: ImageRow): SqliteImageAsset {
  if (!(row.bytes instanceof Uint8Array) || row.bytes.byteLength !== row.byte_size || row.byte_size <= 0)
    invalidArgument();
  return Object.freeze({
    id: row.id,
    conversationId: row.conversation_id,
    url: row.url,
    contentType: row.content_type,
    byteSize: row.byte_size,
    bytes: Uint8Array.from(row.bytes),
  });
}

function selectImageById(database: SyncNosSqliteDatabase, id: number): ImageRow | null {
  return (database.prepare('SELECT * FROM image_cache WHERE id = ?').get(id) as ImageRow | undefined) ?? null;
}

function selectImageByConversationAndUrl(
  database: SyncNosSqliteDatabase,
  conversationId: number,
  url: string,
): ImageRow | null {
  return (
    (database.prepare('SELECT * FROM image_cache WHERE conversation_id = ? AND url = ?').get(conversationId, url) as
      | ImageRow
      | undefined) ?? null
  );
}

function validStoredBytes(row: ImageRow): boolean {
  return row.bytes instanceof Uint8Array && row.byte_size > 0 && row.bytes.byteLength === row.byte_size;
}

/**
 * Imports one already validated P1 image record. Existing valid cache bytes win,
 * matching the backup merge policy; metadata still receives non-conflicting opaque
 * fields from the incoming record.
 */
export function upsertMigrationImageWithinTransaction(
  database: SyncNosSqliteDatabase,
  input: Readonly<{
    bytes: Uint8Array;
    contentType: string;
    conversationId: number;
    metadata: Record<string, unknown>;
  }>,
): MigrationImageUpsertResult {
  const conversationId = positiveId(input.conversationId);
  const url = safeString(input.metadata.url);
  if (
    !conversationId ||
    !url ||
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength <= 0 ||
    !safeString(input.contentType) ||
    !database.prepare('SELECT 1 AS present FROM conversations WHERE id = ?').get(conversationId)
  ) {
    invalidArgument();
  }
  const existing = selectImageByConversationAndUrl(database, conversationId, url);
  const existingMetadata = existing ? readCanonicalJsonRecord(existing.payload_json) : {};
  const keepExistingBytes = Boolean(existing && validStoredBytes(existing));
  const contentType = keepExistingBytes ? existing!.content_type : input.contentType;
  const bytes = keepExistingBytes ? existing!.bytes : input.bytes;
  const metadata = {
    ...input.metadata,
    ...existingMetadata,
    url,
    contentType,
    byteSize: bytes.byteLength,
  } as Record<string, unknown>;
  delete metadata.id;
  delete metadata.conversationId;
  delete metadata.blob;
  delete metadata.bytes;
  delete metadata.dataUrl;
  const payloadJson = canonicalJsonText(metadata);
  if (existing) {
    if (!keepExistingBytes) {
      database
        .prepare(
          `UPDATE image_cache
              SET content_type = ?, byte_size = ?, bytes = ?, payload_json = ?
            WHERE id = ?`,
        )
        .run(
          contentType,
          bytes.byteLength,
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          payloadJson,
          existing.id,
        );
    } else if (existing.payload_json !== payloadJson) {
      database.prepare('UPDATE image_cache SET payload_json = ? WHERE id = ?').run(payloadJson, existing.id);
    }
    return Object.freeze({ id: existing.id, url, reusedExistingBytes: keepExistingBytes });
  }
  const result = database
    .prepare(
      `INSERT INTO image_cache (conversation_id, url, content_type, byte_size, bytes, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conversationId,
      url,
      contentType,
      bytes.byteLength,
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      payloadJson,
    );
  const id = positiveId(result.lastInsertRowid);
  if (!id) invalidArgument();
  return Object.freeze({ id, url, reusedExistingBytes: false });
}

async function normalizedImageInput(input: PutImageAssetInput): Promise<
  Readonly<{
    bytes: Buffer;
    contentType: string;
    metadata: Record<string, unknown>;
    url: string;
  }>
> {
  const metadata =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {};
  const url = safeString(input.url ?? (metadata as Record<string, unknown>).url);
  if (!url) invalidArgument();
  const raw: Record<string, unknown> = {
    ...(metadata as Record<string, unknown>),
    url,
    contentType: input.contentType ?? (metadata as Record<string, unknown>).contentType,
    conversationId: 1,
  };
  // P1 accepts both legacy forms but its canonical record deliberately stores only
  // metadata. Clear either inherited representation before choosing the current input.
  delete raw.blob;
  delete raw.bytes;
  delete raw.dataUrl;
  if (input.blob !== undefined) raw.blob = input.blob;
  else if (input.bytes !== undefined) raw.blob = input.bytes;
  else if (input.dataUrl !== undefined) raw.dataUrl = input.dataUrl;
  else if ((metadata as Record<string, unknown>).blob !== undefined)
    raw.blob = (metadata as Record<string, unknown>).blob;
  else if ((metadata as Record<string, unknown>).dataUrl !== undefined)
    raw.dataUrl = (metadata as Record<string, unknown>).dataUrl;
  delete raw.id;
  delete raw.assetId;
  delete raw.byteSize;

  const prepared = prepareMigrationImageFact({ row: raw, sourceLocalId: 1 });
  const chunks: Buffer[] = [];
  for await (const slice of streamMigrationImageBytes(prepared.bytes)) chunks.push(Buffer.from(slice));
  const bytes = Buffer.concat(chunks, prepared.record.byteLength);
  if (bytes.byteLength !== prepared.record.byteLength) invalidArgument();
  const canonicalMetadata = { ...prepared.record.payload } as Record<string, unknown>;
  delete canonicalMetadata.blob;
  delete canonicalMetadata.dataUrl;
  delete canonicalMetadata.bytes;
  return Object.freeze({
    url,
    contentType: prepared.record.contentType,
    bytes,
    metadata: canonicalMetadata,
  });
}

async function putImageAsset(database: SyncNosSqliteDatabase, input: PutImageAssetInput): Promise<SqliteImageAsset> {
  const conversationId = positiveId(input.conversationId);
  if (!conversationId) invalidArgument();
  if (
    !execute(() => Boolean(database.prepare('SELECT 1 AS present FROM conversations WHERE id = ?').get(conversationId)))
  ) {
    invalidArgument();
  }
  const normalized = await normalizedImageInput(input);
  return execute(
    () =>
      runFactsTransaction(database, () => {
        if (!database.prepare('SELECT 1 AS present FROM conversations WHERE id = ?').get(conversationId))
          invalidArgument();
        const byUrl = selectImageByConversationAndUrl(database, conversationId, normalized.url);
        const payload = canonicalJsonText({ ...normalized.metadata, url: normalized.url });
        if (byUrl) {
          database
            .prepare(
              `UPDATE image_cache
                SET url = ?, content_type = ?, byte_size = ?, bytes = ?, payload_json = ?
              WHERE id = ?`,
            )
            .run(
              normalized.url,
              normalized.contentType,
              normalized.bytes.byteLength,
              normalized.bytes,
              payload,
              byUrl.id,
            );
          const updated = selectImageById(database, byUrl.id);
          if (!updated) invalidArgument();
          return asAsset(updated);
        }
        const result = database
          .prepare(
            `INSERT INTO image_cache (conversation_id, url, content_type, byte_size, bytes, payload_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            conversationId,
            normalized.url,
            normalized.contentType,
            normalized.bytes.byteLength,
            normalized.bytes,
            payload,
          );
        const id = positiveId(result.lastInsertRowid);
        if (!id) invalidArgument();
        const inserted = selectImageById(database, id);
        if (!inserted) invalidArgument();
        return asAsset(inserted);
      }).result,
  );
}

export function deleteImagesForConversationIds(database: SyncNosSqliteDatabase, values: readonly number[]): number {
  const statement = database.prepare('DELETE FROM image_cache WHERE conversation_id = ?');
  let deleted = 0;
  for (const id of values) deleted += Number(statement.run(id).changes) || 0;
  return deleted;
}

/** Moves only non-conflicting cache rows, preserving the keep conversation's existing asset ID. */
export function moveImagesForConversationMerge(
  database: SyncNosSqliteDatabase,
  input: Readonly<{ keepConversationId: number; removeConversationId: number }>,
): number {
  const rows = database
    .prepare('SELECT * FROM image_cache WHERE conversation_id = ? ORDER BY id ASC')
    .all(input.removeConversationId) as ImageRow[];
  const remove = database.prepare('DELETE FROM image_cache WHERE id = ?');
  const move = database.prepare('UPDATE image_cache SET conversation_id = ? WHERE id = ?');
  let moved = 0;
  for (const row of rows) {
    if (selectImageByConversationAndUrl(database, input.keepConversationId, row.url)) {
      remove.run(row.id);
      continue;
    }
    move.run(input.keepConversationId, row.id);
    moved += 1;
  }
  return moved;
}

function getImageAssetById(
  database: SyncNosSqliteDatabase,
  input: Readonly<{ conversationId?: unknown; id: unknown }>,
): SqliteImageAsset | null {
  const id = positiveId(input.id);
  if (!id) return null;
  return execute(() => {
    const row = selectImageById(database, id);
    if (!row) return null;
    const expectedConversationId = input.conversationId == null ? null : positiveId(input.conversationId);
    if (input.conversationId != null && !expectedConversationId) return null;
    if (expectedConversationId && expectedConversationId !== row.conversation_id) return null;
    return asAsset(row);
  });
}

function findImageAssetByConversationAndUrl(
  database: SyncNosSqliteDatabase,
  input: Readonly<{ conversationId: unknown; url: unknown }>,
): SqliteImageAsset | null {
  const conversationId = positiveId(input.conversationId);
  const url = safeString(input.url);
  if (!conversationId || !url) return null;
  return execute(() => {
    const row = selectImageByConversationAndUrl(database, conversationId, url);
    return row ? asAsset(row) : null;
  });
}

export function createImagesRepository(database: SyncNosSqliteDatabase) {
  return Object.freeze({
    findImageAssetByConversationAndUrl: (input: Readonly<{ conversationId: unknown; url: unknown }>) =>
      findImageAssetByConversationAndUrl(database, input),
    getImageAssetById: (input: Readonly<{ conversationId?: unknown; id: unknown }>) =>
      getImageAssetById(database, input),
    putImageAsset: async (input: PutImageAssetInput) => await putImageAsset(database, input),
  });
}

export type ImagesRepository = ReturnType<typeof createImagesRepository>;
