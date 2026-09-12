import { buildAiOptions } from '@services/sync/notion/notion-ai.ts';
import { notionFetch } from '@services/sync/notion/notion-api.ts';
import type { ConversationKindDbSpec } from '@services/protocols/conversation-kind-contract.ts';
import { storageGet, storageRemove, storageSet } from '@platform/storage/local';

const SEARCH_PAGE_SIZE = 100;

async function getCachedDatabaseId(storageKey: string) {
  const res = await storageGet([storageKey]);
  return String((res as any)?.[storageKey] || '');
}

async function setCachedDatabaseId(storageKey: string, databaseId: string) {
  await storageSet({ [storageKey]: databaseId });
}

async function clearCachedDatabaseId(storageKey: string) {
  await storageRemove([storageKey]);
}

function isUsableDatabase(database: any): boolean {
  if (!database || typeof database !== 'object') return false;
  if (database.object != null && database.object !== 'database') return false;
  if (database.in_trash === true) return false;
  if (database.archived === true) return false;
  return true;
}

function normalizeNotionId(id: unknown): string {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '');
}

function readParentPageId(database: any): string {
  return database?.parent?.page_id ? String(database.parent.page_id).trim() : '';
}

function matchesParentPage(database: any, parentPageId: string): boolean {
  const expected = normalizeNotionId(parentPageId);
  const actual = normalizeNotionId(readParentPageId(database));
  return !!actual && actual === expected;
}

function readDatabaseTitle(database: any): string {
  const title = Array.isArray(database && database.title) ? database.title : [];
  return title
    .map((x: any) => x?.plain_text || '')
    .join('')
    .trim();
}

function normalizeTitle(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isMissingDatabaseError(error: unknown): boolean {
  const status = Number((error as any)?.status || 0);
  const code = String((error as any)?.code || '')
    .trim()
    .toLowerCase();
  return status === 404 || status === 410 || code === 'object_not_found';
}

async function getDatabase(accessToken: string, databaseId: string) {
  return notionFetch({ accessToken, method: 'GET', path: `/v1/databases/${databaseId}` });
}

async function searchDatabases(accessToken: string, { query, parentPageId }: { query: string; parentPageId: string }) {
  const results: any[] = [];
  let cursor = '';

  for (;;) {
    const body = {
      query,
      filter: { property: 'object', value: 'database' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: SEARCH_PAGE_SIZE,
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const res = await notionFetch({ accessToken, method: 'POST', path: '/v1/search', body });
    const pageResults = Array.isArray(res && (res as any).results) ? (res as any).results : [];
    for (const item of pageResults) {
      if (!isUsableDatabase(item)) continue;
      if (!matchesParentPage(item, parentPageId)) continue;
      results.push(item);
    }
    if (!res || !res.has_more || !res.next_cursor) break;
    cursor = String(res.next_cursor || '').trim();
    if (!cursor) break;
  }

  return { results };
}

async function updateDatabase(
  accessToken: string,
  { databaseId, properties }: { databaseId: string; properties: Record<string, unknown> },
) {
  const body = { properties };
  return notionFetch({ accessToken, method: 'PATCH', path: `/v1/databases/${databaseId}`, body });
}

function materializeDbProperties(dbSpec: ConversationKindDbSpec) {
  const raw = dbSpec.properties;
  const props = { ...raw } as Record<string, any>;

  // If the schema includes `AI` multi-select, fill options from Notion AI helper if available.
  const ai = props.AI;
  if (ai && ai.multi_select && typeof ai.multi_select === 'object') {
    props.AI = { multi_select: { ...ai.multi_select, options: buildAiOptions() } };
  }
  return props;
}

async function createDatabase(
  accessToken: string,
  { parentPageId, dbSpec }: { parentPageId: string; dbSpec: ConversationKindDbSpec },
) {
  const body = {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: dbSpec.title } }],
    properties: materializeDbProperties(dbSpec),
  };
  return notionFetch({ accessToken, method: 'POST', path: '/v1/databases', body });
}

