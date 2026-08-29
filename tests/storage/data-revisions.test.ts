import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import {
  DATA_REVISION_RECORD_KEY,
  DATA_REVISION_SCOPES,
  DATA_REVISION_STORE_BY_SCOPE,
  type DataRevisionScope,
} from '@platform/idb/data-revision-record';
import { closeDbForTests, DB_VERSION, openDb } from '@platform/idb/schema';
import { readDataRevision, readDataRevisionSnapshot } from '@services/data-revisions/storage-idb';
import { runTrackedTransaction } from '@services/data-revisions/transaction';
import { importBackupLegacyJsonMerge } from '@services/sync/backup/import';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('request failed'));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
  });
}

async function deleteDb(): Promise<void> {
  await requestResult(indexedDB.deleteDatabase('webclipper') as unknown as IDBRequest<unknown>);
}

async function writeRevision(scope: DataRevisionScope, revision: number, updatedAt = revision): Promise<void> {
  const db = await openDb();
  const storeName = DATA_REVISION_STORE_BY_SCOPE[scope];
  const transaction = db.transaction([storeName], 'readwrite');
  const done = txDone(transaction);
  await requestResult(transaction.objectStore(storeName).put({ revision, updatedAt }, DATA_REVISION_RECORD_KEY));
  await done;
}

function holdRevisionWrite(scope: DataRevisionScope, revision: number) {
  let released = false;
  let resolveAcquired!: () => void;
  let rejectAcquired!: (error: unknown) => void;
  const acquired = new Promise<void>((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });

  const started = openDb().then((db) => {
    const storeName = DATA_REVISION_STORE_BY_SCOPE[scope];
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const completed = txDone(transaction);

    const keepAlive = () => {
      const request = store.get(DATA_REVISION_RECORD_KEY);
      request.onsuccess = () => {
        if (released) return;
        keepAlive();
      };
      request.onerror = () => rejectAcquired(request.error || new Error('hold transaction failed'));
    };

    const write = store.put({ revision, updatedAt: revision }, DATA_REVISION_RECORD_KEY);
    write.onsuccess = () => {
      resolveAcquired();
      keepAlive();
    };
    write.onerror = () => rejectAcquired(write.error || new Error('hold transaction write failed'));
    return completed;
  });

  return {
    acquired,
    release() {
      released = true;
    },
    async completed() {
      await started;
    },
  };
}

type RevisionReadObserver = {
  waitForPass: (passNumber: number) => Promise<void>;
  getCount: (scope: DataRevisionScope) => number;
  readonlyRevisionTransactions: Array<{ stores: string[]; mode: IDBTransactionMode | undefined }>;
  restore: () => void;
};

function observeRevisionReads(db: IDBDatabase): RevisionReadObserver {
  const revisionStoreNames = new Set(Object.values(DATA_REVISION_STORE_BY_SCOPE));
  const scopeByStore = new Map(
    DATA_REVISION_SCOPES.map((scope) => [DATA_REVISION_STORE_BY_SCOPE[scope], scope] as const),
  );
  const counts = new Map<DataRevisionScope, number>(DATA_REVISION_SCOPES.map((scope) => [scope, 0]));
  const waiters = new Set<() => void>();
  const readonlyRevisionTransactions: Array<{ stores: string[]; mode: IDBTransactionMode | undefined }> = [];
  const original = db.transaction.bind(db);

  const notify = () => {
    for (const waiter of [...waiters]) waiter();
  };

  const spy = vi.spyOn(db, 'transaction').mockImplementation(((storeNames: any, mode?: IDBTransactionMode, options?: any) => {
    const transaction = options === undefined ? original(storeNames, mode) : (original as any)(storeNames, mode, options);
    const stores = (Array.isArray(storeNames) ? storeNames : [storeNames]).map(String);
    if (mode === 'readonly' && stores.some((storeName) => revisionStoreNames.has(storeName))) {
      readonlyRevisionTransactions.push({ stores, mode });
      for (const storeName of stores) {
        const scope = scopeByStore.get(storeName);
        if (scope) counts.set(scope, (counts.get(scope) || 0) + 1);
      }
      notify();
    }
    return transaction;
  }) as any);

  const hasPass = (passNumber: number) => DATA_REVISION_SCOPES.every((scope) => (counts.get(scope) || 0) >= passNumber);

  return {
    waitForPass(passNumber) {
      if (hasPass(passNumber)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const check = () => {
          if (!hasPass(passNumber)) return;
          waiters.delete(check);
          resolve();
        };
        waiters.add(check);
      });
    },
    getCount(scope) {
      return counts.get(scope) || 0;
    },
    readonlyRevisionTransactions,
    restore() {
      spy.mockRestore();
      waiters.clear();
    },
  };
}

