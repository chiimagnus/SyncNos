import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { closeDbForTests } from '@platform/idb/schema';
import { readDataRevision } from '@services/data-revisions/storage-idb';

import {
  addArticleComment,
  attachOrphanCommentsToConversation,
  deleteArticleCommentById,
  hasAnyArticleCommentsForCanonicalUrl,
  listArticleCommentsByCanonicalUrl,
  listArticleCommentsByConversationId,
  migrateArticleCommentsCanonicalUrl,
} from '@services/comments/data/storage-idb';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

async function insertRawArticleComment(row: Record<string, unknown>): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('webclipper');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = db.transaction(['article_comments'], 'readwrite');
  const id = await reqToPromise<number>(transaction.objectStore('article_comments').add(row) as IDBRequest<number>);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
  return id;
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

beforeEach(async () => {
  closeDbForTests();

  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(() => {
  closeDbForTests();
});

describe('article comments storage-idb', () => {
  it('adds, lists by canonicalUrl, and deletes', async () => {
    const url = 'https://example.com/a#hash';

    const c1 = await addArticleComment({
      conversationId: null,
      canonicalUrl: url,
      quoteText: 'q',
      commentText: 'hello',
      createdAt: 10,
    });
    const c2 = await addArticleComment({
      conversationId: 123,
      canonicalUrl: 'https://example.com/a',
      quoteText: '',
      commentText: 'world',
      createdAt: 11,
    });

    const list = await listArticleCommentsByCanonicalUrl('https://example.com/a');
    expect(list.map((c) => c.id)).toEqual([c1.id, c2.id]);
    expect(list[0].canonicalUrl).toBe('https://example.com/a');

    const byConvo = await listArticleCommentsByConversationId(123);
    expect(byConvo.map((c) => c.id)).toEqual([c2.id]);

    const ok = await deleteArticleCommentById(c1.id);
    expect(ok).toBe(true);

    const after = await listArticleCommentsByCanonicalUrl('https://example.com/a');
    expect(after.map((c) => c.id)).toEqual([c2.id]);
  });

  it('returns false without revision churn when deleting a missing comment id', async () => {
    const before = await readDataRevision('article_comments');
    expect(await deleteArticleCommentById(999_999)).toBe(false);
    expect(await readDataRevision('article_comments')).toBe(before);
  });

  it('round-trips author metadata and V1/V2 locators without field loss', async () => {
    const v2 = {
      v: 2 as const,
      textModelVersion: 'dom-text-v2' as const,
      surfaceHint: 'app' as const,
      quote: { type: 'TextQuoteSelector' as const, exact: 'beta', prefix: 'alpha ' },
      position: { type: 'TextPositionSelector' as const, start: 6, end: 10 },
      boundaryPath: { start: { path: [0], offset: 6 }, end: { path: [0], offset: 10 } },
      rootEvidence: { textModelVersion: 'dom-text-v2' as const, textLength: 10, textHash: 'hash' },
    };
    const saved = await addArticleComment({
      conversationId: 7,
      canonicalUrl: 'https://example.com/v2',
      authorName: 'Alice',
      quoteText: 'beta',
      commentText: 'note',
      locator: v2,
      createdAt: 100,
      updatedAt: 101,
    });
    const [read] = await listArticleCommentsByCanonicalUrl('https://example.com/v2');
    expect(read).toEqual(saved);
    expect(read.authorName).toBe('Alice');
    expect(read.locator).toEqual(v2);
  });

  it('rejects missing, nested, and cross-context reply parents', async () => {
    const beforeMissingParent = await readDataRevision('article_comments');
    await expect(
      addArticleComment({
        parentId: 999,
        conversationId: 1,
        canonicalUrl: 'https://example.com/a',
        commentText: 'missing',
      }),
    ).rejects.toThrow('parent_not_found');
    expect(await readDataRevision('article_comments')).toBe(beforeMissingParent);
    const root = await addArticleComment({
      conversationId: 1,
      canonicalUrl: 'https://example.com/a',
      commentText: 'root',
    });
    const reply = await addArticleComment({
      parentId: root.id,
      conversationId: 1,
      canonicalUrl: 'https://example.com/a',
      commentText: 'reply',
    });
    await expect(
      addArticleComment({
        parentId: reply.id,
        conversationId: 1,
        canonicalUrl: 'https://example.com/a',
        commentText: 'nested',
      }),
    ).rejects.toThrow('parent_not_root');
    await expect(
      addArticleComment({
        parentId: root.id,
        conversationId: 2,
        canonicalUrl: 'https://example.com/a',
        commentText: 'cross conversation',
      }),
    ).rejects.toThrow('parent_context_mismatch');
    await expect(
      addArticleComment({
        parentId: root.id,
        conversationId: 1,
        canonicalUrl: 'https://example.com/b',
        commentText: 'cross url',
      }),
    ).rejects.toThrow('parent_context_mismatch');
  });

  it('supports replies and cascades delete on root', async () => {
    const url = 'https://example.com/thread';
    const root = await addArticleComment({
      parentId: null,
      conversationId: null,
      canonicalUrl: url,
      quoteText: 'quote',
      commentText: 'root',
      createdAt: 10,
    });
    const reply1 = await addArticleComment({
      parentId: root.id,
      conversationId: null,
      canonicalUrl: url,
      quoteText: '',
      commentText: 'reply',
      createdAt: 11,
    });

    const list = await listArticleCommentsByCanonicalUrl(url);
    const byId = new Map(list.map((c) => [c.id, c]));
    expect(byId.get(root.id)?.parentId).toBe(null);
    expect(byId.get(reply1.id)?.parentId).toBe(root.id);

    const beforeDeleteRevision = await readDataRevision('article_comments');
    await deleteArticleCommentById(root.id);
    expect(await readDataRevision('article_comments')).toBe(beforeDeleteRevision + 1);
    const after = await listArticleCommentsByCanonicalUrl(url);
    expect(after.length).toBe(0);
  });

  it('deletes all descendants from malformed historical deep reply graphs', async () => {
    const url = 'https://example.com/deep-thread';
    const root = await addArticleComment({ conversationId: 1, canonicalUrl: url, commentText: 'root', createdAt: 1 });
    const childId = await insertRawArticleComment({
      parentId: root.id,
      conversationId: 1,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'child',
      locator: null,
      createdAt: 2,
      updatedAt: 2,
    });
    await insertRawArticleComment({
      parentId: childId,
      conversationId: 1,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'grandchild',
      locator: null,
      createdAt: 3,
      updatedAt: 3,
    });
    await deleteArticleCommentById(root.id);
    expect(await listArticleCommentsByCanonicalUrl(url)).toEqual([]);
  });

  it('hasAnyForCanonicalUrl returns true when exists', async () => {
    const url = 'https://example.com/a';
    expect(await hasAnyArticleCommentsForCanonicalUrl(url)).toBe(false);
    await addArticleComment({ conversationId: null, canonicalUrl: url, commentText: 'x' });
    expect(await hasAnyArticleCommentsForCanonicalUrl(url)).toBe(true);
  });

  it('attaches orphan comments to conversation', async () => {
    const url = 'https://example.com/a';
    const orphan1 = await addArticleComment({
      conversationId: null,
      canonicalUrl: url,
      commentText: 'a',
      createdAt: 1,
    });
    const orphan2 = await addArticleComment({
      conversationId: null,
      canonicalUrl: url,
      commentText: 'b',
      createdAt: 2,
    });
    const already = await addArticleComment({ conversationId: 9, canonicalUrl: url, commentText: 'c', createdAt: 3 });

    const beforeAttachRevision = await readDataRevision('article_comments');
    const res = await attachOrphanCommentsToConversation(url, 42);
    expect(res.updated).toBe(2);
    expect(await readDataRevision('article_comments')).toBe(beforeAttachRevision + 1);
    expect(await attachOrphanCommentsToConversation(url, 42)).toEqual({ updated: 0 });
    expect(await readDataRevision('article_comments')).toBe(beforeAttachRevision + 1);

    const list = await listArticleCommentsByCanonicalUrl(url);
    const byId = new Map(list.map((c) => [c.id, c]));
    expect(byId.get(orphan1.id)?.conversationId).toBe(42);
    expect(byId.get(orphan2.id)?.conversationId).toBe(42);
    expect(byId.get(already.id)?.conversationId).toBe(9);
  });

  it('migrates canonicalUrl and merges into existing thread', async () => {
    const fromUrl = 'https://example.com/a?utm_source=x';
    const toUrl = 'https://example.com/a';

    const c1 = await addArticleComment({ conversationId: 1, canonicalUrl: fromUrl, commentText: 'a', createdAt: 1 });
    const c2 = await addArticleComment({ conversationId: null, canonicalUrl: fromUrl, commentText: 'b', createdAt: 2 });
    const existing = await addArticleComment({
      conversationId: 2,
      canonicalUrl: toUrl,
      commentText: 'c',
      createdAt: 3,
    });

    const foreign = await addArticleComment({
      conversationId: 2,
      canonicalUrl: fromUrl,
      commentText: 'foreign',
      createdAt: 4,
    });

    const beforeMigrateRevision = await readDataRevision('article_comments');
    const res = await migrateArticleCommentsCanonicalUrl({
      fromCanonicalUrl: fromUrl,
      toCanonicalUrl: toUrl,
      conversationId: 1,
    });
    expect(res.updated).toBe(2);
    expect(await readDataRevision('article_comments')).toBe(beforeMigrateRevision + 1);
    expect(
      await migrateArticleCommentsCanonicalUrl({
        fromCanonicalUrl: fromUrl,
        toCanonicalUrl: toUrl,
        conversationId: 1,
      }),
    ).toEqual({ updated: 0 });
    expect(await readDataRevision('article_comments')).toBe(beforeMigrateRevision + 1);

    const afterTo = await listArticleCommentsByCanonicalUrl(toUrl);
    expect(afterTo.map((c) => c.id)).toEqual([c1.id, c2.id, existing.id]);
    expect(afterTo.every((c) => c.canonicalUrl === toUrl)).toBe(true);

    const afterFrom = await listArticleCommentsByCanonicalUrl(fromUrl);
    expect(afterFrom.map((c) => c.id)).toEqual([foreign.id]);
  });
});
