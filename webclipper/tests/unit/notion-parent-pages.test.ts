import { describe, expect, it, vi } from 'vitest';

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

describe('listNotionParentPages', () => {
  it('paginates until it finds usable parent pages', async () => {
    const calls: any[] = [];
    const notionFetchImpl = vi.fn(async (input: any) => {
      calls.push(input);
      if (input.method === 'POST' && input.path === '/v1/search') {
        if (!input.body?.start_cursor) {
          return {
            results: [
              notionPage('d1', 'db child', { type: 'database_id', database_id: 'db1' }),
              notionPage('d2', 'db child 2', { database_id: 'db1' }),
            ],
            has_more: true,
            next_cursor: 'c1',
          };
        }
        return {
          results: [notionPage('p1', 'parent page', { type: 'workspace', workspace: true })],
          has_more: false,
          next_cursor: null,
        };
      }
      throw new Error(`unexpected call: ${input.method} ${input.path}`);
    });

    const res = await listNotionParentPages('token', { notionFetchImpl });
    expect(res.pages.map((p) => p.id)).toEqual(['p1']);
    expect(calls.length).toBe(2);
    expect(calls[0].body?.start_cursor).toBeUndefined();
    expect(calls[1].body?.start_cursor).toBe('c1');
  });

  it('resolves savedPageId via GET /pages/:id when missing from search results', async () => {
    const notionFetchImpl = vi.fn(async (input: any) => {
      if (input.method === 'POST' && input.path === '/v1/search') {
        return {
          results: [notionPage('p1', 'parent page', { type: 'workspace', workspace: true })],
          has_more: false,
          next_cursor: null,
        };
      }
      if (input.method === 'GET' && String(input.path).startsWith('/v1/pages/')) {
        return notionPage('s1', 'saved page', { type: 'page_id', page_id: 'root' });
      }
      throw new Error(`unexpected call: ${input.method} ${input.path}`);
    });

    const res = await listNotionParentPages('token', { notionFetchImpl, savedPageId: 's1' });
    expect(res.resolvedSaved?.id).toBe('s1');
    expect(res.pages[0]?.id).toBe('s1');
    expect(res.pages.map((p) => p.id)).toEqual(['s1', 'p1']);
  });
});

