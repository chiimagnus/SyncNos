import { describe, expect, it } from "vitest";

function loadNotionApi() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/sync/notion/notion-api.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/sync/notion/notion-api.js");
}

function loadNotionFilesApi() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/sync/notion/notion-files-api.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/sync/notion/notion-files-api.js");
}

describe("notion-files-api", () => {
  it("notionFetch supports version override", async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: string, init: any) => {
      calls.push(init);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true })
      };
    };

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const notionApi = loadNotionApi();

    await notionApi.notionFetch({ accessToken: "t", method: "GET", path: "/v1/users/me" });
    await notionApi.notionFetch({ accessToken: "t", method: "GET", path: "/v1/users/me", notionVersion: "2099-01-01" });

    expect(calls[0].headers["Notion-Version"]).toBe("2022-06-28");
    expect(calls[1].headers["Notion-Version"]).toBe("2099-01-01");
  });

  it("creates external_url upload and polls until uploaded", async () => {
    const reqs: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        reqs.push(req);
        if (req.method === "POST" && req.path === "/v1/file_uploads") {
          return { id: "u1", status: "pending" };
        }
        if (req.method === "GET" && req.path.startsWith("/v1/file_uploads/")) {
          const count = reqs.filter((r) => r.method === "GET").length;
          return count >= 2 ? { id: "u1", status: "uploaded" } : { id: "u1", status: "pending" };
        }
        throw new Error(`unexpected: ${req.method} ${req.path}`);
      }
    };

    const files = loadNotionFilesApi();
    const created = await files.createExternalURLUpload({ accessToken: "t", url: "https://example.com/a.png" });
    expect(created.id).toBe("u1");

    const ready = await files.waitUntilUploaded({ accessToken: "t", id: "u1", pollIntervalMs: 1, maxAttempts: 3 });
    expect(ready.status).toBe("uploaded");

    const post = reqs.find((r) => r.method === "POST");
    expect(post.notionVersion).toBe("2025-09-03");
    expect(post.body.mode).toBe("external_url");
    expect(post.body.external_url).toBe("https://example.com/a.png");
  });
});

