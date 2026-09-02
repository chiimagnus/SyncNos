import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { closeDbForTests } from '@platform/idb/schema';
import {
  __resetConversationStorageStateForTests,
  findConversationBySourceAndKey,
  getConversationListBootstrap,
  getConversationListPage,
  upsertConversation,
} from '@services/conversations/data/storage-idb';
import { addArticleComment } from '@services/comments/data/storage-idb';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

beforeEach(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
});

describe('conversations pagination storage-idb', () => {
  it('keeps stable order when lastCapturedAt ties and paginates by cursor', async () => {
    const ts = Date.now();
    const a = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'tie-a',
      title: 'A',
      lastCapturedAt: ts,
    });
    const b = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'tie-b',
      title: 'B',
      lastCapturedAt: ts,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'tie-c',
      title: 'C',
      lastCapturedAt: ts - 1,
    });

    const first = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 2 });
    expect(first.items.map((item) => item.conversationKey)).toEqual(['tie-b', 'tie-a']);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toEqual({
      lastCapturedAt: ts,
      id: Number(a.id),
    });

    const second = await getConversationListPage({ sourceKey: 'all', siteKey: 'all', limit: 2 }, first.cursor!);
    expect(second.items.map((item) => item.conversationKey)).toEqual(['tie-c']);
    expect(second.hasMore).toBe(false);

    expect(Number(a.id)).toBeLessThan(Number(b.id));
  });

  it('does not duplicate or skip rows across pages', async () => {
    const now = Date.now();
    const inserted: Array<{ id: number; conversationKey: string; lastCapturedAt: number }> = [];
    const timestamps = [now, now - 1, now - 1, now - 2, now - 3, now - 3, now - 4];
    for (let i = 0; i < timestamps.length; i += 1) {
      const row = await upsertConversation({
        sourceType: 'chat',
        source: i % 2 === 0 ? 'chatgpt' : 'gemini',
        conversationKey: `page-${i + 1}`,
        title: `Row ${i + 1}`,
        lastCapturedAt: timestamps[i],
      });
      inserted.push({
        id: Number(row.id),
        conversationKey: String(row.conversationKey),
        lastCapturedAt: Number(row.lastCapturedAt) || 0,
      });
    }

    const allIds: number[] = [];
    const expectedIds = inserted
      .slice()
      .sort((a, b) => {
        if (b.lastCapturedAt !== a.lastCapturedAt) return b.lastCapturedAt - a.lastCapturedAt;
        return b.id - a.id;
      })
      .map((row) => row.id);

    let page = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 3 });
    allIds.push(...page.items.map((item) => Number(item.id)));

    let loops = 0;
    while (page.hasMore && page.cursor) {
      loops += 1;
      if (loops > 20) throw new Error('unexpected pagination loop');
      page = await getConversationListPage({ sourceKey: 'all', siteKey: 'all', limit: 3 }, page.cursor);
      allIds.push(...page.items.map((item) => Number(item.id)));
    }

    expect(allIds).toEqual(expectedIds);
    expect(new Set(allIds).size).toBe(expectedIds.length);
  });

  it('counts summary scopes and facets from persisted list indexes without treating future rows as today', async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const rows = [
      {
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/today',
        title: 'example today',
        url: 'https://example.com/today',
        lastCapturedAt: today.getTime(),
      },
      {
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/yesterday',
        title: 'example yesterday',
        url: 'https://example.com/yesterday',
        lastCapturedAt: yesterday.getTime(),
      },
      {
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://other.example/today',
        title: 'other today',
        url: 'https://other.example/today',
        lastCapturedAt: today.getTime(),
      },
      {
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:no-url',
        title: 'unknown today',
        url: '',
        lastCapturedAt: today.getTime(),
      },
      {
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://future.example/tomorrow',
        title: 'future',
        url: 'https://future.example/tomorrow',
        lastCapturedAt: tomorrow.getTime(),
      },
      {
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'chat-1',
        title: 'chat',
        url: 'https://chatgpt.com/c/1',
        lastCapturedAt: today.getTime(),
      },
      {
        sourceType: 'chat',
        source: 'gemini',
        conversationKey: 'gemini-1',
        title: 'gemini',
        url: 'https://gemini.google.com/app/1',
        lastCapturedAt: yesterday.getTime(),
      },
    ];
    for (const row of rows) await upsertConversation(row);

    const all = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 20 });
    expect(all.summary).toEqual({ totalCount: 7, todayCount: 4 });
    expect(new Map(all.facets.sources.map((item) => [item.key, item.count]))).toEqual(
      new Map([
        ['web', 5],
        ['chatgpt', 1],
        ['gemini', 1],
      ]),
    );
    expect(new Map(all.facets.sites.map((item) => [item.key, item.count]))).toEqual(
      new Map([
        ['domain:example.com', 2],
        ['domain:future.example', 1],
        ['domain:other.example', 1],
        ['unknown', 1],
      ]),
    );

    const sourceOnly = await getConversationListBootstrap({ sourceKey: 'web', siteKey: 'all', limit: 20 });
    expect(sourceOnly.summary).toEqual({ totalCount: 5, todayCount: 3 });

    const sourceAndSite = await getConversationListBootstrap({
      sourceKey: 'web',
      siteKey: 'Example.COM',
      limit: 20,
    });
    expect(sourceAndSite.summary).toEqual({ totalCount: 2, todayCount: 1 });
    expect(sourceAndSite.items.every((item) => item.listSourceKey === 'web')).toBe(true);
    expect(sourceAndSite.items.every((item) => item.listSiteKey === 'domain:example.com')).toBe(true);

    const siteOnly = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'example.com', limit: 20 });
    expect(siteOnly.summary).toEqual({ totalCount: 2, todayCount: 1 });

    const chatgpt = await getConversationListBootstrap({ sourceKey: 'chatgpt', siteKey: 'all', limit: 20 });
    expect(chatgpt.summary).toEqual({ totalCount: 1, todayCount: 1 });
    expect(chatgpt.facets.sites).toEqual([{ key: 'domain:chatgpt.com', label: 'chatgpt.com', count: 1 }]);
  });

  it('does not persist derived-key repairs while reading a fresh bootstrap', async () => {
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'seed-schema',
      title: 'seed',
      url: 'https://chatgpt.com/c/seed',
      lastCapturedAt: 1,
    });

    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('webclipper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rawTx = rawDb.transaction(['conversations'], 'readwrite');
    const rawStore = rawTx.objectStore('conversations');
    const existing = await reqToPromise<any>(
      rawStore.index('by_source_conversationKey').get(['chatgpt', 'seed-schema']),
    );
    existing.listSourceKey = 'stale-source';
    existing.listSiteKey = 'stale.example';
    await reqToPromise(rawStore.put(existing));
    await new Promise<void>((resolve, reject) => {
      rawTx.oncomplete = () => resolve();
      rawTx.onerror = () => reject(rawTx.error);
      rawTx.onabort = () => reject(rawTx.error);
    });

    const bootstrap = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 20 });
    expect(bootstrap.items).toHaveLength(1);
    expect(bootstrap.items[0]).toMatchObject({
      listSourceKey: 'chatgpt',
      listSiteKey: 'domain:chatgpt.com',
    });
    expect(bootstrap.facets.sources).toEqual([{ key: 'stale-source', label: 'stale-source', count: 1 }]);
    expect(bootstrap.facets.sites).toEqual([]);

    const verifyTx = rawDb.transaction(['conversations'], 'readonly');
    const persisted = await reqToPromise<any>(
      verifyTx.objectStore('conversations').index('by_source_conversationKey').get(['chatgpt', 'seed-schema']),
    );
    await new Promise<void>((resolve, reject) => {
      verifyTx.oncomplete = () => resolve();
      verifyTx.onerror = () => reject(verifyTx.error);
      verifyTx.onabort = () => reject(verifyTx.error);
    });
    rawDb.close();

    expect(persisted.listSourceKey).toBe('stale-source');
    expect(persisted.listSiteKey).toBe('stale.example');
  });

  it('shows a tracked upsert in the next fresh bootstrap without stale summary state', async () => {
    const initial = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 20 });
    expect(initial.summary.totalCount).toBe(0);

    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'tracked-bootstrap',
      title: 'Tracked bootstrap',
      url: 'https://chatgpt.com/c/tracked-bootstrap',
      lastCapturedAt: Date.now(),
    });

    const refreshed = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 20 });
    expect(refreshed.items.map((item) => item.conversationKey)).toEqual(['tracked-bootstrap']);
    expect(refreshed.summary.totalCount).toBe(1);
  });

  it('reuses bootstrap summary and facets for continuation pages in the same list scope', async () => {
    const now = Date.now();
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'cache-1',
      title: 'cache 1',
      url: 'https://chatgpt.com/c/cache-1',
      lastCapturedAt: now,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'cache-2',
      title: 'cache 2',
      url: 'https://chatgpt.com/c/cache-2',
      lastCapturedAt: now - 1,
    });

    const first = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 1 });
    expect(first.summary.totalCount).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeTruthy();

    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('webclipper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rawTx = rawDb.transaction(['conversations'], 'readwrite');
    rawTx.objectStore('conversations').add({
      sourceType: 'chat',
      source: 'gemini',
      conversationKey: 'cache-external-newer',
      title: 'external newer',
      url: 'https://gemini.google.com/app/cache-external-newer',
      lastCapturedAt: now + 1,
      listSourceKey: 'gemini',
      listSiteKey: 'domain:gemini.google.com',
    });
    await new Promise<void>((resolve, reject) => {
      rawTx.oncomplete = () => resolve();
      rawTx.onerror = () => reject(rawTx.error);
      rawTx.onabort = () => reject(rawTx.error);
    });
    rawDb.close();

    const continued = await getConversationListPage({ sourceKey: 'all', siteKey: 'all', limit: 1 }, first.cursor!);
    expect(continued.summary).toEqual(first.summary);
    expect(continued.facets).toEqual(first.facets);

    const fresh = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 20 });
    expect(fresh.summary.totalCount).toBe(3);
  });

  it('recomputes summary on a fresh bootstrap after an external IndexedDB write', async () => {
    const initial = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 20 });
    expect(initial.items).toEqual([]);
    expect(initial.summary).toEqual({ totalCount: 0, todayCount: 0 });

    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('webclipper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rawTx = rawDb.transaction(['conversations'], 'readwrite');
    rawTx.objectStore('conversations').add({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'externally-imported',
      title: 'Externally imported',
      url: 'https://chatgpt.com/c/externally-imported',
      lastCapturedAt: Date.now(),
      listSourceKey: 'chatgpt',
      listSiteKey: 'chatgpt',
    });
    await new Promise<void>((resolve, reject) => {
      rawTx.oncomplete = () => resolve();
      rawTx.onerror = () => reject(rawTx.error);
      rawTx.onabort = () => reject(rawTx.error);
    });
    rawDb.close();

    const refreshed = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 20 });
    expect(refreshed.items.map((item) => item.conversationKey)).toEqual(['externally-imported']);
    expect(refreshed.summary).toEqual({ totalCount: 1, todayCount: 1 });
  });

  it('finds open target by source+conversationKey', async () => {
    const inserted = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'loc-key-1',
      title: 'loc title',
      url: 'https://chatgpt.com/c/loc-1',
      lastCapturedAt: Date.now(),
    });

    const byLoc = await findConversationBySourceAndKey('chatgpt', 'loc-key-1');
    expect(byLoc).toBeTruthy();
    expect(byLoc?.id).toBe(Number(inserted.id));
    expect(byLoc?.source).toBe('chatgpt');
    expect(byLoc?.conversationKey).toBe('loc-key-1');

    const missing = await findConversationBySourceAndKey('chatgpt', 'missing');
    expect(missing).toBeNull();
  });

  it('injects commentThreadCount for article items only', async () => {
    const article = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/thread',
      title: 'article',
      url: 'https://example.com/thread?utm_source=x',
      lastCapturedAt: Date.now(),
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'chat-thread',
      title: 'chat',
      url: 'https://chatgpt.com/c/thread',
      lastCapturedAt: Date.now() - 1,
    });

    const beforeComments = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 10 });
    expect(beforeComments.items.find((item) => item.sourceType === 'article')?.commentThreadCount).toBe(0);

    // Write directly through the storage service: no handler event is emitted here.
    // The next bootstrap must derive its count from current article_comments state.
    const root = await addArticleComment({
      conversationId: Number(article.id),
      canonicalUrl: 'https://example.com/thread?utm_source=x',
      commentText: 'root',
      parentId: null,
      createdAt: 1,
    });
    await addArticleComment({
      conversationId: Number(article.id),
      canonicalUrl: 'https://example.com/thread?utm_source=x',
      commentText: 'reply',
      parentId: root.id,
      createdAt: 2,
    });
    // Insert a malformed historical row directly. The public write path now
    // rejects missing parents, while list projections must remain resilient to
    // data created by older versions or damaged imports.
    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('webclipper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rawTx = rawDb.transaction(['article_comments'], 'readwrite');
    const rawStore = rawTx.objectStore('article_comments');
    rawStore.add({
      conversationId: Number(article.id),
      canonicalUrl: 'https://example.com/thread',
      authorName: '',
      quoteText: '',
      commentText: 'orphan',
      locator: null,
      parentId: 999,
      createdAt: 3,
      updatedAt: 3,
    });
    rawStore.add({
      id: 1001,
      conversationId: Number(article.id),
      canonicalUrl: 'https://example.com/thread',
      authorName: '',
      quoteText: '',
      commentText: 'cycle a',
      locator: null,
      parentId: 1002,
      createdAt: 4,
      updatedAt: 4,
    });
    rawStore.add({
      id: 1002,
      conversationId: Number(article.id),
      canonicalUrl: 'https://example.com/thread',
      authorName: '',
      quoteText: '',
      commentText: 'cycle b',
      locator: null,
      parentId: 1001,
      createdAt: 5,
      updatedAt: 5,
    });
    await new Promise<void>((resolve, reject) => {
      rawTx.oncomplete = () => resolve();
      rawTx.onerror = () => reject(rawTx.error);
      rawTx.onabort = () => reject(rawTx.error);
    });
    rawDb.close();

    const page = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 10 });
    const articleItem = page.items.find((item) => item.sourceType === 'article');
    const chatItem = page.items.find((item) => item.sourceType !== 'article');

    expect(articleItem?.commentThreadCount).toBe(3);
    expect(chatItem?.commentThreadCount).toBeUndefined();
  });

  it('hydrates multiple article rows with shared orphan URL comments without mixing conversation-owned rows', async () => {
    const now = Date.now();
    const canonical = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/shared',
      title: 'canonical',
      url: 'https://example.com/shared',
      lastCapturedAt: now,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'after-shared',
      title: 'after',
      url: 'https://chatgpt.com/c/after-shared',
      lastCapturedAt: now - 2,
    });

    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('webclipper');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rawTx = rawDb.transaction(['conversations'], 'readwrite');
    const duplicateId = Number(
      await reqToPromise(
        rawTx.objectStore('conversations').add({
          sourceType: 'article',
          source: 'web',
          conversationKey: 'article:historical-shared-copy',
          title: 'historical duplicate',
          url: 'https://example.com/shared#historical',
          lastCapturedAt: now - 1,
          listSourceKey: 'web',
          listSiteKey: 'domain:example.com',
        }),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      rawTx.oncomplete = () => resolve();
      rawTx.onerror = () => reject(rawTx.error);
      rawTx.onabort = () => reject(rawTx.error);
    });
    rawDb.close();

    await addArticleComment({
      conversationId: Number(canonical.id),
      canonicalUrl: 'https://example.com/shared',
      commentText: 'canonical owned root',
      parentId: null,
      createdAt: 1,
    });
    await addArticleComment({
      conversationId: duplicateId,
      canonicalUrl: 'https://example.com/shared',
      commentText: 'duplicate owned root',
      parentId: null,
      createdAt: 2,
    });
    await addArticleComment({
      conversationId: null,
      canonicalUrl: 'https://example.com/shared',
      commentText: 'shared orphan root',
      parentId: null,
      createdAt: 3,
    });

    const first = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 2 });
    expect(first.items.map((item) => item.conversationKey)).toEqual([
      'article:https://example.com/shared',
      'article:historical-shared-copy',
    ]);
    expect(first.items.map((item) => item.commentThreadCount)).toEqual([2, 2]);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toEqual({ lastCapturedAt: now - 1, id: duplicateId });

    const second = await getConversationListPage({ sourceKey: 'all', siteKey: 'all', limit: 2 }, first.cursor!);
    expect(second.items.map((item) => item.conversationKey)).toEqual(['after-shared']);
    expect(second.items[0]?.commentThreadCount).toBeUndefined();
    expect(second.hasMore).toBe(false);
  });
});
