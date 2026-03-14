import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { inlineChatImagesInMessages, __closeDbForTests as __closeImageInlineDbForTests } from "../../src/conversations/data/image-inline";

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
  it("inlines http(s) images and reuses per-conversation url cache", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    // @ts-expect-error test global
    globalThis.fetch = fetchMock;

    const messages1 = [
      { messageKey: "m1", contentMarkdown: "![](https://example.com/a.png)", role: "assistant", sequence: 1 },
      { messageKey: "m2", contentMarkdown: "![](https://example.com/b.png)", role: "assistant", sequence: 2 },
    ];
    const r1 = await inlineChatImagesInMessages({ conversationId: 1, messages: messages1 });
    expect(r1.downloadedCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(messages1[0].contentMarkdown)).toMatch(/^!\[\]\(data:image\/png;base64,/);
    expect(String(messages1[1].contentMarkdown)).toMatch(/^!\[\]\(data:image\/png;base64,/);

    // Simulate a new capture of the same message still referencing the same url.
    const messages2 = [
      { messageKey: "m1", contentMarkdown: "![](https://example.com/a.png)", role: "assistant", sequence: 1 },
    ];
    const r2 = await inlineChatImagesInMessages({ conversationId: 1, messages: messages2 });
    expect(r2.fromCacheCount).toBe(1);
    expect(r2.downloadedCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(messages2[0].contentMarkdown)).toMatch(/^!\[\]\(data:image\/png;base64,/);
  });
});
