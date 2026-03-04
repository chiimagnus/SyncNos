import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTION_VERSION, notionFetch, searchPages } from '../../src/sync/notion/notion-api.ts';
import {
  createExternalURLUpload,
  createFileUpload,
  sendFileUpload,
  waitUntilUploaded,
} from '../../src/sync/notion/notion-files-api.ts';

function createHeaders(map: Record<string, string> = {}) {
  return {
    get(key: string) {
      return map[key] ?? map[key.toLowerCase()] ?? null;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test global
  delete globalThis.fetch;
});

describe('notion-api', () => {
  it('notionFetch supports version override', async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: string, init: any) => {
      calls.push(init);
      return {
        ok: true,
        status: 200,
        headers: createHeaders({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: true }),
      };
    };

    await notionFetch({ accessToken: 't', method: 'GET', path: '/v1/users/me' });
    await notionFetch({ accessToken: 't', method: 'GET', path: '/v1/users/me', notionVersion: '2099-01-01' });

    expect(calls[0].headers['Notion-Version']).toBe(NOTION_VERSION);
    expect(calls[1].headers['Notion-Version']).toBe('2099-01-01');
  });

  it('searchPages paginates and returns usable parent pages only', async () => {
    const bodies: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: string, init: any) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      bodies.push(body);
      if (bodies.length === 1) {
        return {
          ok: true,
          status: 200,
          headers: createHeaders({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              results: [{ object: 'page', id: 'entry1', parent: { type: 'database_id', database_id: 'db1' } }],
              has_more: true,
              next_cursor: 'cursor_2',
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: createHeaders({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            results: [
              { object: 'page', id: 'entry2', parent: { type: 'database_id', database_id: 'db2' } },
              { object: 'page', id: 'p2', parent: { type: 'page_id', page_id: 'root1' }, properties: {} },
            ],
            has_more: false,
          }),
      };
    };

    const res = await searchPages({ accessToken: 't', query: '', pageSize: 50 });

    expect(Array.isArray(res.results)).toBe(true);
    expect(res.results.length).toBe(1);
    expect(res.results[0].id).toBe('p2');
    expect(Object.prototype.hasOwnProperty.call(bodies[0], 'query')).toBe(false);
    expect(bodies[0].filter?.value).toBe('page');
    expect(bodies[1].start_cursor).toBe('cursor_2');
  });

  it('searchPages keeps non-empty query', async () => {
    const bodies: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: string, init: any) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return {
        ok: true,
        status: 200,
        headers: createHeaders({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({ results: [{ object: 'page', id: 'p1', properties: {} }], has_more: false }),
      };
    };

    await searchPages({ accessToken: 't', query: 'syncnos', pageSize: 10 });
    expect(bodies[0].query).toBe('syncnos');
    expect(bodies[0].page_size).toBe(10);
  });
});

describe('notion-files-api', () => {
  it('creates external_url upload and polls until uploaded', async () => {
    const reqs: any[] = [];
    let pollCount = 0;

    // @ts-expect-error test global
    globalThis.fetch = async (url: string, init: any) => {
      reqs.push({ url, init });
      const u = String(url);
      if (u === 'https://api.notion.com/v1/file_uploads' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          headers: createHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'u1', status: 'pending' }),
        };
      }
      if (u === 'https://api.notion.com/v1/file_uploads/u1' && init?.method === 'GET') {
        pollCount += 1;
        return {
          ok: true,
          status: 200,
          headers: createHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'u1', status: pollCount >= 2 ? 'uploaded' : 'pending' }),
        };
      }
      throw new Error(`unexpected fetch: ${init?.method} ${u}`);
    };

    const created = await createExternalURLUpload({ accessToken: 't', url: 'https://example.com/a.png' });
    expect(created.id).toBe('u1');

    const ready = await waitUntilUploaded({ accessToken: 't', id: 'u1', pollIntervalMs: 1, maxAttempts: 3 });
    expect(ready.status).toBe('uploaded');

    const post = reqs.find((r) => r.init?.method === 'POST');
    expect(post.init.headers['Notion-Version']).toBe('2025-09-03');
    const body = JSON.parse(String(post.init.body));
    expect(body.mode).toBe('external_url');
    expect(body.external_url).toBe('https://example.com/a.png');
  });

  it('supports single_part file upload (create + send + poll)', async () => {
    const fetchCalls: any[] = [];

    // @ts-expect-error test global
    globalThis.fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, init });
      const u = String(url);
      if (u === 'https://api.notion.com/v1/file_uploads' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          headers: createHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'u2', status: 'pending' }),
        };
      }
      if (u === 'https://api.notion.com/v1/file_uploads/u2/send' && init?.method === 'POST') {
        return { ok: true, status: 200, headers: createHeaders(), text: async () => '' };
      }
      if (u === 'https://api.notion.com/v1/file_uploads/u2' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          headers: createHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'u2', status: 'uploaded' }),
        };
      }
      throw new Error(`unexpected fetch: ${init?.method} ${u}`);
    };

    const created = await createFileUpload({
      accessToken: 't',
      filename: 'a.png',
      contentType: 'image/png',
      contentLength: 3,
    });
    expect(created.id).toBe('u2');

    await sendFileUpload({
      accessToken: 't',
      id: created.id,
      bytes: new Uint8Array([1, 2, 3]),
      filename: 'a.png',
      contentType: 'image/png',
    });

    const sendReq = fetchCalls.find((c) => c.url === 'https://api.notion.com/v1/file_uploads/u2/send');
    expect(sendReq.init.method).toBe('POST');
    expect(sendReq.init.headers.Authorization).toBe('Bearer t');
    expect(sendReq.init.headers['Notion-Version']).toBe('2025-09-03');
    expect(typeof sendReq.init.body?.append).toBe('function');

    await waitUntilUploaded({ accessToken: 't', id: 'u2', pollIntervalMs: 1, maxAttempts: 1 });

    const post = fetchCalls.find((c) => c.url === 'https://api.notion.com/v1/file_uploads' && c.init?.method === 'POST');
    const body = JSON.parse(String(post.init.body));
    expect(body.mode).toBe('single_part');
    expect(body.content_type).toBe('image/png');
    expect(body.content_length).toBe(undefined);
  });

  it('surfaces file_import_result when upload fails', async () => {
    // @ts-expect-error test global
    globalThis.fetch = async (url: string, init: any) => {
      const u = String(url);
      if (u === 'https://api.notion.com/v1/file_uploads/u1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          headers: createHeaders({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ id: 'u1', status: 'failed', file_import_result: { message: '403' } }),
        };
      }
      throw new Error(`unexpected fetch: ${init?.method} ${u}`);
    };

    await expect(waitUntilUploaded({ accessToken: 't', id: 'u1', pollIntervalMs: 1, maxAttempts: 1 })).rejects.toThrow(
      /file upload failed/i,
    );
  });
});

