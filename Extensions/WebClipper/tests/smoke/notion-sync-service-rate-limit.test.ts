import { afterEach, describe, expect, it, vi } from "vitest";

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

async function loadNotionSyncService() {
  return loadFresh("../../src/sync/notion/notion-sync-service.ts");
}

function notionResponse({
  ok = true,
  status = 200,
  body = {},
  retryAfter = "",
}: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  retryAfter?: string;
}) {
  return {
    ok,
    status,
    headers: {
      get(name: string) {
        if (String(name).toLowerCase() === "retry-after") return retryAfter;
        return "";
      },
    },
    text: async () => JSON.stringify(body),
  };
}

function paragraphBlock(index: number) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: `block-${index}` } }],
    },
  };
}

describe("notion-sync-service rate limit", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).fetch;
  });

  it("retries appendChildren on 429 using retry-after and does not sleep between successful batches", async () => {
    vi.useFakeTimers();
    const notionSyncService = await loadNotionSyncService();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(notionResponse({
        ok: false,
        status: 429,
        retryAfter: "0.2",
        body: {
          object: "error",
          status: 429,
          code: "rate_limited",
          message: "slow down",
        },
      }))
      .mockResolvedValueOnce(notionResponse({ ok: true, status: 200, body: { results: [] } }))
      .mockResolvedValueOnce(notionResponse({ ok: true, status: 200, body: { results: [] } }));
    (globalThis as any).fetch = fetchMock;
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const blocks = Array.from({ length: 91 }, (_, index) => paragraphBlock(index));
    const promise = notionSyncService.appendChildren("token", "page_1", blocks);

    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy.mock.calls.some((call) => Number(call[1]) >= 150)).toBe(true);
  });

  it("retries clearPageChildren deletes on 503 using the shared backoff path", async () => {
    vi.useFakeTimers();
    const notionSyncService = await loadNotionSyncService();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(notionResponse({
        ok: true,
        status: 200,
        body: { results: [{ id: "block_a" }], has_more: false, next_cursor: null },
      }))
      .mockResolvedValueOnce(notionResponse({
        ok: false,
        status: 503,
        retryAfter: "0.15",
        body: {
          object: "error",
          status: 503,
          code: "service_unavailable",
          message: "temporarily unavailable",
        },
      }))
      .mockResolvedValueOnce(notionResponse({ ok: true, status: 200, body: {} }));
    (globalThis as any).fetch = fetchMock;
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = notionSyncService.clearPageChildren("token", "page_2");

    await vi.advanceTimersByTimeAsync(150);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy.mock.calls.some((call) => Number(call[1]) >= 150)).toBe(true);
  });

  it("sends consecutive successful append batches without fixed delay", async () => {
    const notionSyncService = await loadNotionSyncService();
    const fetchMock = vi.fn().mockResolvedValue(notionResponse({ ok: true, status: 200, body: { results: [] } }));
    (globalThis as any).fetch = fetchMock;
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const blocks = Array.from({ length: 181 }, (_, index) => paragraphBlock(index));
    await notionSyncService.appendChildren("token", "page_3", blocks);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});
