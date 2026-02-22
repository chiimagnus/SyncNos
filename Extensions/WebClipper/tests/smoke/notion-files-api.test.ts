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

  it("supports single_part file upload (create + send + poll)", async () => {
    const reqs: any[] = [];
    const fetchCalls: any[] = [];

    // @ts-expect-error test global
    globalThis.fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200, text: async () => "" };
    };

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        reqs.push(req);
        if (req.method === "POST" && req.path === "/v1/file_uploads" && req.body && req.body.mode === "single_part") {
          return { id: "u2", status: "pending" };
        }
        if (req.method === "GET" && req.path === "/v1/file_uploads/u2") return { id: "u2", status: "uploaded" };
        throw new Error(`unexpected: ${req.method} ${req.path}`);
      }
    };

    const files = loadNotionFilesApi();
    const created = await files.createFileUpload({
      accessToken: "t",
      filename: "a.png",
      contentType: "image/png",
      contentLength: 3
    });
    expect(created.id).toBe("u2");

    await files.sendFileUpload({
      accessToken: "t",
      id: created.id,
      bytes: new Uint8Array([1, 2, 3]),
      filename: "a.png",
      contentType: "image/png"
    });
    expect(fetchCalls[0].url).toBe("https://api.notion.com/v1/file_uploads/u2/send");
    expect(fetchCalls[0].init.method).toBe("POST");
    expect(fetchCalls[0].init.headers.Authorization).toBe("Bearer t");
    expect(fetchCalls[0].init.headers["Notion-Version"]).toBe("2025-09-03");
    expect(typeof fetchCalls[0].init.body?.append).toBe("function");

    await files.waitUntilUploaded({ accessToken: "t", id: "u2", pollIntervalMs: 1, maxAttempts: 1 });

    const post = reqs.find((r) => r.method === "POST" && r.path === "/v1/file_uploads");
    expect(post.notionVersion).toBe("2025-09-03");
    expect(post.body.mode).toBe("single_part");
    expect(post.body.content_type).toBe("image/png");
    expect(post.body.content_length).toBe(undefined);
  });

  it("surfaces file_import_result when upload fails", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.WebClipper.notionApi = {
      notionFetch: async (req: any) => {
        if (req.method === "GET" && req.path.startsWith("/v1/file_uploads/")) {
          return { id: "u1", status: "failed", file_import_result: { message: "403" } };
        }
        throw new Error(`unexpected: ${req.method} ${req.path}`);
      }
    };

    const files = loadNotionFilesApi();
    await expect(files.waitUntilUploaded({ accessToken: "t", id: "u1", pollIntervalMs: 1, maxAttempts: 1 }))
      .rejects
      .toThrow(/file upload failed/i);
  });
});
