import { openDb } from '@platform/idb/schema';
import { estimateOriginStorage } from '@platform/storage/storage-estimate';

export type StorageOverview = {
  imageCacheRecords: number;
  originUsageBytes: number | null;
  originQuotaBytes: number | null;
};

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('indexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('indexedDB transaction aborted'));
  });
}

export async function getStorageOverview(): Promise<StorageOverview> {
  const db = await openDb();
  const transaction = db.transaction('image_cache', 'readonly');
  const done = transactionDone(transaction);
  const estimate = estimateOriginStorage();
  const [imageCacheRecords, , origin] = await Promise.all([
    requestDone(transaction.objectStore('image_cache').count()),
    done,
    estimate,
  ]);

  return {
    imageCacheRecords,
    originUsageBytes: origin.usageBytes,
    originQuotaBytes: origin.quotaBytes,
  };
}
