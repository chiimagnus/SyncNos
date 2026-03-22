import { beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { openDb } from '../../src/platform/idb/schema';

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

beforeEach(async () => {
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;

  await deleteDb('webclipper');
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
        url: 'https://www.notion.so/chat',
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
        url: `https://www.notion.so/SomePage-0123456789abcdef0123456789abcdef?t=${threadId}`,
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
    db2.close();

    // Only one conversation should remain after merge.
    expect(convs.filter((c) => c.source === 'notionai' && c.conversationKey === stableKey).length).toBe(1);
    expect(convs.some((c) => Number(c.id) === legacyId)).toBe(false);

    // Messages should have been moved onto the stable conversation.
    expect(msgs.some((m) => Number(m.conversationId) === legacyId)).toBe(false);
    expect(msgs.filter((m) => Number(m.conversationId) === stableId).length).toBe(2);

    // Canonical URL should be enforced on the remaining record.
    const remaining = convs.find((c) => c.conversationKey === stableKey);
    expect(String(remaining.url)).toBe(`https://www.notion.so/chat?t=${threadId}&wfv=chat`);
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
        url: `https://www.notion.so/SomePage-0123456789abcdef0123456789abcdef?t=${threadId}`,
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
    db2.close();

    const migrated = convs.find((c) => Number(c.id) === legacyId);
    expect(migrated).toBeTruthy();
    expect(String(migrated.conversationKey)).toBe(stableKey);
    expect(String(migrated.url)).toBe(`https://www.notion.so/chat?t=${threadId}&wfv=chat`);

    // Mapping should follow the stable key.
    expect(maps.some((m) => m.source === 'notionai' && m.conversationKey === legacyKey)).toBe(false);
    expect(
      maps.some((m) => m.source === 'notionai' && m.conversationKey === stableKey && m.notionPageId === 'page_1'),
    ).toBe(true);
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
    db2.close();

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
    db2.close();

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
        source: 'article',
        conversationKey: 'article_https://example.com/post',
        notionPageId: 'page_old',
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
    db2.close();

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
      notionPageId: 'page_old',
    });
  });
});
