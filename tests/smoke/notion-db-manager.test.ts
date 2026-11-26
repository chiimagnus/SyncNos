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
      if (req.method === 'GET' && req.path === '/v1/blocks/p/children?page_size=100')
        return { results: [], has_more: false };
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
      if (req.method === 'GET' && req.path === '/v1/blocks/p/children?page_size=100')
        return { results: [], has_more: false };
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

  function database(id: string, dbSpec = CHAT_DB_SPEC, title = dbSpec.title, parent = 'p') {
    return {
      object: 'database',
      id,
      parent: { type: 'page_id', page_id: parent },
      title: [{ plain_text: title }],
      properties: Object.fromEntries(
        Object.entries(dbSpec.properties).map(([name, spec]) => [name, { type: Object.keys(spec as object)[0] }]),
      ),
    };
  }

  function child(id: string, title: string) {
    return { id, type: 'child_database', child_database: { title } };
  }

  it.each([401, 403, 404, 429, 500, 503])('preserves a bound database after HTTP %s', async (status) => {
    const id = '7'.repeat(32);
    const chromeMock = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: id } });
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    const calls: any[] = [];
    notionFetchImpl = async (req) => {
      calls.push(req);
      throw Object.assign(new Error('unavailable'), { status, retryAfterMs: 6000 });
    };
    await expect(ensureChatDatabase()).rejects.toThrow('unavailable');
    expect(chromeMock.__store[CHAT_DB_STORAGE_KEY]).toBe(id);
    expect(chromeMock.__removed).toEqual([]);
    expect(calls.map((c) => c.path)).toEqual(['/v1/databases/' + id]);
  });

  it.each(['archived', 'in_trash', 'wrong_parent'])(
    'does not replace a bound database with state %s',
    async (state) => {
      const id = 'a'.repeat(32);
      const chromeMock = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: id } });
      // @ts-expect-error test global
      globalThis.chrome = chromeMock;
      const calls: any[] = [];
      notionFetchImpl = async (req) => {
        calls.push(req);
        return {
          ...database(id, CHAT_DB_SPEC, 'Renamed'),
          ...(state === 'wrong_parent' ? { parent: { type: 'page_id', page_id: 'other' } } : { [state]: true }),
        };
      };
      await expect(ensureChatDatabase()).rejects.toThrow('configured Notion database');
      expect(chromeMock.__store[CHAT_DB_STORAGE_KEY]).toBe(id);
      expect(chromeMock.__removed).toEqual([]);
      expect(calls).toHaveLength(1);
    },
  );

  it.each(['chat', 'article', 'video'])(
    'reuses the unique renamed %s database in the actual parent page',
    async (kindId) => {
      const spec = conversationKinds.getNotionDbSpecByKindId(kindId)!;
      const id = '1'.repeat(32);
      const unrelated = '2'.repeat(32);
      const other = '3'.repeat(32);
      const chromeMock = mockChromeStorage();
      // @ts-expect-error test global
      globalThis.chrome = chromeMock;
      const calls: any[] = [];
      notionFetchImpl = async (req) => {
        calls.push(req);
        if (req.path === '/v1/blocks/p/children?page_size=100')
          return { results: [child(unrelated, 'Unrelated')], has_more: true, next_cursor: 'next' };
        if (req.path === '/v1/blocks/p/children?page_size=100&start_cursor=next')
          return { results: [child(id, spec.title + '000'), child(other, spec.title)], has_more: false };
        if (req.path === '/v1/databases/' + unrelated)
          return { ...database(unrelated, spec, 'Unrelated'), properties: { Name: { type: 'title' } } };
        if (req.path === '/v1/databases/' + id) return database(id, spec, spec.title + '000');
        if (req.path === '/v1/databases/' + other) return database(other, spec, spec.title, 'other-parent');
        throw new Error('unexpected request: ' + req.path);
      };
      const input = { accessToken: 't', parentPageId: 'p', kindId, dbSpec: spec };
      await expect(notionDbManager.ensureDatabase(input)).resolves.toMatchObject({ databaseId: id, reused: true });
      expect(chromeMock.__store[spec.storageKey]).toBe(id);
      calls.length = 0;
      await expect(notionDbManager.ensureDatabase(input)).resolves.toMatchObject({ databaseId: id, reused: true });
      expect(calls.map((c) => c.path)).toEqual(['/v1/databases/' + id]);
    },
  );

  it('reuses a bound database even after its title is completely changed', async () => {
    const id = 'b'.repeat(32);
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { [CHAT_DB_STORAGE_KEY]: id } });
    notionFetchImpl = async (req) => {
      expect(req.path).toBe('/v1/databases/' + id);
      expect(req.method).toBe('GET');
      return database(id, CHAT_DB_SPEC, 'My conversations');
    };
    await expect(ensureChatDatabase()).resolves.toMatchObject({ databaseId: id, reused: true });
  });

  it.each([
    { titles: ['SyncNos-AI Chats', 'SyncNos-AI Chats'] },
    { titles: ['SyncNos-AI Chats', 'SyncNos-AI Chats000'] },
    { titles: ['My conversations'] },
  ])('refuses ambiguous or unidentifiable database candidates ($titles)', async ({ titles }) => {
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    const databases = titles.map((title, i) => database(String(i + 1).repeat(32), CHAT_DB_SPEC, title));
    const calls: any[] = [];
    notionFetchImpl = async (req) => {
      calls.push(req);
      if (req.path.startsWith('/v1/blocks/'))
        return { results: databases.map((db) => child(db.id, db.title[0].plain_text)), has_more: false };
      const db = databases.find((d) => req.path === '/v1/databases/' + d.id);
      if (db) return db;
      throw new Error('unexpected request: ' + req.path);
    };
    await expect(ensureChatDatabase()).rejects.toMatchObject({ code: 'notion_database_ambiguous' });
    expect(chromeMock.__store[CHAT_DB_STORAGE_KEY]).toBeUndefined();
    expect(calls.every((req) => req.method === 'GET')).toBe(true);
  });

  it.each([
    { results: [], has_more: true, next_cursor: null },
    { results: null, has_more: false },
    { results: [], has_more: true, next_cursor: 'same' },
  ])('never creates from incomplete or malformed child listing: %j', async (response) => {
    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();
    notionFetchImpl = async (req) => {
      calls.push(req);
      return response;
    };
    await expect(ensureChatDatabase()).rejects.toThrow(/Notion block children/);
    expect(calls.every((req) => req.method === 'GET')).toBe(true);
  });

  it('does not create a database if a child lookup fails', async () => {
    const id = '1'.repeat(32);
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();
    const calls: any[] = [];
    notionFetchImpl = async (req) => {
      calls.push(req);
      if (req.path.startsWith('/v1/blocks/')) return { results: [child(id, 'Unrelated')], has_more: false };
      throw Object.assign(new Error('access denied'), { status: 404 });
    };
    await expect(ensureChatDatabase()).rejects.toThrow('access denied');
    expect(calls.every((req) => req.method === 'GET')).toBe(true);
  });

  it('recovers a database created remotely before the response was lost', async () => {
    const id = '1'.repeat(32);
    const chromeMock = mockChromeStorage();
    // @ts-expect-error test global
    globalThis.chrome = chromeMock;
    let created = false;
    let creates = 0;
    notionFetchImpl = async (req) => {
      if (req.path.startsWith('/v1/blocks/'))
        return {
          results: created ? [child(id, CHAT_DB_SPEC.title)] : [],
          has_more: false,
        };
      if (req.method === 'POST' && req.path === '/v1/databases') {
        creates += 1;
        created = true;
        throw new Error('response lost');
      }
      if (req.path === '/v1/databases/' + id) return database(id);
      throw new Error('unexpected request: ' + req.path);
    };
    await expect(ensureChatDatabase()).rejects.toThrow('response lost');
    await expect(ensureChatDatabase()).resolves.toMatchObject({ databaseId: id, reused: true });
    expect(creates).toBe(1);
    expect(chromeMock.__store[CHAT_DB_STORAGE_KEY]).toBe(id);
  });

  it('does not mutate a database whose non-chat managed field has the wrong type', async () => {
    const id = '1'.repeat(32);
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage({ initial: { [ARTICLE_DB_SPEC.storageKey]: id } });
    const db = database(id, ARTICLE_DB_SPEC);
    db.properties.Author = { type: 'number' };
    notionFetchImpl = async (req) => {
      expect(req.method).toBe('GET');
      return db;
    };
    await expect(
      notionDbManager.ensureDatabase({
        accessToken: 't',
        parentPageId: 'p',
        kindId: 'article',
        dbSpec: ARTICLE_DB_SPEC,
      }),
    ).rejects.toThrow('Author must be rich_text');
  });
});
