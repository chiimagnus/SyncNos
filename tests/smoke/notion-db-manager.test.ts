import { beforeEach, describe, expect, it, vi } from 'vitest';

let notionFetchImpl: ((req: any) => Promise<any>) | null = null;

vi.mock('@services/sync/notion/notion-api.ts', () => {
  const notionFetch = (req: any) => {
    if (!notionFetchImpl) throw new Error('notionFetchImpl not set');
    return notionFetchImpl(req);
  };
  return {
    notionFetch,
  };
});

import * as notionDbManager from '@services/sync/notion/notion-db-manager.ts';
import { conversationKinds } from '@services/protocols/conversation-kinds.ts';

const CHAT_DB_SPEC = conversationKinds.getNotionDbSpecByKindId('chat')!;
const ARTICLE_DB_SPEC = conversationKinds.getNotionDbSpecByKindId('article')!;
const CHAT_DB_STORAGE_KEY = CHAT_DB_SPEC.storageKey;

function ensureChatDatabase(input: { accessToken?: string; parentPageId?: string } = {}) {
  return notionDbManager.ensureDatabase({
    accessToken: input.accessToken ?? 't',
    parentPageId: input.parentPageId ?? 'p',
    kindId: 'chat',
    dbSpec: CHAT_DB_SPEC,
  });
}

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
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: '11111111111111111111111111111111' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const res = await ensureChatDatabase();
    expect(res.databaseId).toBe('11111111111111111111111111111111');
    expect(res.title).toBe('SyncNos-AI Chats');

    const create = calls.find((c) => c.method === 'POST' && c.path === '/v1/databases');
    expect(create).toBeTruthy();
    expect(create.body.title?.[0]?.text?.content).toBe('SyncNos-AI Chats');
    expect(create.body.properties?.AI?.multi_select).toBeTruthy();
    expect(create.body.properties?.['Last Activity']?.date).toBeTruthy();
    expect(create.body.properties?.Date).toBeUndefined();
  });

  it('creates SyncNos-Web Articles database when missing (dbSpec-driven + separate cache key)', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'POST' && req.path === '/v1/search') return { results: [] };
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: '22222222222222222222222222222222' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const dbSpec = ARTICLE_DB_SPEC;

    const res = await notionDbManager.ensureDatabase({
      accessToken: 't',
      parentPageId: 'p',
      kindId: 'article',
      dbSpec,
    });
    expect(res.databaseId).toBe('22222222222222222222222222222222');
    expect(res.title).toBe('SyncNos-Web Articles');
    expect(chromeMock.__store.notion_db_id_syncnos_web_articles).toBe('22222222222222222222222222222222');

    const create = calls.find((c) => c.method === 'POST' && c.path === '/v1/databases');
    expect(create.body.title?.[0]?.text?.content).toBe('SyncNos-Web Articles');
    expect(create.body.properties?.Author?.rich_text).toBeTruthy();
    expect(create.body.properties?.['Last Activity']?.date).toBeTruthy();
    expect(create.body.properties?.Date).toBeUndefined();
    expect(create.body.properties?.AI).toBeFalsy();
  });

  it('throws when cached database has AI property with wrong type', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/33333333333333333333333333333333') {
        return {
          id: '33333333333333333333333333333333',
          parent: { type: 'page_id', page_id: 'p' },
          properties: {
            Name: { type: 'title' },
            'Last Activity': { type: 'date' },
            URL: { type: 'url' },
            AI: { type: 'select' },
          },
        };
      }
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: '33333333333333333333333333333333' } });

    await expect(ensureChatDatabase()).rejects.toThrow('AI must be multi_select');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('renames legacy Date before adding missing AI when reusing a cached database', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/33333333333333333333333333333333') {
        return {
          id: '33333333333333333333333333333333',
          parent: { type: 'page_id', page_id: 'p' },
          properties: { Name: { type: 'title' }, Date: { type: 'date' }, URL: { type: 'url' } },
        };
      }
      if (req.method === 'PATCH' && req.path === '/v1/databases/33333333333333333333333333333333') return { ok: true };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: '33333333333333333333333333333333' } });

    const res = await ensureChatDatabase();
    expect(res.reused).toBe(true);
    expect(res.databaseId).toBe('33333333333333333333333333333333');

    const patches = calls.filter(
      (c) => c.method === 'PATCH' && c.path === '/v1/databases/33333333333333333333333333333333',
    );
    expect(patches).toHaveLength(2);
    expect(patches[0]?.body?.properties).toEqual({ Date: { name: 'Last Activity' } });
    expect(patches[1]?.body?.properties?.AI?.multi_select).toBeTruthy();
  });

  it('renames legacy Date only once', async () => {
    const calls: any[] = [];
    let properties: Record<string, any> = {
      Name: { type: 'title' },
      Date: { type: 'date' },
      URL: { type: 'url' },
      AI: { type: 'multi_select' },
    };
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/33333333333333333333333333333333') {
        return {
          id: '33333333333333333333333333333333',
          parent: { type: 'page_id', page_id: 'p' },
          properties: { ...properties },
        };
      }
      if (req.method === 'PATCH' && req.path === '/v1/databases/33333333333333333333333333333333') {
        if (req.body?.properties?.Date?.name === 'Last Activity') {
          properties = {
            ...properties,
            'Last Activity': { ...properties.Date, type: 'date' },
          };
          delete properties.Date;
        }
        return { ok: true };
      }
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: '33333333333333333333333333333333' } });

    await ensureChatDatabase();
    await ensureChatDatabase();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it.each([
    ['Last Activity', { type: 'rich_text' }],
    ['Date', { type: 'rich_text' }],
  ])('rejects incompatible %s activity schema without patching', async (propertyName, propertyValue) => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/33333333333333333333333333333333') {
        return {
          id: '33333333333333333333333333333333',
          parent: { type: 'page_id', page_id: 'p' },
          properties: {
            Name: { type: 'title' },
            URL: { type: 'url' },
            AI: { type: 'multi_select' },
            [propertyName]: propertyValue,
          },
        };
      }
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: '33333333333333333333333333333333' } });

    await expect(ensureChatDatabase()).rejects.toThrow(`${propertyName} must be date`);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('propagates schema PATCH failures instead of continuing sync', async () => {
    notionFetchImpl = async (req: any) => {
      if (req.method === 'GET' && req.path === '/v1/databases/33333333333333333333333333333333') {
        return {
          id: '33333333333333333333333333333333',
          parent: { type: 'page_id', page_id: 'p' },
          properties: {
            Name: { type: 'title' },
            Date: { type: 'date' },
            URL: { type: 'url' },
            AI: { type: 'multi_select' },
          },
        };
      }
      if (req.method === 'PATCH' && req.path === '/v1/databases/33333333333333333333333333333333')
        throw new Error('schema patch failed');
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: '33333333333333333333333333333333' } });

    await expect(ensureChatDatabase()).rejects.toThrow('schema patch failed');
  });

  it('clears stale cached database id and recreates database on object_not_found', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/77777777777777777777777777777777') {
        const error: any = new Error('database missing');
        error.status = 404;
        error.code = 'object_not_found';
        throw error;
      }
      if (req.method === 'POST' && req.path === '/v1/search') return { results: [] };
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: '55555555555555555555555555555555' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    const chromeMock = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: '77777777777777777777777777777777' } });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const res = await ensureChatDatabase();
    expect(res.databaseId).toBe('55555555555555555555555555555555');
    expect(chromeMock.__removed.some((keys) => keys.includes(CHAT_DB_STORAGE_KEY))).toBe(true);
    expect(calls.some((c) => c.method === 'GET' && c.path === '/v1/databases/77777777777777777777777777777777')).toBe(
      true,
    );
  });

  it('does not reuse cached databases that are already in trash', async () => {
    const calls: any[] = [];
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
        return {
          id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          object: 'database',
          archived: false,
          in_trash: true,
          properties: { Name: { type: 'title' } },
        };
      }
      if (req.method === 'POST' && req.path === '/v1/search') return { results: [] };
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: '55555555555555555555555555555555' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    const chromeMock = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const res = await ensureChatDatabase();
    expect(res.databaseId).toBe('55555555555555555555555555555555');
    expect(chromeMock.__removed.some((keys) => keys.includes(CHAT_DB_STORAGE_KEY))).toBe(true);
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
              id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              object: 'database',
              archived: false,
              in_trash: true,
              title: [{ plain_text: 'SyncNos-AI Chats' }],
            },
          ],
        };
      }
      if (req.method === 'POST' && req.path === '/v1/databases') return { id: '55555555555555555555555555555555' };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const res = await ensureChatDatabase();
    expect(res.databaseId).toBe('55555555555555555555555555555555');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/databases')).toBe(true);
  });

  it('does not reuse cached database when parent page changed', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: '44444444444444444444444444444444' } });
    notionFetchImpl = async (req: any) => {
      calls.push(req);
      if (req.method === 'GET' && req.path === '/v1/databases/44444444444444444444444444444444') {
        return {
          id: '44444444444444444444444444444444',
          object: 'database',
          archived: false,
          in_trash: false,
          parent: { type: 'page_id', page_id: 'p_old' },
          properties: {
            Name: { type: 'title' },
            'Last Activity': { type: 'date' },
            URL: { type: 'url' },
            AI: { type: 'multi_select' },
          },
        };
      }
      if (req.method === 'POST' && req.path === '/v1/search') {
        return {
          results: [
            {
              id: '66666666666666666666666666666666',
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
      if (req.method === 'GET' && req.path === '/v1/databases/66666666666666666666666666666666') {
        return {
          id: '66666666666666666666666666666666',
          object: 'database',
          archived: false,
          in_trash: false,
          parent: { type: 'page_id', page_id: 'p_new' },
          properties: {
            Name: { type: 'title' },
            'Last Activity': { type: 'date' },
            URL: { type: 'url' },
            AI: { type: 'multi_select' },
          },
        };
      }
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = chromeMock;

    const res = await ensureChatDatabase({ parentPageId: 'p_new' });
    expect(res.databaseId).toBe('66666666666666666666666666666666');
    expect(res.reused).toBe(true);
    expect(chromeMock.__removed.some((keys) => keys.includes(CHAT_DB_STORAGE_KEY))).toBe(true);
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
                id: '88888888888888888888888888888888',
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
                id: '99999999999999999999999999999999',
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
      if (req.method === 'GET' && req.path === '/v1/databases/99999999999999999999999999999999') {
        return {
          id: '99999999999999999999999999999999',
          object: 'database',
          archived: false,
          in_trash: false,
          parent: { type: 'page_id', page_id: 'p_target' },
          properties: {
            Name: { type: 'title' },
            'Last Activity': { type: 'date' },
            URL: { type: 'url' },
            AI: { type: 'multi_select' },
          },
        };
      }
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const res = await ensureChatDatabase({ parentPageId: 'p_target' });
    expect(res.databaseId).toBe('99999999999999999999999999999999');
    expect(res.reused).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/databases')).toBe(false);
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/v1/search').length).toBe(2);
  });
});
