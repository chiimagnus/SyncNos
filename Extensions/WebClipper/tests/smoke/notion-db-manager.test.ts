import { describe, expect, it } from "vitest";

function mockChromeStorage({ initial = {} as Record<string, unknown> } = {}) {
  const store: Record<string, unknown> = { ...initial };
  return {
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) out[k] = store[k];
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        }
      }
    }
  };
}

describe("notion-db-manager", () => {
  it("creates SyncNos-AI Chats database when missing", async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {
      notionApi: {
        notionFetch: async (req: any) => {
          calls.push(req);
          if (req.method === "POST" && req.path === "/v1/search") return { results: [] };
          if (req.method === "POST" && req.path === "/v1/databases") return { id: "db_created" };
          throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
        }
      }
    };
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = require.resolve("../../src/sync/notion/notion-db-manager.js");
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete require.cache[modulePath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notionDbManager = require("../../src/sync/notion/notion-db-manager.js");

    const res = await notionDbManager.ensureDatabase({ accessToken: "t", parentPageId: "p" });
    expect(res.databaseId).toBe("db_created");
    expect(res.title).toBe("SyncNos-AI Chats");

    const create = calls.find((c) => c.method === "POST" && c.path === "/v1/databases");
    expect(create).toBeTruthy();
    expect(create.body.title?.[0]?.text?.content).toBe("SyncNos-AI Chats");
    expect(create.body.properties?.AI?.multi_select).toBeTruthy();
  });

  it("best-effort adds AI property when reusing cached database without AI", async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {
      notionApi: {
        notionFetch: async (req: any) => {
          calls.push(req);
          if (req.method === "GET" && req.path === "/v1/databases/db1") {
            return { id: "db1", properties: { Name: { type: "title" }, Date: { type: "date" }, URL: { type: "url" } } };
          }
          if (req.method === "PATCH" && req.path === "/v1/databases/db1") return { ok: true };
          throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
        }
      }
    };
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { notion_db_id_syncnos_ai_chats: "db1" } });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = require.resolve("../../src/sync/notion/notion-db-manager.js");
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete require.cache[modulePath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notionDbManager = require("../../src/sync/notion/notion-db-manager.js");

    const res = await notionDbManager.ensureDatabase({ accessToken: "t", parentPageId: "p" });
    expect(res.reused).toBe(true);
    expect(res.databaseId).toBe("db1");

    const patched = calls.some((c) => c.method === "PATCH" && c.path === "/v1/databases/db1");
    expect(patched).toBe(true);
  });
});
