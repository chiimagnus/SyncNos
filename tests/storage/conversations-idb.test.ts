import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBIndex, IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { normalizeConversationListRecord } from '@platform/idb/conversation-list-record';
import { closeDbForTests, openDb } from '../../src/platform/idb/schema';
import { readDataRevision } from '@services/data-revisions/storage-idb';
import { resolveCaptureIntegrity } from '@services/shared/capture-integrity';

import {
  attachOrphanCommentsToConversation,
  listArticleCommentsByConversationId,
} from '@services/comments/data/storage-idb';
import { buildConversationBasename, stableConversationId10 } from '@services/conversations/domain/file-naming';
import {
  __resetConversationStorageStateForTests,
  deleteConversationsByIds,
  getConversationById,
  getConversationTailWindowBySourceAndKey,
  getConversationListBootstrap,
  getMessagesByConversationId,
  getMessagesTailByConversationId,
  getSyncMappingByConversation,
  mergeConversationsByIds,
  patchSyncMapping,
  setConversationNotionPageId,
  setSyncCursor,
  syncConversationMessages,
  upsertConversation,
} from '@services/conversations/data/storage-idb';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error('tx failed'));
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

describe('conversation list stored-key normalization', () => {
  it('normalizes source/site keys and only falls back to stored keys when source/url cannot derive them', () => {
    expect(
      normalizeConversationListRecord({
        source: ' Web ',
        url: 'HTTPS://Example.COM/path#fragment',
        listSourceKey: 'stale-source',
        listSiteKey: 'stale.example',
      }),
    ).toMatchObject({ listSourceKey: 'web', listSiteKey: 'domain:example.com' });

    expect(
      normalizeConversationListRecord({
        source: ' ',
        url: 'mailto:test@example.com',
        listSourceKey: ' ChatGPT ',
        listSiteKey: ' Example.COM ',
      }),
    ).toMatchObject({ listSourceKey: 'chatgpt', listSiteKey: 'domain:example.com' });

    expect(normalizeConversationListRecord({ source: '', url: 'not a url' })).toMatchObject({
      listSourceKey: 'unknown',
      listSiteKey: 'unknown',
    });
  });

  it('preserves object identity when the stored keys are already canonical', () => {
    const record = {
      source: 'web',
      url: 'https://example.com/post',
      listSourceKey: 'web',
      listSiteKey: 'domain:example.com',
    };
    expect(normalizeConversationListRecord(record)).toBe(record);
  });
});

beforeEach(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();

  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
});

async function listAllConversationsForTests() {
  const page = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 500 }, 500);
  return page.items;
}

async function seedImageCacheRow(input: {
  conversationId: number;
  url: string;
  blob?: Blob;
  byteSize?: number;
  contentType?: string;
  createdAt?: number;
  updatedAt?: number;
}): Promise<number> {
  const db = await openDb();
  const transaction = db.transaction(['image_cache'], 'readwrite');
  const id = await reqToPromise<number>(
    transaction.objectStore('image_cache').add({
      conversationId: input.conversationId,
      url: input.url,
      ...(input.blob ? { blob: input.blob } : {}),
      byteSize: input.byteSize ?? input.blob?.size ?? 0,
      contentType: input.contentType || input.blob?.type || 'image/png',
      createdAt: input.createdAt ?? 1,
      updatedAt: input.updatedAt ?? 1,
    }) as any,
  );
  await txDone(transaction);
  return Number(id);
}

async function readImageCacheRows(): Promise<any[]> {
  const db = await openDb();
  const transaction = db.transaction(['image_cache'], 'readonly');
  const rows = await reqToPromise<any[]>(transaction.objectStore('image_cache').getAll());
  await txDone(transaction);
  return rows;
}

async function createMergePair(suffix: string) {
  const keep = await upsertConversation({
    sourceType: 'chat',
    source: 'debug',
    conversationKey: `merge-keep-${suffix}`,
    title: 'keep',
    lastCapturedAt: 1,
  });
  const remove = await upsertConversation({
    sourceType: 'chat',
    source: 'debug',
    conversationKey: `merge-remove-${suffix}`,
    title: 'remove',
    lastCapturedAt: 2,
  });
  return { keepId: Number(keep.id), removeId: Number(remove.id) };
}

