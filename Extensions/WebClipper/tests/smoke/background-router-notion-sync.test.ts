import { describe, expect, it } from "vitest";

function mockChromeStorage({ parentPageId = "parent_page" } = {}) {
  return {
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            if (k === "notion_parent_page_id") out[k] = parentPageId;
            else out[k] = null;
          }
          cb(out);
        }
      }
    }
  };
}

function loadBackgroundRouter() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/bootstrap/background-router.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/bootstrap/background-router.js");
}

describe("background-router notion sync", () => {
  it("recreates page when existing page is missing", async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    // @ts-expect-error test global
    globalThis.WebClipper.notionTokenStore = { getToken: async () => ({ accessToken: "t" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.notionDbManager = { ensureDatabase: async () => ({ databaseId: "db1" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      getSyncMappingByConversation: async () => ({
        conversation: { id: 1, title: "Hello", url: "https://x", source: "chatgpt", notionPageId: "p_old" },
        mapping: { notionPageId: "p_old", lastSyncedMessageKey: "m0" }
      }),
      getMessagesByConversationId: async () => [{ messageKey: "m1", role: "user", contentText: "hi", sequence: 1 }],
      setConversationNotionPageId: async (_id: number, pageId: string) => calls.push({ op: "setPageId", pageId }),
      setSyncCursor: async (_id: number, cursor: any) => calls.push({ op: "setCursor", cursor })
    };

    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncService = {
      getPage: async () => {
        throw new Error("notion api failed: GET /v1/pages/p_old HTTP 404");
      },
      createPageInDatabase: async () => ({ id: "p_new" }),
      updatePageProperties: async () => ({ ok: true }),
      clearPageChildren: async () => ({ ok: true }),
      appendChildren: async (_t: string, _pageId: string, _blocks: any[]) => {
        calls.push({ op: "append", pageId: _pageId });
        return { ok: true };
      },
      messagesToBlocks: (messages: any[]) => [{ kind: "blocks", count: messages.length }],
      isPageUsableForDatabase: () => false,
      pageBelongsToDatabase: () => false
    };

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "notionSyncConversations", conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.okCount).toBe(1);
    expect(res.data.results[0].mode).toBe("created");
    expect(calls.some((c) => c.op === "setPageId" && c.pageId === "p_new")).toBe(true);
    expect(calls.some((c) => c.op === "append" && c.pageId === "p_new")).toBe(true);
    expect(calls.some((c) => c.op === "setCursor")).toBe(true);
  });

  it("appends only new messages when cursor matches", async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    // @ts-expect-error test global
    globalThis.WebClipper.notionTokenStore = { getToken: async () => ({ accessToken: "t" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.notionDbManager = { ensureDatabase: async () => ({ databaseId: "db1" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      getSyncMappingByConversation: async () => ({
        conversation: { id: 1, title: "Hello", url: "https://x", source: "chatgpt", notionPageId: "p1" },
        mapping: { notionPageId: "p1", lastSyncedMessageKey: "m1" }
      }),
      getMessagesByConversationId: async () => [
        { messageKey: "m1", role: "user", contentText: "hi", sequence: 1 },
        { messageKey: "m2", role: "assistant", contentText: "yo", sequence: 2 }
      ],
      setSyncCursor: async () => calls.push({ op: "setCursor" })
    };

    let blocksFromCount = 0;
    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncService = {
      getPage: async () => ({ parent: { type: "database_id", database_id: "db1" }, archived: false }),
      updatePageProperties: async () => ({ ok: true }),
      clearPageChildren: async () => calls.push({ op: "clear" }),
      appendChildren: async (_t: string, _pageId: string, _blocks: any[]) => {
        calls.push({ op: "append", blocks: _blocks });
        return { ok: true };
      },
      messagesToBlocks: (messages: any[]) => {
        blocksFromCount = messages.length;
        return [{ kind: "blocks", count: messages.length }];
      },
      isPageUsableForDatabase: () => true,
      pageBelongsToDatabase: () => true
    };

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "notionSyncConversations", conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe("appended");
    expect(blocksFromCount).toBe(1);
    expect(calls.some((c) => c.op === "clear")).toBe(false);
    expect(calls.some((c) => c.op === "append")).toBe(true);
  });

  it("rebuilds when cursor is missing but page exists", async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    // @ts-expect-error test global
    globalThis.WebClipper.notionTokenStore = { getToken: async () => ({ accessToken: "t" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.notionDbManager = { ensureDatabase: async () => ({ databaseId: "db1" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      getSyncMappingByConversation: async () => ({
        conversation: { id: 1, title: "Hello", url: "https://x", source: "chatgpt", notionPageId: "p1" },
        mapping: { notionPageId: "p1" }
      }),
      getMessagesByConversationId: async () => [{ messageKey: "m1", role: "user", contentText: "hi", sequence: 1 }],
      setSyncCursor: async () => calls.push({ op: "setCursor" })
    };

    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncService = {
      getPage: async () => ({ parent: { type: "database_id", database_id: "db1" }, archived: false }),
      updatePageProperties: async () => ({ ok: true }),
      clearPageChildren: async () => calls.push({ op: "clear" }),
      appendChildren: async () => calls.push({ op: "append" }),
      messagesToBlocks: (messages: any[]) => [{ kind: "blocks", count: messages.length }],
      isPageUsableForDatabase: () => true,
      pageBelongsToDatabase: () => true
    };

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "notionSyncConversations", conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe("rebuilt");
    expect(calls.some((c) => c.op === "clear")).toBe(true);
    expect(calls.some((c) => c.op === "append")).toBe(true);
  });
});

