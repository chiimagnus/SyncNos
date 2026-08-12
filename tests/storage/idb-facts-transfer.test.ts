import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { MAX_MIGRATION_FACT_RECORD_BYTES, MAX_STREAM_FRAME_BYTES } from '@services/local-data/contracts';
import { decodeMigrationFactRecord, type MigrationFactRecord } from '@services/local-data/facts-archive';
import { nodeDigestProvider } from '../../packages/syncnoscli/src/runtime/node-digest';
import {
  LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD,
  createLocalDataMigrationFixture,
} from '../helpers/local-data-migration-fixture';
import {
  NativeWireSessionReceiver,
  serializeNativeWireFrame,
  type NativeWireFrame,
} from '@services/local-data/native-wire';
import { FACTS_IDB_STORE_NAMES, DB_NAME, openDb } from '../../src/platform/idb/schema';
import { clearFacts, transferIndexedDbFacts, verifyFactsEmpty } from '../../src/platform/idb/facts-transfer';
import { requestToPromise, transactionDone } from '../../src/platform/idb/transactions';

const MIGRATION_ID = '1b8c5d79-6607-4f8f-9d7b-c8c3dadf0480';

type DecodedSession = Readonly<{
  frames: readonly NativeWireFrame[];
  operation: string;
  rawBytes: Uint8Array | null;
  record: MigrationFactRecord | null;
}>;

type Deferred = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}>;

let openedDatabases: IDBDatabase[] = [];

function deferred(): Deferred {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve: () => resolve?.() };
}

function nextSessionIds(): () => string {
  let counter = 0;
  return () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function groupFramesBySession(frames: readonly NativeWireFrame[]): NativeWireFrame[][] {
  const groups: NativeWireFrame[][] = [];
  let current: NativeWireFrame[] | null = null;
  for (const frame of frames) {
    if (frame.type === 'begin') {
      expect(current).toBeNull();
      current = [frame];
      continue;
    }
    expect(current).not.toBeNull();
    current!.push(frame);
    if (frame.type === 'terminal') {
      groups.push(current!);
      current = null;
    }
  }
  expect(current).toBeNull();
  return groups;
}

async function decodeSessions(frames: readonly NativeWireFrame[]): Promise<DecodedSession[]> {
  const sessions: DecodedSession[] = [];
  for (const group of groupFramesBySession(frames)) {
    const begin = group[0]!;
    expect(begin.type).toBe('begin');
    if (begin.type !== 'begin') throw new Error('missing begin frame');
    const receiver = await NativeWireSessionReceiver.create(begin.sessionId, nodeDigestProvider);
    const rawChunks: Uint8Array[] = [];
    let record: MigrationFactRecord | null = null;
    for (const wireFrame of group) {
      const event = await receiver.accept(wireFrame);
      if (event?.kind === 'data') rawChunks.push(event.bytes);
      if (event?.kind === 'record') record = decodeMigrationFactRecord(event.record.bytes);
      if (event?.kind === 'terminal') expect(event.terminalFrame.status).toBe('ok');
    }
    expect(receiver.failed).toBe(false);
    expect(receiver.closed).toBe(true);
    sessions.push({
      frames: group,
      operation: begin.operation,
      rawBytes: rawChunks.length ? joinBytes(rawChunks) : null,
      record,
    });
  }
  return sessions;
}

function trackTransactions(db: IDBDatabase): Readonly<{
  active: () => number;
  starts: () => number;
  restore: () => void;
}> {
  const original = db.transaction.bind(db);
  let active = 0;
  let starts = 0;
  (db as any).transaction = (...args: any[]) => {
    const transaction = original(...args);
    starts += 1;
    active += 1;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      active -= 1;
    };
    transaction.addEventListener('complete', settle);
    transaction.addEventListener('error', settle);
    transaction.addEventListener('abort', settle);
    return transaction;
  };
  return Object.freeze({
    active: () => active,
    starts: () => starts,
    restore: () => {
      (db as any).transaction = original;
    },
  });
}

async function deleteDb(): Promise<void> {
  await requestToPromise(indexedDB.deleteDatabase(DB_NAME) as unknown as IDBRequest<unknown>);
}