describe('conversations storage-idb', () => {
  it('bumps conversations for a new row and keeps an identical upsert revision-stable', async () => {
    const payload = {
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'revision-stable',
      title: 'Stable',
      url: 'https://example.com/stable',
      warningFlags: ['keep'],
      lastCapturedAt: 10,
    };

    const created = await upsertConversation(payload);
    expect(Number(created.id)).toBeGreaterThan(0);
    expect(await readDataRevision('conversations')).toBe(1);
    expect(await readDataRevision('sync_mappings')).toBe(0);
    expect(await readDataRevision('article_comments')).toBe(0);

    const repeated = await upsertConversation(payload);
    expect(Number(repeated.id)).toBe(Number(created.id));
    expect(await readDataRevision('conversations')).toBe(1);
    expect(await readDataRevision('sync_mappings')).toBe(0);
    expect(await readDataRevision('article_comments')).toBe(0);
  });

  it('preserves persisted mapping mirrors and unknown fields across an identical upsert', async () => {
    const payload = {
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'preserve-existing-fields',
      title: 'Preserve',
      notionPageId: 'page-1',
      feishuDocId: 'doc-1',
      lastCapturedAt: 20,
    };
    const created = await upsertConversation(payload);
    const id = Number(created.id);

    const db = await openDb();
    const seedTx = db.transaction(['conversations'], 'readwrite');
    const store = seedTx.objectStore('conversations');
    const row = await reqToPromise<any>(store.get(id));
    await reqToPromise(
      store.put({
        ...row,
        notionPageUrl: 'https://notion.so/page-1',
        notionWorkspaceSlug: 'workspace-1',
        futureConversationMetadata: { nested: { a: 1 } },
      }),
    );
    await txDone(seedTx);

    await upsertConversation(payload);
    expect(await readDataRevision('conversations')).toBe(1);

    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['conversations'], 'readonly');
    const persisted = await reqToPromise<any>(verifyTx.objectStore('conversations').get(id));
    await txDone(verifyTx);
    expect(persisted).toMatchObject({
      notionPageUrl: 'https://notion.so/page-1',
      notionWorkspaceSlug: 'workspace-1',
      futureConversationMetadata: { nested: { a: 1 } },
    });
  });

  it('bumps only sync_mappings when upsert repairs a missing mapping mirror', async () => {
    const payload = {
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'mapping-only',
      title: 'Mapping only',
      notionPageId: 'page-mirror',
      lastCapturedAt: 30,
    };
    const created = await upsertConversation(payload);
    expect(await readDataRevision('conversations')).toBe(1);

    const db = await openDb();
    const seedTx = db.transaction(['sync_mappings'], 'readwrite');
    await reqToPromise(
      seedTx.objectStore('sync_mappings').add({
        source: 'chatgpt',
        conversationKey: 'mapping-only',
        unknownMetadata: { keep: true },
      }),
    );
    await txDone(seedTx);

    await upsertConversation(payload);
    expect(await readDataRevision('conversations')).toBe(1);
    expect(await readDataRevision('sync_mappings')).toBe(1);
    const mapping = await getSyncMappingByConversation(Number(created.id));
    expect(mapping?.mapping).toMatchObject({
      notionPageId: 'page-mirror',
      unknownMetadata: { keep: true },
    });
  });

  it('upserts conversation and lists conversations sorted by lastCapturedAt desc', async () => {
    await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k2',
      title: 'B',
      lastCapturedAt: 2,
    });

    const items = await listAllConversationsForTests();
    expect(items.length).toBe(2);
    expect(items[0].conversationKey).toBe('k2');
    expect(items[1].conversationKey).toBe('k1');
    expect(items[0].listSourceKey).toBe('debug');
    expect(items[0].listSiteKey).toBe('unknown');
  });

  it('syncs messages and cleans up removed messages', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    const before = await getMessagesByConversationId(id);
    expect(before.map((m) => m.messageKey)).toEqual(['m1', 'm2']);

    // Re-sync with only one message; should delete m2.
    const res = await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 },
    ]);
    expect(res.upserted).toBe(1);
    expect(res.deleted).toBe(1);

    const after = await getMessagesByConversationId(id);
    expect(after.map((m) => m.messageKey)).toEqual(['m1']);
  });

  it('keeps equivalent message rows revision-stable when incoming timestamps are missing or invalid', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'message_timestamp_noop',
      title: 'Timestamp no-op',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    const stableMessage = {
      messageKey: 'm1',
      role: 'user',
      authorName: 'User',
      contentText: 'same',
      contentMarkdown: 'same',
      sequence: 1,
    };

    await syncConversationMessages(id, [{ ...stableMessage, updatedAt: 100 }]);
    expect(await readDataRevision('messages')).toBe(1);

    const db = await openDb();
    const probeTx = db.transaction(['messages'], 'readonly');
    const prototype = Object.getPrototypeOf(probeTx.objectStore('messages')) as any;
    const originalPut = prototype.put;
    await txDone(probeTx);
    prototype.put = function put(value: unknown, key?: IDBValidKey) {
      if (this.name === 'messages') throw new DOMException('equivalent message must not be put', 'DataError');
      return originalPut.call(this, value, key);
    };

    try {
      for (const updatedAt of [undefined, '100', Number.NaN, Number.POSITIVE_INFINITY]) {
        const snapshotResult = await syncConversationMessages(id, [{ ...stableMessage, updatedAt }]);
        expect(snapshotResult).toEqual({ upserted: 1, deleted: 0 });
      }
      const incrementalResult = await syncConversationMessages(id, [{ ...stableMessage }], {
        mode: 'incremental',
        diff: { added: [], updated: ['m1'], removed: [] },
      });
      expect(incrementalResult).toEqual({ upserted: 1, deleted: 0 });
      const appendResult = await syncConversationMessages(id, [{ ...stableMessage }], {
        mode: 'append',
        diff: { added: [], updated: ['m1'], removed: [] },
      });
      expect(appendResult).toEqual({ upserted: 1, deleted: 0 });
    } finally {
      prototype.put = originalPut;
    }

    expect(await readDataRevision('messages')).toBe(1);
    const preserved = await getMessagesByConversationId(id);
    expect(preserved[0]?.updatedAt).toBe(100);

    await syncConversationMessages(id, [{ ...stableMessage, updatedAt: 101 }]);
    expect(await readDataRevision('messages')).toBe(2);
    expect((await getMessagesByConversationId(id))[0]?.updatedAt).toBe(101);
  });

  it('uses a current timestamp only when inserting a new message without a finite timestamp', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'message_timestamp_new',
      title: 'Timestamp new',
      lastCapturedAt: 1,
    });
    const before = Date.now();
    await syncConversationMessages(Number(convo.id), [
      { messageKey: 'm1', role: 'user', contentText: 'new', sequence: 1, updatedAt: 'invalid' },
    ]);
    const stored = await getMessagesByConversationId(Number(convo.id));
    expect(Number(stored[0]?.updatedAt)).toBeGreaterThanOrEqual(before);
    expect(Number(stored[0]?.updatedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('materializes the snapshot working set once without per-key existing lookups', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'snapshot-working-set',
      title: 'Working set',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 0, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 1, updatedAt: 2 },
      { messageKey: 'm3', role: 'user', contentText: 'remove', sequence: 2, updatedAt: 3 },
    ]);

    const getAllSpy = vi.spyOn(IDBIndex.prototype, 'getAll');
    const getSpy = vi.spyOn(IDBIndex.prototype, 'get');
    try {
      const result = await syncConversationMessages(id, [
        { messageKey: 'm1', role: 'user', contentText: 'one updated', sequence: 0, updatedAt: 4 },
        { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 1, updatedAt: 2 },
        { messageKey: 'm4', role: 'assistant', contentText: 'four', sequence: 2, updatedAt: 5 },
      ]);
      expect(result).toEqual({ upserted: 3, deleted: 1 });

      const sequenceReads = getAllSpy.mock.contexts.filter(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_sequence',
      );
      const perKeyReads = getSpy.mock.contexts.filter(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_messageKey',
      );
      expect(sequenceReads).toHaveLength(1);
      expect(perKeyReads).toHaveLength(0);
    } finally {
      getAllSpy.mockRestore();
      getSpy.mockRestore();
    }

    expect((await getMessagesByConversationId(id)).map((message) => [message.messageKey, message.contentText])).toEqual([
      ['m1', 'one updated'],
      ['m2', 'two'],
      ['m4', 'four'],
    ]);
  });

  it('keeps duplicate snapshot message keys on one row with the last incoming value', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'snapshot-duplicate-key',
      title: 'Duplicate',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    const result = await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'first', sequence: 0, updatedAt: 1 },
      { messageKey: 'm1', role: 'assistant', contentText: 'second', sequence: 1, updatedAt: 2 },
    ]);

    expect(result).toEqual({ upserted: 2, deleted: 0 });
    expect(await getMessagesByConversationId(id)).toMatchObject([
      { messageKey: 'm1', role: 'assistant', contentText: 'second', sequence: 1, updatedAt: 2 },
    ]);
  });

  it('keeps ordinary append deltas on per-key reads without materializing the conversation', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append-delta-read-shape',
      title: 'Delta',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [{ messageKey: 'm1', role: 'user', contentText: 'old', sequence: 0 }]);

    const getAllSpy = vi.spyOn(IDBIndex.prototype, 'getAll');
    const getSpy = vi.spyOn(IDBIndex.prototype, 'get');
    try {
      await syncConversationMessages(id, [{ messageKey: 'm1', role: 'user', contentText: 'new', sequence: 0 }], {
        mode: 'append',
        diff: { added: [], updated: ['m1'], removed: [] },
      });

      const sequenceReads = getAllSpy.mock.contexts.filter(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_sequence',
      );
      const perKeyReads = getSpy.mock.contexts.filter(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_messageKey',
      );
      expect(sequenceReads).toHaveLength(0);
      expect(perKeyReads).toHaveLength(1);
    } finally {
      getAllSpy.mockRestore();
      getSpy.mockRestore();
    }
  });

  it('reuses the preserve-tail working set without redundant per-key reads', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append-tail-read-shape',
      title: 'Tail',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 10 },
      { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 20 },
    ]);

    const getAllSpy = vi.spyOn(IDBIndex.prototype, 'getAll');
    const getSpy = vi.spyOn(IDBIndex.prototype, 'get');
    try {
      await syncConversationMessages(
        id,
        [
          {
            messageKey: 'm2',
            role: 'assistant',
            contentText: 'two updated',
            sequence: 0,
            captureSequencePolicy: 'preserve-existing-tail',
          },
          {
            messageKey: 'm3',
            role: 'user',
            contentText: 'three',
            sequence: 0,
            captureSequencePolicy: 'preserve-existing-tail',
          },
        ],
        { mode: 'append', diff: { added: ['m3'], updated: ['m2'], removed: [] } },
      );

      const sequenceReads = getAllSpy.mock.contexts.filter(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_sequence',
      );
      const perKeyReads = getSpy.mock.contexts.filter(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_messageKey',
      );
      expect(sequenceReads).toHaveLength(1);
      expect(perKeyReads).toHaveLength(0);
    } finally {
      getAllSpy.mockRestore();
      getSpy.mockRestore();
    }

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 10],
      ['m2', 20],
      ['m3', 21],
    ]);
  });

  it('keeps exact stored message-key matching when reusing an append working set', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append-exact-key',
      title: 'Exact key',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: ' m1 ', role: 'user', contentText: 'legacy spaced key', sequence: 0 },
    ]);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'normalized incoming key',
          sequence: 0,
          captureSequencePolicy: 'preserve-existing-tail',
        },
      ],
      { mode: 'append', diff: { added: ['m1'], updated: [], removed: [] } },
    );

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      [' m1 ', 0],
      ['m1', 1],
    ]);
  });

  it('reuses the append reconciliation working set without redundant per-key reads', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'append-reconcile-read-shape',
      title: 'Reconcile',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 0 },
      { messageKey: 'm4', role: 'assistant', contentText: 'four', sequence: 1 },
    ]);

    const getAllSpy = vi.spyOn(IDBIndex.prototype, 'getAll');
    const getSpy = vi.spyOn(IDBIndex.prototype, 'get');
    try {
      await syncConversationMessages(
        id,
        [
          {
            messageKey: 'm1',
            role: 'user',
            contentText: 'one',
            sequence: 0,
            captureSequencePolicy: 'reconcile-existing-order',
          },
          {
            messageKey: 'm2',
            role: 'assistant',
            contentText: 'two',
            sequence: 1,
            captureSequencePolicy: 'reconcile-existing-order',
          },
          {
            messageKey: 'm3',
            role: 'user',
            contentText: 'three',
            sequence: 2,
            captureSequencePolicy: 'reconcile-existing-order',
          },
          {
            messageKey: 'm4',
            role: 'assistant',
            contentText: 'four',
            sequence: 3,
            captureSequencePolicy: 'reconcile-existing-order',
          },
        ],
        { mode: 'append', diff: { added: ['m1', 'm2'], updated: ['m3', 'm4'], removed: [] } },
      );

      const sequenceReads = getAllSpy.mock.contexts.filter(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_sequence',
      );
      const perKeyReads = getSpy.mock.contexts.filter(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_messageKey',
      );
      expect(sequenceReads).toHaveLength(1);
      expect(perKeyReads).toHaveLength(0);
    } finally {
      getAllSpy.mockRestore();
      getSpy.mockRestore();
    }

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 0],
      ['m2', 1],
      ['m3', 2],
      ['m4', 3],
    ]);
  });

  it('syncs messages incrementally without snapshot cleanup', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    // Incremental update only provides m1 (e.g. partial render) and does not mark m2 as removed:
    // m2 should remain.
    const res1 = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 }],
      { mode: 'incremental', diff: { added: [], updated: ['m1'], removed: [] } },
    );
    expect(res1.upserted).toBe(1);
    expect(res1.deleted).toBe(0);
    const after1 = await getMessagesByConversationId(id);
    expect(after1.map((m) => m.messageKey)).toEqual(['m1', 'm2']);
    expect(after1.find((m) => m.messageKey === 'm1')?.contentText).toBe('u2');

    // Incremental delete removes only explicitly removed keys.
    const res2 = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u3', sequence: 1, updatedAt: 4 }],
      { mode: 'incremental', diff: { added: [], updated: ['m1'], removed: ['m2'] } },
    );
    expect(res2.upserted).toBe(1);
    expect(res2.deleted).toBe(1);
    const after2 = await getMessagesByConversationId(id);
    expect(after2.map((m) => m.messageKey)).toEqual(['m1']);
  });

  it('rejects an unknown persistence mode before mutating stored messages', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'unknown_mode',
      title: 'Mode',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [{ messageKey: 'm1', role: 'user', contentText: 'old', sequence: 0 }]);

    await expect(
      syncConversationMessages(id, [{ messageKey: 'm2', role: 'assistant', contentText: 'new', sequence: 1 }], {
        mode: 'snapshop' as any,
      }),
    ).rejects.toThrow('Unknown message persistence mode');
    expect((await getMessagesByConversationId(id)).map((message) => message.messageKey)).toEqual(['m1']);
  });

  it('syncs messages in append-only mode and never deletes even when removed is provided', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    const res = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 }],
      { mode: 'append', diff: { added: [], updated: ['m1'], removed: ['m2'] } },
    );
    expect(res.upserted).toBe(1);
    expect(res.deleted).toBe(0);

    const after = await getMessagesByConversationId(id);
    expect(after.map((m) => m.messageKey)).toEqual(['m1', 'm2']);
    expect(after.find((m) => m.messageKey === 'm1')?.contentText).toBe('u2');
  });

  it.each([
    ['null diff', null],
    ['empty diff', {}],
    ['malformed diff', { added: 'm1', updated: 12, removed: ['m2'] }],
  ])('keeps append non-destructive with %s', async (_label, diff) => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: `append_${_label}`,
      title: 'Append',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'old', sequence: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'keep', sequence: 2 },
    ]);

    const result = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'new', sequence: 1 }],
      { mode: 'append', diff: diff as any },
    );

    expect(result).toEqual({ upserted: 0, deleted: 0 });
    const stored = await getMessagesByConversationId(id);
    expect(stored.map((message) => message.messageKey)).toEqual(['m1', 'm2']);
    expect(stored.find((message) => message.messageKey === 'm1')?.contentText).toBe('old');
  });

  it('treats unkeyed append input as a no-delete no-op', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_unkeyed',
      title: 'Append',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'old', sequence: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'keep', sequence: 2 },
    ]);

    const result = await syncConversationMessages(id, [{ role: 'user', contentText: 'ignored', sequence: 1 }], {
      mode: 'append',
      diff: null,
    });

    expect(result).toEqual({ upserted: 0, deleted: 0 });
    expect((await getMessagesByConversationId(id)).map((message) => message.messageKey)).toEqual(['m1', 'm2']);
  });

  it('requires an explicit diff for incremental mode', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'incremental_no_diff',
      title: 'Incremental',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'old', sequence: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'keep', sequence: 2 },
    ]);

    const result = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'ignored', sequence: 1 }],
      { mode: 'incremental', diff: null },
    );

    expect(result).toEqual({ upserted: 0, deleted: 0 });
    expect((await getMessagesByConversationId(id)).map((message) => message.contentText)).toEqual(['old', 'keep']);
  });

  it('preserves existing order and tail-assigns new virtual partial rows', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_sequence_tail',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 10 },
      { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 20 },
      { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 30 },
    ]);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm3',
          role: 'user',
          contentText: 'three updated',
          sequence: 0,
          captureSequencePolicy: 'preserve-existing-tail',
        },
        {
          messageKey: 'm4',
          role: 'assistant',
          contentText: 'four',
          sequence: 0,
          captureSequencePolicy: 'preserve-existing-tail',
        },
        {
          messageKey: 'm5',
          role: 'user',
          contentText: 'five',
          sequence: 0,
          captureSequencePolicy: 'preserve-existing-tail',
        },
      ],
      { mode: 'append', diff: { added: ['m4', 'm5'], updated: ['m3'], removed: [] } },
    );

    const stored = await getMessagesByConversationId(id);
    expect(stored.map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 10],
      ['m2', 20],
      ['m3', 30],
      ['m4', 31],
      ['m5', 32],
    ]);
  });

  it('tail-assigns virtual partial rows in incoming order across added and updated diff groups', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_sequence_incoming_order',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm2',
          role: 'assistant',
          contentText: 'second',
          sequence: 99,
          captureSequencePolicy: 'preserve-existing-tail',
        },
        {
          messageKey: 'm1',
          role: 'user',
          contentText: 'first',
          sequence: 99,
          captureSequencePolicy: 'preserve-existing-tail',
        },
      ],
      { mode: 'append', diff: { added: ['m1'], updated: ['m2'], removed: [] } },
    );

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m2', 0],
      ['m1', 1],
    ]);
  });

  it('tail-assigns virtual partial rows from zero in an empty conversation', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_sequence_empty',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'user',
          contentText: 'one',
          sequence: 999,
          captureSequencePolicy: 'preserve-existing-tail',
        },
        {
          messageKey: 'm2',
          role: 'assistant',
          contentText: 'two',
          sequence: 999,
          captureSequencePolicy: 'preserve-existing-tail',
        },
      ],
      { mode: 'append', diff: { added: ['m1', 'm2'], updated: [], removed: [] } },
    );

    expect((await getMessagesByConversationId(id)).map((message) => message.sequence)).toEqual([0, 1]);
  });

  it('reconciles newly discovered virtual partial prefixes before existing anchored rows', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'partial_prefix_reconcile',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 0 },
      { messageKey: 'm4', role: 'assistant', contentText: 'four', sequence: 1 },
    ]);

    const integrity = resolveCaptureIntegrity('chatgpt', {
      conversation: { sourceType: 'chat', source: 'chatgpt', conversationKey: 'partial_prefix_reconcile' },
      messages: [
        { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 0 },
        { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 1 },
        { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 2 },
        { messageKey: 'm4', role: 'assistant', contentText: 'four', sequence: 3 },
      ],
      captureMeta: {
        completeness: 'partial',
        identityVerified: true,
        reasons: ['bottom_not_reached'],
      },
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) return;

    await syncConversationMessages(id, integrity.snapshot.messages, integrity.persistence);

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 0],
      ['m2', 1],
      ['m3', 2],
      ['m4', 3],
    ]);
  });

  it('repairs legacy tail-polluted order when a trusted partial capture covers every stored key', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'partial_legacy_order_recovery',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 0 },
      { messageKey: 'm4', role: 'assistant', contentText: 'four', sequence: 1 },
      { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 2 },
      { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 3 },
    ]);

    const integrity = resolveCaptureIntegrity('chatgpt', {
      conversation: { sourceType: 'chat', source: 'chatgpt', conversationKey: 'partial_legacy_order_recovery' },
      messages: [
        { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 0 },
        { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 1 },
        { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 2 },
        { messageKey: 'm4', role: 'assistant', contentText: 'four', sequence: 3 },
      ],
      captureMeta: { completeness: 'partial', identityVerified: true, reasons: ['bottom_not_reached'] },
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) return;

    await syncConversationMessages(id, integrity.snapshot.messages, integrity.persistence);

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 0],
      ['m2', 1],
      ['m3', 2],
      ['m4', 3],
    ]);
  });

  it('reconciles newly discovered virtual partial rows between stable anchors', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'partial_middle_reconcile',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 10 },
      { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 30 },
    ]);

    const integrity = resolveCaptureIntegrity('chatgpt', {
      conversation: { sourceType: 'chat', source: 'chatgpt', conversationKey: 'partial_middle_reconcile' },
      messages: [
        { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 0 },
        { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 1 },
        { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 2 },
      ],
      captureMeta: { completeness: 'partial', identityVerified: true, reasons: ['bottom_not_reached'] },
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) return;

    await syncConversationMessages(id, integrity.snapshot.messages, integrity.persistence);

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 0],
      ['m2', 1],
      ['m3', 2],
    ]);
  });

  it('keeps unanchored virtual partial rows at the tail instead of guessing a prefix', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'partial_unanchored_tail',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'one', sequence: 10 },
      { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 20 },
    ]);

    const integrity = resolveCaptureIntegrity('chatgpt', {
      conversation: { sourceType: 'chat', source: 'chatgpt', conversationKey: 'partial_unanchored_tail' },
      messages: [
        { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 0 },
        { messageKey: 'm4', role: 'assistant', contentText: 'four', sequence: 1 },
      ],
      captureMeta: { completeness: 'partial', identityVerified: true, reasons: ['order_unanchored'] },
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) return;

    await syncConversationMessages(id, integrity.snapshot.messages, integrity.persistence);

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 10],
      ['m2', 20],
      ['m3', 21],
      ['m4', 22],
    ]);
  });

  it('keeps unmarked append incoming sequence for autosave prefix reconciliation', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_sequence_unmarked',
      title: 'Order',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm2', role: 'assistant', contentText: 'two', sequence: 20 },
      { messageKey: 'm3', role: 'user', contentText: 'three', sequence: 30 },
    ]);

    await syncConversationMessages(id, [{ messageKey: 'm1', role: 'user', contentText: 'one', sequence: 10 }], {
      mode: 'append',
      diff: { added: ['m1'], updated: [], removed: [] },
    });

    expect((await getMessagesByConversationId(id)).map(({ messageKey, sequence }) => [messageKey, sequence])).toEqual([
      ['m1', 10],
      ['m2', 20],
      ['m3', 30],
    ]);
  });

  it('lets explicit replace clear stale markdown in append and snapshot modes', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'clear_markdown',
      title: 'Clear',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'assistant', contentText: 'old', contentMarkdown: '**old**', sequence: 0 },
    ]);

    await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'assistant', contentText: 'append plain', contentMarkdown: '', sequence: 0 }],
      { mode: 'append', diff: { added: [], updated: ['m1'], removed: [] } },
    );
    expect((await getMessagesByConversationId(id))[0].contentMarkdown).toBe('');

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'assistant', contentText: 'snapshot plain', contentMarkdown: '', sequence: 0 },
    ]);
    expect((await getMessagesByConversationId(id))[0].contentMarkdown).toBe('');
  });

  it('preserves existing markdown for protective append merge policy', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_preserve_markdown',
      title: 'Merge',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      {
        messageKey: 'm1',
        role: 'assistant',
        contentText: 'old text',
        contentMarkdown: '![rich](data:image/png;base64,abc)',
        sequence: 5,
        updatedAt: 10,
      },
    ]);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'new text',
          contentMarkdown: 'plain fallback',
          sequence: 0,
          updatedAt: 20,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-markdown',
        },
      ],
      { mode: 'append', diff: { added: [], updated: ['m1'], removed: [] } },
    );

    const [stored] = await getMessagesByConversationId(id);
    expect(stored).toMatchObject({
      contentText: 'new text',
      contentMarkdown: '![rich](data:image/png;base64,abc)',
      sequence: 5,
      updatedAt: 20,
    });
    expect(stored).not.toHaveProperty('captureMergePolicy');
    expect(stored).not.toHaveProperty('captureSequencePolicy');
  });

  it('allows a later complete AI image snapshot to replace an earlier protected fallback', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'googleaistudio',
      conversationKey: 'image_fallback_recovery',
      title: 'Images',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'fallback',
          contentMarkdown: 'fallback',
          sequence: 0,
          captureMergePolicy: 'preserve-existing-markdown',
        },
      ],
      { mode: 'append', diff: { added: ['m1'], updated: [], removed: [] } },
    );

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'complete',
          contentMarkdown: 'complete\n\n![](syncnos-asset://asset-1)',
          sequence: 0,
        },
      ],
      { mode: 'snapshot', diff: null },
    );

    const [stored] = await getMessagesByConversationId(id);
    expect(stored).toMatchObject({
      contentText: 'complete',
      contentMarkdown: 'complete\n\n![](syncnos-asset://asset-1)',
    });
    expect(stored).not.toHaveProperty('captureMergePolicy');
  });

  it('preserves existing content and zero timestamp while allowing first-time protective insert', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'append_preserve_content',
      title: 'Merge',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      {
        messageKey: 'm1',
        role: 'assistant',
        contentText: 'hydrated report',
        contentMarkdown: '# Hydrated report',
        sequence: 3,
        updatedAt: 0,
      },
    ]);

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'm1',
          role: 'assistant',
          contentText: 'placeholder',
          contentMarkdown: 'placeholder',
          sequence: 0,
          updatedAt: 20,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-content',
        },
        {
          messageKey: 'm2',
          role: 'assistant',
          contentText: 'first placeholder',
          contentMarkdown: 'first placeholder',
          sequence: 0,
          updatedAt: 30,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-content',
        },
      ],
      { mode: 'append', diff: { added: ['m2'], updated: ['m1'], removed: [] } },
    );

    const stored = await getMessagesByConversationId(id);
    expect(stored[0]).toMatchObject({
      messageKey: 'm1',
      contentText: 'hydrated report',
      contentMarkdown: '# Hydrated report',
      sequence: 3,
      updatedAt: 0,
    });
    expect(stored[1]).toMatchObject({
      messageKey: 'm2',
      contentText: 'first placeholder',
      contentMarkdown: 'first placeholder',
      sequence: 4,
      updatedAt: 30,
    });
  });

  it('keeps hydrated Deep Research content while inserting a first-time placeholder', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'deep_research_merge',
      title: 'Research',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      {
        messageKey: 'research-1',
        role: 'assistant',
        contentText: 'Complete report',
        contentMarkdown: '# Complete report',
        sequence: 0,
        updatedAt: 10,
      },
    ]);
    const placeholder = 'Deep Research (iframe): https://example.web-sandbox.oaiusercontent.com/report';

    await syncConversationMessages(
      id,
      [
        {
          messageKey: 'research-1',
          role: 'assistant',
          contentText: placeholder,
          contentMarkdown: placeholder,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-content',
        },
        {
          messageKey: 'research-2',
          role: 'assistant',
          contentText: placeholder,
          contentMarkdown: placeholder,
          captureSequencePolicy: 'preserve-existing-tail',
          captureMergePolicy: 'preserve-existing-content',
        },
      ],
      { mode: 'append', diff: { added: ['research-2'], updated: ['research-1'], removed: [] } },
    );

    const stored = await getMessagesByConversationId(id);
    expect(stored[0]).toMatchObject({ contentText: 'Complete report', contentMarkdown: '# Complete report' });
    expect(stored[1]).toMatchObject({ contentText: placeholder, contentMarkdown: placeholder });
  });

  it('reads message tails by conversation id with ascending sequence order', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'tail_k1',
      title: 'Tail',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(
      id,
      Array.from({ length: 300 }, (_, index) => {
        const sequence = index + 1;
        return {
          messageKey: `tail_${sequence}`,
          role: sequence % 2 === 0 ? 'assistant' : 'user',
          contentText: `content_${sequence}`,
          sequence,
          updatedAt: sequence,
        };
      }),
    );

    const tail = await getMessagesTailByConversationId(id, 200);
    expect(tail).toHaveLength(200);
    expect(tail[0]?.sequence).toBe(101);
    expect(tail[199]?.sequence).toBe(300);
    expect(tail[0]?.messageKey).toBe('tail_101');
    expect(tail[199]?.messageKey).toBe('tail_300');
  });

  it('reads conversation tail window by source and key', async () => {
    const missing = await getConversationTailWindowBySourceAndKey('debug', 'missing', 200);
    expect(missing.conversation).toBeNull();
    expect(missing.messages).toEqual([]);

    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'tail_window_k1',
      title: 'Window',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(
      id,
      Array.from({ length: 300 }, (_, index) => {
        const sequence = index + 1;
        return {
          messageKey: `window_${sequence}`,
          role: sequence % 2 === 0 ? 'assistant' : 'user',
          contentText: `content_${sequence}`,
          sequence,
          updatedAt: sequence,
        };
      }),
    );

    const windowResult = await getConversationTailWindowBySourceAndKey('debug', 'tail_window_k1', 200);
    expect(windowResult.conversation?.id).toBe(id);
    expect(windowResult.messages).toHaveLength(200);
    expect(windowResult.messages[0]?.sequence).toBe(101);
    expect(windowResult.messages[199]?.sequence).toBe(300);
  });

  it('patches mapping nested state through one writer and keeps mapping identity stable', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'mapping-patch',
      title: 'Mapping patch',
      notionPageId: 'page-1',
      lastCapturedAt: 1,
    });
    const conversationId = Number(convo.id);

    const db = await openDb();
    const seedTx = db.transaction(['sync_mappings'], 'readwrite');
    const mappingId = await reqToPromise<number>(
      seedTx.objectStore('sync_mappings').add({
        source: 'debug',
        conversationKey: 'mapping-patch',
        notionPageId: 'page-1',
        notionSections: {
          conversations: { headingBlockId: 'h-old', stable: true },
          comments: { headingBlockId: 'h-comments' },
        },
        notionSectionCursors: {
          conversations: { lastSyncedMessageKey: 'm1', lastSyncedSequence: 1 },
        },
        notionSectionDigests: {
          article: { digest: 'd-old', lastSyncedAt: 10 },
        },
        updatedAt: 10,
      }) as any,
    );
    await txDone(seedTx);

    await patchSyncMapping(conversationId, {
      notionSections: { conversations: { headingBlockId: 'h-new' } },
      notionSectionCursors: { conversations: { lastSyncedSequence: 2 } },
      notionSectionDigests: { comments: { digest: 'd-comments', lastSyncedAt: 20 } },
      feishuDocId: 'doc-1',
      feishuLastContentHash: 'hash-1',
    });

    const afterPatch = await getSyncMappingByConversation(conversationId);
    expect(afterPatch?.mapping).toMatchObject({
      id: mappingId,
      source: 'debug',
      conversationKey: 'mapping-patch',
      notionPageId: 'page-1',
      notionSections: {
        conversations: { headingBlockId: 'h-new', stable: true },
        comments: { headingBlockId: 'h-comments' },
      },
      notionSectionCursors: {
        conversations: { lastSyncedMessageKey: 'm1', lastSyncedSequence: 2 },
      },
      notionSectionDigests: {
        article: { digest: 'd-old', lastSyncedAt: 10 },
        comments: { digest: 'd-comments', lastSyncedAt: 20 },
      },
      feishuDocId: 'doc-1',
      feishuLastContentHash: 'hash-1',
    });
    expect(afterPatch?.conversation.feishuDocId).toBe('doc-1');

    const beforeCursorUpdatedAt = Number(afterPatch?.mapping?.updatedAt) || 0;
    await setSyncCursor(conversationId, {
      lastSyncedMessageKey: 'm2',
      lastSyncedSequence: null,
      lastSyncedAt: null,
      lastSyncedMessageUpdatedAt: null,
      notionSectionCursors: {
        conversations: { lastSyncedMessageKey: 'm2', lastSyncedSequence: 2 },
      },
    });

    const afterCursor = await getSyncMappingByConversation(conversationId);
    expect(afterCursor?.mapping).toMatchObject({
      id: mappingId,
      source: 'debug',
      conversationKey: 'mapping-patch',
      lastSyncedMessageKey: 'm2',
      lastSyncedSequence: null,
      lastSyncedMessageUpdatedAt: null,
      notionSections: {
        conversations: { headingBlockId: 'h-new', stable: true },
        comments: { headingBlockId: 'h-comments' },
      },
      notionSectionCursors: {
        conversations: { lastSyncedMessageKey: 'm2', lastSyncedSequence: 2 },
      },
      notionSectionDigests: {
        article: { digest: 'd-old', lastSyncedAt: 10 },
        comments: { digest: 'd-comments', lastSyncedAt: 20 },
      },
    });
    expect(Number(afterCursor?.mapping?.lastSyncedAt)).toBeGreaterThan(0);
    expect(Number(afterCursor?.mapping?.updatedAt)).toBeGreaterThanOrEqual(beforeCursorUpdatedAt);
  });

  it('keeps audit metadata and absent provider targets stable for business-equivalent mapping patches', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'mapping-business-noop',
      title: 'Mapping business no-op',
      lastCapturedAt: 1,
    });
    const conversationId = Number(convo.id);
    const db = await openDb();
    const seedTx = db.transaction(['sync_mappings'], 'readwrite');
    await reqToPromise(
      seedTx.objectStore('sync_mappings').add({
        source: 'debug',
        conversationKey: 'mapping-business-noop',
        customMetadata: 'same',
        updatedAt: 123,
      }),
    );
    await txDone(seedTx);

    const conversationsBefore = await readDataRevision('conversations');
    const mappingsBefore = await readDataRevision('sync_mappings');
    await patchSyncMapping(conversationId, { customMetadata: 'same' });

    const unchanged = await getSyncMappingByConversation(conversationId);
    expect(unchanged?.mapping?.updatedAt).toBe(123);
    expect(Object.prototype.hasOwnProperty.call(unchanged?.mapping || {}, 'notionPageId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(unchanged?.mapping || {}, 'feishuDocId')).toBe(false);
    expect(await readDataRevision('conversations')).toBe(conversationsBefore);
    expect(await readDataRevision('sync_mappings')).toBe(mappingsBefore);

    await patchSyncMapping(conversationId, { customMetadata: 'changed' });
    const changed = await getSyncMappingByConversation(conversationId);
    expect(changed?.mapping?.customMetadata).toBe('changed');
    expect(Object.prototype.hasOwnProperty.call(changed?.mapping || {}, 'notionPageId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(changed?.mapping || {}, 'feishuDocId')).toBe(false);
    expect(await readDataRevision('conversations')).toBe(conversationsBefore);
    expect(await readDataRevision('sync_mappings')).toBe(mappingsBefore + 1);
  });

  it('repairs a conversation provider mirror without rewriting an equivalent mapping', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'mapping-mirror-only',
      title: 'Mapping mirror only',
      lastCapturedAt: 1,
    });
    const conversationId = Number(convo.id);
    const db = await openDb();
    const seedTx = db.transaction(['sync_mappings'], 'readwrite');
    await reqToPromise(
      seedTx.objectStore('sync_mappings').add({
        source: 'debug',
        conversationKey: 'mapping-mirror-only',
        feishuDocId: 'doc-existing',
        updatedAt: 321,
      }),
    );
    await txDone(seedTx);

    const conversationsBefore = await readDataRevision('conversations');
    const mappingsBefore = await readDataRevision('sync_mappings');
    await patchSyncMapping(conversationId, { feishuDocId: 'doc-existing' });

    const after = await getSyncMappingByConversation(conversationId);
    expect(after?.mapping?.updatedAt).toBe(321);
    expect(after?.mapping?.feishuDocId).toBe('doc-existing');
    expect(after?.conversation?.feishuDocId).toBe('doc-existing');
    expect(await readDataRevision('conversations')).toBe(conversationsBefore + 1);
    expect(await readDataRevision('sync_mappings')).toBe(mappingsBefore);
  });

  it('generates a strictly newer implicit sync baseline and keeps an explicit identical cursor stable', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'cursor-baseline-monotonic',
      title: 'Cursor baseline',
      lastCapturedAt: 1,
    });
    const conversationId = Number(convo.id);
    const previousBaseline = 9_000_000_000_000;
    const db = await openDb();
    const seedTx = db.transaction(['sync_mappings'], 'readwrite');
    await reqToPromise(
      seedTx.objectStore('sync_mappings').add({
        source: 'debug',
        conversationKey: 'cursor-baseline-monotonic',
        lastSyncedMessageKey: 'm1',
        lastSyncedSequence: 1,
        lastSyncedAt: previousBaseline,
        lastSyncedMessageUpdatedAt: 2,
        updatedAt: 50,
      }),
    );
    await txDone(seedTx);

    const mappingsBefore = await readDataRevision('sync_mappings');
    await setSyncCursor(conversationId, {
      lastSyncedMessageKey: 'm1',
      lastSyncedSequence: 1,
      lastSyncedMessageUpdatedAt: 2,
    });
    const generated = await getSyncMappingByConversation(conversationId);
    expect(generated?.mapping?.lastSyncedAt).toBe(previousBaseline + 1);
    expect(await readDataRevision('sync_mappings')).toBe(mappingsBefore + 1);

    const generatedUpdatedAt = generated?.mapping?.updatedAt;
    await setSyncCursor(conversationId, {
      lastSyncedMessageKey: 'm1',
      lastSyncedSequence: 1,
      lastSyncedAt: previousBaseline + 1,
      lastSyncedMessageUpdatedAt: 2,
    });
    const explicitNoop = await getSyncMappingByConversation(conversationId);
    expect(explicitNoop?.mapping?.updatedAt).toBe(generatedUpdatedAt);
    expect(await readDataRevision('sync_mappings')).toBe(mappingsBefore + 1);
  });

  it('resets stale Notion continuity when the destination page changes and keeps the same mapping identity', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'page-switch',
      title: 'Page switch',
      notionPageId: 'page-old',
      lastCapturedAt: 1,
    });
    const conversationId = Number(convo.id);

    await patchSyncMapping(conversationId, {
      notionPageId: 'page-old',
      notionPageUrl: 'https://notion.so/page-old',
      notionWorkspaceSlug: 'old-workspace',
      lastSyncedMessageKey: 'm5',
      lastSyncedSequence: 5,
      lastSyncedAt: 50,
      lastSyncedMessageUpdatedAt: 55,
      notionSections: { conversations: { headingBlockId: 'h-old' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'm5', lastSyncedSequence: 5 } },
      notionSectionDigests: { article: { digest: 'd-old' } },
      feishuDocId: 'doc-1',
      unknownMetadata: 'keep-me',
    });
    const before = await getSyncMappingByConversation(conversationId);
    const mappingId = Number(before?.mapping?.id);

    await setConversationNotionPageId(conversationId, 'page-old', {
      notionPageUrl: 'https://notion.so/page-old-refreshed',
      notionWorkspaceSlug: 'old-workspace-refreshed',
    });
    const samePage = await getSyncMappingByConversation(conversationId);
    expect(samePage?.mapping).toMatchObject({
      id: mappingId,
      notionPageId: 'page-old',
      notionPageUrl: 'https://notion.so/page-old-refreshed',
      notionWorkspaceSlug: 'old-workspace-refreshed',
      lastSyncedMessageKey: 'm5',
      lastSyncedSequence: 5,
      notionSections: { conversations: { headingBlockId: 'h-old' } },
    });

    await setConversationNotionPageId(conversationId, 'page-new', {
      notionPageUrl: 'https://notion.so/page-new',
      notionWorkspaceSlug: 'new-workspace',
    });

    const after = await getSyncMappingByConversation(conversationId);
    expect(after?.mapping).toMatchObject({
      id: mappingId,
      source: 'debug',
      conversationKey: 'page-switch',
      notionPageId: 'page-new',
      notionPageUrl: 'https://notion.so/page-new',
      notionWorkspaceSlug: 'new-workspace',
      feishuDocId: 'doc-1',
      unknownMetadata: 'keep-me',
    });
    expect(after?.mapping?.lastSyncedMessageKey).toBeUndefined();
    expect(after?.mapping?.lastSyncedSequence).toBeUndefined();
    expect(after?.mapping?.lastSyncedAt).toBeUndefined();
    expect(after?.mapping?.lastSyncedMessageUpdatedAt).toBeUndefined();
    expect(after?.mapping?.notionSections).toBeUndefined();
    expect(after?.mapping?.notionSectionCursors).toBeUndefined();
    expect(after?.mapping?.notionSectionDigests).toBeUndefined();
    expect(after?.conversation).toMatchObject({
      notionPageId: 'page-new',
      notionPageUrl: 'https://notion.so/page-new',
      notionWorkspaceSlug: 'new-workspace',
    });
  });

  it('uses the conversation Notion mirror as the current target when an old mapping is missing notionPageId', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'page-switch-missing-mapping-page',
      title: 'Page switch legacy state',
      notionPageId: 'page-old',
      lastCapturedAt: 1,
    });
    const conversationId = Number(convo.id);

    const db = await openDb();
    const tx = db.transaction(['sync_mappings'], 'readwrite');
    await reqToPromise(
      tx.objectStore('sync_mappings').add({
        source: 'debug',
        conversationKey: 'page-switch-missing-mapping-page',
        lastSyncedMessageKey: 'm5',
        lastSyncedSequence: 5,
        notionSections: { conversations: { headingBlockId: 'h-old' } },
        notionSectionCursors: { conversations: { lastSyncedMessageKey: 'm5', lastSyncedSequence: 5 } },
        unknownMetadata: 'keep-me',
      }),
    );
    await txDone(tx);

    await setConversationNotionPageId(conversationId, 'page-new');

    const after = await getSyncMappingByConversation(conversationId);
    expect(after?.mapping).toMatchObject({
      notionPageId: 'page-new',
      unknownMetadata: 'keep-me',
    });
    expect(after?.mapping?.lastSyncedMessageKey).toBeUndefined();
    expect(after?.mapping?.lastSyncedSequence).toBeUndefined();
    expect(after?.mapping?.notionSections).toBeUndefined();
    expect(after?.mapping?.notionSectionCursors).toBeUndefined();
  });

  it('resets stale Feishu hash when the destination doc changes and mirrors explicit clears', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'feishu-doc-switch',
      title: 'Feishu doc switch',
      feishuDocId: 'doc-old',
      lastCapturedAt: 1,
    });
    const conversationId = Number(convo.id);

    await patchSyncMapping(conversationId, {
      feishuDocId: 'doc-old',
      feishuLastContentHash: 'hash-old',
      notionPageId: 'page-1',
      unknownMetadata: 'keep-me',
    });
    const before = await getSyncMappingByConversation(conversationId);
    const mappingId = Number(before?.mapping?.id);

    await patchSyncMapping(conversationId, { feishuDocId: 'doc-new' });
    const changed = await getSyncMappingByConversation(conversationId);
    expect(changed?.mapping).toMatchObject({
      id: mappingId,
      feishuDocId: 'doc-new',
      notionPageId: 'page-1',
      unknownMetadata: 'keep-me',
    });
    expect(changed?.mapping?.feishuLastContentHash).toBeUndefined();
    expect(changed?.conversation?.feishuDocId).toBe('doc-new');

    await patchSyncMapping(conversationId, { feishuDocId: '' });
    const cleared = await getSyncMappingByConversation(conversationId);
    expect(cleared?.mapping?.feishuDocId).toBe('');
    expect(cleared?.mapping?.feishuLastContentHash).toBeUndefined();
    expect(cleared?.conversation?.feishuDocId).toBe('');
  });

  it('deletes conversations, messages, and sync mappings', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
    ]);

    // Insert a mapping directly.
    const db = await openDb();
    const t = db.transaction(['sync_mappings'], 'readwrite');
    const store = t.objectStore('sync_mappings');
    await reqToPromise(
      store.add({ source: 'debug', conversationKey: 'k1', notionPageId: 'p1', updatedAt: Date.now() }),
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error || new Error('tx failed'));
      t.onabort = () => reject(t.error || new Error('tx aborted'));
    });

    const res = await deleteConversationsByIds([id]);
    expect(res.deletedConversations).toBe(1);
    expect(res.deletedMessages).toBe(1);
    expect(res.deletedMappings).toBe(1);

    const items = await listAllConversationsForTests();
    expect(items.length).toBe(0);

    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['github_cleanup_outbox'], 'readonly');
    expect(await reqToPromise(verifyTx.objectStore('github_cleanup_outbox').count())).toBe(0);
    await txDone(verifyTx);
  });

  it('advances each affected scope once when deleting an article with messages, mapping, image, and comments', async () => {
    const canonicalUrl = 'https://example.com/delete-revisions';
    const convo = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: `article:${canonicalUrl}`,
      title: 'Delete revisions',
      url: canonicalUrl,
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'delete me', sequence: 1, updatedAt: 1 },
    ]);
    await seedImageCacheRow({
      conversationId: id,
      url: 'https://example.com/delete.png',
      blob: new Blob(['image'], { type: 'image/png' }),
      byteSize: 5,
    });

    const db = await openDb();
    const seedTx = db.transaction(['sync_mappings', 'article_comments'], 'readwrite');
    await reqToPromise(
      seedTx.objectStore('sync_mappings').add({
        source: 'web',
        conversationKey: `article:${canonicalUrl}`,
        notionPageId: 'page-delete',
      }),
    );
    const commentId = await reqToPromise<number>(
      seedTx.objectStore('article_comments').add({
        parentId: null,
        conversationId: id,
        canonicalUrl,
        quoteText: '',
        commentText: 'detach me',
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    await txDone(seedTx);

    const before = {
      conversations: await readDataRevision('conversations'),
      messages: await readDataRevision('messages'),
      sync_mappings: await readDataRevision('sync_mappings'),
      image_cache: await readDataRevision('image_cache'),
      article_comments: await readDataRevision('article_comments'),
    };

    const result = await deleteConversationsByIds([id]);
    expect(result).toEqual({
      deletedConversations: 1,
      deletedMessages: 1,
      deletedMappings: 1,
      deletedImageCache: 1,
    });
    expect(await readDataRevision('conversations')).toBe(before.conversations + 1);
    expect(await readDataRevision('messages')).toBe(before.messages + 1);
    expect(await readDataRevision('sync_mappings')).toBe(before.sync_mappings + 1);
    expect(await readDataRevision('image_cache')).toBe(before.image_cache + 1);
    expect(await readDataRevision('article_comments')).toBe(before.article_comments + 1);

    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['article_comments'], 'readonly');
    const detached = await reqToPromise<any>(verifyTx.objectStore('article_comments').get(commentId));
    await txDone(verifyTx);
    expect(detached).toMatchObject({ id: commentId, conversationId: null, canonicalUrl });
  });

  it('atomically enqueues only identity-owned GitHub managed paths before deleting local facts', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'github-delete',
      title: 'GitHub delete',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    const basename = buildConversationBasename(convo);
    const notePath = `AIChats/${basename}.md`;
    const assetPath = `AIChats/${basename}.assets/${'a'.repeat(64)}.png`;
    const metadata = { sha: 'b'.repeat(40), contentHash: 'c'.repeat(64) };
    await patchSyncMapping(id, {
      githubRemoteKey: 'github.com/owner/repo@main',
      githubManagedFiles: {
        [notePath]: { ...metadata, kind: 'markdown' },
        [assetPath]: { ...metadata, kind: 'asset' },
        'README.md': { ...metadata, kind: 'markdown' },
        [`OtherFolder/${basename}.md`]: { ...metadata, kind: 'markdown' },
        'AIChats/other-0000000000.md': { ...metadata, kind: 'markdown' },
        [`AIChats/${basename}.assets/not-a-content-hash.png`]: { ...metadata, kind: 'asset' },
      },
      githubProjectionFingerprint: 'd'.repeat(64),
      githubLastSyncedAt: 10,
    });

    await deleteConversationsByIds([id]);

    expect(await getConversationById(id)).toBeNull();
    expect(await getSyncMappingByConversation(id)).toBeNull();
    const db = await openDb();
    const tx = db.transaction(['github_cleanup_outbox'], 'readonly');
    const rows = await reqToPromise<any[]>(tx.objectStore('github_cleanup_outbox').getAll());
    await txDone(tx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      remoteKey: 'github.com/owner/repo@main',
      paths: [assetPath, notePath].sort(),
      reason: 'delete',
    });
    expect(rows[0].nextAttemptAt).toBe(rows[0].createdAt);
  });

  it('keeps article comment trees as orphans on delete and allows canonical-url reattach', async () => {
    const canonicalUrl = 'https://example.com/article';
    const convo = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: `article:${canonicalUrl}`,
      title: 'Article',
      url: canonicalUrl,
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    const db = await openDb();
    const tx = db.transaction(['article_comments'], 'readwrite');
    const store = tx.objectStore('article_comments');
    const parentId = await reqToPromise<number>(
      store.add({
        parentId: null,
        conversationId: id,
        canonicalUrl,
        quoteText: 'quote',
        commentText: 'parent',
        locator: { kind: 'text_quote', exact: 'quote' },
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    const replyId = await reqToPromise<number>(
      store.add({
        parentId,
        conversationId: id,
        canonicalUrl,
        quoteText: '',
        commentText: 'reply',
        createdAt: 2,
        updatedAt: 2,
      }) as any,
    );
    await txDone(tx);

    await deleteConversationsByIds([id]);

    const orphanDb = await openDb();
    const orphanTx = orphanDb.transaction(['article_comments'], 'readonly');
    const orphans = await reqToPromise<any[]>(orphanTx.objectStore('article_comments').getAll());
    await txDone(orphanTx);
    expect(orphans).toHaveLength(2);
    expect(orphans.map((row) => row.conversationId)).toEqual([null, null]);
    expect(orphans.find((row) => row.id === replyId)?.parentId).toBe(parentId);
    expect(orphans.find((row) => row.id === parentId)).toMatchObject({
      canonicalUrl,
      quoteText: 'quote',
      commentText: 'parent',
      locator: { kind: 'text_quote', exact: 'quote' },
    });

    const replacement = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: `article:${canonicalUrl}`,
      title: 'Article restored',
      url: canonicalUrl,
      lastCapturedAt: 2,
    });
    const replacementId = Number(replacement.id);
    await expect(attachOrphanCommentsToConversation(canonicalUrl, replacementId)).resolves.toEqual({ updated: 2 });
    const attached = await listArticleCommentsByConversationId(replacementId);
    expect(attached.map((row) => row.id).sort((a, b) => a - b)).toEqual([parentId, replyId]);
    expect(attached.find((row) => row.id === replyId)?.parentId).toBe(parentId);
  });

  it('does not enqueue corrupt imported GitHub ownership claims', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'corrupt-github-delete',
      title: 'Corrupt',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    const stableId = stableConversationId10(convo);
    const metadata = { sha: 'a'.repeat(40), contentHash: 'b'.repeat(64) };
    await patchSyncMapping(id, {
      githubRemoteKey: 'github.com/owner/repo@main',
      githubManagedFiles: {
        'README.md': { ...metadata, kind: 'markdown' },
        'AIChats/another-0000000000.md': { ...metadata, kind: 'markdown' },
        [`AIChats/debug-Corrupt-${stableId}.assets/image.png`]: { ...metadata, kind: 'asset' },
      },
    });

    await deleteConversationsByIds([id]);
    const db = await openDb();
    const tx = db.transaction(['github_cleanup_outbox'], 'readonly');
    expect(await reqToPromise(tx.objectStore('github_cleanup_outbox').count())).toBe(0);
    await txDone(tx);
  });

  it('aborts conversation delete if cleanup enqueue fails, preserving conversation mapping and comments', async () => {
    const canonicalUrl = 'https://example.com/abort';
    const convo = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: `article:${canonicalUrl}`,
      title: 'Abort delete',
      url: canonicalUrl,
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);
    await patchSyncMapping(id, {
      githubRemoteKey: 'github.com/owner/repo@main',
      githubManagedFiles: {
        [`WebArticles/${buildConversationBasename(convo)}.md`]: {
          kind: 'markdown',
          sha: 'a'.repeat(40),
          contentHash: 'b'.repeat(64),
        },
      },
    });
    const db = await openDb();
    const commentTx = db.transaction(['article_comments'], 'readwrite');
    await reqToPromise(
      commentTx.objectStore('article_comments').add({
        parentId: null,
        conversationId: id,
        canonicalUrl,
        quoteText: '',
        commentText: 'must survive',
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await txDone(commentTx);
    const revisionsBeforeFailure = {
      conversations: await readDataRevision('conversations'),
      messages: await readDataRevision('messages'),
      sync_mappings: await readDataRevision('sync_mappings'),
      image_cache: await readDataRevision('image_cache'),
      article_comments: await readDataRevision('article_comments'),
    };
    const probeTx = db.transaction(['github_cleanup_outbox'], 'readonly');
    const prototype = Object.getPrototypeOf(probeTx.objectStore('github_cleanup_outbox')) as any;
    const originalAdd = prototype.add;
    await txDone(probeTx);

    prototype.add = function add(value: unknown, key?: IDBValidKey) {
      if (this.name === 'github_cleanup_outbox') throw new DOMException('forced outbox failure', 'DataError');
      return originalAdd.call(this, value, key);
    };
    try {
      await expect(deleteConversationsByIds([id])).rejects.toThrow();
    } finally {
      prototype.add = originalAdd;
    }

    expect(await getConversationById(id)).not.toBeNull();
    expect((await getSyncMappingByConversation(id))?.mapping?.githubRemoteKey).toBe('github.com/owner/repo@main');
    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['article_comments', 'github_cleanup_outbox'], 'readonly');
    const comments = await reqToPromise<any[]>(verifyTx.objectStore('article_comments').getAll());
    expect(comments).toHaveLength(1);
    expect(comments[0]?.conversationId).toBe(id);
    expect(await reqToPromise(verifyTx.objectStore('github_cleanup_outbox').count())).toBe(0);
    await txDone(verifyTx);
    expect(await readDataRevision('conversations')).toBe(revisionsBeforeFailure.conversations);
    expect(await readDataRevision('messages')).toBe(revisionsBeforeFailure.messages);
    expect(await readDataRevision('sync_mappings')).toBe(revisionsBeforeFailure.sync_mappings);
    expect(await readDataRevision('image_cache')).toBe(revisionsBeforeFailure.image_cache);
    expect(await readDataRevision('article_comments')).toBe(revisionsBeforeFailure.article_comments);
  });

  it('rewrites an explicit article identity atomically while migrating owned and orphan comments', async () => {
    const oldUrl = 'https://example.com/old-identity';
    const nextUrl = 'https://example.com/new-identity';
    const existing = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: `article:${oldUrl}`,
      title: 'Old identity',
      url: oldUrl,
      lastCapturedAt: 1,
    });
    const other = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/other-owner',
      title: 'Other owner',
      url: 'https://example.com/other-owner',
      lastCapturedAt: 1,
    });
    const existingId = Number(existing.id);
    const otherId = Number(other.id);
    const oldPath = `WebArticles/${buildConversationBasename(existing)}.md`;
    await patchSyncMapping(existingId, {
      githubRemoteKey: 'github.com/owner/repo@main',
      githubManagedFiles: {
        [oldPath]: {
          kind: 'markdown',
          sha: 'a'.repeat(40),
          contentHash: 'b'.repeat(64),
        },
      },
      githubProjectionFingerprint: 'c'.repeat(64),
      githubLastSyncedAt: 10,
    });

    const db = await openDb();
    const commentTx = db.transaction(['article_comments'], 'readwrite');
    const comments = commentTx.objectStore('article_comments');
    const ownedId = await reqToPromise<number>(
      comments.add({
        parentId: null,
        conversationId: existingId,
        canonicalUrl: oldUrl,
        quoteText: 'owned quote',
        commentText: 'owned',
        locator: { kind: 'text_quote', exact: 'owned quote' },
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    const orphanId = await reqToPromise<number>(
      comments.add({
        parentId: null,
        conversationId: null,
        canonicalUrl: oldUrl,
        quoteText: 'orphan quote',
        commentText: 'orphan',
        createdAt: 2,
        updatedAt: 2,
      }) as any,
    );
    const otherIdComment = await reqToPromise<number>(
      comments.add({
        parentId: null,
        conversationId: otherId,
        canonicalUrl: oldUrl,
        quoteText: 'other quote',
        commentText: 'other',
        createdAt: 3,
        updatedAt: 3,
      }) as any,
    );
    await txDone(commentTx);

    const revisionsBeforeRewrite = {
      conversations: await readDataRevision('conversations'),
      syncMappings: await readDataRevision('sync_mappings'),
      articleComments: await readDataRevision('article_comments'),
    };

    const rewritten = await upsertConversation({
      id: existingId,
      sourceType: 'article',
      source: 'web',
      conversationKey: String(existing.conversationKey),
      title: 'New identity',
      url: nextUrl,
      lastCapturedAt: 2,
    });

    expect(Number(rewritten.id)).toBe(existingId);
    expect(rewritten.url).toBe(nextUrl);
    expect(rewritten.conversationKey).toBe(`article:${nextUrl}`);
    const movedMapping = await getSyncMappingByConversation(existingId);
    expect(movedMapping?.mapping?.githubRemoteKey).toBeUndefined();
    expect(movedMapping?.mapping?.githubManagedFiles).toBeUndefined();

    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['article_comments', 'github_cleanup_outbox'], 'readonly');
    const commentRows = await reqToPromise<any[]>(verifyTx.objectStore('article_comments').getAll());
    const cleanupRows = await reqToPromise<any[]>(verifyTx.objectStore('github_cleanup_outbox').getAll());
    await txDone(verifyTx);

    expect(commentRows.find((row) => row.id === ownedId)).toMatchObject({
      conversationId: existingId,
      canonicalUrl: nextUrl,
      quoteText: 'owned quote',
      locator: { kind: 'text_quote', exact: 'owned quote' },
    });
    expect(commentRows.find((row) => row.id === orphanId)).toMatchObject({
      conversationId: null,
      canonicalUrl: nextUrl,
      commentText: 'orphan',
    });
    expect(commentRows.find((row) => row.id === otherIdComment)).toMatchObject({
      conversationId: otherId,
      canonicalUrl: oldUrl,
      commentText: 'other',
    });
    expect(cleanupRows).toHaveLength(1);
    expect(cleanupRows[0]).toMatchObject({
      remoteKey: 'github.com/owner/repo@main',
      paths: [oldPath],
      reason: 'identity_move',
      replacementConversationId: existingId,
    });
    expect(cleanupRows[0].nextAttemptAt).toBe(cleanupRows[0].createdAt);
    expect(await readDataRevision('conversations')).toBe(revisionsBeforeRewrite.conversations + 1);
    expect(await readDataRevision('sync_mappings')).toBe(revisionsBeforeRewrite.syncMappings + 1);
    expect(await readDataRevision('article_comments')).toBe(revisionsBeforeRewrite.articleComments + 1);
  });

  it('skips an equivalent canonical mapping put while still deleting the legacy identity row', async () => {
    const oldUrl = 'https://example.com/equivalent-mapping-old';
    const nextUrl = 'https://example.com/equivalent-mapping-new';
    const existing = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: `article:${oldUrl}`,
      title: 'Equivalent mapping',
      url: oldUrl,
      lastCapturedAt: 1,
    });
    const existingId = Number(existing.id);

    const db = await openDb();
    const seedTx = db.transaction(['sync_mappings'], 'readwrite');
    const mappings = seedTx.objectStore('sync_mappings');
    const sharedBusinessState = {
      notionPageId: 'page-1',
      notionPageUrl: 'https://notion.so/page-1',
      lastSyncedAt: 20,
      futureProviderMetadata: { nested: { a: 1, b: 2 } },
    };
    const legacyId = await reqToPromise<number>(
      mappings.add({
        source: 'web',
        conversationKey: `article:${oldUrl}`,
        ...sharedBusinessState,
        updatedAt: 1,
      }) as any,
    );
    const targetId = await reqToPromise<number>(
      mappings.add({
        conversationKey: `article:${nextUrl}`,
        source: 'web',
        futureProviderMetadata: { nested: { b: 2, a: 1 } },
        notionPageUrl: 'https://notion.so/page-1',
        notionPageId: 'page-1',
        lastSyncedAt: 20,
        updatedAt: 999,
      }) as any,
    );
    await txDone(seedTx);

    const probeTx = db.transaction(['sync_mappings'], 'readonly');
    const prototype = Object.getPrototypeOf(probeTx.objectStore('sync_mappings')) as any;
    const originalPut = prototype.put;
    await txDone(probeTx);

    prototype.put = function put(value: unknown, key?: IDBValidKey) {
      if (this.name === 'sync_mappings') throw new DOMException('equivalent mapping must not be put', 'DataError');
      return originalPut.call(this, value, key);
    };
    try {
      const rewritten = await upsertConversation({
        id: existingId,
        sourceType: 'article',
        source: 'web',
        conversationKey: `article:${oldUrl}`,
        title: 'Equivalent mapping rewritten',
        url: nextUrl,
        lastCapturedAt: 2,
      });
      expect(rewritten.conversationKey).toBe(`article:${nextUrl}`);
    } finally {
      prototype.put = originalPut;
    }

    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['sync_mappings'], 'readonly');
    const rows = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll());
    await txDone(verifyTx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: targetId,
      source: 'web',
      conversationKey: `article:${nextUrl}`,
      updatedAt: 999,
    });
    expect(rows.some((row) => Number(row.id) === Number(legacyId))).toBe(false);
  });

  it('aborts an article identity rewrite when GitHub cleanup enqueue fails', async () => {
    const oldUrl = 'https://example.com/rewrite-abort-old';
    const nextUrl = 'https://example.com/rewrite-abort-new';
    const existing = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: `article:${oldUrl}`,
      title: 'Rewrite abort',
      url: oldUrl,
      lastCapturedAt: 1,
    });
    const existingId = Number(existing.id);
    const oldPath = `WebArticles/${buildConversationBasename(existing)}.md`;
    await patchSyncMapping(existingId, {
      githubRemoteKey: 'github.com/owner/repo@main',
      githubManagedFiles: {
        [oldPath]: { kind: 'markdown', sha: 'a'.repeat(40), contentHash: 'b'.repeat(64) },
      },
    });
    const db = await openDb();
    const commentTx = db.transaction(['article_comments'], 'readwrite');
    await reqToPromise(
      commentTx.objectStore('article_comments').add({
        parentId: null,
        conversationId: existingId,
        canonicalUrl: oldUrl,
        quoteText: '',
        commentText: 'must stay old',
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await txDone(commentTx);
    const probeTx = db.transaction(['github_cleanup_outbox'], 'readonly');
    const prototype = Object.getPrototypeOf(probeTx.objectStore('github_cleanup_outbox')) as any;
    const originalAdd = prototype.add;
    await txDone(probeTx);

    prototype.add = function add(value: unknown, key?: IDBValidKey) {
      if (this.name === 'github_cleanup_outbox') throw new DOMException('forced identity outbox failure', 'DataError');
      return originalAdd.call(this, value, key);
    };
    try {
      await expect(
        upsertConversation({
          id: existingId,
          sourceType: 'article',
          source: 'web',
          conversationKey: String(existing.conversationKey),
          title: 'Rewrite abort new',
          url: nextUrl,
          lastCapturedAt: 2,
        }),
      ).rejects.toThrow();
    } finally {
      prototype.add = originalAdd;
    }

    const preserved = await getConversationById(existingId);
    expect(preserved).toMatchObject({ url: oldUrl, conversationKey: `article:${oldUrl}` });
    expect((await getSyncMappingByConversation(existingId))?.mapping).toMatchObject({
      githubRemoteKey: 'github.com/owner/repo@main',
      githubManagedFiles: { [oldPath]: expect.any(Object) },
    });
    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['article_comments', 'github_cleanup_outbox'], 'readonly');
    const rows = await reqToPromise<any[]>(verifyTx.objectStore('article_comments').getAll());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conversationId: existingId, canonicalUrl: oldUrl, commentText: 'must stay old' });
    expect(await reqToPromise(verifyTx.objectStore('github_cleanup_outbox').count())).toBe(0);
    await txDone(verifyTx);
  });

  it('reuses and rewrites legacy article conversation rows by normalized url', async () => {
    const db = await openDb();
    const t = db.transaction(['conversations', 'sync_mappings'], 'readwrite');
    const conversations = t.objectStore('conversations');
    const mappings = t.objectStore('sync_mappings');

    const legacyId = await reqToPromise<number>(
      conversations.add({
        sourceType: 'article',
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        title: 'Legacy title',
        url: 'https://example.com/post#frag',
        notionPageId: 'page_old',
        warningFlags: [],
        lastCapturedAt: 1,
      }),
    );

    await reqToPromise(
      mappings.add({
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        notionPageId: 'page_old',
        notionPageUrl: 'https://notion.so/page_old',
        notionWorkspaceSlug: 'legacy-ws',
        lastSyncedMessageKey: 'article_body',
        lastSyncedSequence: 1,
        lastSyncedAt: 10,
        lastSyncedMessageUpdatedAt: 9,
        notionSections: { article: { headingBlockId: 'h-article' }, comments: { headingBlockId: 'h-comments' } },
        notionSectionCursors: { conversations: { lastSyncedMessageKey: 'article_body', lastSyncedSequence: 1 } },
        notionSectionDigests: { article: { digest: 'd-article', lastSyncedAt: 10 } },
        feishuDocId: 'doc-old',
        feishuLastContentHash: 'hash-old',
        futureMetadata: { keep: true },
        updatedAt: 1,
      }),
    );
    await txDone(t);

    const conversation = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      title: 'New title',
      url: 'https://example.com/post',
      lastCapturedAt: 2,
    });

    expect(Number(conversation.id)).toBe(legacyId);
    expect(conversation.source).toBe('web');
    expect(conversation.conversationKey).toBe('article:https://example.com/post');
    expect(conversation.url).toBe('https://example.com/post');

    const reopened = await openDb();
    const verifyTx = reopened.transaction(['conversations', 'sync_mappings'], 'readonly');
    const verifyConversations = await reqToPromise<any[]>(verifyTx.objectStore('conversations').getAll());
    const verifyMappings = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll());
    await txDone(verifyTx);

    expect(verifyConversations).toHaveLength(1);
    expect(verifyConversations[0]).toMatchObject({
      id: legacyId,
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      url: 'https://example.com/post',
      notionPageId: 'page_old',
    });
    expect(verifyMappings).toHaveLength(1);
    expect(verifyMappings[0]).toMatchObject({
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      notionPageId: 'page_old',
      notionPageUrl: 'https://notion.so/page_old',
      notionWorkspaceSlug: 'legacy-ws',
      lastSyncedMessageKey: 'article_body',
      notionSections: { article: { headingBlockId: 'h-article' }, comments: { headingBlockId: 'h-comments' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'article_body', lastSyncedSequence: 1 } },
      notionSectionDigests: { article: { digest: 'd-article', lastSyncedAt: 10 } },
      feishuDocId: 'doc-old',
      feishuLastContentHash: 'hash-old',
      futureMetadata: { keep: true },
    });
  });

  it('merges conversations by ids and migrates messages + sync mappings', async () => {
    const keep = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'keep',
      title: '',
      url: 'https://example.com/a',
      notionPageId: '',
      warningFlags: ['w1'],
      lastCapturedAt: 10,
    });
    const remove = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'remove',
      title: 'From remove',
      url: 'https://example.com/b',
      notionPageId: 'page_remove',
      warningFlags: ['w2'],
      lastCapturedAt: 20,
    });
    const keepId = Number(keep.id);
    const removeId = Number(remove.id);
    const keepKey = String(keep.conversationKey || '');
    const removeKey = String(remove.conversationKey || '');

    await syncConversationMessages(removeId, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    const ownedLegacyPath = `WebArticles/${buildConversationBasename(remove)}.md`;
    const db = await openDb();
    const t = db.transaction(['sync_mappings', 'article_comments'], 'readwrite');
    await reqToPromise(
      t.objectStore('sync_mappings').add({
        source: 'web',
        conversationKey: removeKey,
        notionPageId: 'page_remove',
        notionPageUrl: 'https://notion.so/page_remove',
        lastSyncedMessageKey: 'x',
        lastSyncedSequence: 2,
        notionSections: { conversations: { headingBlockId: 'h-remove' } },
        notionSectionCursors: { conversations: { lastSyncedMessageKey: 'x', lastSyncedSequence: 2 } },
        feishuDocId: 'doc-remove',
        feishuLastContentHash: 'hash-remove',
        githubRemoteKey: 'github.com/owner/repo@main',
        githubManagedFiles: {
          [ownedLegacyPath]: { kind: 'markdown', sha: 'a'.repeat(40), contentHash: 'b'.repeat(64) },
          'README.md': { kind: 'markdown', sha: 'c'.repeat(40), contentHash: 'd'.repeat(64) },
        },
        githubProjectionFingerprint: 'e'.repeat(64),
        githubLastSyncedAt: 30,
        legacyOnly: true,
        updatedAt: 1,
      }),
    );
    const comments = t.objectStore('article_comments');
    const parentId = await reqToPromise<number>(
      comments.add({
        parentId: null,
        conversationId: removeId,
        canonicalUrl: String(remove.url),
        quoteText: 'merge quote',
        commentText: 'merge parent',
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    const replyId = await reqToPromise<number>(
      comments.add({
        parentId,
        conversationId: removeId,
        canonicalUrl: String(remove.url),
        quoteText: '',
        commentText: 'merge reply',
        createdAt: 2,
        updatedAt: 2,
      }) as any,
    );
    await txDone(t);

    const res = await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });
    expect(res.keptConversationId).toBe(keepId);
    expect(res.removedConversationId).toBe(removeId);
    expect(res.merged).toBe(true);

    const items = await listAllConversationsForTests();
    expect(items.map((c) => c.conversationKey)).toEqual([keepKey]);
    expect(items[0]).toMatchObject({
      conversationKey: keepKey,
      title: 'From remove',
      notionPageId: 'page_remove',
    });
    expect(items[0].warningFlags).toEqual(['w1', 'w2']);
    expect(Number(items[0].lastCapturedAt)).toBe(20);

    const moved = await getMessagesByConversationId(keepId);
    expect(moved.map((m) => m.messageKey)).toEqual(['m1', 'm2']);

    const reopened = await openDb();
    const verifyTx = reopened.transaction(['sync_mappings', 'article_comments', 'github_cleanup_outbox'], 'readonly');
    const verifyMappings = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll());
    const verifyComments = await reqToPromise<any[]>(verifyTx.objectStore('article_comments').getAll());
    const cleanupRows = await reqToPromise<any[]>(verifyTx.objectStore('github_cleanup_outbox').getAll());
    await txDone(verifyTx);

    expect(verifyMappings).toHaveLength(1);
    expect(verifyMappings[0]).toMatchObject({
      source: 'web',
      conversationKey: keepKey,
      notionPageId: 'page_remove',
      notionPageUrl: 'https://notion.so/page_remove',
      lastSyncedMessageKey: 'x',
      lastSyncedSequence: 2,
      notionSections: { conversations: { headingBlockId: 'h-remove' } },
      feishuDocId: 'doc-remove',
      feishuLastContentHash: 'hash-remove',
      legacyOnly: true,
    });
    expect(verifyMappings[0]?.githubRemoteKey).toBeUndefined();
    expect(verifyMappings[0]?.githubManagedFiles).toBeUndefined();
    expect(verifyComments.find((row) => row.id === parentId)).toMatchObject({
      conversationId: keepId,
      canonicalUrl: String(keep.url),
      commentText: 'merge parent',
    });
    expect(verifyComments.find((row) => row.id === replyId)).toMatchObject({
      parentId,
      conversationId: keepId,
      canonicalUrl: String(keep.url),
      commentText: 'merge reply',
    });
    expect(cleanupRows).toHaveLength(1);
    expect(cleanupRows[0]).toMatchObject({
      remoteKey: 'github.com/owner/repo@main',
      paths: [ownedLegacyPath],
      reason: 'identity_move',
      replacementConversationId: keepId,
    });
  });

  it('deduplicates same-URL valid image assets without overwriting the keep-side payload', async () => {
    const { keepId, removeId } = await createMergePair('image-valid');
    const url = 'https://example.com/shared-valid.png';
    const keepIdAsset = await seedImageCacheRow({
      conversationId: keepId,
      url,
      blob: new Blob(['keep'], { type: 'image/png' }),
      byteSize: 4,
      updatedAt: 10,
    });
    await seedImageCacheRow({
      conversationId: removeId,
      url,
      blob: new Blob(['remove'], { type: 'image/png' }),
      byteSize: 6,
      updatedAt: 20,
    });
    const beforeConversationRevision = await readDataRevision('conversations');

    const result = await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });

    expect(result).toMatchObject({ merged: true, movedImageCache: 0 });
    const rows = await readImageCacheRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: keepIdAsset, conversationId: keepId, url, byteSize: 4 });
    expect(await readDataRevision('image_cache')).toBe(1);
    expect(await readDataRevision('conversations')).toBe(beforeConversationRevision + 1);
    expect(await readDataRevision('messages')).toBe(0);
    expect(await readDataRevision('sync_mappings')).toBe(0);
    expect(await readDataRevision('article_comments')).toBe(0);
  });

  it('repairs an invalid keep-side image with the valid remove-side payload while preserving keep identity', async () => {
    const { keepId, removeId } = await createMergePair('image-repair');
    const url = 'https://example.com/shared-repair.png';
    const keepAssetId = await seedImageCacheRow({
      conversationId: keepId,
      url,
      blob: new Blob([], { type: 'image/png' }),
      byteSize: 0,
      updatedAt: 10,
    });
    await seedImageCacheRow({
      conversationId: removeId,
      url,
      blob: new Blob(['source'], { type: 'image/webp' }),
      byteSize: 6,
      contentType: 'image/webp',
      updatedAt: 20,
    });

    const result = await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });

    expect(result.movedImageCache).toBe(1);
    const rows = await readImageCacheRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: keepAssetId,
      conversationId: keepId,
      url,
      byteSize: 6,
      contentType: 'image/webp',
    });
    expect((rows[0].blob as Blob).size).toBe(6);
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('deterministically keeps the keep-side row when both colliding image payloads are invalid', async () => {
    const { keepId, removeId } = await createMergePair('image-invalid');
    const url = 'https://example.com/shared-invalid.png';
    const keepAssetId = await seedImageCacheRow({ conversationId: keepId, url, blob: new Blob([]), byteSize: 0 });
    await seedImageCacheRow({ conversationId: removeId, url, blob: new Blob([]), byteSize: 0 });

    const result = await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });

    expect(result.movedImageCache).toBe(0);
    const rows = await readImageCacheRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: keepAssetId, conversationId: keepId, url, byteSize: 0 });
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('reassigns a non-colliding image row without changing its asset id', async () => {
    const { keepId, removeId } = await createMergePair('image-move');
    const url = 'https://example.com/remove-only.png';
    const removeAssetId = await seedImageCacheRow({
      conversationId: removeId,
      url,
      blob: new Blob(['move'], { type: 'image/png' }),
      byteSize: 4,
    });

    const result = await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });

    expect(result.movedImageCache).toBe(1);
    const rows = await readImageCacheRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: removeAssetId, conversationId: keepId, url, byteSize: 4 });
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('rolls back earlier merge mutations and all revisions when an image write fails', async () => {
    const { keepId, removeId } = await createMergePair('image-abort');
    await syncConversationMessages(removeId, [
      { messageKey: 'm1', role: 'user', contentText: 'remove-message', sequence: 1, updatedAt: 1 },
    ]);
    await seedImageCacheRow({
      conversationId: removeId,
      url: 'https://example.com/fail.png',
      blob: new Blob(['fail'], { type: 'image/png' }),
      byteSize: 4,
    });
    const revisionsBefore = {
      conversations: await readDataRevision('conversations'),
      messages: await readDataRevision('messages'),
      sync_mappings: await readDataRevision('sync_mappings'),
      image_cache: await readDataRevision('image_cache'),
      article_comments: await readDataRevision('article_comments'),
    };

    const db = await openDb();
    const probeTx = db.transaction(['image_cache'], 'readonly');
    const prototype = Object.getPrototypeOf(probeTx.objectStore('image_cache')) as any;
    const originalPut = prototype.put;
    await txDone(probeTx);
    prototype.put = function put(value: unknown, key?: IDBValidKey) {
      if (this.name === 'image_cache') throw new DOMException('forced image merge failure', 'DataError');
      return originalPut.call(this, value, key);
    };
    try {
      await expect(
        mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId }),
      ).rejects.toThrow();
    } finally {
      prototype.put = originalPut;
    }

    expect(await getConversationById(keepId)).not.toBeNull();
    expect(await getConversationById(removeId)).not.toBeNull();
    expect(await getMessagesByConversationId(keepId)).toEqual([]);
    expect((await getMessagesByConversationId(removeId)).map((row) => row.messageKey)).toEqual(['m1']);
    expect((await readImageCacheRows())[0]).toMatchObject({ conversationId: removeId });
    expect(await readDataRevision('conversations')).toBe(revisionsBefore.conversations);
    expect(await readDataRevision('messages')).toBe(revisionsBefore.messages);
    expect(await readDataRevision('sync_mappings')).toBe(revisionsBefore.sync_mappings);
    expect(await readDataRevision('image_cache')).toBe(revisionsBefore.image_cache);
    expect(await readDataRevision('article_comments')).toBe(revisionsBefore.article_comments);
  });

  it('keeps canonical provider targets atomic when merging conversations with conflicting mappings', async () => {
    const keep = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'keep-conflict',
      title: 'keep',
      url: 'https://example.com/keep',
      notionPageId: '',
      feishuDocId: '',
      lastCapturedAt: 10,
    });
    const remove = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'remove-conflict',
      title: 'remove',
      url: 'https://example.com/remove',
      notionPageId: 'page-remove-conversation',
      feishuDocId: 'doc-remove-conversation',
      lastCapturedAt: 20,
    });
    const keepId = Number(keep.id);
    const removeId = Number(remove.id);
    const keepKey = String(keep.conversationKey || '');
    const removeKey = String(remove.conversationKey || '');
    const keepGithubPath = `WebArticles/${buildConversationBasename(keep)}.md`;
    const removeGithubPath = `WebArticles/${buildConversationBasename(remove)}.md`;

    const db = await openDb();
    const tx = db.transaction(['sync_mappings'], 'readwrite');
    const store = tx.objectStore('sync_mappings');
    await reqToPromise(
      store.add({
        source: 'web',
        conversationKey: keepKey,
        notionPageId: 'page-keep',
        notionPageUrl: 'https://notion.so/page-keep',
        lastSyncedMessageKey: 'keep-m1',
        lastSyncedSequence: 1,
        notionSections: { conversations: { headingBlockId: 'h-keep' } },
        notionSectionCursors: { conversations: { lastSyncedMessageKey: 'keep-m1', lastSyncedSequence: 1 } },
        feishuDocId: 'doc-keep',
        feishuLastContentHash: 'hash-keep',
        githubRemoteKey: 'github.com/owner/target@main',
        githubManagedFiles: {
          [keepGithubPath]: { kind: 'markdown', sha: 'a'.repeat(40), contentHash: 'b'.repeat(64) },
        },
        githubProjectionFingerprint: 'c'.repeat(64),
        githubLastSyncedAt: 10,
        sharedMetadata: 'target',
        updatedAt: 10,
      }),
    );
    await reqToPromise(
      store.add({
        source: 'web',
        conversationKey: removeKey,
        notionPageId: 'page-remove',
        notionPageUrl: 'https://notion.so/page-remove',
        lastSyncedMessageKey: 'remove-m9',
        lastSyncedSequence: 9,
        notionSections: { conversations: { headingBlockId: 'h-remove' } },
        notionSectionCursors: { conversations: { lastSyncedMessageKey: 'remove-m9', lastSyncedSequence: 9 } },
        feishuDocId: 'doc-remove',
        feishuLastContentHash: 'hash-remove',
        githubRemoteKey: 'github.com/owner/legacy@main',
        githubManagedFiles: {
          [removeGithubPath]: { kind: 'markdown', sha: 'd'.repeat(40), contentHash: 'e'.repeat(64) },
        },
        githubProjectionFingerprint: 'f'.repeat(64),
        githubLastSyncedAt: 99,
        sharedMetadata: 'legacy',
        legacyOnly: true,
        updatedAt: 99,
      }),
    );
    await txDone(tx);

    await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });

    const reopened = await openDb();
    const verifyTx = reopened.transaction(['sync_mappings', 'github_cleanup_outbox'], 'readonly');
    const mappings = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll());
    const cleanupRows = await reqToPromise<any[]>(verifyTx.objectStore('github_cleanup_outbox').getAll());
    await txDone(verifyTx);

    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      source: 'web',
      conversationKey: keepKey,
      notionPageId: 'page-keep',
      notionPageUrl: 'https://notion.so/page-keep',
      lastSyncedMessageKey: 'keep-m1',
      lastSyncedSequence: 1,
      notionSections: { conversations: { headingBlockId: 'h-keep' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'keep-m1', lastSyncedSequence: 1 } },
      feishuDocId: 'doc-keep',
      feishuLastContentHash: 'hash-keep',
      githubRemoteKey: 'github.com/owner/target@main',
      githubManagedFiles: {
        [keepGithubPath]: { kind: 'markdown', sha: 'a'.repeat(40), contentHash: 'b'.repeat(64) },
      },
      githubProjectionFingerprint: 'c'.repeat(64),
      githubLastSyncedAt: 10,
      sharedMetadata: 'target',
      legacyOnly: true,
    });
    expect(cleanupRows).toHaveLength(1);
    expect(cleanupRows[0]).toMatchObject({
      remoteKey: 'github.com/owner/legacy@main',
      paths: [removeGithubPath],
      reason: 'identity_move',
      replacementConversationId: keepId,
    });
  });

  it('aborts duplicate merge when GitHub cleanup enqueue fails', async () => {
    const keep = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'merge-abort-keep',
      title: 'keep',
      url: 'https://example.com/merge-abort-keep',
      lastCapturedAt: 1,
    });
    const remove = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'merge-abort-remove',
      title: 'remove',
      url: 'https://example.com/merge-abort-remove',
      lastCapturedAt: 2,
    });
    const keepId = Number(keep.id);
    const removeId = Number(remove.id);
    const removePath = `WebArticles/${buildConversationBasename(remove)}.md`;
    await patchSyncMapping(removeId, {
      githubRemoteKey: 'github.com/owner/repo@main',
      githubManagedFiles: {
        [removePath]: { kind: 'markdown', sha: 'a'.repeat(40), contentHash: 'b'.repeat(64) },
      },
    });

    const db = await openDb();
    const commentTx = db.transaction(['article_comments'], 'readwrite');
    await reqToPromise(
      commentTx.objectStore('article_comments').add({
        parentId: null,
        conversationId: removeId,
        canonicalUrl: String(remove.url),
        quoteText: '',
        commentText: 'must remain on remove',
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await txDone(commentTx);
    const probeTx = db.transaction(['github_cleanup_outbox'], 'readonly');
    const prototype = Object.getPrototypeOf(probeTx.objectStore('github_cleanup_outbox')) as any;
    const originalAdd = prototype.add;
    await txDone(probeTx);

    prototype.add = function add(value: unknown, key?: IDBValidKey) {
      if (this.name === 'github_cleanup_outbox') throw new DOMException('forced merge outbox failure', 'DataError');
      return originalAdd.call(this, value, key);
    };
    try {
      await expect(
        mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId }),
      ).rejects.toThrow();
    } finally {
      prototype.add = originalAdd;
    }

    expect(await getConversationById(keepId)).not.toBeNull();
    expect(await getConversationById(removeId)).not.toBeNull();
    expect((await getSyncMappingByConversation(removeId))?.mapping?.githubRemoteKey).toBe('github.com/owner/repo@main');
    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['article_comments', 'github_cleanup_outbox'], 'readonly');
    const comments = await reqToPromise<any[]>(verifyTx.objectStore('article_comments').getAll());
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      conversationId: removeId,
      canonicalUrl: String(remove.url),
      commentText: 'must remain on remove',
    });
    expect(await reqToPromise(verifyTx.objectStore('github_cleanup_outbox').count())).toBe(0);
    await txDone(verifyTx);
  });

  it('maintains listSourceKey/listSiteKey on upsert and merge writes', async () => {
    const keep = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'key_keep',
      title: 'keep',
      url: '',
      lastCapturedAt: 1,
    });
    const remove = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'key_remove',
      title: 'remove',
      url: 'https://example.com/post',
      lastCapturedAt: 2,
    });

    expect(keep.listSourceKey).toBe('web');
    expect(keep.listSiteKey).toBe('unknown');
    expect(remove.listSourceKey).toBe('web');
    expect(remove.listSiteKey).toBe('domain:example.com');

    const keepId = Number(keep.id);
    const removeId = Number(remove.id);
    await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });

    const merged = await getConversationById(keepId);
    expect(merged).toBeTruthy();
    expect(merged?.listSourceKey).toBe('web');
    expect(merged?.listSiteKey).toBe('domain:example.com');
  });
});
