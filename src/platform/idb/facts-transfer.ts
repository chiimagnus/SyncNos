import {
  createMigrationCommentFact,
  createMigrationCommentOccurrenceTracker,
  createMigrationConversationFact,
  createMigrationFactReferenceValidator,
  createMigrationMessageFact,
  createMigrationSyncMappingFact,
  encodeMigrationFactRecord,
  prepareMigrationImageFact,
  splitCanonicalJsonText,
  streamMigrationImageBytes,
  type CanonicalJson,
  type MigrationConversationIdentity,
  type MigrationFactRecord,
  type MigrationImageByteSource,
} from '@services/local-data/facts-archive';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LocalDataContractError,
  parseMigrationId,
  type MigrationId,
  type StableConversationReference,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator, sha256Hex, type DigestProvider } from '@services/local-data/digest';
import {
  FACT_STREAM_KINDS,
  FactsManifestAccumulator,
  type FactStreamKind,
  type FactsManifest,
} from '@services/local-data/facts-manifest';
import {
  createNativeWireDataFrame,
  createNativeWireRecordJsonFrame,
  parseNativeWireFrame,
  type NativeWireFrame,
} from '@services/local-data/native-wire';

import { FACTS_IDB_STORE_NAMES, openDb, type FactsIdbStoreName } from './schema';
import { requestToPromise, transactionDone } from './transactions';

// ponytail: one detached row keeps structured-clone memory within the single-record 64 MiB protocol ceiling; add measured byte-bounded batching only if migration throughput needs it.
const FACTS_TRANSFER_PAGE_ROWS = 1;

type DetachedIdbFactRow = Readonly<{
  id: number;
  row: unknown;
}>;

type DetachedIdbFactPage = Readonly<{
  exhausted: boolean;
  lastId: number | null;
  rows: readonly DetachedIdbFactRow[];
}>;

type FactsTransferState = {
  commentOccurrenceTracker: ReturnType<typeof createMigrationCommentOccurrenceTracker>;
  commentRootDigests: Map<number, string>;
  conversations: Map<number, MigrationConversationIdentity>;
  referenceValidator: ReturnType<typeof createMigrationFactReferenceValidator>;
};

type FactsTransferEmission = {
  manifest: FactsManifestAccumulator;
  nextManifestSequence: number;
};

export type IndexedDbFactsTransferInput = Readonly<{
  createSessionId?: () => MigrationId;
  db?: IDBDatabase;
  digestProvider: DigestProvider;
  migrationId: MigrationId;
  onFrame: (frame: NativeWireFrame) => void | Promise<void>;
  signal?: AbortSignal;
}>;

export type FactsStoreCounts = Readonly<Record<FactsIdbStoreName, number>>;

export type FactsEmptyVerification = Readonly<{
  counts: FactsStoreCounts;
  empty: boolean;
}>;

export type LegacyFactConversationReference = Readonly<{
  conversationId: number;
  reference: StableConversationReference | null;
}>;

function fail(code: 'MIGRATION_VALIDATION_FAILED' | 'PAYLOAD_TOO_LARGE' = 'MIGRATION_VALIDATION_FAILED'): never {
  throw new LocalDataContractError(code);
}

function assertFactsStoreOrder(): void {
  if (
    FACTS_IDB_STORE_NAMES.length !== FACT_STREAM_KINDS.length ||
    FACTS_IDB_STORE_NAMES.some((storeName, index) => storeName !== FACT_STREAM_KINDS[index])
  ) {
    fail();
  }
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('IndexedDB facts transfer cancelled');
}

function sourceId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail();
  return Number(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  return value as Record<string, unknown>;
}

function defaultSessionId(): MigrationId {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid !== 'function') fail();
  return parseMigrationId(randomUuid.call(globalThis.crypto));
}

function nextSessionId(input: IndexedDbFactsTransferInput): MigrationId {
  return parseMigrationId((input.createSessionId ?? defaultSessionId)());
}

function frame(value: unknown): NativeWireFrame {
  return parseNativeWireFrame(value);
}

