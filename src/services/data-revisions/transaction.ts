import {
  DATA_REVISION_RECORD_KEY,
  DATA_REVISION_STORE_BY_SCOPE,
  normalizeDataRevisionRecord,
  type DataRevisionScope,
} from '@platform/idb/data-revision-record';
import { publishDataRevisionWake } from '@services/data-revisions/wake';

export type TrackedTransactionContext = {
  stores: Record<string, IDBObjectStore>;
  markChanged: (scope: DataRevisionScope) => void;
};

type TrackedTransactionInput = {
  db: IDBDatabase;
  stores: readonly string[];
  revisionScopes: readonly DataRevisionScope[];
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('tracked transaction request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('tracked transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('tracked transaction aborted'));
  });
}

function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch (_error) {
    // Transaction may already be committed or aborted.
  }
}

function revisionError(code: 'revision_scope_invalid' | 'revision_scope_store_missing' | 'revision_overflow', scope?: unknown) {
  return Object.assign(new Error(code), { code, ...(scope == null ? null : { scope }) });
}

export async function runTrackedTransaction<T>(
  input: TrackedTransactionInput,
  work: (context: TrackedTransactionContext) => Promise<T> | T,
): Promise<T> {
  const businessStores = [...new Set(input.stores.map((store) => String(store || '').trim()).filter(Boolean))];
  const declaredScopes = [...new Set(input.revisionScopes)];
  for (const scope of declaredScopes) {
    if (!DATA_REVISION_STORE_BY_SCOPE[scope]) throw revisionError('revision_scope_invalid', scope);
    if (!businessStores.includes(scope)) throw revisionError('revision_scope_store_missing', scope);
  }

  const revisionStores = declaredScopes.map((scope) => DATA_REVISION_STORE_BY_SCOPE[scope]);
  const transaction = input.db.transaction([...new Set([...businessStores, ...revisionStores])], 'readwrite');
  const done = transactionDone(transaction);
  const stores = Object.fromEntries(businessStores.map((name) => [name, transaction.objectStore(name)]));
  const changedScopes = new Set<DataRevisionScope>();
  const declaredScopeSet = new Set<DataRevisionScope>(declaredScopes);
  const businessStoreSet = new Set(businessStores);

  const markChanged = (scope: DataRevisionScope): void => {
    if (!declaredScopeSet.has(scope)) {
      abortQuietly(transaction);
      throw revisionError('revision_scope_invalid', scope);
    }
    if (!businessStoreSet.has(scope)) {
      abortQuietly(transaction);
      throw revisionError('revision_scope_store_missing', scope);
    }
    changedScopes.add(scope);
  };

  try {
    const result = await work({ stores, markChanged });
    for (const scope of changedScopes) {
      const revisionStore = transaction.objectStore(DATA_REVISION_STORE_BY_SCOPE[scope]);
      const current = normalizeDataRevisionRecord(await requestResult(revisionStore.get(DATA_REVISION_RECORD_KEY)));
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        abortQuietly(transaction);
        throw revisionError('revision_overflow', scope);
      }
      await requestResult(
        revisionStore.put(
          { revision: current.revision + 1, updatedAt: Date.now() },
          DATA_REVISION_RECORD_KEY,
        ),
      );
    }
    await done;
    if (changedScopes.size > 0) publishDataRevisionWake();
    return result;
  } catch (error) {
    abortQuietly(transaction);
    await done.catch(() => undefined);
    throw error;
  }
}
