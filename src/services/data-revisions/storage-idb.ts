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

export async function readDataRevisionSnapshot(): Promise<DataRevisionSnapshot> {
  const db = await openDb();
  const storeNames = DATA_REVISION_SCOPES.map((scope) => DATA_REVISION_STORE_BY_SCOPE[scope]);
  const transaction = db.transaction(storeNames, 'readonly');
  const done = txDone(transaction);

  const requests = DATA_REVISION_SCOPES.map(async (scope) => {
    const storeName = DATA_REVISION_STORE_BY_SCOPE[scope];
    const stored = await requestResult(transaction.objectStore(storeName).get(DATA_REVISION_RECORD_KEY));
    return [scope, normalizeDataRevisionRecord(stored).revision] as const;
  });

  let entries: ReadonlyArray<readonly [DataRevisionScope, number]>;
  try {
    entries = await Promise.all(requests);
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }

  await done;
  return Object.fromEntries(entries) as DataRevisionSnapshot;
}
