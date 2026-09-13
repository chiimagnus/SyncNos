import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBIndex, IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { closeDbForTests, openDb } from '@platform/idb/schema';
import {
  __resetConversationStorageStateForTests,
  searchConversations,
  syncConversationMessages,
  upsertConversation,
} from '@services/conversations/data/storage-idb';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
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

afterEach(() => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
  vi.restoreAllMocks();
});

describe('conversation search storage', () => {
  it('returns the most recent matching conversations across metadata and message content', async () => {
    const now = Date.now();
    const oldest = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'search-oldest',
      title: 'ordinary title',
      url: 'https://chatgpt.com/c/search-oldest',
      lastActivityAt: now - 200,
    });
    const middle = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/search-middle',
      title: 'Needle in title',
      url: 'https://example.com/search-middle',
      lastActivityAt: now - 100,
    });
    const newest = await upsertConversation({
      sourceType: 'chat',
      source: 'claude',
      conversationKey: 'search-newest',
      title: 'ordinary newest',
      url: 'https://claude.ai/chat/search-newest',
      lastActivityAt: now,
    });
    await syncConversationMessages(Number(oldest.id), [
      { messageKey: 'old-m1', role: 'assistant', contentMarkdown: 'old message with Needle', sequence: 1 },
    ]);
    await syncConversationMessages(Number(newest.id), [
      { messageKey: 'new-m1', role: 'assistant', contentMarkdown: 'newest Needle message', sequence: 1 },
    ]);

    const results = await searchConversations({ query: 'needle', limit: 20 });
    expect(results.map((item) => item.conversation.id)).toEqual([
      Number(newest.id),
      Number(middle.id),
      Number(oldest.id),
    ]);
    expect(results.map((item) => item.hit.field)).toEqual(['message', 'title', 'message']);
    expect(results[0].hit.snippet).toContain('Needle');
  });

  it('applies source/site/activity filters using the existing list indexes', async () => {
    const now = Date.now();
    const included = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/included',
      title: 'filtered needle',
      url: 'https://example.com/included',
      lastActivityAt: now - 100,
    });
    await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://other.example/excluded-site',
      title: 'filtered needle',
      url: 'https://other.example/excluded-site',
      lastActivityAt: now - 90,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'excluded-source',
      title: 'filtered needle',
      url: 'https://example.com/chat',
      lastActivityAt: now - 80,
    });
    await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/too-old',
      title: 'filtered needle',
      url: 'https://example.com/too-old',
      lastActivityAt: now - 500,
    });

    const results = await searchConversations({
      query: 'needle',
      sourceKey: 'web',
      siteKey: 'domain:example.com',
      after: now - 300,
      before: now - 50,
      limit: 20,
    });
    expect(results.map((item) => item.conversation.id)).toEqual([Number(included.id)]);
  });

  it('searches message content with an index cursor rather than getAll', async () => {
    const conversation = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'cursor-message-search',
      title: 'no metadata match',
      lastActivityAt: Date.now(),
    });
    await syncConversationMessages(Number(conversation.id), [
      { messageKey: 'm1', role: 'user', contentMarkdown: 'first', sequence: 1 },
      { messageKey: 'm2', role: 'assistant', contentMarkdown: 'cursor needle', sequence: 2 },
    ]);

    const getAllSpy = vi.spyOn(IDBIndex.prototype, 'getAll');
    const openCursorSpy = vi.spyOn(IDBIndex.prototype, 'openCursor');
    const results = await searchConversations({ query: 'needle' });

    expect(results).toHaveLength(1);
    expect(results[0].hit).toMatchObject({ field: 'message', messageKey: 'm2', sequence: 2 });
    expect(
      openCursorSpy.mock.contexts.some(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_sequence',
      ),
    ).toBe(true);
    expect(
      getAllSpy.mock.contexts.some(
        (context) => String((context as IDBIndex)?.name || '') === 'by_conversationId_sequence',
      ),
    ).toBe(false);
  });

  it('has no arbitrary 2000-conversation truncation and scans to the oldest match when fewer than limit match', async () => {
    const db = await openDb();
    const tx = db.transaction(['conversations', 'messages'], 'readwrite');
    const done = txDone(tx);
    const conversations = tx.objectStore('conversations');
    const messages = tx.objectStore('messages');
    const total = 2105;
    for (let id = 1; id <= total; id += 1) {
      conversations.put({
        id,
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: `bulk-${id}`,
        title: `ordinary ${id}`,
        lastActivityAt: id,
        listSourceKey: 'chatgpt',
        listSiteKey: 'unknown',
      });
    }
    messages.put({
      conversationId: 1,
      messageKey: 'oldest-hit',
      role: 'assistant',
      contentMarkdown: 'the only ancient needle',
      sequence: 1,
    });
    await done;

    const results = await searchConversations({ query: 'ancient needle', limit: 20 });
    expect(results).toHaveLength(1);
    expect(results[0].conversation.id).toBe(1);
    expect(results[0].hit).toMatchObject({ field: 'message', messageKey: 'oldest-hit' });
  });

  it('stops after the requested recent top-N matches', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: `limit-${i}`,
        title: `needle ${i}`,
        lastActivityAt: now - i,
      });
    }
    const results = await searchConversations({ query: 'needle', limit: 2 });
    expect(results).toHaveLength(2);
    expect(results.map((item) => item.conversation.conversationKey)).toEqual(['limit-0', 'limit-1']);
  });
});
