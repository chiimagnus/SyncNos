import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

async function loadNotionSyncService() {
  return loadFresh('@services/sync/notion/notion-sync-service.ts');
}

function notionResponse({
  ok = true,
  status = 200,
  body = {},
  retryAfter = '',
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
        if (String(name).toLowerCase() === 'retry-after') return retryAfter;
        return '';
      },
    },
    text: async () => JSON.stringify(body),
  };
}

function paragraphBlock(index: number) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: `block-${index}` } }],
    },
  };
}

describe('notion-sync-service rate limit', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).fetch;
  });

  it('retries appendChildren on 429 using retry-after and does not sleep between successful batches', async () => {
    vi.useFakeTimers();
    const notionSyncService = await loadNotionSyncService();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        notionResponse({
          ok: false,
          status: 429,
          retryAfter: '0.2',
          body: {
            object: 'error',
            status: 429,
            code: 'rate_limited',
            message: 'slow down',
          },
        }),
      )
      .mockResolvedValueOnce(notionResponse({ ok: true, status: 200, body: { results: [] } }))
      .mockResolvedValueOnce(notionResponse({ ok: true, status: 200, body: { results: [] } }));
    (globalThis as any).fetch = fetchMock;
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const blocks = Array.from({ length: 91 }, (_, index) => paragraphBlock(index));
    const promise = notionSyncService.appendChildren('token', 'page_1', blocks);

    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy.mock.calls.some((call) => Number(call[1]) >= 150)).toBe(true);
  });

  it('still appends children when the source array has a broken slice implementation', async () => {
    const notionSyncService = await loadNotionSyncService();
    const appendBodies: any[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      if (String(init?.method || '').toUpperCase() === 'PATCH') {
        appendBodies.push(JSON.parse(String(init?.body || '{}')));
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

    await expect(notionSyncService.appendChildren('token', 'page_5', blocks as any)).resolves.toEqual({
      results: [],
      count: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(appendBodies[0]?.children)).toBe(true);
    expect(appendBodies[0]?.children).toHaveLength(2);
  });

  it('sends consecutive successful append batches without fixed delay', async () => {
    const notionSyncService = await loadNotionSyncService();
    const fetchMock = vi.fn().mockResolvedValue(notionResponse({ ok: true, status: 200, body: { results: [] } }));
    (globalThis as any).fetch = fetchMock;
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const blocks = Array.from({ length: 181 }, (_, index) => paragraphBlock(index));
    await notionSyncService.appendChildren('token', 'page_3', blocks);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});
