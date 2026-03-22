// @ts-nocheck
import { buildAiOptions as buildDefaultAiOptions } from '@services/sync/notion/notion-ai.ts';
import { notionFetch as defaultNotionFetch } from '@services/sync/notion/notion-api.ts';
import { conversationKinds as builtInConversationKinds } from '@services/protocols/conversation-kinds.ts';
import { storageGet, storageRemove, storageSet } from '@platform/storage/local';

const DEFAULT_DB_TITLE = 'SyncNos-AI Chats';
const DEFAULT_DB_STORAGE_KEY = 'notion_db_id_syncnos_ai_chats';

async function getCachedDatabaseId(storageKey) {
  const key = String(storageKey || '').trim() || DEFAULT_DB_STORAGE_KEY;
  const res = await storageGet([key]);
  return String((res && (res as any)[key]) || '');
}

async function setCachedDatabaseId(storageKey, databaseId) {
  const key = String(storageKey || '').trim() || DEFAULT_DB_STORAGE_KEY;
  await storageSet({ [key]: databaseId || '' });
  return true;
}

async function clearCachedDatabaseId(storageKey) {
  const key = String(storageKey || '').trim() || DEFAULT_DB_STORAGE_KEY;
  await storageRemove([key]);
  return true;
}

function getConversationKinds() {
  return builtInConversationKinds;
}

function getNotionFetch() {
  return defaultNotionFetch;
}

function buildAiOptions() {
  return buildDefaultAiOptions();
}

function defaultDbSpec() {
  const conversationKinds = getConversationKinds();
  const list = conversationKinds && typeof conversationKinds.list === 'function' ? conversationKinds.list() : [];
  const chat = Array.isArray(list) ? list.find((d) => d && d.id === 'chat' && d.notion && d.notion.dbSpec) : null;
  if (chat && chat.notion && chat.notion.dbSpec) return chat.notion.dbSpec;

  // Fallback for unit tests / load-order gaps.
  return {
    title: DEFAULT_DB_TITLE,
    storageKey: DEFAULT_DB_STORAGE_KEY,
    properties: {
      Name: { title: {} },
      Date: { date: {} },
      URL: { url: {} },
      AI: { multi_select: { options: [] } },
    },
    ensureSchemaPatch: {
      AI: { multi_select: { options: [] } },
    },
  };
}

function isUsableDatabase(database) {
  if (!database || typeof database !== 'object') return false;
  if (database.object != null && database.object !== 'database') return false;
  if (database.in_trash === true) return false;
  if (database.archived === true) return false;
  return true;
}

async function getDatabase(accessToken, databaseId) {
  const notionFetch = getNotionFetch();
  return notionFetch({ accessToken, method: 'GET', path: `/v1/databases/${databaseId}` });
}

async function searchDatabases(accessToken, query) {
  const body = {
    query: query || '',
    filter: { property: 'object', value: 'database' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: 20,
  };
  const notionFetch = getNotionFetch();
  return notionFetch({ accessToken, method: 'POST', path: '/v1/search', body });
}

async function updateDatabase(accessToken, { databaseId, properties }) {
  const body = { properties: properties || {} };
  const notionFetch = getNotionFetch();
  return notionFetch({ accessToken, method: 'PATCH', path: `/v1/databases/${databaseId}`, body });
}

function materializeDbProperties(dbSpec) {
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

async function createDatabase(accessToken, { parentPageId, dbSpec }) {
  const spec = dbSpec && typeof dbSpec === 'object' ? dbSpec : defaultDbSpec();
  const body = {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: spec.title } }],
    properties: materializeDbProperties(spec),
  };
  const notionFetch = getNotionFetch();
  return notionFetch({ accessToken, method: 'POST', path: '/v1/databases', body });
}

async function ensureDatabaseSchema({ accessToken, databaseId, dbSpec }) {
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

  const missing = {};
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

async function ensureDatabase({ accessToken, parentPageId, dbSpec }) {
  const spec = dbSpec && typeof dbSpec === 'object' ? dbSpec : defaultDbSpec();
  const cached = await getCachedDatabaseId(spec.storageKey);
  if (cached) {
    try {
      const db = await getDatabase(accessToken, cached);
      if (!isUsableDatabase(db)) throw new Error('cached database is archived');
      await ensureDatabaseSchema({ accessToken, databaseId: cached, dbSpec: spec });
      return { databaseId: cached, title: spec.title, reused: true, database: db };
    } catch (_e) {
      // Fall through: cached id invalid or no access.
      await clearCachedDatabaseId(spec.storageKey);
    }
  }

  const found = await searchDatabases(accessToken, spec.title);
  const results = Array.isArray(found.results) ? found.results : [];
  const exact = results.find((d) => {
    if (!isUsableDatabase(d)) return false;
    const t = Array.isArray(d.title)
      ? d.title
          .map((x) => x.plain_text || '')
          .join('')
          .trim()
      : '';
    return t === spec.title;
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

const api = {
  ensureDatabase,
  ensureDatabaseSchema,
  clearCachedDatabaseId,
  buildAiOptions,
  getCachedDatabaseId,
  setCachedDatabaseId,
  DEFAULT_DB_TITLE,
  DEFAULT_DB_STORAGE_KEY,
};

export {
  ensureDatabase,
  ensureDatabaseSchema,
  clearCachedDatabaseId,
  buildAiOptions,
  getCachedDatabaseId,
  setCachedDatabaseId,
  DEFAULT_DB_TITLE,
  DEFAULT_DB_STORAGE_KEY,
};
export default api;
