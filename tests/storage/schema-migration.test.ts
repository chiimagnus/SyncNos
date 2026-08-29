import { beforeEach, describe, expect, it, vi } from 'vitest';

import { forceCloseDatabase, IDBKeyRange, IDBVersionChangeEvent, indexedDB } from 'fake-indexeddb';
import { closeDbForTests, DB_VERSION, openDb } from '../../src/platform/idb/schema';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error('tx failed'));
    t.onabort = () => reject(t.error || new Error('tx aborted'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

async function openV1Db() {
  const req = indexedDB.open('webclipper', 1);
  req.onupgradeneeded = () => {
    const db = req.result;

    const conversations = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
    conversations.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
    conversations.createIndex('by_lastCapturedAt', 'lastCapturedAt', { unique: false });

    const messages = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
    messages.createIndex('by_conversationId_sequence', ['conversationId', 'sequence'], { unique: false });
    messages.createIndex('by_conversationId_messageKey', ['conversationId', 'messageKey'], { unique: true });

    const mappings = db.createObjectStore('sync_mappings', { keyPath: 'id', autoIncrement: true });
    mappings.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
    mappings.createIndex('by_notionPageId', 'notionPageId', { unique: false });
  };
  return reqToPromise(req);
}

async function openV7DbWithoutPaginationIndexes() {
  const req = indexedDB.open('webclipper', 7);
  req.onupgradeneeded = () => {
    const db = req.result;

    const conversations = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
    conversations.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
    conversations.createIndex('by_lastCapturedAt', 'lastCapturedAt', { unique: false });

    const messages = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
    messages.createIndex('by_conversationId_sequence', ['conversationId', 'sequence'], { unique: false });
    messages.createIndex('by_conversationId_messageKey', ['conversationId', 'messageKey'], { unique: true });

    const mappings = db.createObjectStore('sync_mappings', { keyPath: 'id', autoIncrement: true });
    mappings.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
    mappings.createIndex('by_notionPageId', 'notionPageId', { unique: false });

    const imageCache = db.createObjectStore('image_cache', { keyPath: 'id', autoIncrement: true });
    imageCache.createIndex('by_conversationId_url', ['conversationId', 'url'], { unique: true });
    imageCache.createIndex('by_conversationId', 'conversationId', { unique: false });

    const comments = db.createObjectStore('article_comments', { keyPath: 'id', autoIncrement: true });
    comments.createIndex('by_canonicalUrl_createdAt', ['canonicalUrl', 'createdAt'], { unique: false });
    comments.createIndex('by_conversationId_createdAt', ['conversationId', 'createdAt'], { unique: false });
  };
  return reqToPromise(req);
}

async function openV8Db() {
  const req = indexedDB.open('webclipper', 8);
  req.onupgradeneeded = () => {
    const db = req.result;
    const conversations = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
    conversations.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
    conversations.createIndex('by_lastCapturedAt', 'lastCapturedAt', { unique: false });
    conversations.createIndex('by_lastCapturedAt_id', ['lastCapturedAt', 'id'], { unique: false });
    conversations.createIndex('by_listSourceKey_lastCapturedAt_id', ['listSourceKey', 'lastCapturedAt', 'id'], {
      unique: false,
    });
    conversations.createIndex(
      'by_listSourceKey_listSiteKey_lastCapturedAt_id',
      ['listSourceKey', 'listSiteKey', 'lastCapturedAt', 'id'],
      { unique: false },
    );
    conversations.createIndex('by_listSiteKey_lastCapturedAt_id', ['listSiteKey', 'lastCapturedAt', 'id'], {
      unique: false,
    });

    const messages = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
    messages.createIndex('by_conversationId_sequence', ['conversationId', 'sequence'], { unique: false });
    messages.createIndex('by_conversationId_messageKey', ['conversationId', 'messageKey'], { unique: true });

    const mappings = db.createObjectStore('sync_mappings', { keyPath: 'id', autoIncrement: true });
    mappings.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
    mappings.createIndex('by_notionPageId', 'notionPageId', { unique: false });

    const imageCache = db.createObjectStore('image_cache', { keyPath: 'id', autoIncrement: true });
    imageCache.createIndex('by_conversationId_url', ['conversationId', 'url'], { unique: true });
    imageCache.createIndex('by_conversationId', 'conversationId', { unique: false });

    const comments = db.createObjectStore('article_comments', { keyPath: 'id', autoIncrement: true });
    comments.createIndex('by_canonicalUrl_createdAt', ['canonicalUrl', 'createdAt'], { unique: false });
    comments.createIndex('by_conversationId_createdAt', ['conversationId', 'createdAt'], { unique: false });
  };
  return reqToPromise(req);
}

beforeEach(async () => {
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;

  closeDbForTests();
  await deleteDb('webclipper');
});

describe('canonical IndexedDB connection manager', () => {
  it('reuses one opening promise and cached connection per context', async () => {
    const firstOpen = openDb();
    const secondOpen = openDb();

    expect(secondOpen).toBe(firstOpen);
    const firstDb = await firstOpen;
    expect(await openDb()).toBe(firstDb);
  });

  it('clears a failed opening so a later open can retry', async () => {
    const futureReq = indexedDB.open('webclipper', DB_VERSION + 1);
    const futureDb = await reqToPromise(futureReq);
    futureDb.close();

    await expect(openDb()).rejects.toBeTruthy();
    await deleteDb('webclipper');

    const recovered = await openDb();
    expect(recovered.version).toBe(DB_VERSION);
  });

  it('closes and invalidates the cached connection on versionchange', async () => {
    const firstDb = await openDb();
    firstDb.dispatchEvent(
      new IDBVersionChangeEvent('versionchange', { oldVersion: DB_VERSION, newVersion: DB_VERSION + 1 }),
    );

    const reopened = await openDb();
    expect(reopened).not.toBe(firstDb);
    expect(reopened.version).toBe(DB_VERSION);
  });

  it('invalidates the cached connection after an unexpected close', async () => {
    const firstDb = await openDb();
    forceCloseDatabase(firstDb as any);

    const reopened = await openDb();
    expect(reopened).not.toBe(firstDb);
    expect(reopened.version).toBe(DB_VERSION);
  });

  it('reports a blocked upgrade without resolving the open early', async () => {
    const blocker = await openV8Db();
    let resolveBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => {
      resolveBlocked = resolve;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation((message) => {
      if (message === '[IndexedDB] open blocked') resolveBlocked();
    });

    const opening = openDb();
    await blocked;
    expect(warn).toHaveBeenCalledWith('[IndexedDB] open blocked', {
      database: 'webclipper',
      requestedVersion: DB_VERSION,
    });

    blocker.close();
    const db = await opening;
    expect(db.version).toBe(DB_VERSION);
    warn.mockRestore();
  });

  it('does not let a reset-era late open recache or clear a newer opening', async () => {
    const blocker = await openV8Db();
    let resolveBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => {
      resolveBlocked = resolve;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation((message) => {
      if (message === '[IndexedDB] open blocked') resolveBlocked();
    });

    const staleOpen = openDb();
    await blocked;
    closeDbForTests();
    const freshOpen = openDb();
    blocker.close();

    await expect(staleOpen).rejects.toThrow('indexeddb open superseded');
    const freshDb = await freshOpen;
    expect(await openDb()).toBe(freshDb);
    warn.mockRestore();
  });
});

describe('storage schema migration (v2 NotionAI thread id)', () => {
  it('does not abort when stableKey record exists but is not grouped by url', async () => {
    const threadId = '30cbe9d6386a807c83e900a970ea41b2';
    const stableKey = `notionai_t_${threadId}`;

    const db1 = await openV1Db();
    const t1 = db1.transaction(['conversations', 'messages'], 'readwrite');
    const convStore = t1.objectStore('conversations');
    const msgStore = t1.objectStore('messages');

    const stableId = await reqToPromise<number>(
      convStore.add({
        sourceType: 'chat',
        source: 'notionai',
        conversationKey: stableKey,
        title: 'stable',
        // Intentionally missing `t` so this record would not be grouped by url parsing.
        url: 'https://app.notion.com/chat',
        warningFlags: [],
        lastCapturedAt: 10,
      }),
    );

    const legacyId = await reqToPromise<number>(
      convStore.add({
        sourceType: 'chat',
        source: 'notionai',
        conversationKey: 'notionai_legacy',
        title: 'legacy',
        url: `https://app.notion.com/SomePage-0123456789abcdef0123456789abcdef?t=${threadId}`,
        warningFlags: [],
        lastCapturedAt: 20,
      }),
    );

    await reqToPromise(
      msgStore.add({
        conversationId: legacyId,
        messageKey: 'user_u1',
        role: 'user',
        contentText: 'hi',
        sequence: 0,
        updatedAt: 1,
      }),
    );
    await reqToPromise(
      msgStore.add({
        conversationId: legacyId,
        messageKey: 'assistant_b1',
        role: 'assistant',
        contentText: 'hello',
        sequence: 1,
        updatedAt: 2,
      }),
    );

    await txDone(t1);
    db1.close();

    const db2 = await openDb();

    const t2 = db2.transaction(['conversations', 'messages'], 'readonly');
    const convs = await reqToPromise<any[]>(t2.objectStore('conversations').getAll());
    const msgs = await reqToPromise<any[]>(t2.objectStore('messages').getAll());
    await txDone(t2);

    // Only one conversation should remain after merge.
    expect(convs.filter((c) => c.source === 'notionai' && c.conversationKey === stableKey).length).toBe(1);
    expect(convs.some((c) => Number(c.id) === legacyId)).toBe(false);

    // Messages should have been moved onto the stable conversation.
    expect(msgs.some((m) => Number(m.conversationId) === legacyId)).toBe(false);
    expect(msgs.filter((m) => Number(m.conversationId) === stableId).length).toBe(2);

    // Canonical URL should be enforced on the remaining record.
    const remaining = convs.find((c) => c.conversationKey === stableKey);
    expect(String(remaining.url)).toBe(`https://app.notion.com/chat?t=${threadId}&wfv=chat`);
  });

  it('merges legacy mapping metadata into an existing stable mapping without mixing provider targets', async () => {
    const threadId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const stableKey = `notionai_t_${threadId}`;
    const legacyKey = 'notionai_legacy_conflict';

    const db1 = await openV1Db();
    const t1 = db1.transaction(['conversations', 'sync_mappings'], 'readwrite');
    const convStore = t1.objectStore('conversations');
    const mapStore = t1.objectStore('sync_mappings');

    await reqToPromise(
      convStore.add({
        sourceType: 'chat',
        source: 'notionai',
        conversationKey: stableKey,
        title: 'stable',
        url: `https://app.notion.com/chat?t=${threadId}&wfv=chat`,
        notionPageId: 'page-target',
        warningFlags: [],
        lastCapturedAt: 20,
      }),
    );
    await reqToPromise(
      convStore.add({
        sourceType: 'chat',
        source: 'notionai',
        conversationKey: legacyKey,
        title: 'legacy',
        url: `https://app.notion.com/SomePage-0123456789abcdef0123456789abcdef?t=${threadId}`,
        notionPageId: 'page-legacy',
        warningFlags: [],
        lastCapturedAt: 10,
      }),
    );
    await reqToPromise(
      mapStore.add({
        source: 'notionai',
        conversationKey: stableKey,
        notionPageId: 'page-target',
        notionPageUrl: 'https://notion.so/page-target',
        lastSyncedMessageKey: 'target-m1',
        lastSyncedSequence: 1,
        notionSections: { conversations: { headingBlockId: 'h-target' } },
        notionSectionCursors: { conversations: { lastSyncedMessageKey: 'target-m1', lastSyncedSequence: 1 } },
        feishuDocId: 'doc-target',
        feishuLastContentHash: 'hash-target',
        sharedMetadata: 'target',
        updatedAt: 20,
      }),
    );
    await reqToPromise(
      mapStore.add({
        source: 'notionai',
        conversationKey: legacyKey,
        notionPageId: 'page-legacy',
        notionPageUrl: 'https://notion.so/page-legacy',
        lastSyncedMessageKey: 'legacy-m9',
        lastSyncedSequence: 9,
        notionSections: { conversations: { headingBlockId: 'h-legacy' } },
        notionSectionCursors: { conversations: { lastSyncedMessageKey: 'legacy-m9', lastSyncedSequence: 9 } },
        feishuDocId: 'doc-legacy',
        feishuLastContentHash: 'hash-legacy',
        sharedMetadata: 'legacy',
        legacyOnly: true,
        updatedAt: 99,
      }),
    );
    await txDone(t1);
    db1.close();

    const db2 = await openDb();
    const t2 = db2.transaction(['sync_mappings'], 'readonly');
    const maps = await reqToPromise<any[]>(t2.objectStore('sync_mappings').getAll());
    await txDone(t2);

    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({
      source: 'notionai',
      conversationKey: stableKey,
      notionPageId: 'page-target',
      notionPageUrl: 'https://notion.so/page-target',
      lastSyncedMessageKey: 'target-m1',
      lastSyncedSequence: 1,
      notionSections: { conversations: { headingBlockId: 'h-target' } },
      notionSectionCursors: { conversations: { lastSyncedMessageKey: 'target-m1', lastSyncedSequence: 1 } },
      feishuDocId: 'doc-target',
      feishuLastContentHash: 'hash-target',
      sharedMetadata: 'target',
      legacyOnly: true,
    });
  });

  it('migrates keep conversation mapping when conversationKey is rewritten to stableKey', async () => {
    const threadId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const stableKey = `notionai_t_${threadId}`;

    const db1 = await openV1Db();
    const t1 = db1.transaction(['conversations', 'sync_mappings'], 'readwrite');
    const convStore = t1.objectStore('conversations');
    const mapStore = t1.objectStore('sync_mappings');

    const legacyKey = 'notionai_legacy_key';
    const legacyId = await reqToPromise<number>(
      convStore.add({
        sourceType: 'chat',
        source: 'notionai',
        conversationKey: legacyKey,
        title: 'legacy',
        url: `https://app.notion.com/SomePage-0123456789abcdef0123456789abcdef?t=${threadId}`,
        warningFlags: [],
        notionPageId: 'page_1',
        lastCapturedAt: 1,
      }),
    );

    await reqToPromise(
      mapStore.add({
        source: 'notionai',
        conversationKey: legacyKey,
        notionPageId: 'page_1',
        updatedAt: 1,
      }),
    );

    await txDone(t1);
    db1.close();

    const db2 = await openDb();

    const t2 = db2.transaction(['conversations', 'sync_mappings'], 'readonly');
    const convs = await reqToPromise<any[]>(t2.objectStore('conversations').getAll());
    const maps = await reqToPromise<any[]>(t2.objectStore('sync_mappings').getAll());
    await txDone(t2);

    const migrated = convs.find((c) => Number(c.id) === legacyId);
    expect(migrated).toBeTruthy();
    expect(String(migrated.conversationKey)).toBe(stableKey);
    expect(String(migrated.url)).toBe(`https://app.notion.com/chat?t=${threadId}&wfv=chat`);

    // Mapping should follow the stable key.
    expect(maps.some((m) => m.source === 'notionai' && m.conversationKey === legacyKey)).toBe(false);
    expect(
      maps.some((m) => m.source === 'notionai' && m.conversationKey === stableKey && m.notionPageId === 'page_1'),
    ).toBe(true);
  });
});

describe('storage schema migration (v8 list pagination indexes)', () => {
  it('adds composite indexes and backfills listSourceKey/listSiteKey', async () => {
    const db7 = await openV7DbWithoutPaginationIndexes();
    const tx7 = db7.transaction(['conversations'], 'readwrite');
    const conversations = tx7.objectStore('conversations');
    await reqToPromise(
      conversations.add({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'chat-1',
        title: 'chat row',
        url: 'https://chatgpt.com/c/1',
        lastCapturedAt: 10,
      }),
    );
    await reqToPromise(
      conversations.add({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/a',
        title: 'article row',
        url: 'https://example.com/a#fragment',
        lastCapturedAt: 20,
      }),
    );
    await txDone(tx7);
    db7.close();

    const db8 = await openDb();
    const tx8 = db8.transaction(['conversations'], 'readonly');
    const store = tx8.objectStore('conversations');
    const rows = await reqToPromise<any[]>(store.getAll());
    await txDone(tx8);

    expect(store.indexNames.contains('by_lastCapturedAt_id')).toBe(true);
    expect(store.indexNames.contains('by_listSourceKey_lastCapturedAt_id')).toBe(true);
    expect(store.indexNames.contains('by_listSourceKey_listSiteKey_lastCapturedAt_id')).toBe(true);
    expect(store.indexNames.contains('by_listSiteKey_lastCapturedAt_id')).toBe(true);

    const chat = rows.find((row) => row.conversationKey === 'chat-1');
    expect(chat).toBeTruthy();
    expect(chat.listSourceKey).toBe('chatgpt');
    expect(chat.listSiteKey).toBe('domain:chatgpt.com');

    const article = rows.find((row) => row.conversationKey === 'article:https://example.com/a');
    expect(article).toBeTruthy();
    expect(article.listSourceKey).toBe('web');
    expect(article.listSiteKey).toBe('domain:example.com');
  });
});

describe('storage schema migration (v9 GitHub cleanup outbox)', () => {
  it('adds the cleanup store/index to a v8 database without changing existing store data', async () => {
    const db8 = await openV8Db();
    const tx8 = db8.transaction(
      ['conversations', 'messages', 'sync_mappings', 'image_cache', 'article_comments'],
      'readwrite',
    );
    await reqToPromise(
      tx8.objectStore('conversations').add({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'keep',
        title: 'keep',
        url: 'https://chatgpt.com/c/keep',
        listSourceKey: 'chatgpt',
        listSiteKey: 'domain:chatgpt.com',
        lastCapturedAt: 1,
      }),
    );
    await reqToPromise(
      tx8.objectStore('messages').add({ conversationId: 1, messageKey: 'm1', sequence: 1, contentText: 'keep' }),
    );
    await reqToPromise(
      tx8.objectStore('sync_mappings').add({ source: 'chatgpt', conversationKey: 'keep', sharedMetadata: 'keep' }),
    );
    await reqToPromise(
      tx8.objectStore('image_cache').add({ conversationId: 1, url: 'https://example.com/image.png', byteSize: 1 }),
    );
    await reqToPromise(
      tx8.objectStore('article_comments').add({
        conversationId: 1,
        canonicalUrl: 'https://example.com/article',
        createdAt: 1,
        updatedAt: 1,
        commentText: 'keep',
      }),
    );
    await txDone(tx8);
    db8.close();

    const db9 = await openDb();
    expect(db9.version).toBe(9);
    expect(db9.objectStoreNames.contains('github_cleanup_outbox')).toBe(true);
    const tx9 = db9.transaction(
      ['conversations', 'messages', 'sync_mappings', 'image_cache', 'article_comments', 'github_cleanup_outbox'],
      'readonly',
    );
    const cleanup = tx9.objectStore('github_cleanup_outbox');
    expect(cleanup.indexNames.contains('by_remoteKey_nextAttemptAt_createdAt')).toBe(true);
    expect(await reqToPromise(tx9.objectStore('conversations').count())).toBe(1);
    expect(await reqToPromise(tx9.objectStore('messages').count())).toBe(1);
    expect(await reqToPromise(tx9.objectStore('sync_mappings').count())).toBe(1);
    expect(await reqToPromise(tx9.objectStore('image_cache').count())).toBe(1);
    expect(await reqToPromise(tx9.objectStore('article_comments').count())).toBe(1);
    expect(await reqToPromise(cleanup.count())).toBe(0);
    await txDone(tx9);
  });

  it('creates the cleanup store/index in a fresh database', async () => {
    const db = await openDb();
    expect(db.version).toBe(9);
    expect(db.objectStoreNames.contains('github_cleanup_outbox')).toBe(true);
    const tx = db.transaction(['github_cleanup_outbox'], 'readonly');
    const store = tx.objectStore('github_cleanup_outbox');
    expect(store.indexNames.contains('by_remoteKey_nextAttemptAt_createdAt')).toBe(true);
    expect(store.keyPath).toBe('id');
    expect(store.autoIncrement).toBe(true);
    await txDone(tx);
  });
});

describe('storage schema migration (v6 strip article description)', () => {
  it('removes legacy conversation.description fields during upgrade', async () => {
    const db1 = await openV1Db();
    const t1 = db1.transaction(['conversations'], 'readwrite');
    const convStore = t1.objectStore('conversations');

    await reqToPromise<number>(
      convStore.add({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/a',
        title: 't',
        url: 'https://example.com/a',
        description: 'should be removed',
        warningFlags: [],
        lastCapturedAt: 1,
      }),
    );
    await txDone(t1);
    db1.close();

    const db2 = await openDb();
    const t2 = db2.transaction(['conversations'], 'readonly');
    const convs = await reqToPromise<any[]>(t2.objectStore('conversations').getAll());
    await txDone(t2);

    expect(convs.length).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(convs[0], 'description')).toBe(false);
  });
});

describe('storage schema migration (v4 legacy article rows)', () => {
  it('rewrites legacy article source/key/url to canonical web article values', async () => {
    const db1 = await openV1Db();
    const t1 = db1.transaction(['conversations', 'messages', 'sync_mappings'], 'readwrite');
    const convStore = t1.objectStore('conversations');
    const msgStore = t1.objectStore('messages');
    const mapStore = t1.objectStore('sync_mappings');

    const legacyId = await reqToPromise<number>(
      convStore.add({
        sourceType: 'article',
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        title: 'Legacy article',
        url: 'https://example.com/post#frag',
        notionPageId: 'page_old',
        warningFlags: [],
        lastCapturedAt: 10,
      }),
    );
    await reqToPromise(
      msgStore.add({
        conversationId: legacyId,
        messageKey: 'article_body',
        role: 'assistant',
        contentText: 'hello',
        sequence: 1,
        updatedAt: 10,
      }),
    );
    await reqToPromise(
      mapStore.add({
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        notionPageId: 'page_old',
        notionPageUrl: 'https://notion.so/page_old',
        notionWorkspaceSlug: 'legacy-ws',
        lastSyncedMessageKey: 'article_body',
        lastSyncedSequence: 1,
        lastSyncedAt: 10,
        notionSections: { article: { headingBlockId: 'h-article' }, comments: { headingBlockId: 'h-comments' } },
        notionSectionDigests: { article: { digest: 'digest-old', lastSyncedAt: 10 } },
        feishuDocId: 'doc-old',
        feishuLastContentHash: 'hash-old',
        futureMetadata: { keep: true },
        updatedAt: 10,
      }),
    );
    await txDone(t1);
    db1.close();

    const db2 = await openDb();
    const t2 = db2.transaction(['conversations', 'messages', 'sync_mappings'], 'readonly');
    const convs = await reqToPromise<any[]>(t2.objectStore('conversations').getAll());
    const msgs = await reqToPromise<any[]>(t2.objectStore('messages').getAll());
    const maps = await reqToPromise<any[]>(t2.objectStore('sync_mappings').getAll());
    await txDone(t2);

    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({
      id: legacyId,
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      url: 'https://example.com/post',
      notionPageId: 'page_old',
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      conversationId: legacyId,
      messageKey: 'article_body',
    });
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      notionPageId: 'page_old',
      notionPageUrl: 'https://notion.so/page_old',
      notionWorkspaceSlug: 'legacy-ws',
      lastSyncedMessageKey: 'article_body',
      lastSyncedSequence: 1,
      notionSections: { article: { headingBlockId: 'h-article' }, comments: { headingBlockId: 'h-comments' } },
      notionSectionDigests: { article: { digest: 'digest-old', lastSyncedAt: 10 } },
      feishuDocId: 'doc-old',
      feishuLastContentHash: 'hash-old',
      futureMetadata: { keep: true },
    });
  });

  it('merges duplicate legacy/canonical article rows onto a single canonical conversation', async () => {
    const db1 = await openV1Db();
    const t1 = db1.transaction(['conversations', 'messages', 'sync_mappings'], 'readwrite');
    const convStore = t1.objectStore('conversations');
    const msgStore = t1.objectStore('messages');
    const mapStore = t1.objectStore('sync_mappings');

    const canonicalId = await reqToPromise<number>(
      convStore.add({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/post',
        title: 'Canonical article',
        url: 'https://example.com/post',
        warningFlags: [],
        lastCapturedAt: 20,
      }),
    );
    const legacyId = await reqToPromise<number>(
      convStore.add({
        sourceType: 'article',
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        title: '',
        url: 'https://example.com/post#frag',
        notionPageId: 'page_old',
        warningFlags: [],
        lastCapturedAt: 10,
      }),
    );

    await reqToPromise(
      msgStore.add({
        conversationId: legacyId,
        messageKey: 'article_body',
        role: 'assistant',
        contentText: 'legacy body',
        sequence: 1,
        updatedAt: 10,
      }),
    );
    await reqToPromise(
      mapStore.add({
        source: 'web',
        conversationKey: 'article:https://example.com/post',
        notionPageId: 'page_target',
        notionPageUrl: 'https://notion.so/page_target',
        lastSyncedMessageKey: 'target-body',
        lastSyncedSequence: 1,
        notionSections: { article: { headingBlockId: 'h-target' } },
        notionSectionDigests: { article: { digest: 'target-digest', lastSyncedAt: 20 } },
        feishuDocId: 'doc-target',
        feishuLastContentHash: 'hash-target',
        sharedMetadata: 'target',
        updatedAt: 20,
      }),
    );
    await reqToPromise(
      mapStore.add({
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        notionPageId: 'page_old',
        notionPageUrl: 'https://notion.so/page_old',
        lastSyncedMessageKey: 'legacy-body',
        lastSyncedSequence: 9,
        notionSections: { article: { headingBlockId: 'h-legacy' } },
        notionSectionDigests: { article: { digest: 'legacy-digest', lastSyncedAt: 99 } },
        feishuDocId: 'doc-legacy',
        feishuLastContentHash: 'hash-legacy',
        sharedMetadata: 'legacy',
        legacyOnly: true,
        updatedAt: 99,
      }),
    );
    await txDone(t1);
    db1.close();

    const db2 = await openDb();
    const t2 = db2.transaction(['conversations', 'messages', 'sync_mappings'], 'readonly');
    const convs = await reqToPromise<any[]>(t2.objectStore('conversations').getAll());
    const msgs = await reqToPromise<any[]>(t2.objectStore('messages').getAll());
    const maps = await reqToPromise<any[]>(t2.objectStore('sync_mappings').getAll());
    await txDone(t2);

    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({
      id: canonicalId,
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      notionPageId: 'page_old',
    });
    expect(convs.some((c) => Number(c.id) === legacyId)).toBe(false);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      conversationId: canonicalId,
      messageKey: 'article_body',
    });
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      notionPageId: 'page_target',
      notionPageUrl: 'https://notion.so/page_target',
      lastSyncedMessageKey: 'target-body',
      lastSyncedSequence: 1,
      notionSections: { article: { headingBlockId: 'h-target' } },
      notionSectionDigests: { article: { digest: 'target-digest', lastSyncedAt: 20 } },
      feishuDocId: 'doc-target',
      feishuLastContentHash: 'hash-target',
      sharedMetadata: 'target',
      legacyOnly: true,
    });
  });
});
