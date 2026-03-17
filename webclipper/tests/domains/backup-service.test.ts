import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { exportBackupZipV2 } from '../../src/sync/backup/export';
import { importBackupLegacyJsonMerge, importBackupZipV2Merge } from '../../src/sync/backup/import';
import { extractZipEntries } from '../../src/sync/backup/zip-utils';
import { __closeDbForTests } from '../../src/sync/backup/idb';
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
        get(keys: any, cb: (res: Record<string, unknown>) => void) {
          if (keys == null) {
            cb({ ...store });
            return;
          }
          const list = Array.isArray(keys) ? keys : [];
          const out: Record<string, unknown> = {};
          for (const k of list) out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
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

describe('backup service', () => {
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
    const t = db.transaction(['conversations', 'messages', 'sync_mappings', 'image_cache'], 'readwrite');
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
    const imgId = await reqToPromise<number>(
      t.objectStore('image_cache').add({
        conversationId: convId,
        url: 'https://img.example/x.png',
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        byteSize: 3,
        contentType: 'image/png',
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('messages').add({
        conversationId: convId,
        messageKey: 'm1',
        role: 'user',
        contentText: 'hi',
        contentMarkdown: `![x](syncnos-asset://${imgId})`,
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
    expect(manifest.assets.imageCacheIndexPath).toBe('assets/image-cache/index.json');

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

    expect(entries.has('assets/image-cache/index.json')).toBe(true);
    const imageIndex = JSON.parse(new TextDecoder().decode(entries.get('assets/image-cache/index.json')!));
    expect(imageIndex.schemaVersion).toBe(1);
    expect(Array.isArray(imageIndex.assets)).toBe(true);
    expect(imageIndex.assets.length).toBe(1);
    expect(imageIndex.assets[0].assetId).toBe(imgId);
    expect(typeof imageIndex.assets[0].blobPath).toBe('string');
    expect(entries.has(imageIndex.assets[0].blobPath)).toBe(true);
  });

  it('importBackupZipV2Merge restores image cache and rewrites syncnos-asset urls', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const db = await openDb();
    const t = db.transaction(['conversations', 'messages', 'sync_mappings', 'image_cache'], 'readwrite');
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
    const oldImgId = await reqToPromise<number>(
      t.objectStore('image_cache').add({
        conversationId: convId,
        url: 'https://img.example/x.png',
        blob: new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/png' }),
        byteSize: 4,
        contentType: 'image/png',
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('messages').add({
        conversationId: convId,
        messageKey: 'm1',
        role: 'user',
        contentText: 'hi',
        contentMarkdown: `![x](syncnos-asset://${oldImgId})`,
        sequence: 1,
        updatedAt: 1,
      }) as any,
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    db.close();

    const exported = await exportBackupZipV2();
    const entries = await extractZipEntries(exported.blob);

    await __closeDbForTests();
    await deleteDb('webclipper');

    const stats = await importBackupZipV2Merge(entries);
    expect(stats.conversationsAdded + stats.conversationsUpdated).toBeGreaterThanOrEqual(1);

    const db2 = await openDb();
    const t2 = db2.transaction(['messages', 'image_cache'], 'readonly');
    const msgs = await reqToPromise<any[]>(t2.objectStore('messages').getAll() as any);
    const assets = await reqToPromise<any[]>(t2.objectStore('image_cache').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      t2.oncomplete = () => resolve();
      t2.onerror = () => reject(t2.error);
      t2.onabort = () => reject(t2.error);
    });
    db2.close();

    expect(msgs.length).toBe(1);
    expect(assets.length).toBe(1);
    const md = String(msgs[0].contentMarkdown || '');
    const match = /syncnos-asset:\/\/(\d+)/.exec(md);
    expect(match).not.toBeNull();
    const referencedId = Number(match?.[1]);
    expect(assets.some((a) => Number(a.id) === referencedId)).toBe(true);
  });

  it('importBackupZipV2Merge tolerates missing image index and strips syncnos-asset urls', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const db = await openDb();
    const t = db.transaction(['conversations', 'messages', 'image_cache'], 'readwrite');
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
    const oldImgId = await reqToPromise<number>(
      t.objectStore('image_cache').add({
        conversationId: convId,
        url: 'https://img.example/x.png',
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        byteSize: 3,
        contentType: 'image/png',
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('messages').add({
        conversationId: convId,
        messageKey: 'm1',
        role: 'user',
        contentText: 'hi',
        contentMarkdown: `![x](syncnos-asset://${oldImgId})`,
        sequence: 1,
        updatedAt: 1,
      }) as any,
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    db.close();

    const exported = await exportBackupZipV2();
    const entries = await extractZipEntries(exported.blob);

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    const indexPath = String(manifest.assets?.imageCacheIndexPath || '');
    const indexDoc = JSON.parse(new TextDecoder().decode(entries.get(indexPath)!));
    const blobPath = String(indexDoc.assets?.[0]?.blobPath || '');

    entries.delete(indexPath);
    if (blobPath) entries.delete(blobPath);

    await __closeDbForTests();
    await deleteDb('webclipper');

    await importBackupZipV2Merge(entries);

    const db2 = await openDb();
    const t2 = db2.transaction(['messages', 'image_cache'], 'readonly');
    const msgs = await reqToPromise<any[]>(t2.objectStore('messages').getAll() as any);
    const assets = await reqToPromise<any[]>(t2.objectStore('image_cache').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      t2.oncomplete = () => resolve();
      t2.onerror = () => reject(t2.error);
      t2.onabort = () => reject(t2.error);
    });
    db2.close();

    expect(assets.length).toBe(0);
    expect(String(msgs[0].contentMarkdown || '')).not.toContain('syncnos-asset://');
    expect(String(msgs[0].contentMarkdown || '')).toContain('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');
  });

  it('importBackupZipV2Merge tolerates missing image blob and falls back to https url', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const db = await openDb();
    const t = db.transaction(['conversations', 'messages', 'image_cache'], 'readwrite');
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
    const oldImgId = await reqToPromise<number>(
      t.objectStore('image_cache').add({
        conversationId: convId,
        url: 'https://img.example/x.png',
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        byteSize: 3,
        contentType: 'image/png',
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('messages').add({
        conversationId: convId,
        messageKey: 'm1',
        role: 'user',
        contentText: 'hi',
        contentMarkdown: `![x](syncnos-asset://${oldImgId})`,
        sequence: 1,
        updatedAt: 1,
      }) as any,
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    db.close();

    const exported = await exportBackupZipV2();
    const entries = await extractZipEntries(exported.blob);

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    const indexPath = String(manifest.assets?.imageCacheIndexPath || '');
    const indexDoc = JSON.parse(new TextDecoder().decode(entries.get(indexPath)!));
    const blobPath = String(indexDoc.assets?.[0]?.blobPath || '');
    if (blobPath) entries.delete(blobPath);

    await __closeDbForTests();
    await deleteDb('webclipper');

    await importBackupZipV2Merge(entries);

    const db2 = await openDb();
    const t2 = db2.transaction(['messages', 'image_cache'], 'readonly');
    const msgs = await reqToPromise<any[]>(t2.objectStore('messages').getAll() as any);
    const assets = await reqToPromise<any[]>(t2.objectStore('image_cache').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      t2.oncomplete = () => resolve();
      t2.onerror = () => reject(t2.error);
      t2.onabort = () => reject(t2.error);
    });
    db2.close();

    expect(assets.length).toBe(0);
    expect(String(msgs[0].contentMarkdown || '')).toContain('https://img.example/x.png');
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
