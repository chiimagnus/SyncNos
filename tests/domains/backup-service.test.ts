import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { storageGetAll, storageSet } from '@platform/storage/local';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import { filterStorageForBackup } from '@services/sync/backup/backup-utils';
import { buildBackupZipV2 } from '@services/sync/backup/export';
import { createIdbBackupFactsAdapter } from '@services/sync/backup/idb-facts-adapter';
import { parseBackupLegacyJson, parseBackupZipV2 } from '@services/sync/backup/import';
import type { ImportProgress } from '@services/sync/backup/local-data';
import { extractZipEntries } from '@services/sync/backup/zip-utils';
import { openDb } from '../../src/platform/idb/schema';

const notStarted = { mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null } as const;

async function withIdbBackupAdapter<T>(
  run: (adapter: ReturnType<typeof createIdbBackupFactsAdapter>) => Promise<T>,
): Promise<T> {
  const gate = new FactsOperationGate({ readJournal: async () => notStarted });
  gate.reopenForJournalState(notStarted);
  return await gate.runFactsOperation('backup-test', async (lease) => await run(createIdbBackupFactsAdapter(lease)));
}

async function exportViaIdbAdapter() {
  const exported = await withIdbBackupAdapter((adapter) => adapter.exportFacts());
  return await buildBackupZipV2({
    facts: exported.facts,
    storageLocal: filterStorageForBackup(await storageGetAll()),
    warnings: exported.warnings,
  });
}

async function applyParsedImport(
  parsed: ReturnType<typeof parseBackupZipV2>,
  onProgress?: (progress: ImportProgress) => void,
) {
  const stats = await withIdbBackupAdapter((adapter) => adapter.importFacts(parsed.facts, onProgress));
  stats.messagesSkipped += parsed.preSkippedMessages;
  const settings = filterStorageForBackup(parsed.storageLocal);
  if (Object.keys(settings).length) {
    await storageSet(settings);
    stats.settingsApplied = Object.keys(settings).length;
  }
  return stats;
}

async function importZipViaIdbAdapter(
  entries: Map<string, Uint8Array>,
  onProgress?: (progress: ImportProgress) => void,
) {
  return await applyParsedImport(parseBackupZipV2(entries), onProgress);
}

async function importLegacyViaIdbAdapter(doc: unknown, onProgress?: (progress: ImportProgress) => void) {
  return await applyParsedImport(parseBackupLegacyJson(doc), onProgress);
}

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
  await deleteDb('webclipper');
});

describe('backup service', () => {
  it('exportViaIdbAdapter emits manifest + bundles and filters storage.local', async () => {
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

    const out = await exportViaIdbAdapter();
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

  it('keeps legacy data URL image export behavior after sharing the pure image helpers', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const db = await openDb();
    const t = db.transaction(['conversations', 'image_cache'], 'readwrite');
    const conversationId = await reqToPromise<number>(
      t.objectStore('conversations').add({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'legacy-data-url',
        title: 'Legacy image',
        url: 'https://example.com',
        warningFlags: [],
        lastCapturedAt: 1,
      }) as any,
    );
    await reqToPromise(
      t.objectStore('image_cache').add({
        conversationId,
        url: 'https://img.example/legacy.png',
        dataUrl: 'data:image/png;base64,AQID',
        byteSize: 3,
        contentType: 'image/png',
        createdAt: 1,
        updatedAt: 1,
      }) as any,
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    db.close();

    const entries = await extractZipEntries((await exportViaIdbAdapter()).blob);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    const imageIndex = JSON.parse(new TextDecoder().decode(entries.get(manifest.assets.imageCacheIndexPath)!));
    expect(imageIndex.assets).toHaveLength(1);
    expect([...entries.get(imageIndex.assets[0].blobPath)!]).toEqual([1, 2, 3]);
  });

  it('importZipViaIdbAdapter restores image cache and rewrites syncnos-asset urls', async () => {
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

    const exported = await exportViaIdbAdapter();
    const entries = await extractZipEntries(exported.blob);

    await deleteDb('webclipper');

    const stats = await importZipViaIdbAdapter(entries);
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

  it('importZipViaIdbAdapter tolerates missing image index and strips syncnos-asset urls', async () => {
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

    const exported = await exportViaIdbAdapter();
    const entries = await extractZipEntries(exported.blob);

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    const indexPath = String(manifest.assets?.imageCacheIndexPath || '');
    const indexDoc = JSON.parse(new TextDecoder().decode(entries.get(indexPath)!));
    const blobPath = String(indexDoc.assets?.[0]?.blobPath || '');

    entries.delete(indexPath);
    if (blobPath) entries.delete(blobPath);

    await deleteDb('webclipper');

    await importZipViaIdbAdapter(entries);

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

  it('importZipViaIdbAdapter tolerates missing image blob and falls back to https url', async () => {
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

    const exported = await exportViaIdbAdapter();
    const entries = await extractZipEntries(exported.blob);

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    const indexPath = String(manifest.assets?.imageCacheIndexPath || '');
    const indexDoc = JSON.parse(new TextDecoder().decode(entries.get(indexPath)!));
    const blobPath = String(indexDoc.assets?.[0]?.blobPath || '');
    if (blobPath) entries.delete(blobPath);

    await deleteDb('webclipper');

    await importZipViaIdbAdapter(entries);

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

  it('importZipViaIdbAdapter tolerates missing conversation bundle entry', async () => {
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

    const exported = await exportViaIdbAdapter();
    const entries = await extractZipEntries(exported.blob);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));

    // Remove the first referenced bundle entry to simulate a user-edited / corrupted zip.
    const firstBundlePath = String(manifest.sources?.[0]?.files?.[0] || '');
    if (firstBundlePath) entries.delete(firstBundlePath);

    await deleteDb('webclipper');

    const stats = await importZipViaIdbAdapter(entries);
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

  it('importZipViaIdbAdapter recovers bundles when manifest paths do not match zip entry names', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

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

    const stats = await importZipViaIdbAdapter(entries);
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

    await importZipViaIdbAdapter(entries);
    const db = await openDb();
    const tx = db.transaction(['article_comments'], 'readonly');
    const rows = await reqToPromise<any[]>(tx.objectStore('article_comments').getAll());
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.conversationId ?? null).toBeNull();
  });

  it('importLegacyViaIdbAdapter merges into IndexedDB and applies allowlisted settings only', async () => {
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

    const stats = await importLegacyViaIdbAdapter(doc);
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
    expect(chromeMock.__setPayloads.some((p) => Object.prototype.hasOwnProperty.call(p, 'notion_oauth_token_v1'))).toBe(
      false,
    );
    expect(chromeMock.__setPayloads.some((p) => (p as any).notion_oauth_client_id === 'cid')).toBe(true);
  });
});
