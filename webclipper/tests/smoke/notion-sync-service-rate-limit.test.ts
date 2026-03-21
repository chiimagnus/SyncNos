import { afterEach, describe, expect, it, vi } from "vitest";

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

async function loadNotionSyncService() {
  return loadFresh("../../src/sync/notion/notion-sync-service.ts");
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return true;
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for ${label}`);
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

  it("still appends children when the source array has a broken slice implementation", async () => {
    const notionSyncService = await loadNotionSyncService();
    const appendBodies: any[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      if (String(init?.method || "").toUpperCase() === "PATCH") {
        appendBodies.push(JSON.parse(String(init?.body || "{}")));
      }
      return notionResponse({ ok: true, status: 200, body: { results: [] } });
    });
    (globalThis as any).fetch = fetchMock;

    class BadSliceArray<T> extends Array<T> {
      override slice(start?: number, end?: number) {
        if (start === undefined && end === undefined) {
          return {
            length: 1,
            slice() {
              return undefined;
            },
          } as any;
        }
        return super.slice(start, end);
      }
    }

	    const blocks = new BadSliceArray(paragraphBlock(0), paragraphBlock(1));

	    await expect(notionSyncService.appendChildren("token", "page_5", blocks as any)).resolves.toEqual({
	      results: [],
	      count: 0,
	    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(appendBodies[0]?.children)).toBe(true);
    expect(appendBodies[0]?.children).toHaveLength(2);
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

  it("caps clearPageChildren delete concurrency at the configured limit", async () => {
    const notionSyncService = await loadNotionSyncService();
    const blockers = new Map<string, ReturnType<typeof deferred<any>>>();
    let activeDeletes = 0;
    let maxActiveDeletes = 0;

    const fetchMock = vi.fn((url: string, init?: { method?: string }) => {
      if (String(url).includes("/children?page_size=100")) {
        return Promise.resolve(notionResponse({
          ok: true,
          status: 200,
          body: {
            results: Array.from({ length: 8 }, (_, index) => ({ id: `block_${index}` })),
            has_more: false,
            next_cursor: null,
          },
        }));
      }

      if (init?.method === "DELETE") {
        const blockId = String(url).split("/v1/blocks/")[1];
        const blocker = deferred<any>();
        blockers.set(blockId, blocker);
        activeDeletes += 1;
        maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
        return blocker.promise.then(() => {
          activeDeletes -= 1;
          return notionResponse({ ok: true, status: 200, body: {} });
        });
      }

      throw new Error(`unexpected fetch: ${String(url)} ${String(init?.method || "GET")}`);
    });
    (globalThis as any).fetch = fetchMock;

    const promise = notionSyncService.clearPageChildren("token", "page_4");

    await waitFor(() => blockers.size === 6, "initial delete workers");
    expect(maxActiveDeletes).toBe(6);

    for (const blocker of blockers.values()) blocker.resolve(undefined);

    await waitFor(() => blockers.size === 8, "remaining delete workers");
    for (const blocker of blockers.values()) blocker.resolve(undefined);

    await promise;
    expect(maxActiveDeletes).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });
});
