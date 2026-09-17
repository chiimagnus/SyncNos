import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dom: JSDOM;

function installDom(url: string) {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url });
  vi.stubGlobal('window', dom.window as unknown as Window & typeof globalThis);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
}

async function loadInterceptor() {
  let config: any = null;
  vi.stubGlobal('defineContentScript', (value: any) => {
    config = value;
    return value;
  });
  await import('../../src/entrypoints/notionai-transcript-interceptor.content.ts');
  if (!config) throw new Error('notionai transcript interceptor was not registered');
  return config;
}

function findPosted(spy: ReturnType<typeof vi.spyOn>, type: string) {
  return spy.mock.calls.map((call) => call[0] as any).filter((data) => data?.type === type);
}

function dispatchRequest(threadId: string, mode: 'full' | 'latest', requestId = 'request-1') {
  window.dispatchEvent(
    new (window as any).MessageEvent('message', {
      source: window,
      data: {
        __syncnos: true,
        type: 'SYNCNOS_NOTIONAI_TRANSCRIPT_REQUEST',
        requestId,
        threadId,
        mode,
      },
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  dom?.window.close();
});

describe('Notion AI transcript main-world interceptor', () => {
  it('runs at document-start in MAIN world on Notion hosts', async () => {
    installDom('https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef');
    vi.stubGlobal('fetch', vi.fn());
    const config = await loadInterceptor();

    expect(config.runAt).toBe('document_start');
    expect(config.world).toBe('MAIN');
    expect(config.matches).toEqual(['https://app.notion.com/*', 'https://notion.so/*', 'https://*.notion.so/*']);
  });

  it('reuses the page-authenticated transcript request to paginate history without posting request headers', async () => {
    const compactThreadId = '0123456789abcdef0123456789abcdef';
    const apiThreadId = '01234567-89ab-cdef-0123-456789abcdef';
    installDom(`https://app.notion.com/chat?t=${compactThreadId}&wfv=chat`);

    const calls: Array<{ body: any; headers: Headers }> = [];
    const fetchStub = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calls.push({ body, headers: new Headers(init?.headers) });
      const page = body.cursor
        ? {
            patches: [
              {
                op: 'put',
                entity: {
                  id: 'old-user',
                  kind: 'user_message',
                  sequence: 1,
                  text: [['old']],
                  files: [{ url: 'https://signed.example/private?token=must-not-cross-worlds' }],
                },
              },
            ],
            has_more_backward: false,
            backward_cursor: 'oldest',
          }
        : {
            patches: [
              { op: 'put', entity: { id: 'new-assistant', kind: 'assistant_message', sequence: 2, content: [] } },
              {
                op: 'put',
                entity: { id: 'private-thinking', kind: 'thinking', content_text: 'must not cross worlds' },
              },
              { op: 'put', entity: { id: 'private-tool', kind: 'tool', result: { secret: 'must not cross worlds' } } },
            ],
            has_more_backward: true,
            backward_cursor: 'older-cursor',
          };
      return new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchStub);
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const config = await loadInterceptor();
    config.main();

    await (globalThis.fetch as any)('/api/v3/getThreadTranscript', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-private-session-header': 'must-stay-in-main-world',
      },
      body: JSON.stringify({ spaceId: 'space-1', threadId: apiThreadId, direction: 'backward', limit: 10 }),
    });

    dispatchRequest(compactThreadId, 'full');
    await vi.waitFor(() => expect(findPosted(postSpy, 'SYNCNOS_NOTIONAI_TRANSCRIPT_RESPONSE')).toHaveLength(1));

    const response = findPosted(postSpy, 'SYNCNOS_NOTIONAI_TRANSCRIPT_RESPONSE')[0];
    expect(response).toMatchObject({
      threadId: compactThreadId,
      complete: true,
      pages: [
        {
          patches: [
            expect.objectContaining({
              entity: expect.objectContaining({ id: 'old-user', has_files: true }),
            }),
          ],
        },
        { patches: [expect.objectContaining({ entity: expect.objectContaining({ id: 'new-assistant' }) })] },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('must-stay-in-main-world');
    expect(JSON.stringify(response)).not.toContain('must not cross worlds');
    expect(JSON.stringify(response)).not.toContain('must-not-cross-worlds');

    expect(calls).toHaveLength(3);
    expect(calls[1].body).toMatchObject({ threadId: apiThreadId, direction: 'backward', limit: 10 });
    expect(calls[1].body.cursor).toBeUndefined();
    expect(calls[2].body.cursor).toBe('older-cursor');
    expect(calls[1].headers.get('x-private-session-header')).toBe('must-stay-in-main-world');
  });

  it('refuses transcript replay after navigation to another thread', async () => {
    const threadA = '0123456789abcdef0123456789abcdef';
    installDom(`https://app.notion.com/chat?t=${threadA}&wfv=chat`);
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ patches: [], has_more_backward: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const config = await loadInterceptor();
    config.main();

    await (globalThis.fetch as any)('/api/v3/getThreadTranscript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        spaceId: 'space-1',
        threadId: '01234567-89ab-cdef-0123-456789abcdef',
        direction: 'backward',
        limit: 10,
      }),
    });
    const initialCalls = fetchStub.mock.calls.length;

    dom.reconfigure({ url: 'https://app.notion.com/chat?t=fedcba9876543210fedcba9876543210&wfv=chat' });
    dispatchRequest(threadA, 'full');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchStub).toHaveBeenCalledTimes(initialCalls);
    expect(findPosted(postSpy, 'SYNCNOS_NOTIONAI_TRANSCRIPT_RESPONSE')).toEqual([]);
  });
});