function notionPropertyType(property: unknown): string {
  return property && typeof property === 'object' ? String((property as any).type || '').trim() : '';
}

function schemaIncompatible(propertyName: string, expectedType: string, actualType: string): Error {
  return new Error(
    `notion database schema incompatible: ${propertyName} must be ${expectedType}${actualType ? `, got ${actualType}` : ''}`,
  );
}

async function ensureDatabaseSchema({
  accessToken,
  databaseId,
  dbSpec,
}: {
  accessToken: string;
  databaseId: string;
  dbSpec: ConversationKindDbSpec;
}) {
  const db = await getDatabase(accessToken, databaseId);
  const props = { ...(db && db.properties ? db.properties : {}) } as Record<string, any>;
  const patch = dbSpec.ensureSchemaPatch || {};

  const lastActivity = props['Last Activity'];
  if (lastActivity) {
    const type = notionPropertyType(lastActivity);
    if (type !== 'date') throw schemaIncompatible('Last Activity', 'date', type);
  } else if (props.Date) {
    const type = notionPropertyType(props.Date);
    if (type !== 'date') throw schemaIncompatible('Date', 'date', type);
    await updateDatabase(accessToken, {
      databaseId,
      properties: { Date: { name: 'Last Activity' } },
    });
    props['Last Activity'] = { ...props.Date, type: 'date' };
    delete props.Date;
  }

  if (patch.AI) {
    const ai = props.AI;
    if (ai) {
      const type = notionPropertyType(ai);
      if (type !== 'multi_select') throw schemaIncompatible('AI', 'multi_select', type);
    }
  }

  const missing: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!props[k]) missing[k] = v;
  }
  if (!Object.keys(missing).length) return;

  if (missing.AI && missing.AI.multi_select && typeof missing.AI.multi_select === 'object') {
    missing.AI = { multi_select: { ...missing.AI.multi_select, options: buildAiOptions() } };
  }
  await updateDatabase(accessToken, { databaseId, properties: missing });
}

async function ensureDatabase({
  accessToken,
  parentPageId,
  dbSpec,
}: {
  accessToken: string;
  parentPageId: string;
  dbSpec: ConversationKindDbSpec;
}) {
  const cached = await getCachedDatabaseId(dbSpec.storageKey);
  if (cached) {
    try {
      const db = await getDatabase(accessToken, cached);
      if (!isUsableDatabase(db)) {
        await clearCachedDatabaseId(dbSpec.storageKey);
      } else if (!matchesParentPage(db, parentPageId)) {
        await clearCachedDatabaseId(dbSpec.storageKey);
      } else {
        await ensureDatabaseSchema({ accessToken, databaseId: cached, dbSpec });
        return { databaseId: cached, title: dbSpec.title, reused: true, database: db };
      }
    } catch (error) {
      if (isMissingDatabaseError(error)) {
        await clearCachedDatabaseId(dbSpec.storageKey);
      } else {
        throw error;
      }
    }
  }

  const found = await searchDatabases(accessToken, { query: dbSpec.title, parentPageId });
  const results = found.results;
  const wantedTitle = normalizeTitle(dbSpec.title);
  const exact = results.find((d: any) => {
    if (!matchesParentPage(d, parentPageId)) return false;
    const title = readDatabaseTitle(d);
    return normalizeTitle(title) === wantedTitle;
  });
  if (exact && exact.id) {
    await setCachedDatabaseId(dbSpec.storageKey, exact.id);
    await ensureDatabaseSchema({ accessToken, databaseId: exact.id, dbSpec });
    return { databaseId: exact.id, title: dbSpec.title, reused: true, database: exact };
  }

  const created = await createDatabase(accessToken, { parentPageId, dbSpec });
  if (!created || !created.id) throw new Error('create database failed');
  await setCachedDatabaseId(dbSpec.storageKey, created.id);
  return { databaseId: created.id, title: dbSpec.title, reused: false, database: created };
}

export { ensureDatabase, clearCachedDatabaseId };
