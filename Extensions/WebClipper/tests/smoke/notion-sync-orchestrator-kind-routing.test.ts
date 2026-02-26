import { describe, expect, it } from "vitest";

function mockChromeStorage({ parentPageId = "parent_page" } = {}) {
  const store: Record<string, unknown> = { notion_parent_page_id: parentPageId };
  return {
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) out[k] = store[k] || "";
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        },
        remove(keys: string[], cb: () => void) {
          for (const k of keys || []) delete store[String(k)];
          cb();
        }
      }
    }
  };
}

function loadKinds() {
  // @ts-expect-error test global
  globalThis.WebClipper = globalThis.WebClipper || {};
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const contractPath = require.resolve("../../src/protocols/conversation-kind-contract.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[contractPath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/protocols/conversation-kind-contract.js");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const kindsPath = require.resolve("../../src/protocols/conversation-kinds.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[kindsPath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/protocols/conversation-kinds.js");
}

function loadOrchestrator() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/export/notion/notion-sync-orchestrator.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/export/notion/notion-sync-orchestrator.js");
}

describe("notion-sync-orchestrator kind routing", () => {
  it("routes chat/article to different dbSpec and avoids AI for article", async () => {
    const ensureCalls: any[] = [];
    const createCalls: any[] = [];
    const updateCalls: any[] = [];

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadKinds();
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncJobStore = {
      abortRunningJobIfFromOtherInstance: async () => null,
      isRunningJob: () => false,
      setJob: async () => true
    };
    // @ts-expect-error test global
    globalThis.WebClipper.notionTokenStore = { getToken: async () => ({ accessToken: "t" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.notionDbManager = {
      ensureDatabase: async ({ dbSpec }: any) => {
        ensureCalls.push(dbSpec);
        if (dbSpec.storageKey === "notion_db_id_syncnos_web_articles") return { databaseId: "db_articles" };
        return { databaseId: "db_chats" };
      }
    };

    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      getSyncMappingByConversation: async (id: number) => {
        if (id === 1) {
          return {
            conversation: {
              id: 1,
              sourceType: "article",
              title: "Article 1",
              url: "https://a",
              author: "Alice",
              publishedAt: "2026-02-26",
              description: "Desc",
              lastCapturedAt: 1000
            },
            mapping: null
          };
        }
        return {
          conversation: { id: 2, sourceType: "chat", source: "chatgpt", title: "Chat 2", url: "https://c", lastCapturedAt: 2000 },
          mapping: null
        };
      },
      getMessagesByConversationId: async () => [{ messageKey: "m1", role: "assistant", contentText: "hi", sequence: 1, updatedAt: 1 }],
      setConversationNotionPageId: async () => true,
      setSyncCursor: async () => true
    };

    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncService = {
      getPage: async () => {
        throw new Error("not found");
      },
      createPageInDatabase: async (_t: string, req: any) => {
        createCalls.push(req);
        return { id: `p_${req.databaseId}` };
      },
      updatePageProperties: async (_t: string, req: any) => {
        updateCalls.push(req);
        return { ok: true };
      },
      clearPageChildren: async () => ({ ok: true }),
      appendChildren: async () => ({ ok: true }),
      messagesToBlocks: (messages: any[]) => [{ kind: "blocks", count: messages.length }]
    };

    const orchestrator = loadOrchestrator();
    const res = await orchestrator.syncConversations({ conversationIds: [1, 2], instanceId: "i" });
    expect(res.okCount).toBe(2);

    // Ensure dbSpec-driven ensureDatabase was invoked for both storage keys.
    expect(ensureCalls.some((s) => s.storageKey === "notion_db_id_syncnos_web_articles")).toBe(true);
    expect(ensureCalls.some((s) => s.storageKey === "notion_db_id_syncnos_ai_chats")).toBe(true);

    // Create calls should target different databases.
    expect(createCalls.map((c) => c.databaseId).sort()).toEqual(["db_articles", "db_chats"]);

    // Create properties: article should not carry AI; chat should carry AI.
    const articleCreate = createCalls.find((c) => c.databaseId === "db_articles");
    const chatCreate = createCalls.find((c) => c.databaseId === "db_chats");
    expect(articleCreate.properties.AI).toBeUndefined();
    expect(articleCreate.properties.Author).toBeTruthy();
    expect(chatCreate.properties.AI).toBeTruthy();

    // Update properties only happen on subsequent syncs; keep coverage minimal here.
    expect(updateCalls.length).toBe(0);
  });

  it("forces rebuild for article when message updatedAt is newer than mapping.lastSyncedAt (even if cursor matches)", async () => {
    const calls: any[] = [];

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadKinds();
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncJobStore = {
      abortRunningJobIfFromOtherInstance: async () => null,
      isRunningJob: () => false,
      setJob: async () => true
    };
    // @ts-expect-error test global
    globalThis.WebClipper.notionTokenStore = { getToken: async () => ({ accessToken: "t" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.notionDbManager = { ensureDatabase: async () => ({ databaseId: "db_articles" }) };
    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      getSyncMappingByConversation: async () => ({
        conversation: { id: 1, sourceType: "article", title: "A", url: "https://a", lastCapturedAt: 1000, notionPageId: "p1" },
        mapping: { notionPageId: "p1", lastSyncedMessageKey: "article_body", lastSyncedAt: 1000 }
      }),
      getMessagesByConversationId: async () => [{
        messageKey: "article_body",
        role: "assistant",
        contentText: "v2",
        contentMarkdown: "v2",
        sequence: 1,
        updatedAt: 2000
      }],
      setConversationNotionPageId: async () => true,
      setSyncCursor: async () => true
    };

    // @ts-expect-error test global
    globalThis.WebClipper.notionSyncService = {
      getPage: async () => ({ id: "p1", parent: { type: "database_id", database_id: "db_articles" }, archived: false, in_trash: false }),
      isPageUsableForDatabase: () => true,
      updatePageProperties: async (_t: string, req: any) => {
        calls.push({ op: "updateProps", req });
        return { ok: true };
      },
      clearPageChildren: async () => {
        calls.push({ op: "clear" });
        return { ok: true };
      },
      appendChildren: async () => {
        calls.push({ op: "append" });
        return { ok: true };
      },
      messagesToBlocks: () => [{ kind: "blocks", count: 1 }]
    };

    const orchestrator = loadOrchestrator();
    const res = await orchestrator.syncConversations({ conversationIds: [1], instanceId: "i" });
    expect(res.okCount).toBe(1);
    expect(res.results[0].mode).toBe("rebuilt");
    expect(calls.some((c) => c.op === "clear")).toBe(true);
    expect(calls.some((c) => c.op === "append")).toBe(true);
  });
});
