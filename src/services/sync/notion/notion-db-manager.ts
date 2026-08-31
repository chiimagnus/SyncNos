import { buildAiOptions } from '@services/sync/notion/notion-ai.ts';
import { notionFetch } from '@services/sync/notion/notion-api.ts';
import { conversationKinds as builtInConversationKinds } from '@services/protocols/conversation-kinds.ts';
import { storageGet, storageRemove, storageSet } from '@platform/storage/local';

const DEFAULT_DB_STORAGE_KEY = 'notion_db_id_syncnos_ai_chats';
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 10;

async function getCachedDatabaseId(storageKey: unknown) {
  const key = String(storageKey || '').trim() || DEFAULT_DB_STORAGE_KEY;
  const res = await storageGet([key]);
  return String((res && (res as any)[key]) || '');
}

async function setCachedDatabaseId(storageKey: unknown, databaseId: unknown) {
  const key = String(storageKey || '').trim() || DEFAULT_DB_STORAGE_KEY;
  await storageSet({ [key]: databaseId || '' });
  return true;
}

async function clearCachedDatabaseId(storageKey: unknown) {
  const key = String(storageKey || '').trim() || DEFAULT_DB_STORAGE_KEY;
  await storageRemove([key]);
  return true;
}

function defaultDbSpec() {
  const spec = builtInConversationKinds.getNotionDbSpecByKindId('chat');
  if (!spec) throw new Error('chat notion database spec missing');
  return spec;
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
  try {
    const parent = database && database.parent ? database.parent : null;
    if (!parent || typeof parent !== 'object') return '';
    if (parent.page_id) return String(parent.page_id).trim();
    return '';
  } catch (_e) {
    return '';
  }
}

function matchesParentPage(database: any, parentPageId: unknown): boolean {
  const expected = normalizeNotionId(parentPageId);
  if (!expected) return true;
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

function parseHttpStatus(error: unknown): number {
  const fromField = Number(error && (error as any).status);
  if (Number.isFinite(fromField) && fromField > 0) return fromField;
  const message = String((error && (error as any).message) || error || '');
  const matched = message.match(/\bHTTP\s+(\d{3})\b/i);
  return matched ? Number(matched[1]) : 0;
}

function parseNotionErrorCode(error: unknown): string {
  const direct = String((error && (error as any).code) || '').trim();
  if (direct) return direct;
  const message = String((error && (error as any).message) || error || '');
  const matched = message.match(/"code"\s*:\s*"([^"]+)"/i);
  return matched ? String(matched[1] || '').trim() : '';
}

function isMissingDatabaseError(error: unknown): boolean {
  const status = parseHttpStatus(error);
  if (status === 404 || status === 410) return true;
  const code = parseNotionErrorCode(error).toLowerCase();
  return code === 'object_not_found';
}

async function getDatabase(accessToken: string, databaseId: string) {
  return notionFetch({ accessToken, method: 'GET', path: `/v1/databases/${databaseId}` });
}

async function searchDatabases(
  accessToken: string,
  { query, parentPageId }: { query?: string; parentPageId?: string },
) {
  const results: any[] = [];
  let cursor = '';
  let pageCount = 0;

  while (pageCount < SEARCH_MAX_PAGES) {
    pageCount += 1;
    const body = {
      query: query || '',
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
  { databaseId, properties }: { databaseId?: string; properties?: Record<string, unknown> },
) {
  const body = { properties: properties || {} };
  return notionFetch({ accessToken, method: 'PATCH', path: `/v1/databases/${databaseId}`, body });
}

function materializeDbProperties(dbSpec: any) {
  const spec = dbSpec && typeof dbSpec === 'object' ? dbSpec : defaultDbSpec();
  const raw = spec.properties && typeof spec.properties === 'object' ? spec.properties : {};
  const props = { ...raw };

  // If the schema includes `AI` multi-select, fill options from Notion AI helper if available.
  const ai = props.AI;
  if (ai && ai.multi_select && typeof ai.multi_select === 'object') {
    props.AI = { multi_select: { ...ai.multi_select, options: buildAiOptions() } };
  }
  return props;
}

async function createDatabase(accessToken: string, { parentPageId, dbSpec }: { parentPageId?: string; dbSpec?: any }) {
  const spec = dbSpec && typeof dbSpec === 'object' ? dbSpec : defaultDbSpec();
  const body = {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: spec.title } }],
    properties: materializeDbProperties(spec),
  };
  return notionFetch({ accessToken, method: 'POST', path: '/v1/databases', body });
}

