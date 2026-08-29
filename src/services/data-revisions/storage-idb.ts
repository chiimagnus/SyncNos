import {
  DATA_REVISION_RECORD_KEY,
  DATA_REVISION_SCOPES,
  DATA_REVISION_STORE_BY_SCOPE,
  normalizeDataRevisionRecord,
  type DataRevisionScope,
  type DataRevisionSnapshot,
} from '@platform/idb/data-revision-record';
import { openDb } from '@platform/idb/schema';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('data revision request failed'));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('data revision transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('data revision transaction aborted'));
  });
}

export async function readDataRevision(scope: DataRevisionScope): Promise<number> {
  const storeName = DATA_REVISION_STORE_BY_SCOPE[scope];
  if (!storeName) throw new Error('data_revision_scope_invalid');

  const db = await openDb();
  const transaction = db.transaction([storeName], 'readonly');
  const done = txDone(transaction);
  const stored = await requestResult(transaction.objectStore(storeName).get(DATA_REVISION_RECORD_KEY));
  await done;
  return normalizeDataRevisionRecord(stored).revision;
}

async function readSnapshotPass(): Promise<DataRevisionSnapshot> {
  const entries = await Promise.all(
    DATA_REVISION_SCOPES.map(async (scope) => [scope, await readDataRevision(scope)] as const),
  );
  return Object.fromEntries(entries) as DataRevisionSnapshot;
}

function snapshotsEqual(left: DataRevisionSnapshot, right: DataRevisionSnapshot): boolean {
  return DATA_REVISION_SCOPES.every((scope) => left[scope] === right[scope]);
}

export async function readDataRevisionSnapshot(): Promise<DataRevisionSnapshot> {
  const first = await readSnapshotPass();
  const second = await readSnapshotPass();
  if (snapshotsEqual(first, second)) return second;

  const third = await readSnapshotPass();
  if (snapshotsEqual(second, third)) return third;
  throw Object.assign(new Error('snapshot_unstable'), { code: 'snapshot_unstable' as const });
}