async function seedCompleteFacts(): Promise<Readonly<{ db: IDBDatabase; imageBytes: readonly Uint8Array[] }>> {
  const db = await openDb();
  openedDatabases.push(db);
  const fixture = createLocalDataMigrationFixture();
  const transaction = db.transaction([...FACTS_IDB_STORE_NAMES], 'readwrite');
  const conversations = transaction.objectStore('conversations');
  const mappings = transaction.objectStore('sync_mappings');
  const messages = transaction.objectStore('messages');
  const images = transaction.objectStore('image_cache');
  const comments = transaction.objectStore('article_comments');
  for (const row of fixture.rows.conversations) await requestToPromise<number>(conversations.add(row));
  for (const row of fixture.rows.syncMappings) await requestToPromise<number>(mappings.add(row));
  for (const row of fixture.rows.messages) await requestToPromise<number>(messages.add(row));
  for (const row of fixture.rows.imageCache) await requestToPromise<number>(images.add(row));
  for (const row of fixture.rows.articleComments) await requestToPromise<number>(comments.add(row));
  await transactionDone(transaction);
  return {
    db,
    imageBytes: [
      fixture.assets.blobBytes,
      fixture.assets.base64Bytes,
      fixture.assets.viewBytes,
      fixture.assets.percentBytes,
      fixture.assets.base64Bytes,
    ],
  };
}

beforeEach(async () => {
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of openedDatabases.splice(0)) db.close();
  await deleteDb();
});

