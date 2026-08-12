import { openDb as openSchemaDb } from '@platform/idb/schema';

export {
  openTransaction as tx,
  requestToPromise as reqToPromise,
  transactionDone as txDone,
} from '@platform/idb/transactions';

let cachedDb: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

export async function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb;
  if (openingDb) return openingDb;

  openingDb = openSchemaDb()
    .then((db) => {
      cachedDb = db;
      return db;
    })
    .finally(() => {
      openingDb = null;
    });

  return openingDb;
}

export async function __closeDbForTests(): Promise<void> {
  try {
    const db = cachedDb || (openingDb ? await openingDb : null);
    db?.close?.();
  } catch (_e) {
    // ignore
  } finally {
    cachedDb = null;
    openingDb = null;
  }
}
