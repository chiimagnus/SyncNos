import { describe, expect, it, vi } from 'vitest';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { DATA_REVISION_STORE_BY_SCOPE } from '@platform/idb/data-revision-record';
import { closeDbForTests, openDb } from '@platform/idb/schema';
import { exportBackupZipV2 } from '@services/sync/backup/export';
import * as backupUtils from '@services/sync/backup/backup-utils.ts';

describe('backup zip v2 schema', () => {
  it('validateStorageLocalDocument rejects invalid shapes', () => {
    expect(backupUtils.validateStorageLocalDocument(null).ok).toBe(false);
    expect(backupUtils.validateStorageLocalDocument({ schemaVersion: 2, storageLocal: {} }).ok).toBe(false);
    expect(backupUtils.validateStorageLocalDocument({ schemaVersion: 1, storageLocal: 'nope' }).ok).toBe(false);
    expect(
      backupUtils.validateStorageLocalDocument({ schemaVersion: 1, storageLocal: { popup_active_tab: 'settings' } }).ok,
    ).toBe(true);
  });

  it('validateBackupManifest rejects unknown version and duplicate files', () => {
    const base = {
      exportedAt: new Date().toISOString(),
      db: { name: 'webclipper', version: 3 },
      counts: { conversations: 1, messages: 1, sync_mappings: 0 },
      config: { storageLocalPath: 'config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
    };

    expect(backupUtils.validateBackupManifest({ ...base, backupSchemaVersion: 999, sources: [] }).ok).toBe(false);

    const dup = backupUtils.validateBackupManifest({
      ...base,
      backupSchemaVersion: 2,
      sources: [
        { source: 'chatgpt', conversationCount: 2, files: ['sources/chatgpt/a.json', 'sources/chatgpt/a.json'] },
      ],
    });
    expect(dup.ok).toBe(false);
  });

  it('validateBackupManifest rejects unsafe file paths', () => {
    const res = backupUtils.validateBackupManifest({
      backupSchemaVersion: 2,
      exportedAt: new Date().toISOString(),
      db: { name: 'webclipper', version: 3 },
      counts: { conversations: 1, messages: 0, sync_mappings: 0 },
      config: { storageLocalPath: 'config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
      sources: [{ source: 'chatgpt', conversationCount: 1, files: ['../sources/chatgpt/a.json'] }],
    });
    expect(res.ok).toBe(false);
  });

  it('ZIP export reads only business stores and never revision metadata stores', async () => {
    closeDbForTests();
    // @ts-expect-error fake IndexedDB test global
    globalThis.indexedDB = indexedDB;
    // @ts-expect-error fake IndexedDB test global
    globalThis.IDBKeyRange = IDBKeyRange;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('webclipper');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    const storageLocal: Record<string, unknown> = {};
    (globalThis as any).chrome = {
      runtime: {},
      storage: {
        local: {
          get(_keys: unknown, callback: (value: Record<string, unknown>) => void) {
            callback({ ...storageLocal });
          },
          set(payload: Record<string, unknown>, callback: () => void) {
            Object.assign(storageLocal, payload);
            callback();
          },
        },
      },
    };

    const db = await openDb();
    const originalTransaction = db.transaction.bind(db);
    const openedTransactions: string[][] = [];
    const spy = vi.spyOn(db, 'transaction').mockImplementation(((
      storeNames: string | string[],
      mode?: IDBTransactionMode,
    ) => {
      const names = (Array.isArray(storeNames) ? storeNames : [storeNames]).map(String);
      openedTransactions.push(names);
      return originalTransaction(storeNames, mode);
    }) as any);

    try {
      await exportBackupZipV2();
    } finally {
      spy.mockRestore();
      closeDbForTests();
      delete (globalThis as any).chrome;
    }

    const businessStores = ['conversations', 'messages', 'sync_mappings', 'image_cache', 'article_comments'];
    expect(openedTransactions).toContainEqual(businessStores);
    const revisionStores = new Set(Object.values(DATA_REVISION_STORE_BY_SCOPE));
    expect(openedTransactions.flat().some((storeName) => revisionStores.has(storeName))).toBe(false);
  });

  it('fails export instead of choosing a duplicate sync mapping when the schema invariant is broken', async () => {
    closeDbForTests();
    // @ts-expect-error fake IndexedDB test global
    globalThis.indexedDB = indexedDB;
    // @ts-expect-error fake IndexedDB test global
    globalThis.IDBKeyRange = IDBKeyRange;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('webclipper');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('webclipper', 10);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        const mappings = db.createObjectStore('sync_mappings', { keyPath: 'id', autoIncrement: true });
        mappings.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: false });
        db.createObjectStore('image_cache', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('article_comments', { keyPath: 'id', autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const seed = rawDb.transaction(['conversations', 'sync_mappings'], 'readwrite');
    seed.objectStore('conversations').add({ source: 'chatgpt', conversationKey: 'c1', title: 'Conversation' });
    seed.objectStore('sync_mappings').add({ source: 'chatgpt', conversationKey: 'c1', updatedAt: 1 });
    seed.objectStore('sync_mappings').add({ source: 'chatgpt', conversationKey: 'c1', updatedAt: 2 });
    await new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve();
      seed.onerror = () => reject(seed.error);
      seed.onabort = () => reject(seed.error);
    });
    rawDb.close();

    (globalThis as any).chrome = {
      runtime: {},
      storage: {
        local: {
          get(_keys: unknown, callback: (value: Record<string, unknown>) => void) {
            callback({});
          },
          set(_payload: Record<string, unknown>, callback: () => void) {
            callback();
          },
        },
      },
    };

    try {
      await expect(exportBackupZipV2()).rejects.toThrow('duplicate sync mapping identity: chatgpt||c1');
    } finally {
      closeDbForTests();
      delete (globalThis as any).chrome;
    }
  });

  it('validateConversationBundle accepts a minimal bundle with null mapping', () => {
    const ok = backupUtils.validateConversationBundle({
      schemaVersion: 1,
      conversation: { source: 'chatgpt', conversationKey: 'c1', title: 'T' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi', updatedAt: 1, sequence: 1 }],
      syncMapping: null,
    });
    expect(ok.ok).toBe(true);
  });
});
