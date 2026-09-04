import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBKeyRange, IDBObjectStore, indexedDB } from 'fake-indexeddb';
import { closeDbForTests, openDb } from '@platform/idb/schema';
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
  const db = await openDb();
  const transaction = db.transaction(['article_comments'], 'readwrite');
  const id = await reqToPromise<number>(transaction.objectStore('article_comments').add(row) as IDBRequest<number>);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
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

    const result = await deleteArticleCommentById(c1.id);
    expect(result).toEqual({ deleted: true, conversationId: null });

    const after = await listArticleCommentsByCanonicalUrl('https://example.com/a');
    expect(after.map((c) => c.id)).toEqual([c2.id]);
  });

  it('returns a stable missing result without revision churn or guessing context from malformed children', async () => {
    const childId = await insertRawArticleComment({
      parentId: 999_999,
      conversationId: 77,
      canonicalUrl: 'https://example.com/missing-parent',
      authorName: '',
      quoteText: '',
      commentText: 'historical child',
      locator: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const before = await readDataRevision('article_comments');
    expect(await deleteArticleCommentById(999_999)).toEqual({ deleted: false, conversationId: null });
    expect(await readDataRevision('article_comments')).toBe(before);
    expect(
      (await listArticleCommentsByCanonicalUrl('https://example.com/missing-parent')).map((item) => item.id),
    ).toEqual([childId]);
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

  it('returns the deleted row owner and prefers a reply own conversationId', async () => {
    const root = await addArticleComment({
      conversationId: 41,
      canonicalUrl: 'https://example.com/owners',
      commentText: 'root',
      createdAt: 1,
    });
    const reply = await addArticleComment({
      parentId: root.id,
      conversationId: 41,
      canonicalUrl: 'https://example.com/owners',
      commentText: 'reply',
      createdAt: 2,
    });

    expect(await deleteArticleCommentById(reply.id)).toEqual({ deleted: true, conversationId: 41 });
    expect((await listArticleCommentsByCanonicalUrl('https://example.com/owners')).map((item) => item.id)).toEqual([
      root.id,
    ]);
    expect(await deleteArticleCommentById(root.id)).toEqual({ deleted: true, conversationId: 41 });
  });

  it('resolves the nearest valid owner through malformed deep ancestors and terminates ancestor cycles', async () => {
    const url = 'https://example.com/historical-owner';
    const rootId = await insertRawArticleComment({
      id: 5001,
      parentId: null,
      conversationId: 51,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'root owner',
      locator: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const middleId = await insertRawArticleComment({
      id: 5002,
      parentId: rootId,
      conversationId: null,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'middle without owner',
      locator: null,
      createdAt: 2,
      updatedAt: 2,
    });
    const targetId = await insertRawArticleComment({
      id: 5003,
      parentId: middleId,
      conversationId: null,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'target without owner',
      locator: null,
      createdAt: 3,
      updatedAt: 3,
    });
    expect(await deleteArticleCommentById(targetId)).toEqual({ deleted: true, conversationId: 51 });

    await insertRawArticleComment({
      id: 5101,
      parentId: 5102,
      conversationId: null,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'cycle a',
      locator: null,
      createdAt: 4,
      updatedAt: 4,
    });
    await insertRawArticleComment({
      id: 5102,
      parentId: 5101,
      conversationId: null,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'cycle b',
      locator: null,
      createdAt: 5,
      updatedAt: 5,
    });
    expect(await deleteArticleCommentById(5101)).toEqual({ deleted: true, conversationId: null });
    expect((await listArticleCommentsByCanonicalUrl(url)).map((item) => item.id)).toEqual([rootId, middleId]);
  });

  it('skips malformed fractional owners while resolving the nearest valid ancestor owner', async () => {
    const url = 'https://example.com/malformed-owner';
    const rootId = await insertRawArticleComment({
      id: 5201,
      parentId: null,
      conversationId: 71,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'valid root owner',
      locator: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const middleId = await insertRawArticleComment({
      id: 5202,
      parentId: rootId,
      conversationId: 1.5,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'malformed middle owner',
      locator: null,
      createdAt: 2,
      updatedAt: 2,
    });
    const targetId = await insertRawArticleComment({
      id: 5203,
      parentId: middleId,
      conversationId: null,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'target',
      locator: null,
      createdAt: 3,
      updatedAt: 3,
    });

    expect(await deleteArticleCommentById(targetId)).toEqual({ deleted: true, conversationId: 71 });
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
    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    try {
      expect(await deleteArticleCommentById(root.id)).toEqual({ deleted: true, conversationId: null });
      const articleCommentMaterializations = getAllSpy.mock.contexts.filter(
        (context) => String((context as any)?.name || '') === 'article_comments',
      );
      expect(articleCommentMaterializations).toHaveLength(1);
    } finally {
      getAllSpy.mockRestore();
    }
    expect(await readDataRevision('article_comments')).toBe(beforeDeleteRevision + 1);
    const after = await listArticleCommentsByCanonicalUrl(url);
    expect(after.length).toBe(0);
  });

  it('deletes deep descendants and target-connected cycles in one revision per delete', async () => {
    const url = 'https://example.com/deep-thread';
    const root = await addArticleComment({ conversationId: 1, canonicalUrl: url, commentText: 'root', createdAt: 1 });
    const childId = await insertRawArticleComment({
      id: 6001,
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
      id: 6002,
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
    await insertRawArticleComment({
      id: 6003,
      parentId: 6004,
      conversationId: 1,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'cycle a',
      locator: null,
      createdAt: 4,
      updatedAt: 4,
    });
    await insertRawArticleComment({
      id: 6004,
      parentId: 6003,
      conversationId: 1,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'cycle b',
      locator: null,
      createdAt: 5,
      updatedAt: 5,
    });
    await insertRawArticleComment({
      id: 6005,
      parentId: 6004,
      conversationId: 1,
      canonicalUrl: url,
      authorName: '',
      quoteText: '',
      commentText: 'cycle child',
      locator: null,
      createdAt: 6,
      updatedAt: 6,
    });

    const before = await readDataRevision('article_comments');
    expect(await deleteArticleCommentById(root.id)).toEqual({ deleted: true, conversationId: 1 });
    expect(await readDataRevision('article_comments')).toBe(before + 1);
    expect((await listArticleCommentsByCanonicalUrl(url)).map((item) => item.id)).toEqual([6003, 6004, 6005]);

    const beforeCycleDelete = await readDataRevision('article_comments');
    expect(await deleteArticleCommentById(6003)).toEqual({ deleted: true, conversationId: 1 });
    expect(await readDataRevision('article_comments')).toBe(beforeCycleDelete + 1);
    expect(await listArticleCommentsByCanonicalUrl(url)).toEqual([]);
  });

  it('hasAnyForCanonicalUrl returns true when exists', async () => {
    const url = 'https://example.com/a';
    expect(await hasAnyArticleCommentsForCanonicalUrl(url)).toBe(false);
    await addArticleComment({ conversationId: null, canonicalUrl: url, commentText: 'x' });
    expect(await hasAnyArticleCommentsForCanonicalUrl(url)).toBe(true);
  });

  it('fails instead of fabricating empty comment results when IDBKeyRange is unavailable', async () => {
    const url = 'https://example.com/required-key-range';
    await addArticleComment({ conversationId: null, canonicalUrl: url, commentText: 'x' });
    const previousKeyRange = globalThis.IDBKeyRange;
    // @ts-expect-error simulate a broken IndexedDB runtime invariant
    globalThis.IDBKeyRange = undefined;
    try {
      await expect(listArticleCommentsByCanonicalUrl(url)).rejects.toThrow();
      await expect(hasAnyArticleCommentsForCanonicalUrl(url)).rejects.toThrow();
      await expect(attachOrphanCommentsToConversation(url, 42)).rejects.toThrow();
      await expect(
        migrateArticleCommentsCanonicalUrl({
          fromCanonicalUrl: url,
          toCanonicalUrl: 'https://example.com/required-key-range-next',
          conversationId: 42,
        }),
      ).rejects.toThrow();
    } finally {
      globalThis.IDBKeyRange = previousKeyRange;
    }
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