describe('IndexedDB migration facts transfer', () => {
  it('streams five stores in fixed order with exact primary keys, bounded frames, opaque fields, and adjacent image assets', async () => {
    const { db, imageBytes } = await seedCompleteFacts();
    const tracker = trackTransactions(db);
    const frames: NativeWireFrame[] = [];

    const manifest = await transferIndexedDbFacts({
      db,
      digestProvider: nodeDigestProvider,
      migrationId: MIGRATION_ID,
      createSessionId: nextSessionIds(),
      onFrame: async (wireFrame) => {
        expect(tracker.active()).toBe(0);
        expect(new TextEncoder().encode(serializeNativeWireFrame(wireFrame)).byteLength).toBeLessThanOrEqual(
          MAX_STREAM_FRAME_BYTES,
        );
        frames.push(wireFrame);
      },
    });
    tracker.restore();

    expect(FACTS_IDB_STORE_NAMES).toEqual([
      'conversations',
      'sync_mappings',
      'messages',
      'image_cache',
      'article_comments',
    ]);
    expect(manifest.factCounts).toEqual({
      conversations: 2,
      sync_mappings: 1,
      messages: 2,
      image_cache: 5,
      article_comments: 2,
    });
    expect(manifest.streamBytes.image_cache).toBeGreaterThan(
      imageBytes.reduce((total, bytes) => total + bytes.byteLength, 0),
    );
    expect(tracker.starts()).toBeGreaterThan(10);

    const sessions = await decodeSessions(frames);
    const facts = sessions.flatMap((session) => (session.record ? [session.record] : []));
    expect(facts.map((fact) => `${fact.kind}:${fact.sourceLocalId}`)).toEqual([
      'conversations:10',
      'conversations:11',
      'sync_mappings:30',
      'messages:20',
      'messages:21',
      'image_cache:40',
      'image_cache:41',
      'image_cache:42',
      'image_cache:43',
      'image_cache:44',
      'article_comments:50',
      'article_comments:51',
    ]);
    expect((facts.find((fact) => fact.kind === 'messages')?.payload.opaque as { large: string }).large).toHaveLength(
      LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD.length,
    );
    expect(facts.find((fact) => fact.kind === 'conversations')?.payload.unknownConversationField).toMatchObject({
      nested: true,
      large: LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD,
    });
    const [rootComment, replyComment] = facts.filter(
      (fact): fact is Extract<MigrationFactRecord, { kind: 'article_comments' }> => fact.kind === 'article_comments',
    );
    expect(rootComment?.payload.unknownCommentField).toEqual({ keep: true });
    expect(replyComment).toMatchObject({ parentSourceLocalId: '50', conversationSourceLocalId: '10' });

    const imageRecordIndexes = sessions
      .map((session, index) => (session.record?.kind === 'image_cache' ? index : -1))
      .filter((index) => index >= 0);
    expect(imageRecordIndexes).toHaveLength(5);
    for (const [index, recordIndex] of imageRecordIndexes.entries()) {
      const record = sessions[recordIndex]!.record;
      const asset = sessions[recordIndex + 1]!;
      expect(record?.kind).toBe('image_cache');
      expect(asset.operation).toBe('migration-image-asset');
      expect(asset.rawBytes).toEqual(imageBytes[index]);
      expect(record?.payload).not.toHaveProperty('blob');
      expect(record?.payload).not.toHaveProperty('dataUrl');
      expect(record?.payload).not.toHaveProperty('id');
      expect(record?.payload).not.toHaveProperty('conversationId');
    }
    const percentImage = facts.find(
      (fact): fact is Extract<MigrationFactRecord, { kind: 'image_cache' }> =>
        fact.kind === 'image_cache' && fact.sourceLocalId === '43',
    );
    expect(percentImage?.payload.unknownImageField).toEqual({ nested: LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD });

    const blobAsset = sessions[imageRecordIndexes[0]! + 1]!;
    expect(blobAsset.frames.filter((wireFrame) => wireFrame.type === 'data')).toHaveLength(3);
  });

  it('does not keep an IndexedDB transaction open while consumer backpressure or a Blob slice is delayed', async () => {
    const { db } = await seedCompleteFacts();
    const tracker = trackTransactions(db);
    const framePause = deferred();
    const framePaused = deferred();
    const blobRead = deferred();
    const blobRelease = deferred();
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    let blobArrayBufferCalls = 0;
    let pausedFrame = false;
    let delayedBlobRead = false;
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(async function (this: Blob) {
      blobArrayBufferCalls += 1;
      if (!delayedBlobRead) {
        delayedBlobRead = true;
        expect(tracker.active()).toBe(0);
        blobRead.resolve();
        await blobRelease.promise;
      }
      return await originalArrayBuffer.call(this);
    });

    const transfer = transferIndexedDbFacts({
      db,
      digestProvider: nodeDigestProvider,
      migrationId: MIGRATION_ID,
      createSessionId: nextSessionIds(),
      onFrame: async (wireFrame) => {
        expect(tracker.active()).toBe(0);
        if (!pausedFrame && wireFrame.type === 'record-json') {
          pausedFrame = true;
          framePaused.resolve();
          await framePause.promise;
        }
      },
    });

    await framePaused.promise;
    expect(tracker.active()).toBe(0);
    framePause.resolve();
    await blobRead.promise;
    expect(tracker.active()).toBe(0);
    blobRelease.resolve();
    await expect(transfer).resolves.toMatchObject({ migrationId: MIGRATION_ID });
    expect(blobArrayBufferCalls).toBe(3);
    tracker.restore();
  });

  it('fails closed on an invalid detached row, consumer cancellation, and an oversized asset', async () => {
    const db = await openDb();
    openedDatabases.push(db);
    const transaction = db.transaction([...FACTS_IDB_STORE_NAMES], 'readwrite');
    const conversations = transaction.objectStore('conversations');
    const messages = transaction.objectStore('messages');
    const conversationId = await requestToPromise<number>(
      conversations.add({ source: 'chatgpt', conversationKey: 'valid', title: 'Valid' }),
    );
    await requestToPromise<number>(messages.add({ conversationId: 999, messageKey: 'missing-owner' }));
    await transactionDone(transaction);

    let completedManifest = false;
    await expect(
      transferIndexedDbFacts({
        db,
        digestProvider: nodeDigestProvider,
        migrationId: MIGRATION_ID,
        createSessionId: nextSessionIds(),
        onFrame: () => undefined,
      }).then(() => {
        completedManifest = true;
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });
    expect(completedManifest).toBe(false);

    const repair = db.transaction(['messages', 'image_cache'], 'readwrite');
    repair.objectStore('messages').clear();
    await requestToPromise<number>(
      repair.objectStore('image_cache').add({
        conversationId,
        url: 'https://example.com/oversized.png',
        blob: new Blob([Uint8Array.from([1])], { type: 'image/png' }),
        contentType: 'image/png',
      }),
    );
    await transactionDone(repair);

    const oversize = vi.spyOn(Blob.prototype, 'size', 'get').mockReturnValue(MAX_MIGRATION_FACT_RECORD_BYTES + 1);
    await expect(
      transferIndexedDbFacts({
        db,
        digestProvider: nodeDigestProvider,
        migrationId: MIGRATION_ID,
        createSessionId: nextSessionIds(),
        onFrame: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    oversize.mockRestore();

    const controller = new AbortController();
    await expect(
      transferIndexedDbFacts({
        db,
        digestProvider: nodeDigestProvider,
        migrationId: MIGRATION_ID,
        createSessionId: nextSessionIds(),
        signal: controller.signal,
        onFrame: (wireFrame) => {
          if (wireFrame.type === 'record-begin') controller.abort();
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('does not finalize a migration when one JSON fact exceeds the 64 MiB record ceiling', async () => {
    const db = await openDb();
    openedDatabases.push(db);
    const transaction = db.transaction(['conversations', 'messages'], 'readwrite');
    const conversationId = await requestToPromise<number>(
      transaction.objectStore('conversations').add({ source: 'chatgpt', conversationKey: 'large-record' }),
    );
    let oversized = 'x'.repeat(MAX_MIGRATION_FACT_RECORD_BYTES);
    await requestToPromise<number>(
      transaction.objectStore('messages').add({
        conversationId,
        messageKey: 'too-large',
        opaque: { oversized },
      }),
    );
    oversized = '';
    await transactionDone(transaction);

    let completedManifest = false;
    await expect(
      transferIndexedDbFacts({
        db,
        digestProvider: nodeDigestProvider,
        migrationId: MIGRATION_ID,
        createSessionId: nextSessionIds(),
        onFrame: () => undefined,
      }).then(() => {
        completedManifest = true;
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(completedManifest).toBe(false);
  });

  it('clears exactly the five fact stores in one transaction, then independently verifies every count', async () => {
    const { db } = await seedCompleteFacts();
    const originalTransaction = db.transaction.bind(db);
    const transactionCalls: Array<Readonly<{ mode: IDBTransactionMode | undefined; stores: readonly string[] }>> = [];
    const clearCalls: string[] = [];
    (db as any).transaction = (storeNames: string | string[], mode?: IDBTransactionMode) => {
      const stores = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
      const transaction = originalTransaction(storeNames, mode);
      transactionCalls.push(Object.freeze({ mode, stores: Object.freeze(stores) }));
      if (mode === 'readwrite') {
        const originalObjectStore = transaction.objectStore.bind(transaction);
        (transaction as any).objectStore = (storeName: string) => {
          const store = originalObjectStore(storeName);
          const originalClear = store.clear.bind(store);
          (store as any).clear = () => {
            clearCalls.push(storeName);
            return originalClear();
          };
          return store;
        };
      }
      return transaction;
    };

    expect(await verifyFactsEmpty({ db })).toEqual({
      empty: false,
      counts: {
        conversations: 2,
        sync_mappings: 1,
        messages: 2,
        image_cache: 5,
        article_comments: 2,
      },
    });
    await clearFacts({ db });
    expect(await verifyFactsEmpty({ db })).toEqual({
      empty: true,
      counts: {
        conversations: 0,
        sync_mappings: 0,
        messages: 0,
        image_cache: 0,
        article_comments: 0,
      },
    });

    expect(clearCalls).toEqual([...FACTS_IDB_STORE_NAMES]);
    expect(transactionCalls).toEqual([
      { mode: 'readonly', stores: [...FACTS_IDB_STORE_NAMES] },
      { mode: 'readwrite', stores: [...FACTS_IDB_STORE_NAMES] },
      { mode: 'readonly', stores: [...FACTS_IDB_STORE_NAMES] },
    ]);
    (db as any).transaction = originalTransaction;
  });

  it('does not claim cleanup success when the clear or verification transaction fails', async () => {
    const { db } = await seedCompleteFacts();
    const originalTransaction = db.transaction.bind(db);
    let failedClear = false;
    (db as any).transaction = (storeNames: string | string[], mode?: IDBTransactionMode) => {
      const transaction = originalTransaction(storeNames, mode);
      if (mode !== 'readwrite' || failedClear) return transaction;
      const originalObjectStore = transaction.objectStore.bind(transaction);
      (transaction as any).objectStore = (storeName: string) => {
        const store = originalObjectStore(storeName);
        if (storeName !== 'messages') return store;
        const originalClear = store.clear.bind(store);
        (store as any).clear = () => {
          failedClear = true;
          const request = originalClear();
          transaction.abort();
          return request;
        };
        return store;
      };
      return transaction;
    };

    await expect(clearFacts({ db })).rejects.toThrow();
    (db as any).transaction = originalTransaction;
    expect(await verifyFactsEmpty({ db })).toMatchObject({ empty: false, counts: { conversations: 2, messages: 2 } });

    (db as any).transaction = () => {
      throw new Error('verification transaction unavailable');
    };
    await expect(verifyFactsEmpty({ db })).rejects.toThrow('verification transaction unavailable');
    (db as any).transaction = originalTransaction;
  });
});
