import { describe, expect, it } from "vitest";

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

async function loadNotionAi() {
  return loadFresh("../../src/sync/notion/notion-ai.ts");
}

async function loadNotionSyncService() {
  return loadFresh("../../src/sync/notion/notion-sync-service.ts");
}

describe("notion-sync-service", () => {
  it("sets AI multi_select on create", async () => {
    let lastReq: any = null;
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        lastReq = req;
        return { id: "p1" };
      }
    };

    const notionSyncService = await loadNotionSyncService();

    await notionSyncService.createPageInDatabase("t", { databaseId: "db", title: "Hello", url: "https://x", ai: "chatgpt" });
    expect(lastReq.method).toBe("POST");
    expect(lastReq.path).toBe("/v1/pages");
    expect(lastReq.body.properties.AI.multi_select[0].name).toBe("ChatGPT");
    expect(lastReq.body.properties.Date?.date?.start).toBeTruthy();
  });

  it("respects explicit properties (article should not inject AI)", async () => {
    let lastReq: any = null;
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        lastReq = req;
        return { id: "p1" };
      }
    };

    const notionSyncService = await loadNotionSyncService();

    await notionSyncService.createPageInDatabase("t", {
      databaseId: "db",
      properties: {
        Name: { title: [{ type: "text", text: { content: "Article" } }] },
        URL: { url: "https://x" },
        Date: { date: { start: "2026-02-26T00:00:00.000Z" } },
        Author: { rich_text: [{ type: "text", text: { content: "A" } }] }
      }
    });
    expect(lastReq.body.properties.AI).toBeUndefined();
    expect(lastReq.body.properties.Author).toBeTruthy();
  });

  it("uses capturedAt when generating Date on create", async () => {
    let lastReq: any = null;
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        lastReq = req;
        return { id: "p1" };
      }
    };

    const notionSyncService = await loadNotionSyncService();

    await notionSyncService.createPageInDatabase("t", {
      databaseId: "db",
      title: "Hello",
      url: "https://x",
      ai: "chatgpt",
      capturedAt: Date.parse("2026-02-23T12:34:56.000Z")
    });
    expect(lastReq.body.properties.Date?.date?.start).toBe("2026-02-23T12:34:56.000Z");
  });

  it("sets AI multi_select on update", async () => {
    let lastReq: any = null;
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        lastReq = req;
        return { ok: true };
      }
    };

    const notionSyncService = await loadNotionSyncService();

    await notionSyncService.updatePageProperties("t", { pageId: "p1", title: "Hello", url: "https://x", ai: "claude" });
    expect(lastReq.method).toBe("PATCH");
    expect(lastReq.path).toBe("/v1/pages/p1");
    expect(lastReq.body.properties.AI.multi_select[0].name).toBe("Claude");
    expect(lastReq.body.properties.Date).toBeUndefined();
  });

  it("detects page database parent", async () => {
    const notionSyncService = await loadNotionSyncService();

    const page = { parent: { type: "database_id", database_id: "db1" } };
    expect(notionSyncService.pageBelongsToDatabase(page, "db1")).toBe(true);
    expect(notionSyncService.pageBelongsToDatabase(page, "db2")).toBe(false);
  });

  it("detects archived/trashed pages", async () => {
    const notionSyncService = await loadNotionSyncService();

    expect(notionSyncService.isPageArchivedOrTrashed({ archived: true })).toBe(true);
    expect(notionSyncService.isPageArchivedOrTrashed({ in_trash: true })).toBe(true);
    expect(notionSyncService.isPageArchivedOrTrashed({ archived: false, in_trash: false })).toBe(false);
  });

  it("paginates when clearing page children", async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        calls.push(req);
        if (req.method === "GET" && req.path.startsWith("/v1/blocks/p1/children")) {
          if (calls.filter((c) => c.method === "GET").length === 1) {
            return { results: [{ id: "b1" }], has_more: true, next_cursor: "c2" };
          }
          return { results: [{ id: "b2" }], has_more: false, next_cursor: null };
        }
        if (req.method === "DELETE" && (req.path === "/v1/blocks/b1" || req.path === "/v1/blocks/b2")) return { ok: true };
        throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
      }
    };

    const notionSyncService = await loadNotionSyncService();

    await notionSyncService.clearPageChildren("t", "p1");
    const getCalls = calls.filter((c) => c.method === "GET");
    const delCalls = calls.filter((c) => c.method === "DELETE");
    expect(getCalls.length).toBe(2);
    expect(delCalls.map((c) => c.path).sort()).toEqual(["/v1/blocks/b1", "/v1/blocks/b2"]);
  });

  it("retries transient errors when clearing page children", async () => {
    const calls: any[] = [];
    let b1DeleteAttempts = 0;
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        calls.push(req);
        if (req.method === "GET" && req.path.startsWith("/v1/blocks/p2/children")) {
          return { results: [{ id: "b1" }, { id: "b2" }], has_more: false, next_cursor: null };
        }
        if (req.method === "DELETE" && req.path === "/v1/blocks/b1") {
          b1DeleteAttempts += 1;
          if (b1DeleteAttempts === 1) {
            const err: any = new Error("notion api failed: DELETE /v1/blocks/b1 HTTP 429");
            err.status = 429;
            err.retryAfterMs = 1;
            throw err;
          }
          return { ok: true };
        }
        if (req.method === "DELETE" && req.path === "/v1/blocks/b2") return { ok: true };
        throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
      }
    };

    const notionSyncService = await loadNotionSyncService();

    await notionSyncService.clearPageChildren("t", "p2");
    const deleteCalls = calls.filter((c) => c.method === "DELETE").map((c) => c.path);
    const b1Calls = deleteCalls.filter((path) => path === "/v1/blocks/b1");
    expect(b1Calls.length).toBe(2);
    expect(deleteCalls.includes("/v1/blocks/b2")).toBe(true);
  });

  it("archives children concurrently when clearing a page", async () => {
    const startedDeletes: string[] = [];
    const deleteResolvers = new Map<string, () => void>();
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        if (req.method === "GET" && req.path.startsWith("/v1/blocks/p3/children")) {
          return { results: [{ id: "b1" }, { id: "b2" }], has_more: false, next_cursor: null };
        }
        if (req.method === "DELETE" && (req.path === "/v1/blocks/b1" || req.path === "/v1/blocks/b2")) {
          startedDeletes.push(req.path);
          return new Promise((resolve) => {
            deleteResolvers.set(req.path, () => resolve({ ok: true }));
          });
        }
        throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
      }
    };

    const notionSyncService = await loadNotionSyncService();

    const clearing = notionSyncService.clearPageChildren("t", "p3");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(startedDeletes.slice().sort()).toEqual(["/v1/blocks/b1", "/v1/blocks/b2"]);

    deleteResolvers.get("/v1/blocks/b1")?.();
    deleteResolvers.get("/v1/blocks/b2")?.();
    await clearing;
  });
});
