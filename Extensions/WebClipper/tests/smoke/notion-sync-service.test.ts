import { describe, expect, it } from "vitest";

describe("notion-sync-service", () => {
  it("sets AI multi_select on create", async () => {
    let lastReq: any = null;
    // @ts-expect-error test global
    globalThis.WebClipper = {
      notionApi: {
        notionFetch: async (req: any) => {
          lastReq = req;
          return { id: "p1" };
        }
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = require.resolve("../../src/sync/notion/notion-sync-service.js");
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete require.cache[modulePath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notionSyncService = require("../../src/sync/notion/notion-sync-service.js");

    await notionSyncService.createPageInDatabase("t", { databaseId: "db", title: "Hello", url: "https://x", ai: "chatgpt" });
    expect(lastReq.method).toBe("POST");
    expect(lastReq.path).toBe("/v1/pages");
    expect(lastReq.body.properties.AI.multi_select[0].name).toBe("ChatGPT");
  });

  it("sets AI multi_select on update", async () => {
    let lastReq: any = null;
    // @ts-expect-error test global
    globalThis.WebClipper = {
      notionApi: {
        notionFetch: async (req: any) => {
          lastReq = req;
          return { ok: true };
        }
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = require.resolve("../../src/sync/notion/notion-sync-service.js");
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete require.cache[modulePath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notionSyncService = require("../../src/sync/notion/notion-sync-service.js");

    await notionSyncService.updatePageProperties("t", { pageId: "p1", title: "Hello", url: "https://x", ai: "claude" });
    expect(lastReq.method).toBe("PATCH");
    expect(lastReq.path).toBe("/v1/pages/p1");
    expect(lastReq.body.properties.AI.multi_select[0].name).toBe("Claude");
  });

  it("detects page database parent", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = require.resolve("../../src/sync/notion/notion-sync-service.js");
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete require.cache[modulePath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notionSyncService = require("../../src/sync/notion/notion-sync-service.js");

    const page = { parent: { type: "database_id", database_id: "db1" } };
    expect(notionSyncService.pageBelongsToDatabase(page, "db1")).toBe(true);
    expect(notionSyncService.pageBelongsToDatabase(page, "db2")).toBe(false);
  });
});
