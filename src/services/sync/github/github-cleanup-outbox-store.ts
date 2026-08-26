import {
  GITHUB_CLEANUP_OUTBOX_DUE_INDEX,
  GITHUB_CLEANUP_OUTBOX_STORE,
  normalizeGithubCleanupOutboxRecord,
  type GithubCleanupOutboxRecord,
} from '@platform/idb/github-cleanup-outbox-record';
import { openDb } from '@platform/idb/schema';

export const GITHUB_CLEANUP_OUTBOX_BATCH_LIMIT = 100;

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('github cleanup outbox transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('github cleanup outbox transaction aborted'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('github cleanup outbox request failed'));
  });
}

function requireRemoteKey(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('github_cleanup_outbox_remote_key_invalid');
  }
  return value;
}

function requireTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('github_cleanup_outbox_timestamp_invalid');
  }
  return value;
}

function requireLimit(value: unknown): number {
  if (value == null) return GITHUB_CLEANUP_OUTBOX_BATCH_LIMIT;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('github_cleanup_outbox_limit_invalid');
  }
  return Math.min(value, GITHUB_CLEANUP_OUTBOX_BATCH_LIMIT);
}

function normalizeIds(values: readonly unknown[]): number[] {
  return [
    ...new Set(
      values.filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0),
    ),
  ];
}

export async function listDueGithubCleanupRows(
  remoteKeyInput: string,
  nowInput: number,
  limitInput = GITHUB_CLEANUP_OUTBOX_BATCH_LIMIT,
): Promise<{ rows: GithubCleanupOutboxRecord[]; hasMoreDue: boolean }> {
  const remoteKey = requireRemoteKey(remoteKeyInput);
  const now = requireTimestamp(nowInput);
  const limit = requireLimit(limitInput);
  const db = await openDb();
  try {
    const transaction = db.transaction([GITHUB_CLEANUP_OUTBOX_STORE], 'readonly');
    const index = transaction.objectStore(GITHUB_CLEANUP_OUTBOX_STORE).index(GITHUB_CLEANUP_OUTBOX_DUE_INDEX);
    const range = globalThis.IDBKeyRange.bound([remoteKey, 0, 0], [remoteKey, now, Infinity]);

    const result = await new Promise<{ rows: GithubCleanupOutboxRecord[]; hasMoreDue: boolean }>((resolve, reject) => {
      const rows: GithubCleanupOutboxRecord[] = [];
      const request = index.openCursor(range);
      request.onerror = () => reject(request.error || new Error('github cleanup outbox cursor failed'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve({ rows, hasMoreDue: false });
        const row = normalizeGithubCleanupOutboxRecord(cursor.value);
        if (row && row.remoteKey === remoteKey && row.nextAttemptAt <= now) {
          if (rows.length >= limit) return resolve({ rows, hasMoreDue: true });
          rows.push(row);
        }
        cursor.continue();
      };
    });
    await txDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

export async function getNextGithubCleanupDueAt(remoteKeyInput: string): Promise<number | null> {
  const remoteKey = requireRemoteKey(remoteKeyInput);
  const db = await openDb();
  try {
    const transaction = db.transaction([GITHUB_CLEANUP_OUTBOX_STORE], 'readonly');
    const index = transaction.objectStore(GITHUB_CLEANUP_OUTBOX_STORE).index(GITHUB_CLEANUP_OUTBOX_DUE_INDEX);
    const range = globalThis.IDBKeyRange.bound([remoteKey, 0, 0], [remoteKey, Infinity, Infinity]);
    const next = await new Promise<number | null>((resolve, reject) => {
      const request = index.openCursor(range);
      request.onerror = () => reject(request.error || new Error('github cleanup outbox cursor failed'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(null);
        const row = normalizeGithubCleanupOutboxRecord(cursor.value);
        if (row && row.remoteKey === remoteKey) return resolve(row.nextAttemptAt);
        cursor.continue();
      };
    });
    await txDone(transaction);
    return next;
  } finally {
    db.close();
  }
}

export async function deferGithubCleanupRows(idsInput: readonly unknown[], nextAttemptAtInput: number): Promise<void> {
  const ids = normalizeIds(idsInput);
  if (!ids.length) return;
  const nextAttemptAt = requireTimestamp(nextAttemptAtInput);
  const db = await openDb();
  try {
    const transaction = db.transaction([GITHUB_CLEANUP_OUTBOX_STORE], 'readwrite');
    const store = transaction.objectStore(GITHUB_CLEANUP_OUTBOX_STORE);
    for (const id of ids) {
      const row = normalizeGithubCleanupOutboxRecord(await requestResult<any>(store.get(id)));
      if (!row) continue;
      await requestResult(store.put({ ...row, nextAttemptAt }));
    }
    await txDone(transaction);
  } finally {
    db.close();
  }
}

export async function ackGithubCleanupRows(idsInput: readonly unknown[]): Promise<void> {
  const ids = normalizeIds(idsInput);
  if (!ids.length) return;
  const db = await openDb();
  try {
    const transaction = db.transaction([GITHUB_CLEANUP_OUTBOX_STORE], 'readwrite');
    const store = transaction.objectStore(GITHUB_CLEANUP_OUTBOX_STORE);
    for (const id of ids) store.delete(id);
    await txDone(transaction);
  } finally {
    db.close();
  }
}
