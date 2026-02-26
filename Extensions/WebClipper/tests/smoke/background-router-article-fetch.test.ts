import { afterEach, describe, expect, it, vi } from "vitest";

function loadBackgroundRouter() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/bootstrap/background-router.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/bootstrap/background-router.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test cleanup
  delete globalThis.WebClipper;
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe("background-router article fetch", () => {
  it("routes fetchActiveTabArticle to articleFetchService", async () => {
    const fetchActiveTabArticle = vi.fn(async ({ tabId }: { tabId?: number }) => ({
      conversationId: 7,
      tabId: Number(tabId || 0)
    }));

    // @ts-expect-error test global
    globalThis.WebClipper = {
      articleFetchService: {
        fetchActiveTabArticle
      }
    };
    // @ts-expect-error test global
    globalThis.chrome = {};

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "fetchActiveTabArticle", tabId: 42 });

    expect(res.ok).toBe(true);
    expect(res.data?.conversationId).toBe(7);
    expect(fetchActiveTabArticle).toHaveBeenCalledTimes(1);
    expect(fetchActiveTabArticle).toHaveBeenCalledWith({ tabId: 42 });
  });

  it("returns error when article fetch service is missing", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    // @ts-expect-error test global
    globalThis.chrome = {};

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "fetchActiveTabArticle" });

    expect(res.ok).toBe(false);
    expect(String(res.error?.message || "")).toContain("article fetch service missing");
  });

  it("returns error payload when article fetch throws", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {
      articleFetchService: {
        fetchActiveTabArticle: async () => {
          throw new Error("extract failed");
        }
      }
    };
    // @ts-expect-error test global
    globalThis.chrome = {};

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: "fetchActiveTabArticle" });

    expect(res.ok).toBe(false);
    expect(String(res.error?.message || "")).toContain("extract failed");
  });
});
