import { afterEach, describe, expect, it, vi } from 'vitest';

import { listNotionParentPages } from '../../src/services/sync/notion/notion-parent-pages';

function notionPage(id: string, title: string, parent: any) {
  return {
    object: 'page',
    id,
    archived: false,
    in_trash: false,
    parent,
    properties: {
      Name: {
        type: 'title',
        title: [{ plain_text: title }],
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test global
  delete globalThis.fetch;
});

describe('listNotionParentPages', () => {
  it('paginates until it finds usable parent pages', async () => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(String(init.body || '{}'));
      calls.push(body);
      if (!body.start_cursor) {
        return jsonResponse({
          results: [
            notionPage('d1', 'db child', { type: 'database_id', database_id: 'db1' }),
            notionPage('d2', 'db child 2', { database_id: 'db1' }),
          ],
          has_more: true,
          next_cursor: 'c1',
        });
      }
      return jsonResponse({
        results: [notionPage('p1', 'parent page', { type: 'workspace', workspace: true })],
        has_more: false,
        next_cursor: null,
      });
    });

    const res = await listNotionParentPages('token');
    expect(res.pages.map((page) => page.id)).toEqual(['p1']);
    expect(calls).toHaveLength(2);
    expect(calls[0].start_cursor).toBeUndefined();
    expect(calls[1].start_cursor).toBe('c1');
  });

  it('resolves savedPageId via GET /pages/:id when missing from search results', async () => {
    // @ts-expect-error test global
    globalThis.fetch = vi.fn(async (url: string, init: any) => {
      if (init.method === 'POST') {
        return jsonResponse({
          results: [notionPage('p1', 'parent page', { type: 'workspace', workspace: true })],
          has_more: false,
          next_cursor: null,
        });
      }
      if (init.method === 'GET' && String(url).includes('/v1/pages/s1')) {
        return jsonResponse(notionPage('s1', 'saved page', { type: 'page_id', page_id: 'root' }));
      }
      throw new Error(`unexpected call: ${init.method} ${url}`);
    });

    const res = await listNotionParentPages('token', { savedPageId: 's1' });
    expect(res.resolvedSaved?.id).toBe('s1');
    expect(res.pages.map((page) => page.id)).toEqual(['s1', 'p1']);
  });
});
