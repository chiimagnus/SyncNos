import { describe, expect, it } from "vitest";

function mockChromeStorage({ parentPageId = "parent_page", initial = {} as Record<string, unknown> } = {}) {
  const store: Record<string, unknown> = {
    notion_parent_page_id: parentPageId,
    ...initial
  };
  const removed: string[] = [];
  return {
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
            else out[k] = null;
          }
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        },
        remove(keys: string[], cb: () => void) {
          for (const k of keys || []) {
            removed.push(String(k));
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete store[k];
          }
          cb();
        }
      }
    },
    __store: store,
    __removed: removed
  };
}

function loadBackgroundRouter() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jobStoreModulePath = require.resolve("../../src/sync/notion/notion-sync-job-store.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[jobStoreModulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/sync/notion/notion-sync-job-store.js");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const orchestratorModulePath = require.resolve("../../src/sync/notion/notion-sync-orchestrator.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[orchestratorModulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/sync/notion/notion-sync-orchestrator.js");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/bootstrap/background-router.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/bootstrap/background-router.js");
}

describe("background-router notion sync", () => {
  it("disconnect clears token and notion sync target cache", async () => {
    let clearTokenCalls = 0;
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const chromeMock = mockChromeStorage({
      initial: {
        notion_db_id_syncnos_ai_chats: "db_old"
      }
    });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    // @ts-expect-error test global
    globalThis.WebClipper.notionTokenStore = {
      clearToken: async () => {
        clearTokenCalls += 1;
      }
    };

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "notionDisconnect" });

    expect(res.ok).toBe(true);
    expect(res.data.disconnected).toBe(true);
    expect(clearTokenCalls).toBe(1);
    expect(chromeMock.__removed.includes("notion_parent_page_id")).toBe(true);
    expect(chromeMock.__removed.includes("notion_db_id_syncnos_ai_chats")).toBe(true);
    expect(chromeMock.__store.notion_parent_page_id).toBeUndefined();
    expect(chromeMock.__store.notion_db_id_syncnos_ai_chats).toBeUndefined();
  });

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

  it("exposes sync job status for popup recovery", async () => {
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
        conversation: { id: 1, title: "Hello", url: "https://x", source: "chatgpt" },
        mapping: null
      }),
      getMessagesByConversationId: async () => [{ messageKey: "m1", role: "user", contentText: "hi", sequence: 1 }],
      setConversationNotionPageId: async () => true,
      setSyncCursor: async () => true
    };
    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncService = {
      getPage: async () => {
        throw new Error("404");
      },
      createPageInDatabase: async () => ({ id: "p_new" }),
      updatePageProperties: async () => ({ ok: true }),
      clearPageChildren: async () => ({ ok: true }),
      appendChildren: async () => ({ ok: true }),
      messagesToBlocks: (messages: any[]) => [{ kind: "blocks", count: messages.length }],
      isPageUsableForDatabase: () => false,
      pageBelongsToDatabase: () => false
    };

    const router = loadBackgroundRouter();
    const syncRes = await router.__handleMessageForTests({ type: "notionSyncConversations", conversationIds: [1] });
    expect(syncRes.ok).toBe(true);

    const jobRes = await router.__handleMessageForTests({ type: "getNotionSyncJobStatus" });
    expect(jobRes.ok).toBe(true);
    expect(jobRes.data.job).toBeTruthy();
    expect(jobRes.data.job.status).toBe("done");
    expect(Array.isArray(jobRes.data.job.perConversation)).toBe(true);
  });

  it("upgrades external image blocks to file_upload before append", async () => {
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
        conversation: { id: 1, title: "Hello", url: "https://x", source: "chatgpt" },
        mapping: null
      }),
      getMessagesByConversationId: async () => [{ messageKey: "m1", role: "user", contentText: "hi", contentMarkdown: "![](https://example.com/a.png)", sequence: 1 }],
      setConversationNotionPageId: async () => true,
      setSyncCursor: async () => true
    };

    let appendedBlocks: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncService = {
      getPage: async () => {
        throw new Error("404");
      },
      createPageInDatabase: async () => ({ id: "p_new" }),
      updatePageProperties: async () => ({ ok: true }),
      clearPageChildren: async () => ({ ok: true }),
      appendChildren: async (_t: string, _pageId: string, blocks: any[]) => {
        appendedBlocks = blocks;
        calls.push({ op: "append", pageId: _pageId });
        return { ok: true };
      },
      messagesToBlocks: () => [{
        object: "block",
        type: "image",
        image: { type: "external", external: { url: "https://example.com/a.png" } }
      }],
      hasExternalImageBlocks: () => true,
      upgradeImageBlocksToFileUploads: async () => [{
        object: "block",
        type: "image",
        image: { type: "file_upload", file_upload: { id: "u1" } }
      }],
      isPageUsableForDatabase: () => false,
      pageBelongsToDatabase: () => false
    };

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "notionSyncConversations", conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(calls.some((c) => c.op === "append" && c.pageId === "p_new")).toBe(true);
    expect(appendedBlocks[0]?.image?.type).toBe("file_upload");
    expect(appendedBlocks[0]?.image?.file_upload?.id).toBe("u1");
  });

  it("rebuilds database cache and retries create page on database object_not_found", async () => {
    const calls: any[] = [];
    let ensureDbCalls = 0;
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    // @ts-expect-error test global
    globalThis.WebClipper.notionTokenStore = { getToken: async () => ({ accessToken: "t" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.notionDbManager = {
      ensureDatabase: async () => {
        ensureDbCalls += 1;
        return { databaseId: ensureDbCalls === 1 ? "db_old" : "db_new" };
      },
      clearCachedDatabaseId: async () => {
        calls.push({ op: "clearDbCache" });
      }
    };
    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      getSyncMappingByConversation: async () => ({
        conversation: { id: 1, title: "Hello", url: "https://x", source: "chatgpt" },
        mapping: null
      }),
      getMessagesByConversationId: async () => [{ messageKey: "m1", role: "user", contentText: "hi", sequence: 1 }],
      setConversationNotionPageId: async (_id: number, pageId: string) => calls.push({ op: "setPageId", pageId }),
      setSyncCursor: async () => calls.push({ op: "setCursor" })
    };

    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncService = {
      getPage: async () => {
        throw new Error("404");
      },
      createPageInDatabase: async (_token: string, payload: any) => {
        calls.push({ op: "createPage", databaseId: payload.databaseId });
        if (payload.databaseId === "db_old") {
          throw new Error(
            "notion api failed: POST /v1/pages HTTP 404 " +
            '{"object":"error","status":404,"code":"object_not_found","message":"Could not find database with ID: db_old"}'
          );
        }
        return { id: "p_new" };
      },
      updatePageProperties: async () => ({ ok: true }),
      clearPageChildren: async () => ({ ok: true }),
      appendChildren: async (_t: string, pageId: string, _blocks: any[]) => {
        calls.push({ op: "append", pageId });
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
    expect(ensureDbCalls).toBe(2);
    expect(calls.some((c) => c.op === "clearDbCache")).toBe(true);
    expect(calls.some((c) => c.op === "createPage" && c.databaseId === "db_old")).toBe(true);
    expect(calls.some((c) => c.op === "createPage" && c.databaseId === "db_new")).toBe(true);
    expect(calls.some((c) => c.op === "setPageId" && c.pageId === "p_new")).toBe(true);
  });
});