function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch (_error) {
    // The transaction may already have completed while an IDB error propagated.
  }
}

async function readDetachedPage(input: {
  afterId: number | null;
  db: IDBDatabase;
  pageSize: number;
  signal?: AbortSignal;
  storeName: FactsIdbStoreName;
}): Promise<DetachedIdbFactPage> {
  assertNotCancelled(input.signal);
  const transaction = input.db.transaction([input.storeName], 'readonly');
  const completed = transactionDone(transaction);
  const store = transaction.objectStore(input.storeName);
  let request: IDBRequest<IDBCursorWithValue | null>;
  try {
    const range =
      input.afterId == null
        ? undefined
        : typeof globalThis.IDBKeyRange?.lowerBound === 'function'
          ? globalThis.IDBKeyRange.lowerBound(input.afterId, true)
          : fail();
    request = store.openCursor(range);
  } catch (error) {
    abortQuietly(transaction);
    await completed.catch(() => undefined);
    throw error;
  }

  const cursorPage = new Promise<DetachedIdbFactPage>((resolve, reject) => {
    const rows: DetachedIdbFactRow[] = [];
    let lastId: number | null = null;
    let settled = false;

    const rejectPage = (error: unknown) => {
      if (settled) return;
      settled = true;
      abortQuietly(transaction);
      reject(error instanceof Error ? error : new Error('IndexedDB cursor failed'));
    };

    request.onerror = () => rejectPage(request.error || new Error('IndexedDB cursor failed'));
    request.onsuccess = () => {
      if (settled) return;
      try {
        assertNotCancelled(input.signal);
        const cursor = request.result;
        if (!cursor) {
          settled = true;
          resolve(Object.freeze({ rows: Object.freeze(rows), lastId, exhausted: true }));
          return;
        }

        const id = sourceId(cursor.primaryKey);
        if (input.afterId != null && id <= input.afterId) fail();
        if (lastId != null && id <= lastId) fail();
        rows.push(Object.freeze({ id, row: cursor.value }));
        lastId = id;
        if (rows.length >= input.pageSize) {
          settled = true;
          resolve(Object.freeze({ rows: Object.freeze(rows), lastId, exhausted: false }));
          return;
        }
        cursor.continue();
      } catch (error) {
        rejectPage(error);
      }
    };
  });

  try {
    const page = await Promise.race([
      cursorPage,
      completed.then(
        () => {
          throw new Error('IndexedDB transaction completed before its cursor page');
        },
        (error) => {
          throw error;
        },
      ),
    ]);
    await completed;
    return page;
  } catch (error) {
    abortQuietly(transaction);
    await completed.catch(() => undefined);
    throw error;
  }
}

async function emitFrame(input: IndexedDbFactsTransferInput, wireFrame: NativeWireFrame): Promise<void> {
  assertNotCancelled(input.signal);
  await input.onFrame(wireFrame);
  assertNotCancelled(input.signal);
}

async function appendManifestFrame(input: {
  byteLength: number;
  digest: string;
  emission: FactsTransferEmission;
  kind: FactStreamKind;
}): Promise<void> {
  if (input.emission.nextManifestSequence >= Number.MAX_SAFE_INTEGER) fail();
  await input.emission.manifest.appendFrame({
    kind: input.kind,
    manifestSequence: input.emission.nextManifestSequence++,
    byteLength: input.byteLength,
    digest: input.digest,
  });
}

