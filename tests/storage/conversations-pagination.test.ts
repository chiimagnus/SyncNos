import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { closeDbForTests } from '@platform/idb/schema';
import {
  __resetConversationStorageStateForTests,
  findConversationById,
  findConversationBySourceAndKey,
  getConversationListBootstrap,
  getConversationListPage,
  upsertConversation,
} from '@services/conversations/data/storage-idb';
import { __closeDbForTests as closeCommentsDbForTests, addArticleComment } from '@services/comments/data/storage-idb';

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
  await closeCommentsDbForTests();
  __resetConversationStorageStateForTests();
  closeDbForTests();
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  await closeCommentsDbForTests();
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

  it('returns summary and facets without relying on full list materialization in UI', async () => {
    const now = Date.now();
    const old = now - 3 * 24 * 60 * 60 * 1000;
    await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/a',
      title: 'a',
      url: 'https://example.com/a',
      lastCapturedAt: now,
    });
    await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/b',
      title: 'b',
      url: 'https://example.com/b',
      lastCapturedAt: old,
    });
    await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:no-url',
      title: 'c',
      url: '',
      lastCapturedAt: now,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'chat-1',
      title: 'chat',
      url: 'https://chatgpt.com/c/1',
      lastCapturedAt: now,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'gemini',
      conversationKey: 'gemini-1',
      title: 'gemini',
      url: 'https://gemini.google.com/app/1',
      lastCapturedAt: old,
    });

    const all = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 20 });
    expect(all.summary.totalCount).toBe(5);
    expect(all.summary.todayCount).toBe(3);

    const sourceCounts = new Map(all.facets.sources.map((item) => [item.key, item.count]));
    expect(sourceCounts.get('web')).toBe(3);
    expect(sourceCounts.get('chatgpt')).toBe(1);
    expect(sourceCounts.get('gemini')).toBe(1);

    const siteCounts = new Map(all.facets.sites.map((item) => [item.key, item.count]));
    expect(siteCounts.get('domain:example.com')).toBe(2);
    expect(siteCounts.get('unknown')).toBe(1);

    const filtered = await getConversationListBootstrap({
      sourceKey: 'web',
      siteKey: 'domain:example.com',
      limit: 20,
    });
    expect(filtered.summary.totalCount).toBe(2);
    expect(filtered.items.every((item) => item.listSourceKey === 'web')).toBe(true);
    expect(filtered.items.every((item) => item.listSiteKey === 'domain:example.com')).toBe(true);
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

  it('finds open target by source+conversationKey and by id', async () => {
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

    const byId = await findConversationById(Number(inserted.id));
    expect(byId).toBeTruthy();
    expect(byId?.id).toBe(Number(inserted.id));
    expect(byId?.conversationKey).toBe('loc-key-1');

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
    rawTx.objectStore('article_comments').add({
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
    await new Promise<void>((resolve, reject) => {
      rawTx.oncomplete = () => resolve();
      rawTx.onerror = () => reject(rawTx.error);
      rawTx.onabort = () => reject(rawTx.error);
    });
    rawDb.close();

    const page = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 10 });
    const articleItem = page.items.find((item) => item.sourceType === 'article');
    const chatItem = page.items.find((item) => item.sourceType !== 'article');

    expect(articleItem?.commentThreadCount).toBe(2);
    expect(chatItem?.commentThreadCount).toBeUndefined();
  });
});
