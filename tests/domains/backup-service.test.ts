import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { exportBackupZipV2 } from '@services/sync/backup/export';
import { importBackupLegacyJsonMerge, importBackupZipV2Merge } from '@services/sync/backup/import';
import { extractZipEntries } from '@services/sync/backup/zip-utils';
import { closeDbForTests, openDb } from '../../src/platform/idb/schema';

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
  closeDbForTests();
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  closeDbForTests();
  await deleteDb('webclipper');
});

describe('backup service', () => {
  it('exportBackupZipV2 emits manifest + bundles and filters storage.local', async () => {
    const chromeMock = mockChromeStorage({
      notion_oauth_client_id: 'client_id',
      notion_parent_page_id: 'page',
      notion_oauth_token_v1: { accessToken: 'secret' },
      github_repository: 'owner/repo',
      github_branch: 'main',
      github_auth_state_v1: {
        version: 1,
        state: 'pending',
        pending: {
          deviceCode: 'DEVICE_SENTINEL_SECRET',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          createdAt: 1,
          expiresAt: 901_000,
          intervalMs: 5_000,
          nextPollAt: 6_000,
        },
      },
    });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const db = await openDb();
    const t = db.transaction(
      ['conversations', 'messages', 'sync_mappings', 'image_cache', 'github_cleanup_outbox'],
      'readwrite',
    );
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
    await reqToPromise(
      t.objectStore('github_cleanup_outbox').add({
        remoteKey: 'github.com/owner/repo@main',
        paths: ['Chats/chatgpt-Hello-0123456789.md'],
        reason: 'delete',
        createdAt: 1,
        nextAttemptAt: 1,
      }) as any,
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });

    const out = await exportBackupZipV2();
    expect(out.filename.endsWith('.zip')).toBe(true);

    const entries = await extractZipEntries(out.blob);
    expect(entries.has('manifest.json')).toBe(true);
    expect(entries.has('config/storage-local.json')).toBe(true);

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    expect(manifest.backupSchemaVersion).toBe(2);
    expect(manifest.counts.conversations).toBe(1);
    expect(manifest.counts.github_cleanup_outbox).toBeUndefined();
    expect(manifest.assets.imageCacheIndexPath).toBe('assets/image-cache/index.json');
    expect(
      [...entries.keys()].some((name) => name.includes('github_cleanup_outbox') || name.includes('cleanup-outbox')),
    ).toBe(false);

    const config = JSON.parse(new TextDecoder().decode(entries.get('config/storage-local.json')!));
    expect(config.schemaVersion).toBe(1);
    expect(config.storageLocal.notion_oauth_client_id).toBe('client_id');
    expect(config.storageLocal.notion_parent_page_id).toBe('page');
    expect(config.storageLocal.notion_oauth_token_v1).toBeUndefined();
    expect(config.storageLocal).toMatchObject({
      github_repository: 'owner/repo',
      github_branch: 'main',
    });
    expect(config.storageLocal.github_auth_state_v1).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain('DEVICE_SENTINEL_SECRET');

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

    chromeMock.__store.github_auth_state_v1 = {
      version: 1,
      state: 'connected',
      token: { accessToken: 'BROWSER_B_ACCESS_SECRET', refreshToken: 'BROWSER_B_REFRESH_SECRET', createdAt: 2 },
    };
    delete chromeMock.__store.github_repository;
    delete chromeMock.__store.github_branch;

    closeDbForTests();
    await deleteDb('webclipper');
    await importBackupZipV2Merge(entries);
    const restoredDb = await openDb();
    const restoredTx = restoredDb.transaction(['conversations', 'sync_mappings', 'github_cleanup_outbox'], 'readonly');
    const restoredConversations = await reqToPromise<any[]>(restoredTx.objectStore('conversations').getAll());
    expect(restoredConversations).toHaveLength(1);
    expect(restoredConversations[0]).toMatchObject({
      listSourceKey: 'chatgpt',
      listSiteKey: 'domain:x',
    });
    expect(await reqToPromise(restoredTx.objectStore('sync_mappings').count())).toBe(1);
    expect(await reqToPromise(restoredTx.objectStore('github_cleanup_outbox').count())).toBe(0);
    await new Promise<void>((resolve, reject) => {
      restoredTx.oncomplete = () => resolve();
      restoredTx.onerror = () => reject(restoredTx.error);
      restoredTx.onabort = () => reject(restoredTx.error);
    });
    expect(chromeMock.__store.github_auth_state_v1).toEqual({
      version: 1,
      state: 'connected',
      token: { accessToken: 'BROWSER_B_ACCESS_SECRET', refreshToken: 'BROWSER_B_REFRESH_SECRET', createdAt: 2 },
    });
    expect(chromeMock.__store).toMatchObject({
      github_repository: 'owner/repo',
      github_branch: 'main',
    });
  });

  it('round-trips complete provider continuity through a real ZIP transfer into an empty database', async () => {
    const chromeMock = mockChromeStorage({
      notion_oauth_client_id: 'client-a',
      notion_parent_page_id: 'parent-a',
      notion_oauth_token_v1: { accessToken: 'secret-a' },
    });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const dbA = await openDb();
    const txA = dbA.transaction(['conversations', 'messages', 'sync_mappings'], 'readwrite');
    const conversationIdA = await reqToPromise<number>(
      txA.objectStore('conversations').add({
        id: 100,
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'continuity-round-trip',
        title: 'Continuity',
        url: 'https://chatgpt.com/c/continuity-round-trip',
        notionPageId: 'page-1',
        notionPageUrl: 'https://www.notion.so/workspace/page-1',
        notionWorkspaceSlug: 'workspace',
        feishuDocId: 'doc-1',
        warningFlags: [],
        lastCapturedAt: 10,
      }) as any,
    );
    await reqToPromise(
      txA.objectStore('messages').add({
        id: 300,
        conversationId: conversationIdA,
        messageKey: 'm1',
        role: 'assistant',
        contentText: 'already synced',
        contentMarkdown: 'already synced',
        sequence: 1,
        updatedAt: 20,
      }) as any,
    );
    const mappingIdA = await reqToPromise<number>(
      txA.objectStore('sync_mappings').add({
        id: 200,
        source: 'chatgpt',
        conversationKey: 'continuity-round-trip',
        notionPageId: 'page-1',
        notionPageUrl: 'https://www.notion.so/workspace/page-1',
        notionWorkspaceSlug: 'workspace',
        lastSyncedMessageKey: 'm1',
        lastSyncedSequence: 1,
        lastSyncedAt: 100,
        lastSyncedMessageUpdatedAt: 20,
        notionSections: {
          conversations: { headingBlockId: 'heading-conversations', recoveredAt: 90 },
          comments: { headingBlockId: 'heading-comments' },
        },
        notionSectionCursors: {
          conversations: {
            lastSyncedMessageKey: 'm1',
            lastSyncedSequence: 1,
            lastSyncedMessageUpdatedAt: 20,
          },
        },
        notionSectionDigests: {
          article: { digest: 'article-digest', lastSyncedAt: 100 },
          comments: { digest: 'comments-digest', lastSyncedAt: 100 },
        },
        feishuDocId: 'doc-1',
        feishuLastContentHash: 'content-hash-1',
        futureProviderMetadata: { version: 3, nested: { keep: true } },
        updatedAt: 101,
      }) as any,
    );
    await new Promise<void>((resolve, reject) => {
      txA.oncomplete = () => resolve();
      txA.onerror = () => reject(txA.error);
      txA.onabort = () => reject(txA.error);
    });

    expect(conversationIdA).toBe(100);
    expect(mappingIdA).toBe(200);

    const exported = await exportBackupZipV2();
    const entries = await extractZipEntries(exported.blob);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    const bundlePath = String(manifest.sources?.[0]?.files?.[0] || '');
    const bundle = JSON.parse(new TextDecoder().decode(entries.get(bundlePath)!));
    const config = JSON.parse(new TextDecoder().decode(entries.get('config/storage-local.json')!));

    expect(bundle.syncMapping.id).toBeUndefined();
    expect(bundle.syncMapping.futureProviderMetadata).toEqual({ version: 3, nested: { keep: true } });
    expect(config.storageLocal.notion_oauth_token_v1).toBeUndefined();

    // Browser B keeps its own secret while restoring A's portable, non-secret settings.
    chromeMock.__store.notion_oauth_token_v1 = { accessToken: 'secret-b' };
    delete chromeMock.__store.notion_oauth_client_id;
    delete chromeMock.__store.notion_parent_page_id;

    closeDbForTests();
    await deleteDb('webclipper');

    const stats = await importBackupZipV2Merge(entries);
    expect(stats.conversationsAdded).toBe(1);
    expect(stats.messagesAdded).toBe(1);
    expect(stats.mappingsAdded).toBe(1);

    const dbB = await openDb();
    const txB = dbB.transaction(['conversations', 'messages', 'sync_mappings'], 'readonly');
    const conversations = await reqToPromise<any[]>(txB.objectStore('conversations').getAll() as any);
    const messages = await reqToPromise<any[]>(txB.objectStore('messages').getAll() as any);
    const mappings = await reqToPromise<any[]>(txB.objectStore('sync_mappings').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      txB.oncomplete = () => resolve();
      txB.onerror = () => reject(txB.error);
      txB.onabort = () => reject(txB.error);
    });

    expect(conversations).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].id).not.toBe(mappingIdA);
    expect(mappings[0]).toMatchObject({
      source: 'chatgpt',
      conversationKey: 'continuity-round-trip',
      notionPageId: 'page-1',
      notionPageUrl: 'https://www.notion.so/workspace/page-1',
      notionWorkspaceSlug: 'workspace',
      lastSyncedMessageKey: 'm1',
      lastSyncedSequence: 1,
      lastSyncedAt: 100,
      lastSyncedMessageUpdatedAt: 20,
      notionSections: {
        conversations: { headingBlockId: 'heading-conversations', recoveredAt: 90 },
        comments: { headingBlockId: 'heading-comments' },
      },
      notionSectionCursors: {
        conversations: {
          lastSyncedMessageKey: 'm1',
          lastSyncedSequence: 1,
          lastSyncedMessageUpdatedAt: 20,
        },
      },
      notionSectionDigests: {
        article: { digest: 'article-digest', lastSyncedAt: 100 },
        comments: { digest: 'comments-digest', lastSyncedAt: 100 },
      },
      feishuDocId: 'doc-1',
      feishuLastContentHash: 'content-hash-1',
      futureProviderMetadata: { version: 3, nested: { keep: true } },
    });
    expect(conversations[0]).toMatchObject({
      notionPageId: mappings[0].notionPageId,
      notionPageUrl: mappings[0].notionPageUrl,
      notionWorkspaceSlug: mappings[0].notionWorkspaceSlug,
      feishuDocId: mappings[0].feishuDocId,
    });
    expect(messages[0]).toMatchObject({
      conversationId: conversations[0].id,
      messageKey: 'm1',
      contentText: 'already synced',
    });
    expect(chromeMock.__store.notion_oauth_token_v1).toEqual({ accessToken: 'secret-b' });
    expect(chromeMock.__store.notion_oauth_client_id).toBe('client-a');
    expect(chromeMock.__store.notion_parent_page_id).toBe('parent-a');
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

    const exported = await exportBackupZipV2();
    const entries = await extractZipEntries(exported.blob);

    closeDbForTests();
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

    const exported = await exportBackupZipV2();
    const entries = await extractZipEntries(exported.blob);

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    const indexPath = String(manifest.assets?.imageCacheIndexPath || '');
    const indexDoc = JSON.parse(new TextDecoder().decode(entries.get(indexPath)!));
    const blobPath = String(indexDoc.assets?.[0]?.blobPath || '');

    entries.delete(indexPath);
    if (blobPath) entries.delete(blobPath);

    closeDbForTests();
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

    const exported = await exportBackupZipV2();
    const entries = await extractZipEntries(exported.blob);

    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));
    const indexPath = String(manifest.assets?.imageCacheIndexPath || '');
    const indexDoc = JSON.parse(new TextDecoder().decode(entries.get(indexPath)!));
    const blobPath = String(indexDoc.assets?.[0]?.blobPath || '');
    if (blobPath) entries.delete(blobPath);

    closeDbForTests();
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

    const exported = await exportBackupZipV2();
    const entries = await extractZipEntries(exported.blob);
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')!));

    // Remove the first referenced bundle entry to simulate a user-edited / corrupted zip.
    const firstBundlePath = String(manifest.sources?.[0]?.files?.[0] || '');
    if (firstBundlePath) entries.delete(firstBundlePath);

    closeDbForTests();
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
    expect(convs.length).toBe(1);
  });

  it('importBackupZipV2Merge recovers bundles when manifest paths do not match zip entry names', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    closeDbForTests();
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

    const stats = await importBackupZipV2Merge(entries);
    expect(stats.commentsAdded).toBe(1);
    const db = await openDb();
    const tx = db.transaction(['article_comments'], 'readonly');
    const rows = await reqToPromise<any[]>(tx.objectStore('article_comments').getAll());
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
        github_cleanup_outbox: [
          {
            id: 999,
            remoteKey: 'github.com/attacker/injected@main',
            paths: ['README.md'],
            reason: 'delete',
            createdAt: 1,
            nextAttemptAt: 1,
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
    const t = db.transaction(['conversations', 'messages', 'sync_mappings', 'github_cleanup_outbox'], 'readonly');
    const convs = await reqToPromise<any[]>(t.objectStore('conversations').getAll() as any);
    const msgs = await reqToPromise<any[]>(t.objectStore('messages').getAll() as any);
    const maps = await reqToPromise<any[]>(t.objectStore('sync_mappings').getAll() as any);
    const cleanupRows = await reqToPromise<any[]>(t.objectStore('github_cleanup_outbox').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });

    expect(convs.length).toBe(1);
    expect(convs[0]).toMatchObject({
      listSourceKey: 'chatgpt',
      listSiteKey: 'domain:x',
    });
    expect(msgs.length).toBe(1);
    expect(maps.length).toBe(1);
    expect(cleanupRows).toEqual([]);
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

  it('keeps Legacy conversation remap on a no-op so later message rows target the existing local id', async () => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    // @ts-expect-error test global
    globalThis.browser = undefined;

    const conversation = {
      id: 99,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'legacy-remap-noop',
      title: 'Stable',
      url: 'https://chatgpt.com/c/legacy-remap-noop',
      warningFlags: [],
      lastCapturedAt: 10,
    };
    const baseDoc = {
      schemaVersion: 1,
      stores: { conversations: [conversation], messages: [], sync_mappings: [] },
      storageLocal: {},
    };

    const first = await importBackupLegacyJsonMerge(baseDoc);
    expect(first.conversationsAdded).toBe(1);
    const db = await openDb();
    const firstTx = db.transaction(['conversations'], 'readonly');
    const persisted = await reqToPromise<any>(
      firstTx.objectStore('conversations').index('by_source_conversationKey').get(['chatgpt', 'legacy-remap-noop']) as any,
    );
    await new Promise<void>((resolve, reject) => {
      firstTx.oncomplete = () => resolve();
      firstTx.onerror = () => reject(firstTx.error);
      firstTx.onabort = () => reject(firstTx.error);
    });
    const localConversationId = Number(persisted.id);

    const repeated = await importBackupLegacyJsonMerge({
      ...baseDoc,
      stores: {
        ...baseDoc.stores,
        messages: [
          {
            id: 500,
            conversationId: 99,
            messageKey: 'm-remap',
            role: 'user',
            contentText: 'mapped',
            contentMarkdown: '',
            sequence: 1,
            updatedAt: 1,
          },
        ],
      },
    });

    expect(repeated.conversationsAdded).toBe(0);
    expect(repeated.conversationsUpdated).toBe(0);
    expect(repeated.messagesAdded).toBe(1);
    const verifyTx = db.transaction(['messages'], 'readonly');
    const message = await reqToPromise<any>(
      verifyTx.objectStore('messages').index('by_conversationId_messageKey').get([localConversationId, 'm-remap']) as any,
    );
    await new Promise<void>((resolve, reject) => {
      verifyTx.oncomplete = () => resolve();
      verifyTx.onerror = () => reject(verifyTx.error);
      verifyTx.onabort = () => reject(verifyTx.error);
    });
    expect(message).toMatchObject({ conversationId: localConversationId, messageKey: 'm-remap', contentText: 'mapped' });
  });

  it('keeps Legacy message imports idempotent after remapping local identities', async () => {
    const doc = {
      schemaVersion: 1,
      stores: {
        conversations: [
          {
            id: 99,
            sourceType: 'chat',
            source: 'chatgpt',
            conversationKey: 'legacy-message-noop',
            title: 'Stable',
            url: 'https://chatgpt.com/c/legacy-message-noop',
            warningFlags: [],
            lastCapturedAt: 10,
          },
        ],
        messages: [
          {
            id: 500,
            conversationId: 99,
            messageKey: 'm-stable',
            role: 'user',
            contentText: 'stable',
            contentMarkdown: '',
            sequence: 1,
          },
        ],
        sync_mappings: [],
      },
      storageLocal: {},
    };

    const first = await importBackupLegacyJsonMerge(doc);
    expect(first.messagesAdded).toBe(1);
    const db = await openDb();
    const firstTx = db.transaction(['messages'], 'readonly');
    const persisted = await reqToPromise<any>(firstTx.objectStore('messages').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      firstTx.oncomplete = () => resolve();
      firstTx.onerror = () => reject(firstTx.error);
      firstTx.onabort = () => reject(firstTx.error);
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ conversationId: 1, messageKey: 'm-stable', contentText: 'stable' });
    expect(persisted[0].id).not.toBe(500);
    expect(persisted[0].updatedAt).toBeGreaterThan(0);

    const repeated = await importBackupLegacyJsonMerge(doc);
    expect(repeated.messagesAdded).toBe(0);
    expect(repeated.messagesUpdated).toBe(0);

    const changed = await importBackupLegacyJsonMerge({
      ...doc,
      stores: {
        ...doc.stores,
        messages: [
          {
            ...doc.stores.messages[0],
            contentText: 'changed',
            updatedAt: Number(persisted[0].updatedAt) + 1,
          },
        ],
      },
    });
    expect(changed.messagesAdded).toBe(0);
    expect(changed.messagesUpdated).toBe(1);
  });

  it('skips equivalent Legacy mappings without losing conversation mirrors', async () => {
    const doc = {
      schemaVersion: 1,
      stores: {
        conversations: [
          {
            id: 99,
            sourceType: 'chat',
            source: 'chatgpt',
            conversationKey: 'legacy-mapping-noop',
            title: 'Stable',
            url: 'https://chatgpt.com/c/legacy-mapping-noop',
            warningFlags: [],
            lastCapturedAt: 10,
          },
        ],
        messages: [],
        sync_mappings: [
          {
            id: 500,
            source: 'chatgpt',
            conversationKey: 'legacy-mapping-noop',
            notionPageId: 'page-stable',
            notionPageUrl: 'https://notion.so/page-stable',
            notionWorkspaceSlug: 'workspace',
            lastSyncedAt: 10,
          },
        ],
      },
      storageLocal: {},
    };

    const first = await importBackupLegacyJsonMerge(doc);
    expect(first.mappingsAdded).toBe(1);

    const repeated = await importBackupLegacyJsonMerge(doc);
    expect(repeated.mappingsAdded).toBe(0);
    expect(repeated.mappingsUpdated).toBe(0);

    const db = await openDb();
    const verifyTx = db.transaction(['conversations'], 'readonly');
    const conversation = await reqToPromise<any>(verifyTx.objectStore('conversations').getAll() as any);
    await new Promise<void>((resolve, reject) => {
      verifyTx.oncomplete = () => resolve();
      verifyTx.onerror = () => reject(verifyTx.error);
      verifyTx.onabort = () => reject(verifyTx.error);
    });
    expect(conversation).toHaveLength(1);
    expect(conversation[0]).toMatchObject({
      notionPageId: 'page-stable',
      notionPageUrl: 'https://notion.so/page-stable',
      notionWorkspaceSlug: 'workspace',
    });
  });

  it('keeps committed ZIP conversations when progress listeners fail', async () => {
    const encoder = new TextEncoder();
    const entryPath = 'sources/chatgpt/progress.json';
    const entries = new Map<string, Uint8Array>([
      [
        'manifest.json',
        encoder.encode(
          JSON.stringify({
            backupSchemaVersion: 2,
            exportedAt: '2026-08-29T00:00:00.000Z',
            db: { name: 'webclipper', version: 10 },
            counts: { conversations: 1, messages: 0, sync_mappings: 0 },
            config: { storageLocalPath: 'config/storage-local.json' },
            index: { conversationsCsvPath: 'sources/conversations.csv' },
            sources: [{ source: 'chatgpt', conversationCount: 1, files: [entryPath] }],
          }),
        ),
      ],
      ['config/storage-local.json', encoder.encode(JSON.stringify({ schemaVersion: 1, storageLocal: {} }))],
      ['sources/conversations.csv', encoder.encode('source,conversationKey\n')],
      [
        entryPath,
        encoder.encode(
          JSON.stringify({
            schemaVersion: 1,
            conversation: {
              id: 99,
              sourceType: 'chat',
              source: 'chatgpt',
              conversationKey: 'zip-progress',
              title: 'Progress',
              url: 'https://chatgpt.com/c/zip-progress',
              lastCapturedAt: 10,
            },
            messages: [],
            syncMapping: null,
          }),
        ),
      ],
    ]);

    await expect(
      importBackupZipV2Merge(entries, () => {
        throw new Error('sync listener failure');
      }),
    ).resolves.toMatchObject({ conversationsAdded: 1 });
    await expect(importBackupZipV2Merge(entries, (() => Promise.reject(new Error('async listener failure'))) as any)).resolves.toMatchObject({
      conversationsAdded: 0,
      conversationsUpdated: 0,
    });
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

    const sameMapping = mappings.find((row) => row.conversationKey === 'same');
    expect(sameMapping).toMatchObject({
      notionPageId: 'page-same',
      notionPageUrl: 'https://notion.so/new-same',
      notionWorkspaceSlug: 'new-ws',
      lastSyncedMessageKey: 'incoming-m9',
      notionSections: { conversations: { headingBlockId: 'incoming-heading' } },
      feishuDocId: 'doc-same',
      feishuLastContentHash: 'local-hash',
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