async function emitMigrationFactRecord(input: {
  canonical: CanonicalJson;
  emission: FactsTransferEmission;
  transfer: IndexedDbFactsTransferInput;
  kind: FactStreamKind;
  record: MigrationFactRecord;
}): Promise<void> {
  const sessionId = nextSessionId(input.transfer);
  const recordDigest = await sha256Hex(input.transfer.digestProvider, input.canonical.bytes);
  const sessionDigest = await OrderedFrameDigestAccumulator.create(input.transfer.digestProvider);
  let sequence = 0;
  let offset = 0;

  await emitFrame(
    input.transfer,
    frame({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: sequence++,
      type: 'begin',
      operation: 'migration-fact-record',
      declaredTotalBytes: input.canonical.bytes.byteLength,
    }),
  );
  await emitFrame(
    input.transfer,
    frame({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: sequence++,
      type: 'record-begin',
      kind: input.kind,
      sourceLocalId: input.record.sourceLocalId,
      byteLength: input.canonical.bytes.byteLength,
      digest: recordDigest,
    }),
  );

  for (const chunk of splitCanonicalJsonText(input.canonical)) {
    const bytes = new TextEncoder().encode(chunk);
    const recordJsonFrame = await createNativeWireRecordJsonFrame({
      bytes,
      offset,
      provider: input.transfer.digestProvider,
      sequence,
      sessionId,
    });
    await sessionDigest.append({
      sequence,
      byteLength: bytes.byteLength,
      digest: recordJsonFrame.chunkDigest,
    });
    await appendManifestFrame({
      emission: input.emission,
      kind: input.kind,
      byteLength: bytes.byteLength,
      digest: recordJsonFrame.chunkDigest,
    });
    await emitFrame(input.transfer, recordJsonFrame);
    offset += bytes.byteLength;
    sequence += 1;
  }
  if (offset !== input.canonical.bytes.byteLength) fail();

  await emitFrame(
    input.transfer,
    frame({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: sequence++,
      type: 'record-end',
      digest: recordDigest,
    }),
  );
  await emitFrame(
    input.transfer,
    frame({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: sequence++,
      type: 'end',
      digest: sessionDigest.finalize(),
    }),
  );
  await emitFrame(
    input.transfer,
    frame({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence,
      type: 'terminal',
      status: 'ok',
    }),
  );
}

async function emitMigrationImageAsset(input: {
  emission: FactsTransferEmission;
  transfer: IndexedDbFactsTransferInput;
  source: MigrationImageByteSource;
}): Promise<void> {
  const sessionId = nextSessionId(input.transfer);
  const sessionDigest = await OrderedFrameDigestAccumulator.create(input.transfer.digestProvider);
  let offset = 0;
  let sequence = 0;

  await emitFrame(
    input.transfer,
    frame({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: sequence++,
      type: 'begin',
      operation: 'migration-image-asset',
      declaredTotalBytes: input.source.byteLength,
    }),
  );
  for await (const bytes of streamMigrationImageBytes(input.source)) {
    const dataFrame = await createNativeWireDataFrame({
      bytes,
      offset,
      provider: input.transfer.digestProvider,
      sequence,
      sessionId,
    });
    await sessionDigest.append({
      sequence,
      byteLength: bytes.byteLength,
      digest: dataFrame.sliceDigest,
    });
    await appendManifestFrame({
      emission: input.emission,
      kind: 'image_cache',
      byteLength: bytes.byteLength,
      digest: dataFrame.sliceDigest,
    });
    await emitFrame(input.transfer, dataFrame);
    offset += bytes.byteLength;
    sequence += 1;
  }
  if (offset !== input.source.byteLength) fail();

  await emitFrame(
    input.transfer,
    frame({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: sequence++,
      type: 'end',
      digest: sessionDigest.finalize(),
    }),
  );
  await emitFrame(
    input.transfer,
    frame({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence,
      type: 'terminal',
      status: 'ok',
    }),
  );
}

async function emitPreparedFact(input: {
  emission: FactsTransferEmission;
  transfer: IndexedDbFactsTransferInput;
  state: FactsTransferState;
  record: MigrationFactRecord;
  imageSource?: MigrationImageByteSource;
}): Promise<void> {
  const canonical = encodeMigrationFactRecord(input.record);
  input.state.referenceValidator.add(input.record);
  input.emission.manifest.addFact(input.record.kind);
  await emitMigrationFactRecord({
    canonical,
    emission: input.emission,
    transfer: input.transfer,
    kind: input.record.kind,
    record: input.record,
  });
  if (input.imageSource) {
    // The raw asset is immediately adjacent to its image metadata record, so the staged receiver has one unambiguous owner.
    await emitMigrationImageAsset({ emission: input.emission, transfer: input.transfer, source: input.imageSource });
  }
}

