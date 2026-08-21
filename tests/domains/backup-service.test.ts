import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { exportBackupZipV2 } from '@services/sync/backup/export';
import { importBackupLegacyJsonMerge, importBackupZipV2Merge } from '@services/sync/backup/import';
import { extractZipEntries } from '@services/sync/backup/zip-utils';
import { __closeDbForTests } from '@services/sync/backup/idb';
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
    expect(bundle.syncMapping.id).toBeUndefined();

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
    expect(String(msgs[0].contentMarkdown || '')).toContain(
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    );
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

  it('importBackupZipV2Merge tolerates missing conversation bundle entry', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const db = await openDb();
    const t = db.transaction(['conversations', 'messages'], 'readwrite');
    const conv1 = await reqToPromise<number>(
      t.objectStore('conversations').add({
        sourceType: 'chat',
        source: 'notionai',
        conversationKey: 'c1',
        title: '打招呼',
        url: 'https://x',
        warningFlags: [],
        lastCapturedAt: 1,
      }) as any,
    );
    const conv2 = await reqToPromise<number>(
      t.objectStore('conversations').add({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'c2',
        title: 'Hello',
        url: 'https://y',
        warningFlags: [],
        lastCapturedAt: 2,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('messages').add({
        conversationId: conv1,
        messageKey: 'm1',
        role: 'user',
        contentText: 'hi',
        contentMarkdown: '',
        sequence: 1,
        updatedAt: 1,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('messages').add({
        conversationId: conv2,
        messageKey: 'm2',
        role: 'user',
        contentText: 'hi',
        contentMarkdown: '',
        sequence: 1,
        updatedAt: 2,
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

    // Remove the first referenced bundle entry to simulate a user-edited / corrupted zip.
    const firstBundlePath = String(manifest.sources?.[0]?.files?.[0] || '');
    if (firstBundlePath) entries.delete(firstBundlePath);

    await __closeDbForTests();
    await deleteDb('webclipper');

    const stats = await importBackupZipV2Merge(entries);
    expect(stats.conversationsAdded + stats.conversationsUpdated).toBeGreaterThanOrEqual(1);

    const db2 = await openDb();
    const t2 = db2.transaction(['conversations'], 'readonly');
    const convs = await reqToPromise<any[]>(t2.objectStore('conversations').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      t2.oncomplete = () => resolve();
      t2.onerror = () => reject(t2.error);
      t2.onabort = () => reject(t2.error);
    });
    db2.close();
    expect(convs.length).toBe(1);
  });

  it('importBackupZipV2Merge recovers bundles when manifest paths do not match zip entry names', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    await __closeDbForTests();
    await deleteDb('webclipper');

    const manifest = {
      backupSchemaVersion: 2,
      exportedAt: '2026-03-17T00:00:00.000Z',
      db: { name: 'webclipper', version: 1 },
      counts: { conversations: 1, messages: 1, sync_mappings: 0 },
      config: { storageLocalPath: 'config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
      sources: [{ source: 'notionai', conversationCount: 1, files: ['sources/notionai/notionai-打招呼-abc.json'] }],
    };

    const bundle = {
      schemaVersion: 1,
      conversation: {
        sourceType: 'chat',
        source: 'notionai',
        conversationKey: 'c1',
        title: '打招呼',
        url: 'https://x',
        warningFlags: [],
        lastCapturedAt: 1,
      },
      messages: [
        { messageKey: 'm1', role: 'user', contentText: 'hi', contentMarkdown: 'hi', sequence: 1, updatedAt: 1 },
      ],
      syncMapping: null,
    };

    // Simulate older zips where non-ASCII filenames were encoded without the UTF-8 flag:
    // the bundle exists, but under a different decoded entry name than the manifest-declared path.
    const entries = new Map<string, Uint8Array>();
    const enc = new TextEncoder();
    entries.set('manifest.json', enc.encode(JSON.stringify(manifest)));
    entries.set('config/storage-local.json', enc.encode(JSON.stringify({ schemaVersion: 1, storageLocal: {} })));
    entries.set('sources/conversations.csv', enc.encode('source,conversationKey\n'));
    entries.set('sources/notionai/notionai-µëôµï¢σæ╝-abc.json', enc.encode(JSON.stringify(bundle)));

    const stats = await importBackupZipV2Merge(entries);
    expect(stats.conversationsAdded).toBe(1);
    expect(stats.messagesAdded).toBe(1);
  });

  it('keeps legacy comments orphaned when the same canonical URL maps to multiple conversations', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const enc = new TextEncoder();
    const files = ['sources/web/a.json', 'sources/web/b.json'];
    const manifest = {
      backupSchemaVersion: 2,
      exportedAt: '2026-07-14T00:00:00.000Z',
      db: { name: 'webclipper', version: 1 },
      counts: { conversations: 2, messages: 0, sync_mappings: 0, article_comments: 1 },
      config: { storageLocalPath: 'config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
      sources: [{ source: 'web', conversationCount: 2, files }],
      assets: { articleCommentsIndexPath: 'assets/article-comments/index.json' },
    };
    const conversation = (conversationKey: string) => ({
      schemaVersion: 1,
      conversation: {
        sourceType: 'article',
        source: 'web',
        conversationKey,
        title: conversationKey,
        url: 'https://example.com/shared',
        warningFlags: [],
        lastCapturedAt: 1,
      },
      messages: [],
      syncMapping: null,
    });
    const comments = {
      schemaVersion: 1,
      comments: [
        {
          commentId: 1,
          parentCommentId: null,
          uniqueKey: '',
          canonicalUrl: 'https://example.com/shared',
          quoteText: 'quote',
          commentText: 'legacy',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const entries = new Map<string, Uint8Array>([
      ['manifest.json', enc.encode(JSON.stringify(manifest))],
      ['config/storage-local.json', enc.encode(JSON.stringify({ schemaVersion: 1, storageLocal: {} }))],
      ['sources/conversations.csv', enc.encode('source,conversationKey\n')],
      [files[0]!, enc.encode(JSON.stringify(conversation('a')))],
      [files[1]!, enc.encode(JSON.stringify(conversation('b')))],
      ['assets/article-comments/index.json', enc.encode(JSON.stringify(comments))],
    ]);

    await importBackupZipV2Merge(entries);
    const db = await openDb();
    const tx = db.transaction(['article_comments'], 'readonly');
    const rows = await reqToPromise<any[]>(tx.objectStore('article_comments').getAll());
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.conversationId ?? null).toBeNull();
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
            id: 200,
            source: 'chatgpt',
            conversationKey: 'c1',
            notionPageId: 'np1',
            notionPageUrl: 'https://www.notion.so/ws/np1',
            notionWorkspaceSlug: 'ws',
            lastSyncedMessageKey: 'm1',
            lastSyncedSequence: 1,
            lastSyncedAt: 100,
            lastSyncedMessageUpdatedAt: 1,
            notionSections: { conversations: { headingBlockId: 'h1' } },
            notionSectionCursors: {
              conversations: { lastSyncedMessageKey: 'm1', lastSyncedSequence: 1, lastSyncedMessageUpdatedAt: 1 },
            },
            notionSectionDigests: { article: { digest: 'digest-1', lastSyncedAt: 100 } },
            feishuDocId: 'doc1',
            feishuLastContentHash: 'hash1',
            futureProviderMetadata: { version: 1 },
            updatedAt: 101,
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
    expect(maps[0]).toMatchObject({
      source: 'chatgpt',
      conversationKey: 'c1',
      notionPageId: 'np1',
      notionPageUrl: 'https://www.notion.so/ws/np1',
      notionWorkspaceSlug: 'ws',
      notionSections: { conversations: { headingBlockId: 'h1' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'm1', lastSyncedSequence: 1 } },
      notionSectionDigests: { article: { digest: 'digest-1' } },
      feishuDocId: 'doc1',
      feishuLastContentHash: 'hash1',
      futureProviderMetadata: { version: 1 },
    });
    expect(maps[0].id).not.toBe(200);
    expect(convs[0]).toMatchObject({
      notionPageId: 'np1',
      notionPageUrl: 'https://www.notion.so/ws/np1',
      notionWorkspaceSlug: 'ws',
      feishuDocId: 'doc1',
    });

    // Ensure secrets are not stored via settings merge.
    expect(chromeMock.__setPayloads.some((p) => Object.prototype.hasOwnProperty.call(p, 'notion_oauth_token_v1'))).toBe(
      false,
    );
    expect(chromeMock.__setPayloads.some((p) => (p as any).notion_oauth_client_id === 'cid')).toBe(true);
  });

  it('importBackupZipV2Merge keeps provider states atomic and mirrors the final targets', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const db = await openDb();
    const seedTx = db.transaction(['conversations', 'sync_mappings'], 'readwrite');
    for (const key of ['same', 'different']) {
      await reqToPromise(
        seedTx.objectStore('conversations').add({
          sourceType: 'chat',
          source: 'chatgpt',
          conversationKey: key,
          title: key,
          url: `https://example.com/${key}`,
          notionPageId: key === 'same' ? 'page-same' : 'page-local',
          notionPageUrl: key === 'same' ? 'https://notion.so/old-same' : 'https://notion.so/page-local',
          notionWorkspaceSlug: 'local-ws',
          feishuDocId: key === 'same' ? 'doc-same' : 'doc-local',
          lastCapturedAt: 1,
        }) as any,
      );
    }
    await reqToPromise(
      seedTx.objectStore('sync_mappings').add({
        source: 'chatgpt',
        conversationKey: 'same',
        notionPageId: 'page-same',
        notionPageUrl: 'https://notion.so/old-same',
        notionWorkspaceSlug: 'old-ws',
        lastSyncedMessageKey: 'local-m1',
        lastSyncedSequence: 1,
        lastSyncedAt: 10,
        notionSections: { conversations: { headingBlockId: 'local-heading' } },
        notionSectionCursors: { conversations: { lastSyncedMessageKey: 'local-m1', lastSyncedSequence: 1 } },
        feishuDocId: 'doc-same',
        feishuLastContentHash: 'local-hash',
        localOnly: 'keep',
        updatedAt: 500,
      }) as any,
    );
    await reqToPromise(
      seedTx.objectStore('sync_mappings').add({
        source: 'chatgpt',
        conversationKey: 'different',
        notionPageId: 'page-local',
        notionPageUrl: 'https://notion.so/page-local',
        notionWorkspaceSlug: 'local-ws',
        lastSyncedMessageKey: 'local-m2',
        lastSyncedSequence: 2,
        lastSyncedAt: 20,
        notionSections: { conversations: { headingBlockId: 'local-heading-2' } },
        feishuDocId: 'doc-local',
        feishuLastContentHash: 'local-hash-2',
        updatedAt: 20,
      }) as any,
    );
    await new Promise<void>((resolve, reject) => {
      seedTx.oncomplete = () => resolve();
      seedTx.onerror = () => reject(seedTx.error);
      seedTx.onabort = () => reject(seedTx.error);
    });
    db.close();

    const bundles = [
      {
        key: 'same',
        mapping: {
          source: 'chatgpt',
          conversationKey: 'same',
          notionPageId: 'page-same',
          notionPageUrl: 'https://notion.so/new-same',
          notionWorkspaceSlug: 'new-ws',
          lastSyncedMessageKey: 'incoming-m9',
          lastSyncedSequence: 9,
          lastSyncedAt: 100,
          notionSections: { conversations: { headingBlockId: 'incoming-heading' } },
          notionSectionCursors: { conversations: { lastSyncedMessageKey: 'incoming-m9', lastSyncedSequence: 9 } },
          feishuDocId: 'doc-same',
          feishuLastContentHash: 'incoming-hash',
          incomingOnly: 'filled',
          updatedAt: 100,
        },
      },
      {
        key: 'different',
        mapping: {
          source: 'chatgpt',
          conversationKey: 'different',
          notionPageId: 'page-other',
          notionPageUrl: 'https://notion.so/page-other',
          notionWorkspaceSlug: 'other-ws',
          lastSyncedMessageKey: 'incoming-other',
          lastSyncedSequence: 99,
          lastSyncedAt: 999,
          notionSections: { conversations: { headingBlockId: 'other-heading' } },
          feishuDocId: 'doc-other',
          feishuLastContentHash: 'other-hash',
          incomingOnly: 'filled-different',
          updatedAt: 999,
        },
      },
    ];
    const files = bundles.map((item) => `sources/chatgpt/${item.key}.json`);
    const manifest = {
      backupSchemaVersion: 2,
      exportedAt: '2026-08-21T00:00:00.000Z',
      db: { name: 'webclipper', version: 8 },
      counts: { conversations: 2, messages: 0, sync_mappings: 2 },
      config: { storageLocalPath: 'config/storage-local.json' },
      index: { conversationsCsvPath: 'sources/conversations.csv' },
      sources: [{ source: 'chatgpt', conversationCount: 2, files }],
    };
    const enc = new TextEncoder();
    const entries = new Map<string, Uint8Array>([
      ['manifest.json', enc.encode(JSON.stringify(manifest))],
      ['config/storage-local.json', enc.encode(JSON.stringify({ schemaVersion: 1, storageLocal: {} }))],
      ['sources/conversations.csv', enc.encode('source,conversationKey\n')],
    ]);
    bundles.forEach((item, index) => {
      entries.set(
        files[index]!,
        enc.encode(
          JSON.stringify({
            schemaVersion: 1,
            conversation: {
              sourceType: 'chat',
              source: 'chatgpt',
              conversationKey: item.key,
              title: item.key,
              url: `https://example.com/${item.key}`,
              lastCapturedAt: 2,
            },
            messages: [],
            syncMapping: item.mapping,
          }),
        ),
      );
    });

    await importBackupZipV2Merge(entries);

    const verifyDb = await openDb();
    const verifyTx = verifyDb.transaction(['conversations', 'sync_mappings'], 'readonly');
    const conversations = await reqToPromise<any[]>(verifyTx.objectStore('conversations').getAll() as any);
    const mappings = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      verifyTx.oncomplete = () => resolve();
      verifyTx.onerror = () => reject(verifyTx.error);
      verifyTx.onabort = () => reject(verifyTx.error);
    });
    verifyDb.close();

    const sameMapping = mappings.find((row) => row.conversationKey === 'same');
    expect(sameMapping).toMatchObject({
      notionPageId: 'page-same',
      notionPageUrl: 'https://notion.so/new-same',
      notionWorkspaceSlug: 'new-ws',
      lastSyncedMessageKey: 'incoming-m9',
      notionSections: { conversations: { headingBlockId: 'incoming-heading' } },
      feishuDocId: 'doc-same',
      feishuLastContentHash: 'incoming-hash',
      localOnly: 'keep',
      incomingOnly: 'filled',
      updatedAt: 500,
    });
    const sameConversation = conversations.find((row) => row.conversationKey === 'same');
    expect(sameConversation).toMatchObject({
      notionPageId: 'page-same',
      notionPageUrl: 'https://notion.so/new-same',
      notionWorkspaceSlug: 'new-ws',
      feishuDocId: 'doc-same',
    });

    const differentMapping = mappings.find((row) => row.conversationKey === 'different');
    expect(differentMapping).toMatchObject({
      notionPageId: 'page-local',
      notionPageUrl: 'https://notion.so/page-local',
      notionWorkspaceSlug: 'local-ws',
      lastSyncedMessageKey: 'local-m2',
      notionSections: { conversations: { headingBlockId: 'local-heading-2' } },
      feishuDocId: 'doc-local',
      feishuLastContentHash: 'local-hash-2',
      incomingOnly: 'filled-different',
      updatedAt: 999,
    });
    const differentConversation = conversations.find((row) => row.conversationKey === 'different');
    expect(differentConversation).toMatchObject({
      notionPageId: 'page-local',
      notionPageUrl: 'https://notion.so/page-local',
      notionWorkspaceSlug: 'local-ws',
      feishuDocId: 'doc-local',
    });
  });
});
