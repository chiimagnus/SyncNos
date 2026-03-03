import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { openDb } from "../../src/platform/idb/schema";

import {
  __closeDbForTests,
  deleteConversationsByIds,
  getConversations,
  getMessagesByConversationId,
  syncConversationMessages,
  upsertConversation,
} from "../../src/conversations/storage-idb";

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

describe("conversations storage-idb", () => {
  it("upserts conversation and lists conversations sorted by lastCapturedAt desc", async () => {
    await upsertConversation({ sourceType: "chat", source: "debug", conversationKey: "k1", title: "A", lastCapturedAt: 1 });
    await upsertConversation({ sourceType: "chat", source: "debug", conversationKey: "k2", title: "B", lastCapturedAt: 2 });

    const items = await getConversations();
    expect(items.length).toBe(2);
    expect(items[0].conversationKey).toBe("k2");
    expect(items[1].conversationKey).toBe("k1");
  });

  it("syncs messages and cleans up removed messages", async () => {
    const convo = await upsertConversation({ sourceType: "chat", source: "debug", conversationKey: "k1", title: "A", lastCapturedAt: 1 });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: "m1", role: "user", contentText: "u", sequence: 1, updatedAt: 1 },
      { messageKey: "m2", role: "assistant", contentText: "a", sequence: 2, updatedAt: 2 },
    ]);

    const before = await getMessagesByConversationId(id);
    expect(before.map((m) => m.messageKey)).toEqual(["m1", "m2"]);

    // Re-sync with only one message; should delete m2.
    const res = await syncConversationMessages(id, [
      { messageKey: "m1", role: "user", contentText: "u2", sequence: 1, updatedAt: 3 },
    ]);
    expect(res.upserted).toBe(1);
    expect(res.deleted).toBe(1);

    const after = await getMessagesByConversationId(id);
    expect(after.map((m) => m.messageKey)).toEqual(["m1"]);
  });

  it("deletes conversations, messages, and sync mappings", async () => {
    const convo = await upsertConversation({ sourceType: "chat", source: "debug", conversationKey: "k1", title: "A", lastCapturedAt: 1 });
    const id = Number(convo.id);

    await syncConversationMessages(id, [
      { messageKey: "m1", role: "user", contentText: "u", sequence: 1, updatedAt: 1 },
    ]);

    // Insert a mapping directly.
    const db = await openDb();
    const t = db.transaction(["sync_mappings"], "readwrite");
    const store = t.objectStore("sync_mappings");
    await reqToPromise(store.add({ source: "debug", conversationKey: "k1", notionPageId: "p1", updatedAt: Date.now() }));
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error || new Error("tx failed"));
      t.onabort = () => reject(t.error || new Error("tx aborted"));
    });
    db.close();

    const res = await deleteConversationsByIds([id]);
    expect(res.deletedConversations).toBe(1);
    expect(res.deletedMessages).toBe(1);
    expect(res.deletedMappings).toBe(1);

    const items = await getConversations();
    expect(items.length).toBe(0);
  });
});
