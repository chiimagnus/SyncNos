import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  __closeDbForTests,
  addArticleComment,
  attachOrphanCommentsToConversation,
  deleteArticleCommentById,
  hasAnyArticleCommentsForCanonicalUrl,
  listArticleCommentsByCanonicalUrl,
  listArticleCommentsByConversationId,
} from "../../src/comments/data/storage-idb";

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexedDB request failed"));
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
  await deleteDb("webclipper");
});

afterEach(async () => {
  await __closeDbForTests();
});

describe("article comments storage-idb", () => {
  it("adds, lists by canonicalUrl, and deletes", async () => {
    const url = "https://example.com/a#hash";

    const c1 = await addArticleComment({
      conversationId: null,
      canonicalUrl: url,
      quoteText: "q",
      commentText: "hello",
      createdAt: 10,
    });
    const c2 = await addArticleComment({
      conversationId: 123,
      canonicalUrl: "https://example.com/a",
      quoteText: "",
      commentText: "world",
      createdAt: 11,
    });

    const list = await listArticleCommentsByCanonicalUrl("https://example.com/a");
    expect(list.map((c) => c.id)).toEqual([c1.id, c2.id]);
    expect(list[0].canonicalUrl).toBe("https://example.com/a");

    const byConvo = await listArticleCommentsByConversationId(123);
    expect(byConvo.map((c) => c.id)).toEqual([c2.id]);

    const ok = await deleteArticleCommentById(c1.id);
    expect(ok).toBe(true);

    const after = await listArticleCommentsByCanonicalUrl("https://example.com/a");
    expect(after.map((c) => c.id)).toEqual([c2.id]);
  });

  it("hasAnyForCanonicalUrl returns true when exists", async () => {
    const url = "https://example.com/a";
    expect(await hasAnyArticleCommentsForCanonicalUrl(url)).toBe(false);
    await addArticleComment({ conversationId: null, canonicalUrl: url, commentText: "x" });
    expect(await hasAnyArticleCommentsForCanonicalUrl(url)).toBe(true);
  });

  it("attaches orphan comments to conversation", async () => {
    const url = "https://example.com/a";
    const orphan1 = await addArticleComment({ conversationId: null, canonicalUrl: url, commentText: "a", createdAt: 1 });
    const orphan2 = await addArticleComment({ conversationId: null, canonicalUrl: url, commentText: "b", createdAt: 2 });
    const already = await addArticleComment({ conversationId: 9, canonicalUrl: url, commentText: "c", createdAt: 3 });

    const res = await attachOrphanCommentsToConversation(url, 42);
    expect(res.updated).toBe(2);

    const list = await listArticleCommentsByCanonicalUrl(url);
    const byId = new Map(list.map((c) => [c.id, c]));
    expect(byId.get(orphan1.id)?.conversationId).toBe(42);
    expect(byId.get(orphan2.id)?.conversationId).toBe(42);
    expect(byId.get(already.id)?.conversationId).toBe(9);
  });
});

