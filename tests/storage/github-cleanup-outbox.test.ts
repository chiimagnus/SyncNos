import { beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import {
  buildGithubCleanupOutboxRecord,
  GITHUB_CLEANUP_OUTBOX_STORE,
  normalizeGithubCleanupOutboxRecord,
} from '@platform/idb/github-cleanup-outbox-record';
import { openDb } from '@platform/idb/schema';
import { isGithubManagedPathOwnedByStableId } from '@services/sync/github/github-managed-path-ownership';
import {
  ackGithubCleanupRows,
  deferGithubCleanupRows,
  getNextGithubCleanupDueAt,
  listDueGithubCleanupRows,
} from '@services/sync/github/github-cleanup-outbox-store';

const REMOTE_A = 'github.com/owner/repo@main';
const REMOTE_B = 'github.com/owner/other@main';

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

async function seedRows(rows: Array<Record<string, unknown>>): Promise<number[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction([GITHUB_CLEANUP_OUTBOX_STORE], 'readwrite');
    const store = transaction.objectStore(GITHUB_CLEANUP_OUTBOX_STORE);
    const ids: number[] = [];
    for (const row of rows) ids.push(await requestResult<number>(store.add(row) as IDBRequest<number>));
    await txDone(transaction);
    return ids;
  } finally {
    db.close();
  }
}

async function readAllRows(): Promise<any[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction([GITHUB_CLEANUP_OUTBOX_STORE], 'readonly');
    const rows = await requestResult<any[]>(transaction.objectStore(GITHUB_CLEANUP_OUTBOX_STORE).getAll());
    await txDone(transaction);
    return rows;
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  // @ts-expect-error fake IndexedDB test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error fake IndexedDB test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb();
});

describe('github cleanup outbox record', () => {
  it('builds a due-now row with safe sorted unique paths', () => {
    expect(
      buildGithubCleanupOutboxRecord({
        remoteKey: REMOTE_A,
        paths: ['Chats/z.md', 'Chats/a.md', 'Chats/z.md'],
        reason: 'delete',
        createdAt: 10,
      }),
    ).toEqual({
      remoteKey: REMOTE_A,
      paths: ['Chats/a.md', 'Chats/z.md'],
      reason: 'delete',
      createdAt: 10,
      nextAttemptAt: 10,
    });
  });

  it('requires identity replacement and rejects unsafe or malformed rows', () => {
    expect(
      normalizeGithubCleanupOutboxRecord({
        remoteKey: REMOTE_A,
        paths: ['Chats/a.md'],
        reason: 'identity_move',
        createdAt: 1,
        nextAttemptAt: 1,
      }),
    ).toBeNull();
    expect(
      normalizeGithubCleanupOutboxRecord({
        remoteKey: REMOTE_A,
        paths: ['Chats/a.md'],
        reason: 'delete',
        replacementConversationId: 1,
        createdAt: 1,
        nextAttemptAt: 1,
      }),
    ).toBeNull();
    for (const path of ['/absolute.md', '../escape.md', 'a/../b.md', 'a\\b.md', '.github/workflows/release.yml']) {
      expect(
        normalizeGithubCleanupOutboxRecord({
          remoteKey: REMOTE_A,
          paths: [path],
          reason: 'delete',
          createdAt: 1,
          nextAttemptAt: 1,
        }),
      ).toBeNull();
    }
  });
});

describe('github managed path ownership', () => {
  it('uses the same stable-id and asset-namespace grammar for cleanup authority', () => {
    const stableId = '1234567890';
    expect(isGithubManagedPathOwnedByStableId(`Chats/chat-title-${stableId}.md`, 'markdown', stableId)).toBe(true);
    expect(
      isGithubManagedPathOwnedByStableId(
        `Chats/chat-title-${stableId}.assets/${'a'.repeat(64)}.png`,
        'asset',
        stableId,
      ),
    ).toBe(true);
    expect(isGithubManagedPathOwnedByStableId('README.md', 'markdown', stableId)).toBe(false);
    expect(isGithubManagedPathOwnedByStableId('Chats/chat-title-0000000000.md', 'markdown', stableId)).toBe(false);
    expect(isGithubManagedPathOwnedByStableId(`Chats/chat-title-${stableId}.assets/image.png`, 'asset', stableId)).toBe(
      false,
    );
  });
});

