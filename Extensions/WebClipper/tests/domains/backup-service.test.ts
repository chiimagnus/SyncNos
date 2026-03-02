import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { exportBackupZipV2 } from '../../src/domains/backup/export';
import { importBackupLegacyJsonMerge } from '../../src/domains/backup/import';
import { extractZipEntries } from '../../src/domains/backup/zip-utils';
import { __closeDbForTests } from '../../src/domains/backup/idb';
import { openDb } from '../../src/platform/idb/schema';

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as any);
}

function mockChromeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const setPayloads: Record<string, unknown>[] = [];

  return {
    runtime: { lastError: null as any },
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          setPayloads.push({ ...(payload || {}) });
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        },
        remove(keys: string[], cb: () => void) {
          for (const k of keys || []) delete store[k];
          cb();
        },
      },
    },
    __store: store,
    __setPayloads: setPayloads,
  };
}

beforeEach(async () => {
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  await __closeDbForTests();
  await deleteDb('webclipper');
});

describe('domains/backup service', () => {
  it('exportBackupZipV2 emits manifest + bundles and filters storage.local', async () => {
    const chromeMock = mockChromeStorage({
      notion_oauth_client_id: 'client_id',
      notion_parent_page_id: 'page',
      notion_oauth_token_v1: { accessToken: 'secret' },
    });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const db = await openDb();
    const t = db.transaction(['conversations', 'messages', 'sync_mappings'], 'readwrite');
    const convId = await reqToPromise<number>(
      t.objectStore('conversations').add({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'c1',
        title: 'Hello',
        url: 'https://x',
        warningFlags: [],
        lastCapturedAt: 1,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('messages').add({
        conversationId: convId,
        messageKey: 'm1',
        role: 'user',
        contentText: 'hi',
        sequence: 1,
        updatedAt: 1,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('sync_mappings').add({
        source: 'chatgpt',
        conversationKey: 'c1',
        notionPageId: 'np1',
        updatedAt: 1,
      }) as any,
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    db.close();

    const out = await exportBackupZipV2();
    expect(out.filename.endsWith('.zip')).toBe(true);

    const entries = await extractZipEntries(out.blob);
    expect(entries.has('manifest.json')).toBe(true);
    expect(entries.has('config/storage-local.json')).toBe(true);

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    expect(manifest.backupSchemaVersion).toBe(2);
    expect(manifest.counts.conversations).toBe(1);

    const config = JSON.parse(new TextDecoder().decode(entries.get('config/storage-local.json')!));
    expect(config.schemaVersion).toBe(1);
    expect(config.storageLocal.notion_oauth_client_id).toBe('client_id');
    expect(config.storageLocal.notion_parent_page_id).toBe('page');
    expect(config.storageLocal.notion_oauth_token_v1).toBeUndefined();

    const bundlePath = manifest.sources[0].files[0];
    const bundle = JSON.parse(new TextDecoder().decode(entries.get(bundlePath)!));
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.conversation.source).toBe('chatgpt');
    expect(bundle.messages.length).toBe(1);
    expect(bundle.syncMapping.notionPageId).toBe('np1');
  });

  it('importBackupLegacyJsonMerge merges into IndexedDB and applies allowlisted settings only', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const doc = {
      schemaVersion: 1,
      stores: {
        conversations: [
          {
            id: 10,
            sourceType: 'chat',
            source: 'chatgpt',
            conversationKey: 'c1',
            title: 'T',
            url: 'https://x',
            warningFlags: [],
            lastCapturedAt: 1,
          },
        ],
        messages: [
          {
            id: 1,
            conversationId: 10,
            messageKey: 'm1',
            role: 'user',
            contentText: 'hi',
            contentMarkdown: '',
            sequence: 1,
            updatedAt: 1,
          },
        ],
        sync_mappings: [
          {
            id: 2,
            source: 'chatgpt',
            conversationKey: 'c1',
            notionPageId: 'np1',
            updatedAt: 1,
          },
        ],
      },
      storageLocal: {
        notion_oauth_client_id: 'cid',
        notion_parent_page_id: 'pid',
        notion_oauth_token_v1: { accessToken: 'secret' },
      },
    };

    const stats = await importBackupLegacyJsonMerge(doc);
    expect(stats.conversationsAdded).toBe(1);
    expect(stats.messagesAdded).toBe(1);
    expect(stats.mappingsAdded).toBe(1);
    expect(stats.settingsApplied).toBeGreaterThanOrEqual(1);

    const db = await openDb();
    const t = db.transaction(['conversations', 'messages', 'sync_mappings'], 'readonly');
    const convs = await reqToPromise<any[]>(t.objectStore('conversations').getAll() as any);
    const msgs = await reqToPromise<any[]>(t.objectStore('messages').getAll() as any);
    const maps = await reqToPromise<any[]>(t.objectStore('sync_mappings').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    db.close();

    expect(convs.length).toBe(1);
    expect(msgs.length).toBe(1);
    expect(maps.length).toBe(1);

    // Ensure secrets are not stored via settings merge.
    expect(chromeMock.__setPayloads.some((p) => Object.prototype.hasOwnProperty.call(p, 'notion_oauth_token_v1'))).toBe(false);
    expect(chromeMock.__setPayloads.some((p) => (p as any).notion_oauth_client_id === 'cid')).toBe(true);
  });
});