function commentParentRootDigest(row: unknown, roots: ReadonlyMap<number, string>): string | undefined {
  const parentId = record(row).parentId;
  if (parentId == null) return undefined;
  const rootDigest = roots.get(sourceId(parentId));
  if (!rootDigest) fail();
  return rootDigest;
}

async function transferDetachedRow(input: {
  emission: FactsTransferEmission;
  id: number;
  row: unknown;
  storeName: FactsIdbStoreName;
  transfer: IndexedDbFactsTransferInput;
  state: FactsTransferState;
}): Promise<void> {
  switch (input.storeName) {
    case 'conversations': {
      const fact = createMigrationConversationFact({ row: input.row, sourceLocalId: input.id });
      const source = fact.payload.source;
      const conversationKey = fact.payload.conversationKey;
      if (typeof source !== 'string' || typeof conversationKey !== 'string') fail();
      input.state.conversations.set(input.id, Object.freeze({ source, conversationKey }));
      await emitPreparedFact({ emission: input.emission, transfer: input.transfer, state: input.state, record: fact });
      return;
    }
    case 'sync_mappings': {
      const fact = createMigrationSyncMappingFact({ row: input.row, sourceLocalId: input.id });
      await emitPreparedFact({ emission: input.emission, transfer: input.transfer, state: input.state, record: fact });
      return;
    }
    case 'messages': {
      const fact = createMigrationMessageFact({ row: input.row, sourceLocalId: input.id });
      await emitPreparedFact({ emission: input.emission, transfer: input.transfer, state: input.state, record: fact });
      return;
    }
    case 'image_cache': {
      const prepared = prepareMigrationImageFact({ row: input.row, sourceLocalId: input.id });
      await emitPreparedFact({
        emission: input.emission,
        transfer: input.transfer,
        state: input.state,
        record: prepared.record,
        imageSource: prepared.bytes,
      });
      return;
    }
    case 'article_comments': {
      const fact = await createMigrationCommentFact({
        conversations: input.state.conversations,
        digestProvider: input.transfer.digestProvider,
        occurrenceTracker: input.state.commentOccurrenceTracker,
        parentRootStructuralDigest: commentParentRootDigest(input.row, input.state.commentRootDigests),
        row: input.row,
        sourceLocalId: input.id,
      });
      if (!fact.parentSourceLocalId)
        input.state.commentRootDigests.set(input.id, fact.archiveIdentity.rootStructuralDigest);
      await emitPreparedFact({ emission: input.emission, transfer: input.transfer, state: input.state, record: fact });
      return;
    }
  }
}

/**
 * Streams the five migration stores after the coordinator has closed facts admission and drained writers.
 * Every page is fully detached and its readonly transaction completed before onFrame, hashing, or Blob I/O runs.
 */
export async function transferIndexedDbFacts(input: IndexedDbFactsTransferInput): Promise<FactsManifest> {
  if (!input || typeof input !== 'object' || typeof input.onFrame !== 'function') fail();
  assertFactsStoreOrder();
  const migrationId = parseMigrationId(input.migrationId);
  assertNotCancelled(input.signal);

  const ownedDb = input.db == null;
  const db = input.db ?? (await openDb());
  try {
    const manifest = await FactsManifestAccumulator.create({ migrationId, provider: input.digestProvider });
    const state: FactsTransferState = {
      commentOccurrenceTracker: createMigrationCommentOccurrenceTracker(),
      commentRootDigests: new Map(),
      conversations: new Map(),
      referenceValidator: createMigrationFactReferenceValidator(),
    };
    const emission: FactsTransferEmission = { manifest, nextManifestSequence: 0 };

    for (const storeName of FACTS_IDB_STORE_NAMES) {
      let afterId: number | null = null;
      while (true) {
        const page = await readDetachedPage({
          db,
          storeName,
          afterId,
          pageSize: FACTS_TRANSFER_PAGE_ROWS,
          signal: input.signal,
        });
        for (const row of page.rows) {
          assertNotCancelled(input.signal);
          await transferDetachedRow({
            emission,
            id: row.id,
            row: row.row,
            storeName,
            transfer: input,
            state,
          });
        }
        if (page.exhausted) break;
        if (page.lastId == null) fail();
        afterId = page.lastId;
      }
    }

    assertNotCancelled(input.signal);
    state.referenceValidator.finalize();
    return manifest.finalize();
  } finally {
    if (ownedDb) db.close();
  }
}

