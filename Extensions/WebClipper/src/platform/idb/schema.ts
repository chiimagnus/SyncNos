export const DB_NAME = 'webclipper';
export const DB_VERSION = 3;

function ensureConversationsStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('conversations')) {
    const store = db.createObjectStore('conversations', {
      keyPath: 'id',
      autoIncrement: true,
    });
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], {
      unique: true,
    });
    store.createIndex('by_lastCapturedAt', 'lastCapturedAt', { unique: false });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore('conversations');
  if (!store.indexNames.contains('by_source_conversationKey')) {
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], {
      unique: true,
    });
  }
  if (!store.indexNames.contains('by_lastCapturedAt')) {
    store.createIndex('by_lastCapturedAt', 'lastCapturedAt', { unique: false });
  }
}

function ensureMessagesStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('messages')) {
    const store = db.createObjectStore('messages', {
      keyPath: 'id',
      autoIncrement: true,
    });
    store.createIndex('by_conversationId_sequence', ['conversationId', 'sequence'], {
      unique: false,
    });
    store.createIndex('by_conversationId_messageKey', ['conversationId', 'messageKey'], {
      unique: true,
    });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore('messages');
  if (!store.indexNames.contains('by_conversationId_sequence')) {
    store.createIndex('by_conversationId_sequence', ['conversationId', 'sequence'], {
      unique: false,
    });
  }
  if (!store.indexNames.contains('by_conversationId_messageKey')) {
    store.createIndex('by_conversationId_messageKey', ['conversationId', 'messageKey'], {
      unique: true,
    });
  }
}

function ensureSyncMappingsStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('sync_mappings')) {
    const store = db.createObjectStore('sync_mappings', {
      keyPath: 'id',
      autoIncrement: true,
    });
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], {
      unique: true,
    });
    store.createIndex('by_notionPageId', 'notionPageId', { unique: false });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore('sync_mappings');
  if (!store.indexNames.contains('by_source_conversationKey')) {
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], {
      unique: true,
    });
  }
  if (!store.indexNames.contains('by_notionPageId')) {
    store.createIndex('by_notionPageId', 'notionPageId', { unique: false });
  }
}

function onUpgradeNeeded(request: IDBOpenDBRequest): void {
  const db = request.result;
  const tx = request.transaction;
  ensureConversationsStore(db, tx);
  ensureMessagesStore(db, tx);
  ensureSyncMappingsStore(db, tx);
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => onUpgradeNeeded(req);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('failed to open indexeddb'));
  });
}
