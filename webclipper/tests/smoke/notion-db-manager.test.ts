import { beforeEach, describe, expect, it, vi } from 'vitest';

let notionFetchImpl: ((req: any) => Promise<any>) | null = null;

vi.mock('@services/sync/notion/notion-api.ts', () => {
  const notionFetch = (req: any) => {
    if (!notionFetchImpl) throw new Error('notionFetchImpl not set');
    return notionFetchImpl(req);
  };
  return {
    NOTION_VERSION: '2022-06-28',
    notionFetch,
    default: { NOTION_VERSION: '2022-06-28', notionFetch },
  };
});

import notionDbManager from '@services/sync/notion/notion-db-manager.ts';

function mockChromeStorage({ initial = {} as Record<string, unknown> } = {}) {
  const store: Record<string, unknown> = { ...initial };
  const removed: string[][] = [];
  return {
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) out[k] = store[k];
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        },
        remove(keys: string[], cb: () => void) {
          const arr = Array.isArray(keys) ? keys : [];
          removed.push(arr.slice());
          for (const k of arr) delete store[k];
          cb();
        },
      },
    },
    __removed: removed,
    __store: store,
  };
}

beforeEach(() => {
  notionFetchImpl = null;
  // @ts-expect-error test global
  delete globalThis.chrome;
});

