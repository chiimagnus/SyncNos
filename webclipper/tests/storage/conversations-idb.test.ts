import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { openDb } from '../../src/platform/idb/schema';

import {
  __closeDbForTests,
  deleteConversationsByIds,
  getConversationById,
  getConversationListBootstrap,
  getMessagesByConversationId,
  mergeConversationsByIds,
  syncConversationMessages,
  syncConversationMessagesAppendOnly,
  upsertConversation,
} from '@services/conversations/data/storage-idb';

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

beforeEach(async () => {
  await __closeDbForTests();

  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  await __closeDbForTests();
});

async function listAllConversationsForTests() {
  const page = await getConversationListBootstrap({ sourceKey: 'all', siteKey: 'all', limit: 500 }, 500);
  return page.items;
}

describe('conversations storage-idb', () => {
  it('upserts conversation and lists conversations sorted by lastCapturedAt desc', async () => {
    await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k2',
      title: 'B',
      lastCapturedAt: 2,
    });

    const items = await listAllConversationsForTests();
    expect(items.length).toBe(2);
    expect(items[0].conversationKey).toBe('k2');
    expect(items[1].conversationKey).toBe('k1');
    expect(items[0].listSourceKey).toBe('debug');
    expect(items[0].listSiteKey).toBe('unknown');
  });

  it('syncs messages and cleans up removed messages', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    const before = await getMessagesByConversationId(id);
    expect(before.map((m) => m.messageKey)).toEqual(['m1', 'm2']);

    // Re-sync with only one message; should delete m2.
    const res = await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 },
    ]);
    expect(res.upserted).toBe(1);
    expect(res.deleted).toBe(1);

    const after = await getMessagesByConversationId(id);
    expect(after.map((m) => m.messageKey)).toEqual(['m1']);
  });

  it('syncs messages incrementally without snapshot cleanup', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    // Incremental update only provides m1 (e.g. partial render) and does not mark m2 as removed:
    // m2 should remain.
    const res1 = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 }],
      { mode: 'incremental', diff: { added: [], updated: ['m1'], removed: [] } },
    );
    expect(res1.upserted).toBe(1);
    expect(res1.deleted).toBe(0);
    const after1 = await getMessagesByConversationId(id);
    expect(after1.map((m) => m.messageKey)).toEqual(['m1', 'm2']);
    expect(after1.find((m) => m.messageKey === 'm1')?.contentText).toBe('u2');

    // Incremental delete removes only explicitly removed keys.
    const res2 = await syncConversationMessages(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u3', sequence: 1, updatedAt: 4 }],
      { mode: 'incremental', diff: { added: [], updated: ['m1'], removed: ['m2'] } },
    );
    expect(res2.upserted).toBe(1);
    expect(res2.deleted).toBe(1);
    const after2 = await getMessagesByConversationId(id);
    expect(after2.map((m) => m.messageKey)).toEqual(['m1']);
  });

  it('syncs messages in append-only mode and never deletes even when removed is provided', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    const res = await syncConversationMessagesAppendOnly(
      id,
      [{ messageKey: 'm1', role: 'user', contentText: 'u2', sequence: 1, updatedAt: 3 }],
      { added: [], updated: ['m1'], removed: ['m2'] },
    );
    expect(res.upserted).toBe(1);
    expect(res.deleted).toBe(0);

    const after = await getMessagesByConversationId(id);
    expect(after.map((m) => m.messageKey)).toEqual(['m1', 'm2']);
    expect(after.find((m) => m.messageKey === 'm1')?.contentText).toBe('u2');
  });

  it('deletes conversations, messages, and sync mappings', async () => {
    const convo = await upsertConversation({
      sourceType: 'chat',
      source: 'debug',
      conversationKey: 'k1',
      title: 'A',
      lastCapturedAt: 1,
    });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
    ]);

    // Insert a mapping directly.
    const db = await openDb();
    const t = db.transaction(['sync_mappings'], 'readwrite');
    const store = t.objectStore('sync_mappings');
    await reqToPromise(
      store.add({ source: 'debug', conversationKey: 'k1', notionPageId: 'p1', updatedAt: Date.now() }),
    );
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error || new Error('tx failed'));
      t.onabort = () => reject(t.error || new Error('tx aborted'));
    });
    db.close();

    const res = await deleteConversationsByIds([id]);
    expect(res.deletedConversations).toBe(1);
    expect(res.deletedMessages).toBe(1);
    expect(res.deletedMappings).toBe(1);

    const items = await listAllConversationsForTests();
    expect(items.length).toBe(0);
  });

  it('reuses and rewrites legacy article conversation rows by normalized url', async () => {
    const db = await openDb();
    const t = db.transaction(['conversations', 'sync_mappings'], 'readwrite');
    const conversations = t.objectStore('conversations');
    const mappings = t.objectStore('sync_mappings');

    const legacyId = await reqToPromise<number>(
      conversations.add({
        sourceType: 'article',
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        title: 'Legacy title',
        url: 'https://example.com/post#frag',
        notionPageId: 'page_old',
        warningFlags: [],
        lastCapturedAt: 1,
      }),
    );

    await reqToPromise(
      mappings.add({
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        notionPageId: 'page_old',
        updatedAt: 1,
      }),
    );
    await txDone(t);
    db.close();

    const conversation = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      title: 'New title',
      url: 'https://example.com/post',
      lastCapturedAt: 2,
    });

    expect(Number(conversation.id)).toBe(legacyId);
    expect(conversation.source).toBe('web');
    expect(conversation.conversationKey).toBe('article:https://example.com/post');
    expect(conversation.url).toBe('https://example.com/post');

    const reopened = await openDb();
    const verifyTx = reopened.transaction(['conversations', 'sync_mappings'], 'readonly');
    const verifyConversations = await reqToPromise<any[]>(verifyTx.objectStore('conversations').getAll());
    const verifyMappings = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll());
    await txDone(verifyTx);
    reopened.close();

    expect(verifyConversations).toHaveLength(1);
    expect(verifyConversations[0]).toMatchObject({
      id: legacyId,
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      url: 'https://example.com/post',
      notionPageId: 'page_old',
    });
    expect(verifyMappings).toHaveLength(1);
    expect(verifyMappings[0]).toMatchObject({
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      notionPageId: 'page_old',
    });
  });

  it('merges conversations by ids and migrates messages + sync mappings', async () => {
    const keep = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'keep',
      title: '',
      url: 'https://example.com/a',
      notionPageId: '',
      warningFlags: ['w1'],
      lastCapturedAt: 10,
    });
    const remove = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'remove',
      title: 'From remove',
      url: 'https://example.com/b',
      notionPageId: 'page_remove',
      warningFlags: ['w2'],
      lastCapturedAt: 20,
    });
    const keepId = Number(keep.id);
    const removeId = Number(remove.id);

    await syncConversationMessages(removeId, [
      { messageKey: 'm1', role: 'user', contentText: 'u', sequence: 1, updatedAt: 1 },
      { messageKey: 'm2', role: 'assistant', contentText: 'a', sequence: 2, updatedAt: 2 },
    ]);

    // Insert mapping for remove directly.
    const db = await openDb();
    const t = db.transaction(['sync_mappings'], 'readwrite');
    await reqToPromise(
      t.objectStore('sync_mappings').add({
        source: 'web',
        conversationKey: 'remove',
        notionPageId: 'page_remove',
        lastSyncedMessageKey: 'x',
        updatedAt: 1,
      }),
    );
    await txDone(t);
    db.close();

    const res = await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });
    expect(res.keptConversationId).toBe(keepId);
    expect(res.removedConversationId).toBe(removeId);
    expect(res.merged).toBe(true);

    const items = await listAllConversationsForTests();
    expect(items.map((c) => c.conversationKey)).toEqual(['keep']);
    expect(items[0]).toMatchObject({
      conversationKey: 'keep',
      title: 'From remove',
      notionPageId: 'page_remove',
    });
    expect(items[0].warningFlags).toEqual(['w1', 'w2']);
    expect(Number(items[0].lastCapturedAt)).toBe(20);

    const moved = await getMessagesByConversationId(keepId);
    expect(moved.map((m) => m.messageKey)).toEqual(['m1', 'm2']);

    const reopened = await openDb();
    const verifyTx = reopened.transaction(['sync_mappings'], 'readonly');
    const verifyMappings = await reqToPromise<any[]>(verifyTx.objectStore('sync_mappings').getAll());
    await txDone(verifyTx);
    reopened.close();

    expect(verifyMappings).toHaveLength(1);
    expect(verifyMappings[0]).toMatchObject({
      source: 'web',
      conversationKey: 'keep',
      notionPageId: 'page_remove',
      lastSyncedMessageKey: 'x',
    });
  });

  it('maintains listSourceKey/listSiteKey on upsert and merge writes', async () => {
    const keep = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'key_keep',
      title: 'keep',
      url: '',
      lastCapturedAt: 1,
    });
    const remove = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'key_remove',
      title: 'remove',
      url: 'https://example.com/post',
      lastCapturedAt: 2,
    });

    expect(keep.listSourceKey).toBe('web');
    expect(keep.listSiteKey).toBe('unknown');
    expect(remove.listSourceKey).toBe('web');
    expect(remove.listSiteKey).toBe('domain:example.com');

    const keepId = Number(keep.id);
    const removeId = Number(remove.id);
    await mergeConversationsByIds({ keepConversationId: keepId, removeConversationId: removeId });

    const merged = await getConversationById(keepId);
    expect(merged).toBeTruthy();
    expect(merged?.listSourceKey).toBe('web');
    expect(merged?.listSiteKey).toBe('domain:example.com');
  });
});
