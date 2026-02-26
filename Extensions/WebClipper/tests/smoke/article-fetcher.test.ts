import { afterEach, describe, expect, it } from "vitest";

function loadModule(relativePath: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve(relativePath);
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modulePath);
}

function loadMessageContracts() {
  return loadModule("../../src/shared/message-contracts.js");
}

function loadArticleFetcher() {
  return loadModule("../../src/collectors/article-fetcher.js");
}

function loadBackgroundRouter() {
  return loadModule("../../src/bootstrap/background-router.js");
}

afterEach(() => {
  // @ts-expect-error test cleanup
  delete globalThis.WebClipper;
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe("article-fetcher module", () => {
  it("exports fetchArticleFromActiveTab function", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const fetcher = loadArticleFetcher();
    expect(typeof fetcher.fetchArticleFromActiveTab).toBe("function");
  });

  it("throws when tabs API is unavailable", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = {};
    const fetcher = loadArticleFetcher();
    await expect(fetcher.fetchArticleFromActiveTab()).rejects.toThrow("tabs API not available");
  });

  it("throws when scripting API is unavailable", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = {
      tabs: {
        query: async () => [{ id: 1, url: "https://example.com" }]
      }
    };
    const fetcher = loadArticleFetcher();
    await expect(fetcher.fetchArticleFromActiveTab()).rejects.toThrow("scripting API not available");
  });

  it("throws when no active tab is found", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = {
      tabs: { query: async () => [] },
      scripting: {}
    };
    const fetcher = loadArticleFetcher();
    await expect(fetcher.fetchArticleFromActiveTab()).rejects.toThrow("no active tab");
  });

  it("throws when active tab URL is not http(s)", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = {
      tabs: { query: async () => [{ id: 1, url: "chrome://newtab" }] },
      scripting: {}
    };
    const fetcher = loadArticleFetcher();
    await expect(fetcher.fetchArticleFromActiveTab()).rejects.toThrow("not an http(s) page");
  });

  it("returns article data on successful extraction", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const fakeArticle = {
      ok: true,
      title: "Test Article",
      author: "Jane Doe",
      text: "Article body text.",
      excerpt: "Short summary.",
      url: "https://example.com/article"
    };
    // @ts-expect-error test global
    globalThis.chrome = {
      tabs: { query: async () => [{ id: 42, url: "https://example.com/article" }] },
      scripting: {
        executeScript: async ({ func }: { func?: unknown; files?: string[] }) => {
          if (func) return [{ result: fakeArticle }];
          return [{ result: undefined }];
        }
      }
    };
    const fetcher = loadArticleFetcher();
    const result = await fetcher.fetchArticleFromActiveTab();
    expect(result.title).toBe("Test Article");
    expect(result.author).toBe("Jane Doe");
    expect(result.text).toBe("Article body text.");
    expect(result.excerpt).toBe("Short summary.");
    expect(result.url).toBe("https://example.com/article");
  });

  it("throws when extraction result indicates failure", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = {
      tabs: { query: async () => [{ id: 1, url: "https://example.com" }] },
      scripting: {
        executeScript: async ({ func }: { func?: unknown }) => {
          if (func) return [{ result: { ok: false, error: "ParseReturnedNull" } }];
          return [{ result: undefined }];
        }
      }
    };
    const fetcher = loadArticleFetcher();
    await expect(fetcher.fetchArticleFromActiveTab()).rejects.toThrow("ParseReturnedNull");
  });
});

describe("message-contracts ARTICLE_MESSAGE_TYPES", () => {
  it("exports FETCH_ARTICLE type", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const contracts = loadMessageContracts();
    expect(contracts.ARTICLE_MESSAGE_TYPES.FETCH_ARTICLE).toBe("fetchArticle");
  });
});

describe("background-router FETCH_ARTICLE", () => {
  it("returns article data when fetcher succeeds", async () => {
    const fakeArticle = {
      title: "Test",
      author: "",
      text: "Body",
      excerpt: "",
      url: "https://example.com"
    };
    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {},
      articleFetcher: {
        fetchArticleFromActiveTab: async () => fakeArticle
      }
    };
    // @ts-expect-error test global
    globalThis.chrome = {};

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "fetchArticle" });

    expect(res.ok).toBe(true);
    expect(res.data?.title).toBe("Test");
    expect(res.data?.url).toBe("https://example.com");
  });

  it("returns error when fetcher module is missing", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = { backgroundStorage: {} };
    // @ts-expect-error test global
    globalThis.chrome = {};

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "fetchArticle" });

    expect(res.ok).toBe(false);
    expect(String(res.error?.message || "")).toContain("article fetcher not available");
  });

  it("returns error when fetcher throws", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {},
      articleFetcher: {
        fetchArticleFromActiveTab: async () => {
          throw new Error("not an http(s) page");
        }
      }
    };
    // @ts-expect-error test global
    globalThis.chrome = {};

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "fetchArticle" });

    expect(res.ok).toBe(false);
    expect(String(res.error?.message || "")).toContain("not an http(s) page");
  });
});