describe('notion-db-manager', () => {
  it('creates SyncNos-AI Chats database when missing', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'POST' && req.path === '/v1/search') return { results: [] };
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: 'db_created' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const res = await notionDbManager.ensureDatabase({ accessToken: 't', parentPageId: 'p' });
    expect(res.databaseId).toBe('db_created');
    expect(res.title).toBe('SyncNos-AI Chats');

    const create = calls.find((c) => c.method === 'POST' && c.path === '/v1/databases');
    expect(create).toBeTruthy();
    expect(create.body.title?.[0]?.text?.content).toBe('SyncNos-AI Chats');
    expect(create.body.properties?.AI?.multi_select).toBeTruthy();
  });

  it('creates SyncNos-Web Articles database when missing (dbSpec-driven + separate cache key)', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'POST' && req.path === '/v1/search') return { results: [] };
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: 'db_articles' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const dbSpec = {
      title: 'SyncNos-Web Articles',
      storageKey: 'notion_db_id_syncnos_web_articles',
      properties: {
        Name: { title: {} },
        Date: { date: {} },
        URL: { url: {} },
        Author: { rich_text: {} },
        Published: { rich_text: {} },
      },
      ensureSchemaPatch: {
        Author: { rich_text: {} },
        Published: { rich_text: {} },
      },
    };

    const res = await notionDbManager.ensureDatabase({ accessToken: 't', parentPageId: 'p', dbSpec });
    expect(res.databaseId).toBe('db_articles');
    expect(res.title).toBe('SyncNos-Web Articles');
    expect(chromeMock.__store.notion_db_id_syncnos_web_articles).toBe('db_articles');

    const create = calls.find((c) => c.method === 'POST' && c.path === '/v1/databases');
    expect(create.body.title?.[0]?.text?.content).toBe('SyncNos-Web Articles');
    expect(create.body.properties?.Author?.rich_text).toBeTruthy();
    expect(create.body.properties?.AI).toBeFalsy();
  });

  it('best-effort adds AI property when reusing cached database without AI', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/db1') {
        return {
          id: 'db1',
          parent: { type: 'page_id', page_id: 'p' },
          properties: { Name: { type: 'title' }, Date: { type: 'date' }, URL: { type: 'url' } },
        };
      }
      if (req.method === 'PATCH' && req.path === '/v1/databases/db1') return { ok: true };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { notion_db_id_syncnos_ai_chats: 'db1' } });

    const res = await notionDbManager.ensureDatabase({ accessToken: 't', parentPageId: 'p' });
    expect(res.reused).toBe(true);
    expect(res.databaseId).toBe('db1');

    const patched = calls.some((c) => c.method === 'PATCH' && c.path === '/v1/databases/db1');
    expect(patched).toBe(true);
  });

  it('returns false when cached database has AI property with wrong type', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/db1') {
        return {
          id: 'db1',
          properties: {
            Name: { type: 'title' },
            Date: { type: 'date' },
            URL: { type: 'url' },
            AI: { type: 'select' },
          },
        };
      }
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { notion_db_id_syncnos_ai_chats: 'db1' } });

    const ok = await notionDbManager.ensureDatabaseSchema({ accessToken: 't', databaseId: 'db1' });
    expect(ok).toBe(false);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('clears stale cached database id and recreates database on object_not_found', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/db_old') {
        throw new Error('notion api failed: GET /v1/databases/db_old HTTP 404 {"code":"object_not_found"}');
      }
      if (req.method === 'POST' && req.path === '/v1/search') return { results: [] };
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: 'db_new' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    const chromeMock = mockChromeStorage({ initial: { notion_db_id_syncnos_ai_chats: 'db_old' } });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const res = await notionDbManager.ensureDatabase({ accessToken: 't', parentPageId: 'p' });
    expect(res.databaseId).toBe('db_new');
    expect(chromeMock.__removed.some((keys) => keys.includes('notion_db_id_syncnos_ai_chats'))).toBe(true);
    expect(calls.some((c) => c.method === 'GET' && c.path === '/v1/databases/db_old')).toBe(true);
  });

  it('does not reuse cached databases that are already in trash', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/db_trashed') {
        return {
          id: 'db_trashed',
          object: 'database',
          archived: false,
          in_trash: true,
          properties: { Name: { type: 'title' } },
        };
      }
      if (req.method === 'POST' && req.path === '/v1/search') return { results: [] };
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: 'db_new' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    const chromeMock = mockChromeStorage({ initial: { notion_db_id_syncnos_ai_chats: 'db_trashed' } });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const res = await notionDbManager.ensureDatabase({ accessToken: 't', parentPageId: 'p' });
    expect(res.databaseId).toBe('db_new');
    expect(chromeMock.__removed.some((keys) => keys.includes('notion_db_id_syncnos_ai_chats'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/databases')).toBe(true);
  });

  it('ignores trashed exact-title search results and creates a fresh database', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'POST' && req.path === '/v1/search') {
        return {
          results: [
            {
              id: 'db_trashed',
              object: 'database',
              archived: false,
              in_trash: true,
              title: [{ plain_text: 'SyncNos-AI Chats' }],
            },
          ],
        };
      }
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: 'db_new' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const res = await notionDbManager.ensureDatabase({ accessToken: 't', parentPageId: 'p' });
    expect(res.databaseId).toBe('db_new');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/databases')).toBe(true);
  });

  it('does not reuse cached database when parent page changed', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage({ initial: { notion_db_id_syncnos_ai_chats: 'db_cached' } });
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/db_cached') {
        return {
          id: 'db_cached',
          object: 'database',
          archived: false,
          in_trash: false,
          parent: { type: 'page_id', page_id: 'p_old' },
          properties: { Name: { type: 'title' }, Date: { type: 'date' }, URL: { type: 'url' }, AI: { type: 'multi_select' } },
        };
      }
      if (req.method === 'POST' && req.path === '/v1/search') {
        return {
          results: [
            {
              id: 'db_new_parent',
              object: 'database',
              archived: false,
              in_trash: false,
              parent: { type: 'page_id', page_id: 'p_new' },
              title: [{ plain_text: 'SyncNos-AI Chats' }],
            },
          ],
          has_more: false,
          next_cursor: null,
        };
      }
      if (req.method === 'GET' && req.path === '/v1/databases/db_new_parent') {
        return {
          id: 'db_new_parent',
          object: 'database',
          archived: false,
          in_trash: false,
          parent: { type: 'page_id', page_id: 'p_new' },
          properties: { Name: { type: 'title' }, Date: { type: 'date' }, URL: { type: 'url' }, AI: { type: 'multi_select' } },
        };
      }
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const res = await notionDbManager.ensureDatabase({ accessToken: 't', parentPageId: 'p_new' });
    expect(res.databaseId).toBe('db_new_parent');
    expect(res.reused).toBe(true);
    expect(chromeMock.__removed.some((keys) => keys.includes('notion_db_id_syncnos_ai_chats'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/databases')).toBe(false);
  });

  it('searches multiple pages and reuses later exact match under same parent', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'POST' && req.path === '/v1/search') {
        const cursor = String(req?.body?.start_cursor || '').trim();
        if (!cursor) {
          return {
            results: [
              {
                id: 'db_other_parent',
                object: 'database',
                archived: false,
                in_trash: false,
                parent: { type: 'page_id', page_id: 'p_other' },
                title: [{ plain_text: 'SyncNos-AI Chats' }],
              },
            ],
            has_more: true,
            next_cursor: 'cursor_2',
          };
        }
        if (cursor === 'cursor_2') {
          return {
            results: [
              {
                id: 'db_target',
                object: 'database',
                archived: false,
                in_trash: false,
                parent: { type: 'page_id', page_id: 'p_target' },
                title: [{ plain_text: 'SyncNos-AI Chats' }],
              },
            ],
            has_more: false,
            next_cursor: null,
          };
        }
      }
      if (req.method === 'GET' && req.path === '/v1/databases/db_target') {
        return {
          id: 'db_target',
          object: 'database',
          archived: false,
          in_trash: false,
          parent: { type: 'page_id', page_id: 'p_target' },
          properties: { Name: { type: 'title' }, Date: { type: 'date' }, URL: { type: 'url' }, AI: { type: 'multi_select' } },
        };
      }
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const res = await notionDbManager.ensureDatabase({ accessToken: 't', parentPageId: 'p_target' });
    expect(res.databaseId).toBe('db_target');
    expect(res.reused).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/databases')).toBe(false);
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/v1/search').length).toBe(2);
  });
});