beforeEach(async () => {
  closeDbForTests();
  // @ts-expect-error fake IndexedDB test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error fake IndexedDB test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb();
  await openDb();
});

afterEach(() => {
  closeDbForTests();
  delete (globalThis as any).chrome;
  delete (globalThis as any).browser;
});

describe('data revision storage', () => {
  it('publishes a wake only after a changed transaction commits, never for no-op or abort', async () => {
    const writes: Record<string, unknown>[] = [];
    (globalThis as any).chrome = {
      runtime: {},
      storage: {
        local: {
          set(payload: Record<string, unknown>, callback: () => void) {
            writes.push(payload);
            callback();
          },
        },
      },
    };
    const db = await openDb();

    await runTrackedTransaction(
      { db, stores: ['conversations'], revisionScopes: ['conversations'] },
      async ({ stores }) => {
        await requestResult(stores.conversations.count());
      },
    );
    await Promise.resolve();
    expect(writes).toHaveLength(0);

    await expect(
      runTrackedTransaction(
        { db, stores: ['conversations', 'messages'], revisionScopes: ['conversations'] },
        async ({ stores, markChanged }) => {
          await requestResult(stores.conversations.add({ source: 'test', conversationKey: 'wake-rollback' }));
          markChanged('messages' as any);
        },
      ),
    ).rejects.toMatchObject({ code: 'revision_scope_invalid' });
    await Promise.resolve();
    expect(writes).toHaveLength(0);

    await runTrackedTransaction(
      { db, stores: ['conversations'], revisionScopes: ['conversations'] },
      async ({ stores, markChanged }) => {
        await requestResult(stores.conversations.add({ source: 'test', conversationKey: 'wake-commit' }));
        markChanged('conversations');
      },
    );
    await vi.waitFor(() => expect(writes).toHaveLength(1));

    const verifyTransaction = db.transaction(['conversations'], 'readonly');
    const done = txDone(verifyTransaction);
    const rows = await requestResult<any[]>(verifyTransaction.objectStore('conversations').getAll());
    await done;
    expect(rows.map((row) => row.conversationKey)).toEqual(['wake-commit']);
    expect(await readDataRevision('conversations')).toBe(1);
  });

  it('bumps one declared scope once even when multiple rows change in the same transaction', async () => {
    const db = await openDb();
    await runTrackedTransaction(
      { db, stores: ['conversations'], revisionScopes: ['conversations'] },
      async ({ stores, markChanged }) => {
        await requestResult(stores.conversations.add({ source: 'test', conversationKey: 'one' }));
        markChanged('conversations');
        await requestResult(stores.conversations.add({ source: 'test', conversationKey: 'two' }));
        markChanged('conversations');
      },
    );

    expect(await readDataRevision('conversations')).toBe(1);
    const transaction = db.transaction(['conversations'], 'readonly');
    const done = txDone(transaction);
    expect(await requestResult(transaction.objectStore('conversations').count())).toBe(2);
    await done;
  });

  it('bumps multiple changed scopes atomically and leaves no-op scopes unchanged', async () => {
    const db = await openDb();
    await runTrackedTransaction(
      { db, stores: ['conversations', 'messages'], revisionScopes: ['conversations', 'messages'] },
      async ({ stores, markChanged }) => {
        const conversationId = await requestResult<number>(
          stores.conversations.add({ source: 'test', conversationKey: 'multi' }) as any,
        );
        markChanged('conversations');
        await requestResult(
          stores.messages.add({ conversationId, messageKey: 'm1', role: 'user', sequence: 0 }),
        );
        markChanged('messages');
      },
    );

    expect(await readDataRevision('conversations')).toBe(1);
    expect(await readDataRevision('messages')).toBe(1);
    expect(await readDataRevision('sync_mappings')).toBe(0);

    await runTrackedTransaction(
      { db, stores: ['conversations'], revisionScopes: ['conversations'] },
      async ({ stores }) => {
        await requestResult(stores.conversations.count());
      },
    );
    expect(await readDataRevision('conversations')).toBe(1);
  });

  it('fails closed for scope/store mismatch and aborts when work marks an undeclared scope', async () => {
    const db = await openDb();
    await expect(
      runTrackedTransaction(
        { db, stores: ['conversations'], revisionScopes: ['messages'] },
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'revision_scope_store_missing', scope: 'messages' });

    await expect(
      runTrackedTransaction(
        { db, stores: ['conversations', 'messages'], revisionScopes: ['conversations'] },
        async ({ stores, markChanged }) => {
          await requestResult(stores.conversations.add({ source: 'test', conversationKey: 'must-rollback' }));
          markChanged('messages' as any);
        },
      ),
    ).rejects.toMatchObject({ code: 'revision_scope_invalid', scope: 'messages' });

    const transaction = db.transaction(['conversations'], 'readonly');
    const done = txDone(transaction);
    expect(await requestResult(transaction.objectStore('conversations').count())).toBe(0);
    await done;
    expect(await readDataRevision('conversations')).toBe(0);
  });

  it('rolls back business rows and revisions when a request fails', async () => {
    const db = await openDb();
    await expect(
      runTrackedTransaction(
        { db, stores: ['conversations'], revisionScopes: ['conversations'] },
        async ({ stores, markChanged }) => {
          await requestResult(stores.conversations.add({ source: 'test', conversationKey: 'duplicate' }));
          markChanged('conversations');
          await requestResult(stores.conversations.add({ source: 'test', conversationKey: 'duplicate' }));
          markChanged('conversations');
        },
      ),
    ).rejects.toBeTruthy();

    const transaction = db.transaction(['conversations'], 'readonly');
    const done = txDone(transaction);
    expect(await requestResult(transaction.objectStore('conversations').count())).toBe(0);
    await done;
    expect(await readDataRevision('conversations')).toBe(0);
  });

  it('aborts the whole transaction instead of wrapping an exhausted revision', async () => {
    await writeRevision('conversations', Number.MAX_SAFE_INTEGER, 1);
    const db = await openDb();

    await expect(
      runTrackedTransaction(
        { db, stores: ['conversations'], revisionScopes: ['conversations'] },
        async ({ stores, markChanged }) => {
          await requestResult(stores.conversations.add({ source: 'test', conversationKey: 'overflow' }));
          markChanged('conversations');
        },
      ),
    ).rejects.toMatchObject({ code: 'revision_overflow', scope: 'conversations' });

    expect(await readDataRevision('conversations')).toBe(Number.MAX_SAFE_INTEGER);
    const transaction = db.transaction(['conversations'], 'readonly');
    const done = txDone(transaction);
    expect(await requestResult(transaction.objectStore('conversations').count())).toBe(0);
    await done;
  });

  it('allows an untracked outbox write without manufacturing a UI data revision', async () => {
    const db = await openDb();
    await runTrackedTransaction(
      {
        db,
        stores: ['conversations', 'github_cleanup_outbox'],
        revisionScopes: ['conversations'],
      },
      async ({ stores }) => {
        await requestResult(
          stores.github_cleanup_outbox.add({
            remoteKey: 'github.com/example/repo@main',
            paths: ['WebArticles/a.md'],
            reason: 'test',
            replacementConversationId: 1,
            createdAt: 1,
            nextAttemptAt: 1,
            attemptCount: 0,
          }),
        );
      },
    );

    expect(await readDataRevision('conversations')).toBe(0);
    const transaction = db.transaction(['github_cleanup_outbox'], 'readonly');
    const done = txDone(transaction);
    expect(await requestResult(transaction.objectStore('github_cleanup_outbox').count())).toBe(1);
    await done;
  });

  it('advances the messages revision only for actual message row mutations', async () => {
    const { syncConversationMessages } = await import('@services/conversations/data/storage-idb');
    const message = { messageKey: 'm1', role: 'user', contentText: 'stable', sequence: 1 };

    await syncConversationMessages(42, [{ ...message, updatedAt: 10 }]);
    expect(await readDataRevision('messages')).toBe(1);

    await syncConversationMessages(42, [{ ...message }]);
    expect(await readDataRevision('messages')).toBe(1);

    await syncConversationMessages(42, [{ ...message, updatedAt: 11 }]);
    expect(await readDataRevision('messages')).toBe(2);

    await syncConversationMessages(42, []);
    expect(await readDataRevision('messages')).toBe(3);
    await syncConversationMessages(42, []);
    expect(await readDataRevision('messages')).toBe(3);
  });

  it('advances article_comments once per successful mutator and stays stable on clean no-ops', async () => {
    const {
      addArticleComment,
      attachOrphanCommentsToConversation,
      deleteArticleCommentById,
      migrateArticleCommentsCanonicalUrl,
    } = await import('@services/comments/data/storage-idb');
    const url = 'https://example.com/revision-comments';

    const root = await addArticleComment({ conversationId: null, canonicalUrl: url, commentText: 'root' });
    expect(await readDataRevision('article_comments')).toBe(1);
    const reply = await addArticleComment({
      parentId: root.id,
      conversationId: null,
      canonicalUrl: url,
      commentText: 'reply',
    });
    expect(Number(reply.id)).toBeGreaterThan(0);
    expect(await readDataRevision('article_comments')).toBe(2);

    await expect(
      addArticleComment({
        parentId: reply.id,
        conversationId: null,
        canonicalUrl: url,
        commentText: 'invalid nested reply',
      }),
    ).rejects.toThrow('parent_not_root');
    expect(await readDataRevision('article_comments')).toBe(2);
    expect(await deleteArticleCommentById(999_999)).toBe(false);
    expect(await readDataRevision('article_comments')).toBe(2);

    expect(await deleteArticleCommentById(root.id)).toBe(true);
    expect(await readDataRevision('article_comments')).toBe(3);

    await addArticleComment({ conversationId: null, canonicalUrl: url, commentText: 'orphan' });
    expect(await readDataRevision('article_comments')).toBe(4);
    expect(await attachOrphanCommentsToConversation(url, 77)).toEqual({ updated: 1 });
    expect(await readDataRevision('article_comments')).toBe(5);
    expect(await attachOrphanCommentsToConversation(url, 77)).toEqual({ updated: 0 });
    expect(await readDataRevision('article_comments')).toBe(5);

    const nextUrl = 'https://example.com/revision-comments-next';
    expect(
      await migrateArticleCommentsCanonicalUrl({ fromCanonicalUrl: url, toCanonicalUrl: nextUrl, conversationId: 77 }),
    ).toEqual({ updated: 1 });
    expect(await readDataRevision('article_comments')).toBe(6);
    expect(
      await migrateArticleCommentsCanonicalUrl({ fromCanonicalUrl: url, toCanonicalUrl: nextUrl, conversationId: 77 }),
    ).toEqual({ updated: 0 });
    expect(await readDataRevision('article_comments')).toBe(6);
  });

  it('advances image_cache only for the first persistent asset write', async () => {
    const { inlineChatImagesInMessages } = await import('@services/conversations/data/image-inline');
    const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([1, 3, 5, 7])).toString('base64')}`;
    const makeMessages = () => [
      { messageKey: 'm-image', contentMarkdown: `![](${dataImageUrl})`, role: 'assistant', sequence: 1 },
    ];

    const first = makeMessages();
    await inlineChatImagesInMessages({ conversationId: 43, messages: first, enableHttpImages: false });
    expect(await readDataRevision('image_cache')).toBe(1);

    const second = makeMessages();
    await inlineChatImagesInMessages({ conversationId: 43, messages: second, enableHttpImages: false });
    expect(await readDataRevision('image_cache')).toBe(1);
  });

  it('keeps all five revisions stable for merge self-target and missing-remove no-ops', async () => {
    const { mergeConversationsByIds, upsertConversation } = await import('@services/conversations/data/storage-idb');
    const keep = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'merge-noop',
      title: 'No-op',
      lastCapturedAt: 1,
    });
    const keepId = Number(keep.id);
    const before = await readDataRevisionSnapshot();

    expect(await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: keepId })).toMatchObject({
      merged: false,
    });
    expect(await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: keepId + 999 })).toMatchObject({
      merged: false,
    });
    expect(await readDataRevisionSnapshot()).toEqual(before);
  });

  it('keeps the snapshot stable when delete receives valid ids with no matching conversation', async () => {
    const { deleteConversationsByIds } = await import('@services/conversations/data/storage-idb');
    const before = await readDataRevisionSnapshot();
    expect(await deleteConversationsByIds([999_999])).toEqual({
      deletedConversations: 0,
      deletedMessages: 0,
      deletedMappings: 0,
      deletedImageCache: 0,
    });
    expect(await readDataRevisionSnapshot()).toEqual(before);
  });

  it('records Obsidian remote writes as a strict atomic generation without clock dependence', async () => {
    const { recordObsidianRemoteWrite } = await import('@services/conversations/data/storage-idb');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123_456);
    try {
      await expect(
        recordObsidianRemoteWrite({ source: 'chatgpt', conversationKey: 'obsidian-generation' }),
      ).resolves.toEqual({ generation: 1 });
      await expect(
        recordObsidianRemoteWrite({ source: 'chatgpt', conversationKey: 'obsidian-generation' }),
      ).resolves.toEqual({ generation: 2 });
      expect(await readDataRevision('sync_mappings')).toBe(2);

      const db = await openDb();
      const verifyTx = db.transaction(['sync_mappings'], 'readonly');
      const stored = await requestResult<any>(
        verifyTx.objectStore('sync_mappings').index('by_source_conversationKey').get(['chatgpt', 'obsidian-generation']),
      );
      await txDone(verifyTx);
      expect(stored).toMatchObject({
        source: 'chatgpt',
        conversationKey: 'obsidian-generation',
        obsidianRemoteWriteGeneration: 2,
        updatedAt: 123_456,
      });

      await expect(recordObsidianRemoteWrite({ source: '', conversationKey: 'bad' })).rejects.toThrow(
        'invalid obsidian remote write identity',
      );
      expect(await readDataRevision('sync_mappings')).toBe(2);

      const overflowTx = db.transaction(['sync_mappings'], 'readwrite');
      await requestResult(
        overflowTx.objectStore('sync_mappings').add({
          source: 'chatgpt',
          conversationKey: 'obsidian-overflow',
          obsidianRemoteWriteGeneration: Number.MAX_SAFE_INTEGER,
          notionPageId: 'preserve-overflow-provider',
        }),
      );
      await txDone(overflowTx);
      await expect(
        recordObsidianRemoteWrite({ source: 'chatgpt', conversationKey: 'obsidian-overflow' }),
      ).rejects.toMatchObject({ code: 'obsidian_remote_write_generation_overflow' });
      expect(await readDataRevision('sync_mappings')).toBe(2);

      const abortSeedTx = db.transaction(['sync_mappings'], 'readwrite');
      await requestResult(
        abortSeedTx.objectStore('sync_mappings').add({
          source: 'chatgpt',
          conversationKey: 'obsidian-abort',
          obsidianRemoteWriteGeneration: 4,
          feishuDocId: 'preserve-doc',
        }),
      );
      await txDone(abortSeedTx);
      const probeTx = db.transaction(['sync_mappings'], 'readonly');
      const prototype = Object.getPrototypeOf(probeTx.objectStore('sync_mappings')) as any;
      const originalPut = prototype.put;
      await txDone(probeTx);
      prototype.put = function put(value: unknown, key?: IDBValidKey) {
        if (this.name === 'sync_mappings') throw new DOMException('forced generation write failure', 'DataError');
        return originalPut.call(this, value, key);
      };
      try {
        await expect(
          recordObsidianRemoteWrite({ source: 'chatgpt', conversationKey: 'obsidian-abort' }),
        ).rejects.toThrow();
      } finally {
        prototype.put = originalPut;
      }
      expect(await readDataRevision('sync_mappings')).toBe(2);
      const afterAbortTx = db.transaction(['sync_mappings'], 'readonly');
      const afterAbort = await requestResult<any>(
        afterAbortTx.objectStore('sync_mappings').index('by_source_conversationKey').get(['chatgpt', 'obsidian-abort']),
      );
      await txDone(afterAbortTx);
      expect(afterAbort).toMatchObject({ obsidianRemoteWriteGeneration: 4, feishuDocId: 'preserve-doc' });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('tracks sync mapping and conversation mirror mutations independently', async () => {
    const { patchSyncMapping, upsertConversation } = await import('@services/conversations/data/storage-idb');
    const conversation = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'mapping-revision-scopes',
      title: 'Mapping revisions',
      lastCapturedAt: 1,
    });
    const conversationId = Number(conversation.id);
    const baseline = await readDataRevisionSnapshot();

    await patchSyncMapping(conversationId, { customMetadata: 'one' });
    expect(await readDataRevision('sync_mappings')).toBe(baseline.sync_mappings + 1);
    expect(await readDataRevision('conversations')).toBe(baseline.conversations);

    await patchSyncMapping(conversationId, { customMetadata: 'one' });
    expect(await readDataRevision('sync_mappings')).toBe(baseline.sync_mappings + 1);
    expect(await readDataRevision('conversations')).toBe(baseline.conversations);

    await patchSyncMapping(conversationId, { feishuDocId: 'doc-1' });
    expect(await readDataRevision('sync_mappings')).toBe(baseline.sync_mappings + 2);
    expect(await readDataRevision('conversations')).toBe(baseline.conversations + 1);
  });

  it('advances conversations once for real Legacy backup changes and stays stable for identical re-imports', async () => {
    const buildBackup = (lastCapturedAt: number) => ({
      schemaVersion: 1,
      stores: {
        conversations: [
          {
            id: 99,
            sourceType: 'chat',
            source: 'chatgpt',
            conversationKey: 'legacy-conversation-revision',
            title: 'Legacy',
            url: 'https://chatgpt.com/c/legacy-conversation-revision',
            lastCapturedAt,
          },
        ],
        messages: [],
        sync_mappings: [],
      },
      storageLocal: {},
    });

    expect(await readDataRevision('conversations')).toBe(0);
    const first = await importBackupLegacyJsonMerge(buildBackup(10));
    expect(first.conversationsAdded).toBe(1);
    expect(first.conversationsUpdated).toBe(0);
    expect(await readDataRevision('conversations')).toBe(1);

    const repeated = await importBackupLegacyJsonMerge(buildBackup(10));
    expect(repeated.conversationsAdded).toBe(0);
    expect(repeated.conversationsUpdated).toBe(0);
    expect(await readDataRevision('conversations')).toBe(1);

    const changed = await importBackupLegacyJsonMerge(buildBackup(20));
    expect(changed.conversationsAdded).toBe(0);
    expect(changed.conversationsUpdated).toBe(1);
    expect(await readDataRevision('conversations')).toBe(2);
  });

  it('reads missing and malformed records as revision zero', async () => {
    for (const scope of DATA_REVISION_SCOPES) await expect(readDataRevision(scope)).resolves.toBe(0);

    const db = await openDb();
    const storeName = DATA_REVISION_STORE_BY_SCOPE.conversations;
    const transaction = db.transaction([storeName], 'readwrite');
    const done = txDone(transaction);
    await requestResult(
      transaction.objectStore(storeName).put({ revision: -1, updatedAt: 100 }, DATA_REVISION_RECORD_KEY),
    );
    await done;
    await expect(readDataRevision('conversations')).resolves.toBe(0);

    await writeRevision('conversations', 7, 999);
    await expect(readDataRevision('conversations')).resolves.toBe(7);
  });

  it('returns a stable A/B snapshot using only single-scope readonly transactions', async () => {
    await writeRevision('conversations', 2);
    await writeRevision('messages', 3);
    await writeRevision('sync_mappings', 4);
    await writeRevision('article_comments', 5);
    await writeRevision('image_cache', 6);

    const db = await openDb();
    const observer = observeRevisionReads(db);
    try {
      await expect(readDataRevisionSnapshot()).resolves.toEqual({
        conversations: 2,
        messages: 3,
        sync_mappings: 4,
        article_comments: 5,
        image_cache: 6,
      });
      for (const scope of DATA_REVISION_SCOPES) expect(observer.getCount(scope)).toBe(2);
      expect(observer.readonlyRevisionTransactions).toHaveLength(DATA_REVISION_SCOPES.length * 2);
      expect(observer.readonlyRevisionTransactions.every((entry) => entry.stores.length === 1)).toBe(true);
    } finally {
      observer.restore();
    }
  });

  it('discards a torn A pass, confirms B/C, and does not block independent revision writers', async () => {
    const db = await openDb();
    const observer = observeRevisionReads(db);
    const heldMessages = holdRevisionWrite('messages', 1);
    await heldMessages.acquired;

    let settled = false;
    const snapshotPromise = readDataRevisionSnapshot().finally(() => {
      settled = true;
    });

    try {
      await observer.waitForPass(1);
      await Promise.all([writeRevision('sync_mappings', 1), writeRevision('image_cache', 1)]);
      expect(settled).toBe(false);

      heldMessages.release();
      await heldMessages.completed();

      await expect(snapshotPromise).resolves.toEqual({
        conversations: 0,
        messages: 1,
        sync_mappings: 1,
        article_comments: 0,
        image_cache: 1,
      });
      for (const scope of DATA_REVISION_SCOPES) expect(observer.getCount(scope)).toBe(3);
    } finally {
      heldMessages.release();
      observer.restore();
    }
  });

  it('throws snapshot_unstable when A, B, and C keep changing', async () => {
    const db = await openDb();
    const observer = observeRevisionReads(db);
    const firstHold = holdRevisionWrite('messages', 1);
    await firstHold.acquired;
    const snapshotPromise = readDataRevisionSnapshot();

    let secondHold: ReturnType<typeof holdRevisionWrite> | null = null;
    let thirdHold: ReturnType<typeof holdRevisionWrite> | null = null;
    try {
      await observer.waitForPass(1);
      secondHold = holdRevisionWrite('messages', 2);
      await writeRevision('sync_mappings', 1);
      firstHold.release();
      await firstHold.completed();

      await secondHold.acquired;
      await observer.waitForPass(2);
      thirdHold = holdRevisionWrite('messages', 3);
      await writeRevision('sync_mappings', 2);
      secondHold.release();
      await secondHold.completed();

      await thirdHold.acquired;
      await observer.waitForPass(3);
      thirdHold.release();
      await thirdHold.completed();

      await expect(snapshotPromise).rejects.toMatchObject({
        message: 'snapshot_unstable',
        code: 'snapshot_unstable',
      });
    } finally {
      firstHold.release();
      secondHold?.release();
      thirdHold?.release();
      observer.restore();
    }
  });

  it('propagates IndexedDB open failures instead of fabricating a zero revision', async () => {
    closeDbForTests();
    const futureRequest = indexedDB.open('webclipper', DB_VERSION + 1);
    const futureDb = await requestResult(futureRequest);
    futureDb.close();

    await expect(readDataRevision('conversations')).rejects.toBeTruthy();
  });
});
