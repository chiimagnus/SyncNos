import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { inlineChatImagesInMessages, __closeDbForTests as __closeImageInlineDbForTests } from "@services/conversations/data/image-inline";
import { openDb as openSchemaDb } from "../../src/platform/idb/schema";

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexedDB request failed"));
  });
}

function txDone(t: IDBTransaction): Promise<true> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error("transaction failed"));
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

beforeEach(async () => {
  await __closeImageInlineDbForTests();

  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb("webclipper");
});

afterEach(async () => {
  await __closeImageInlineDbForTests();
  vi.restoreAllMocks();
});

describe("image-inline", () => {
  it("replaces http(s)/data images with internal asset refs and reuses cache", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([9, 8, 7, 6])).toString("base64")}`;

    const messages1 = [
      { messageKey: "m1", contentMarkdown: "![](https://example.com/a.png)", role: "assistant", sequence: 1 },
      { messageKey: "m2", contentMarkdown: "![](https://example.com/b.png)", role: "assistant", sequence: 2 },
      { messageKey: "m3", contentMarkdown: `![](${dataImageUrl})`, role: "assistant", sequence: 3 },
    ];
    const r1 = await inlineChatImagesInMessages({ conversationId: 1, messages: messages1 });
    expect(r1.downloadedCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(messages1[0].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    expect(String(messages1[1].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    expect(String(messages1[2].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    expect(String(messages1[0].contentMarkdown)).not.toContain("data:image");
    expect(String(messages1[1].contentMarkdown)).not.toContain("data:image");
    expect(String(messages1[2].contentMarkdown)).not.toContain("data:image");

    // Ensure we do not store the full `data:` URL as an IndexedDB key/index value.
    const db = await openSchemaDb();
    const t = db.transaction(["image_cache"], "readonly");
    const store = t.objectStore("image_cache");
    const rows = (await reqToPromise(store.getAll() as any)) as any[];
    await txDone(t);
    db.close();

    const dataRows = rows.filter((r) => String(r?.url || "").startsWith("data:"));
    expect(dataRows.length).toBe(1);
    expect(String(dataRows[0].url)).toMatch(/^data:image\/png;fnv1a64=[0-9a-f]{16}$/);
    expect(String(dataRows[0].url)).not.toContain("base64");
    expect(String(dataRows[0].url).length).toBeLessThan(80);

    // Simulate a new capture of the same message still referencing the same url.
    const messages2 = [
      { messageKey: "m1", contentMarkdown: "![](https://example.com/a.png)", role: "assistant", sequence: 1 },
      { messageKey: "m3", contentMarkdown: `![](${dataImageUrl})`, role: "assistant", sequence: 3 },
    ];
    const r2 = await inlineChatImagesInMessages({ conversationId: 1, messages: messages2 });
    expect(r2.fromCacheCount).toBe(2);
    expect(r2.downloadedCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(messages2[0].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
    expect(String(messages2[1].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
  });

  it("keeps http urls when disabled, but still assets data:image markdown", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([2, 4, 6, 8])).toString("base64")}`;
    const messages = [
      { messageKey: "m1", contentMarkdown: "![](https://example.com/a.png)", role: "assistant", sequence: 1 },
      { messageKey: "m2", contentMarkdown: `![](${dataImageUrl})`, role: "assistant", sequence: 2 },
    ];

    const res = await inlineChatImagesInMessages({
      conversationId: 2,
      messages,
      enableHttpImages: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.downloadedCount).toBe(1);
    expect(String(messages[0].contentMarkdown)).toBe("![](https://example.com/a.png)");
    expect(String(messages[1].contentMarkdown)).toMatch(/^!\[\]\(syncnos-asset:\/\/\d+\)$/);
  });
});
