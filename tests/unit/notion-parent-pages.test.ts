import { afterEach, describe, expect, it, vi } from 'vitest';

import { listNotionParentPages, resolveNotionParentPage } from '../../src/services/sync/notion/notion-parent-pages';

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
  vi.unstubAllGlobals();
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

describe('resolveNotionParentPage', () => {
  const id = '346be9d6386a81748c6af9b7db455770';
  const dashed = '346be9d6-386a-8174-8c6a-f9b7db455770';
  const page = notionPage(dashed, 'Sync destination', { type: 'page_id', page_id: 'root' });

  it.each([
    id,
    dashed.toUpperCase(),
    'https://www.notion.so/Sync-destination-' + id + '?v=' + '1'.repeat(32) + '#' + '2'.repeat(32),
  ])('resolves a page by identity independently of the search index: %s', async (input) => {
    const fetchMock = vi.fn(async () => jsonResponse(page));
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveNotionParentPage('token', input)).resolves.toEqual({ id: dashed, title: 'Sync destination' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.notion.com/v1/pages/' + id,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it.each([
    ['archived', { ...page, archived: true }, 200],
    ['trashed', { ...page, in_trash: true }, 200],
    ['database', { ...page, object: 'database' }, 200],
    ['different ID', { ...page, id: 'a'.repeat(32) }, 200],
    ['not shared', { code: 'object_not_found' }, 404],
  ])('rejects %s instead of saving an unusable target', async (_label, body, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(body, Number(status))),
    );
    await expect(resolveNotionParentPage('token', id)).rejects.toMatchObject({
      code: 'notion_parent_page_unavailable',
    });
  });

  it('rejects view-only and block-only URLs without performing a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const input of ['invalid', 'https://www.notion.so/?v=' + id, 'https://www.notion.so/#' + id]) {
      await expect(resolveNotionParentPage('token', input)).rejects.toMatchObject({
        code: 'invalid_notion_parent_page',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps authorization, rate limit and network failures distinct from inaccessible pages', async () => {
    for (const [status, code] of [
      [401, 'unauthorized'],
      [429, 'rate_limited'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse({ code }, status)),
      );
      await expect(resolveNotionParentPage('token', id)).rejects.toMatchObject({ status, code });
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(resolveNotionParentPage('token', id)).rejects.toThrow('offline');
  });

  it('does not hide a saved page lookup failure behind an empty search result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: any) =>
        init.method === 'POST'
          ? jsonResponse({ results: [], has_more: false })
          : jsonResponse({ code: 'unauthorized' }, 401),
      ),
    );
    await expect(listNotionParentPages('token', { savedPageId: id })).rejects.toMatchObject({ status: 401 });
  });
});