describe('github cleanup outbox store', () => {
  it('lists only due rows for the exact remote key in due/created order', async () => {
    await seedRows([
      {
        ...buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_A, paths: ['late.md'], reason: 'delete', createdAt: 30 }),
        nextAttemptAt: 30,
      },
      {
        ...buildGithubCleanupOutboxRecord({
          remoteKey: REMOTE_A,
          paths: ['second.md'],
          reason: 'delete',
          createdAt: 20,
        }),
        nextAttemptAt: 10,
      },
      {
        ...buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_B, paths: ['other.md'], reason: 'delete', createdAt: 5 }),
        nextAttemptAt: 5,
      },
      {
        ...buildGithubCleanupOutboxRecord({
          remoteKey: REMOTE_A,
          paths: ['first.md'],
          reason: 'delete',
          createdAt: 10,
        }),
        nextAttemptAt: 10,
      },
      {
        ...buildGithubCleanupOutboxRecord({
          remoteKey: REMOTE_A,
          paths: ['future.md'],
          reason: 'delete',
          createdAt: 40,
        }),
        nextAttemptAt: 100,
      },
    ]);

    const result = await listDueGithubCleanupRows(REMOTE_A, 20, 10);
    expect(result.hasMoreDue).toBe(false);
    expect(result.rows.map((row) => row.paths[0])).toEqual(['first.md', 'second.md']);
  });

  it('reports hasMoreDue only when another valid due row exists past the bounded page', async () => {
    await seedRows(
      [1, 2, 3].map((createdAt) =>
        buildGithubCleanupOutboxRecord({
          remoteKey: REMOTE_A,
          paths: [`Chats/${createdAt}.md`],
          reason: 'delete',
          createdAt,
        }),
      ),
    );
    const limited = await listDueGithubCleanupRows(REMOTE_A, 10, 2);
    expect(limited.rows).toHaveLength(2);
    expect(limited.hasMoreDue).toBe(true);

    const complete = await listDueGithubCleanupRows(REMOTE_A, 10, 3);
    expect(complete.rows).toHaveLength(3);
    expect(complete.hasMoreDue).toBe(false);
  });

  it('returns the earliest nextAttemptAt for the selected target', async () => {
    await seedRows([
      {
        ...buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_A, paths: ['later.md'], reason: 'delete', createdAt: 1 }),
        nextAttemptAt: 50,
      },
      {
        ...buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_B, paths: ['other.md'], reason: 'delete', createdAt: 1 }),
        nextAttemptAt: 2,
      },
      {
        ...buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_A, paths: ['first.md'], reason: 'delete', createdAt: 2 }),
        nextAttemptAt: 20,
      },
    ]);
    await expect(getNextGithubCleanupDueAt(REMOTE_A)).resolves.toBe(20);
    await expect(getNextGithubCleanupDueAt('github.com/owner/missing@main')).resolves.toBeNull();
  });

  it('defers existing rows to a future due time without letting them occupy the current due page', async () => {
    const [deferredId] = await seedRows([
      buildGithubCleanupOutboxRecord({
        remoteKey: REMOTE_A,
        paths: ['old.md'],
        reason: 'identity_move',
        replacementConversationId: 9,
        createdAt: 1,
      }),
      buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_A, paths: ['delete.md'], reason: 'delete', createdAt: 2 }),
    ]);

    await deferGithubCleanupRows([deferredId], 100);
    const due = await listDueGithubCleanupRows(REMOTE_A, 10, 1);
    expect(due.rows.map((row) => row.paths[0])).toEqual(['delete.md']);
    expect(due.hasMoreDue).toBe(false);
    await expect(getNextGithubCleanupDueAt(REMOTE_A)).resolves.toBe(2);

    const rows = await readAllRows();
    expect(rows.find((row) => row.id === deferredId)?.nextAttemptAt).toBe(100);
  });

  it('acks rows idempotently and leaves unrelated rows untouched', async () => {
    const [firstId, secondId] = await seedRows([
      buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_A, paths: ['one.md'], reason: 'delete', createdAt: 1 }),
      buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_A, paths: ['two.md'], reason: 'delete', createdAt: 2 }),
    ]);

    await ackGithubCleanupRows([firstId, firstId, 999_999]);
    await ackGithubCleanupRows([firstId]);
    expect((await readAllRows()).map((row) => row.id)).toEqual([secondId]);
  });

  it('skips malformed persisted rows rather than returning them as deletion authority', async () => {
    await seedRows([
      {
        remoteKey: REMOTE_A,
        paths: ['../unsafe.md'],
        reason: 'delete',
        createdAt: 1,
        nextAttemptAt: 1,
      },
      buildGithubCleanupOutboxRecord({ remoteKey: REMOTE_A, paths: ['safe.md'], reason: 'delete', createdAt: 2 }),
    ]);

    const result = await listDueGithubCleanupRows(REMOTE_A, 10);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.paths).toEqual(['safe.md']);
  });
});
