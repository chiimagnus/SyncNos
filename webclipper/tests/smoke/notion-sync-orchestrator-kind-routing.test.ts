import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotionSyncOrchestrator } from "@services/sync/notion/notion-sync-orchestrator.ts";
import { conversationKinds } from "@services/protocols/conversation-kinds.ts";

let notionFetchImpl: ((req: any) => Promise<any>) | null = null;

vi.mock("@services/sync/notion/notion-api.ts", () => {
  const notionFetch = (req: any) => {
    if (!notionFetchImpl) throw new Error("notionFetchImpl not set");
    return notionFetchImpl(req);
  };
  return {
    notionFetch,
    default: { NOTION_VERSION: "2022-06-28", notionFetch },
  };
});

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

describe("notion-sync-orchestrator kind routing", () => {
  beforeEach(() => {
    notionFetchImpl = null;
  });

  it("routes chat/article to different dbSpec and avoids AI for article", async () => {
    const ensureCalls: any[] = [];
    const createCalls: any[] = [];
    const updateCalls: any[] = [];

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const jobStore = {
      abortRunningJobIfFromOtherInstance: async () => null,
      isRunningJob: () => false,
      setJob: async () => true
    };

    const tokenStore = { getToken: async () => ({ accessToken: "t" }) };

    const dbManager = {
      ensureDatabase: async ({ dbSpec }: any) => {
        ensureCalls.push(dbSpec);
        if (dbSpec.storageKey === "notion_db_id_syncnos_web_articles") return { databaseId: "db_articles" };
        return { databaseId: "db_chats" };
      }
    };

    const storage = {
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

    const syncService = {
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
      appendChildren: async (_t: string, _blockId: string, blocks: any[]) => {
        const results = Array.isArray(blocks) ? blocks.map((_, i) => ({ id: `b_${i}_${Math.random().toString(16).slice(2)}` })) : [];
        return { ok: true, results };
      },
      messagesToBlocks: (messages: any[]) => [{ kind: "blocks", count: messages.length }]
    };

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore,
      storage,
      conversationKinds,
      notionApi: {},
      notionFilesApi: {},
      dbManager,
      syncService,
      jobStore,
    });
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

  it("rebuilds article section when digest changes", async () => {
    const calls: any[] = [];

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const jobStore = {
      abortRunningJobIfFromOtherInstance: async () => null,
      isRunningJob: () => false,
      setJob: async () => true
    };

    const tokenStore = { getToken: async () => ({ accessToken: "t" }) };

    const dbManager = { ensureDatabase: async () => ({ databaseId: "db_articles" }) };

    const storage = {
      getSyncMappingByConversation: async () => ({
        conversation: { id: 1, sourceType: "article", title: "A", url: "https://a", lastCapturedAt: 1000, notionPageId: "p1" },
        mapping: {
          notionPageId: "p1",
          notionSections: { article: { headingBlockId: "h_article" } },
          notionSectionDigests: { article: { digest: "old" } },
        }
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

    notionFetchImpl = async (req: any) => {
      calls.push({ op: "fetch", req });
      if (req.method === "DELETE" && req.path === "/v1/blocks/h_article") return { ok: true };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    const syncService = {
      getPage: async () => ({ id: "p1", parent: { type: "database_id", database_id: "db_articles" }, archived: false, in_trash: false }),
      isPageUsableForDatabase: () => true,
      updatePageProperties: async (_t: string, req: any) => {
        calls.push({ op: "updateProps", req });
        return { ok: true };
      },
      appendChildren: async (_t: string, blockId: string, blocks: any[]) => {
        calls.push({ op: "append", blockId, count: Array.isArray(blocks) ? blocks.length : 0 });
        const results = Array.isArray(blocks) ? blocks.map((_, i) => ({ id: `${blockId}_c_${i}` })) : [];
        return { ok: true, results };
      },
      messagesToBlocks: () => [{ kind: "blocks", count: 1 }]
    };

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore,
      storage,
      conversationKinds,
      notionApi: {},
      notionFilesApi: {},
      dbManager,
      syncService,
      jobStore,
    });
    const res = await orchestrator.syncConversations({ conversationIds: [1], instanceId: "i" });
    expect(res.okCount).toBe(1);
    expect(res.results[0].mode).toBe("rebuilt");
    expect(calls.some((c) => c.op === "fetch" && c.req?.method === "DELETE")).toBe(true);
    expect(calls.some((c) => c.op === "append")).toBe(true);
  });
});