/** Resolves only legacy numeric queue handles while the drained source conversations store is still intact. */
export async function readLegacyFactConversationReferences(
  conversationIds: readonly number[],
  input: Readonly<{ db?: IDBDatabase }> = {},
): Promise<readonly LegacyFactConversationReference[]> {
  if (!Array.isArray(conversationIds)) fail();
  const ids = conversationIds.map(sourceId);
  if (new Set(ids).size !== ids.length) fail();
  if (!ids.length) return Object.freeze([]);

  const ownsDb = input.db == null;
  const db = input.db ?? (await openDb());
  try {
    const transaction = db.transaction(['conversations'], 'readonly');
    const completed = transactionDone(transaction);
    try {
      const store = transaction.objectStore('conversations');
      const rows = await Promise.all(ids.map(async (id) => await requestToPromise(store.get(id))));
      await completed;
      return Object.freeze(
        rows.map((row, index) => {
          const conversationId = ids[index]!;
          if (row == null) return Object.freeze({ conversationId, reference: null });
          const value = record(row);
          const source = typeof value.source === 'string' ? value.source.trim() : '';
          const conversationKey = typeof value.conversationKey === 'string' ? value.conversationKey.trim() : '';
          if (!source || !conversationKey) fail();
          return Object.freeze({
            conversationId,
            reference: Object.freeze({ source, conversationKey }),
          });
        }),
      );
    } catch (error) {
      abortQuietly(transaction);
      await completed.catch(() => undefined);
      throw error;
    }
  } finally {
    if (ownsDb) db.close();
  }
}

/** Clears only the five migration fact stores. The migration coordinator owns the call site and receipt gate. */
export async function clearFacts(input: Readonly<{ db?: IDBDatabase }> = {}): Promise<void> {
  assertFactsStoreOrder();
  const ownsDb = input.db == null;
  const db = input.db ?? (await openDb());
  try {
    const transaction = db.transaction([...FACTS_IDB_STORE_NAMES], 'readwrite');
    const completed = transactionDone(transaction);
    try {
      for (const storeName of FACTS_IDB_STORE_NAMES) transaction.objectStore(storeName).clear();
      await completed;
    } catch (error) {
      abortQuietly(transaction);
      await completed.catch(() => undefined);
      throw error;
    }
  } finally {
    if (ownsDb) db.close();
  }
}

/** Counts every migration fact store in a fresh transaction; callers must require empty before declaring cleanup complete. */
export async function verifyFactsEmpty(input: Readonly<{ db?: IDBDatabase }> = {}): Promise<FactsEmptyVerification> {
  assertFactsStoreOrder();
  const ownsDb = input.db == null;
  const db = input.db ?? (await openDb());
  try {
    const transaction = db.transaction([...FACTS_IDB_STORE_NAMES], 'readonly');
    const completed = transactionDone(transaction);
    try {
      const counts = await Promise.all(
        FACTS_IDB_STORE_NAMES.map(async (storeName) => {
          const count = await requestToPromise(transaction.objectStore(storeName).count());
          if (!Number.isSafeInteger(count) || count < 0) fail();
          return [storeName, count] as const;
        }),
      );
      await completed;
      const countsByStore = Object.freeze(Object.fromEntries(counts) as Record<FactsIdbStoreName, number>);
      return Object.freeze({
        counts: countsByStore,
        empty: FACTS_IDB_STORE_NAMES.every((storeName) => countsByStore[storeName] === 0),
      });
    } catch (error) {
      abortQuietly(transaction);
      await completed.catch(() => undefined);
      throw error;
    }
  } finally {
    if (ownsDb) db.close();
  }
}
