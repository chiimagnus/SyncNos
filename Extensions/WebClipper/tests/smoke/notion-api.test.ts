import { describe, expect, it } from "vitest";

function loadNotionApi() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/sync/notion/notion-api.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/sync/notion/notion-api.js");
}

describe("notion-api", () => {
  it("searchPages supports start_cursor and page size normalization", async () => {
    const reqs: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: string, init: any) => {
      reqs.push(JSON.parse(String(init.body || "{}")));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ results: [], has_more: false, next_cursor: null })
      };
    };

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const notionApi = loadNotionApi();

    await notionApi.searchPages({
      accessToken: "t",
      query: "",
      pageSize: 999,
      startCursor: "cursor_1"
    });

    expect(reqs.length).toBe(1);
    expect(reqs[0].page_size).toBe(100);
    expect(reqs[0].start_cursor).toBe("cursor_1");
  });

  it("searchAllPages paginates and merges all results", async () => {
    const reqs: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: string, init: any) => {
      const body = JSON.parse(String(init.body || "{}"));
      reqs.push(body);
      if (!body.start_cursor) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            results: [{ id: "p1" }],
            has_more: true,
            next_cursor: "cursor_2"
          })
        };
      }
      if (body.start_cursor === "cursor_2") {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            results: [{ id: "p2" }, { id: "p3" }],
            has_more: false,
            next_cursor: null
          })
        };
      }
      throw new Error(`unexpected start_cursor: ${body.start_cursor}`);
    };

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const notionApi = loadNotionApi();

    const result = await notionApi.searchAllPages({
      accessToken: "t",
      query: "",
      pageSize: 100
    });

    expect(reqs.length).toBe(2);
    expect(reqs[0].start_cursor).toBeUndefined();
    expect(reqs[1].start_cursor).toBe("cursor_2");
    expect(result.results.map((x: any) => x.id)).toEqual(["p1", "p2", "p3"]);
    expect(result.has_more).toBe(false);
    expect(result.next_cursor).toBe(null);
  });
});