async function ensureDatabaseSchema({
  accessToken,
  databaseId,
  dbSpec,
}: {
  accessToken: string;
  databaseId: string;
  dbSpec?: any;
}) {
  const spec = dbSpec && typeof dbSpec === 'object' ? dbSpec : defaultDbSpec();
  const db = await getDatabase(accessToken, databaseId);
  const props = db && db.properties ? db.properties : {};
  const patch = spec.ensureSchemaPatch && typeof spec.ensureSchemaPatch === 'object' ? spec.ensureSchemaPatch : {};

  // If the DB has an `AI` property but it's not a multi_select, we can't patch it in-place.
  // Signal failure so callers can surface a clear error or rebuild strategy.
  if (patch.AI) {
    const ai = props && props.AI ? props.AI : null;
    if (ai && ai.type && ai.type !== 'multi_select') return false;
  }

  const missing: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!props || !props[k]) missing[k] = v;
  }
  if (!Object.keys(missing).length) return true;

  // Best-effort: add missing properties if possible.
  if (missing.AI && missing.AI.multi_select && typeof missing.AI.multi_select === 'object') {
    missing.AI = { multi_select: { ...missing.AI.multi_select, options: buildAiOptions() } };
  }
  try {
    await updateDatabase(accessToken, { databaseId, properties: missing });
    return true;
  } catch (_e) {
    return false;
  }
}

async function ensureDatabase({
  accessToken,
  parentPageId,
  dbSpec,
}: {
  accessToken: string;
  parentPageId?: string;
  dbSpec?: any;
}) {
  const spec = dbSpec && typeof dbSpec === 'object' ? dbSpec : defaultDbSpec();
  const cached = await getCachedDatabaseId(spec.storageKey);
  if (cached) {
    try {
      const db = await getDatabase(accessToken, cached);
      if (!isUsableDatabase(db)) {
        await clearCachedDatabaseId(spec.storageKey);
      } else if (!matchesParentPage(db, parentPageId)) {
        await clearCachedDatabaseId(spec.storageKey);
      } else {
        await ensureDatabaseSchema({ accessToken, databaseId: cached, dbSpec: spec });
        return { databaseId: cached, title: spec.title, reused: true, database: db };
      }
    } catch (error) {
      if (isMissingDatabaseError(error)) {
        await clearCachedDatabaseId(spec.storageKey);
      } else {
        throw error;
      }
    }
  }

  const found = await searchDatabases(accessToken, { query: spec.title, parentPageId });
  const results = Array.isArray(found.results) ? found.results : [];
  const wantedTitle = normalizeTitle(spec.title);
  const exact = results.find((d: any) => {
    if (!matchesParentPage(d, parentPageId)) return false;
    const title = readDatabaseTitle(d);
    return normalizeTitle(title) === wantedTitle;
  });
  if (exact && exact.id) {
    await setCachedDatabaseId(spec.storageKey, exact.id);
    await ensureDatabaseSchema({ accessToken, databaseId: exact.id, dbSpec: spec });
    return { databaseId: exact.id, title: spec.title, reused: true, database: exact };
  }

  const created = await createDatabase(accessToken, { parentPageId, dbSpec: spec });
  if (!created || !created.id) throw new Error('create database failed');
  await setCachedDatabaseId(spec.storageKey, created.id);
  return { databaseId: created.id, title: spec.title, reused: false, database: created };
}

export { ensureDatabase, ensureDatabaseSchema, clearCachedDatabaseId, DEFAULT_DB_STORAGE_KEY };
