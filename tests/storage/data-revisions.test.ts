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
});

describe('data revision storage', () => {
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
