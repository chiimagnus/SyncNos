import { buildAiOptions } from '@services/sync/notion/notion-ai.ts';
import { notionFetch } from '@services/sync/notion/notion-api.ts';
import type { ConversationKindDbSpec } from '@services/protocols/conversation-kind-contract.ts';
import { normalizeNotionIdInput } from '@services/sync/notion/notion-id-utils';
import { listBlockChildren } from '@services/sync/notion/notion-section-blocks';
import { cacheNotionManagedDatabaseId, getNotionDatabaseId } from '@services/sync/notion/settings-store';

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

async function getDatabase(accessToken: string, databaseId: string, retryRateLimit = false) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await notionFetch({ accessToken, method: 'GET', path: `/v1/databases/${databaseId}` });
    } catch (error: any) {
      // Cold discovery may read multiple databases; retry only safe reads within a bounded window.
      const delay = Math.max(1000, Number(error?.retryAfterMs) || 0);
      if (!retryRateLimit || error?.status !== 429 || attempt >= 2 || delay > 5000) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function resolveNotionDatabaseId(
  accessToken: string,
  input: string,
  parentPageId: string,
): Promise<string> {
  const id = normalizeNotionIdInput(input);
  if (!id) throw Object.assign(new Error('Enter a database link or ID.'), { code: 'invalid_notion_database_id' });
  if (!parentPageId) {
    throw Object.assign(new Error('Choose a destination page first.'), { code: 'notion_parent_page_required' });
  }
  let db;
  try {
    db = await getDatabase(accessToken, id);
  } catch (error) {
    if (!isMissingDatabaseError(error)) throw error;
  }
  if (db?.object !== 'database' || !isUsableDatabase(db) || normalizeNotionId(db.id) !== id) {
    throw Object.assign(new Error('Database is unavailable. Use its full-page link and check access.'), {
      code: 'notion_database_unavailable',
    });
  }
  if (!matchesParentPage(db, parentPageId)) {
    throw Object.assign(new Error('Choose a database under the destination page.'), {
      code: 'notion_database_wrong_parent',
    });
  }
  return id;
}

function databaseResolutionError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function matchesManagedSchema(database: any, dbSpec: ConversationKindDbSpec): boolean {
  const properties = database?.properties || {};
  return Object.entries(dbSpec.properties).every(([name, spec]) => {
    const property = properties[name] ?? (name === 'Last Activity' ? properties.Date : undefined);
    return notionPropertyType(property) === Object.keys(spec as object)[0];
  });
}

async function discoverDatabase(accessToken: string, parentPageId: string, dbSpec: ConversationKindDbSpec) {
  // Search is eventually consistent. Read the actual destination's children before creating anything.
  const children = await listBlockChildren(accessToken, parentPageId);
  const wantedTitle = normalizeTitle(dbSpec.title);
  const candidates: { database: any; recognizable: boolean }[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    if (child?.type !== 'child_database' || child.archived === true || child.in_trash === true) continue;
    const id = normalizeNotionIdInput(child.id);
    if (!id) throw new Error('Notion returned a child database without a valid ID.');
    if (seen.has(id)) continue;
    seen.add(id);
    const database = await getDatabase(accessToken, id, true);
    if (database?.archived === true || database?.in_trash === true) continue;
    if (!isUsableDatabase(database) || normalizeNotionId(database.id) !== id) {
      throw databaseResolutionError(
        'A child database is unavailable. Check its access before syncing.',
        'notion_database_unavailable',
      );
    }
    if (!matchesParentPage(database, parentPageId)) continue;
    const title = normalizeTitle(readDatabaseTitle(database));
    const exactTitle = title === wantedTitle;
    const recognizableName = title.startsWith(wantedTitle);
    const managedSchema = matchesManagedSchema(database, dbSpec);
    if (recognizableName || managedSchema) {
      candidates.push({ database, recognizable: exactTitle || (recognizableName && managedSchema) });
    }
  }
  if (candidates.length > 1 || (candidates.length === 1 && !candidates[0].recognizable)) {
    throw databaseResolutionError(
      `Existing databases may match ${dbSpec.title}. Select the intended database in Settings → Notion → Advanced.`,
      'notion_database_ambiguous',
    );
  }
  return candidates[0]?.database ?? null;
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
  database,
  dbSpec,
}: {
  accessToken: string;
  database: any;
  dbSpec: ConversationKindDbSpec;
}) {
  const databaseId = database.id;
  const props = { ...(database.properties || {}) } as Record<string, any>;
  const patch = dbSpec.ensureSchemaPatch || {};

  // Validate all managed fields before the first schema write.
  const legacyDate = !props['Last Activity'] && props.Date;
  for (const [name, spec] of Object.entries(dbSpec.properties)) {
    const actualName = name === 'Last Activity' && legacyDate ? 'Date' : name;
    const property = props[actualName];
    const expected = Object.keys(spec as object)[0];
    if (!property && patch[name]) continue;
    const actual = notionPropertyType(property);
    if (actual !== expected) throw schemaIncompatible(actualName, expected, actual);
  }

  if (legacyDate) {
    await updateDatabase(accessToken, {
      databaseId,
      properties: { Date: { name: 'Last Activity' } },
    });
    props['Last Activity'] = { ...props.Date, type: 'date' };
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
  kindId,
  dbSpec,
}: {
  accessToken: string;
  parentPageId: string;
  kindId: string;
  dbSpec: ConversationKindDbSpec;
}) {
  const boundId = await getNotionDatabaseId(kindId);
  if (boundId) {
    const database = await getDatabase(accessToken, boundId);
    if (!isUsableDatabase(database) || normalizeNotionId(database.id) !== normalizeNotionId(boundId)) {
      throw databaseResolutionError(
        'The configured Notion database is unavailable. Restore it or choose another database.',
        'notion_database_unavailable',
      );
    }
    if (!matchesParentPage(database, parentPageId)) {
      throw databaseResolutionError(
        'The configured Notion database is no longer under the destination page. Choose the intended database.',
        'notion_database_wrong_parent',
      );
    }
    await ensureDatabaseSchema({ accessToken, database, dbSpec });
    return { databaseId: boundId, title: dbSpec.title, reused: true, database };
  }

  const found = await discoverDatabase(accessToken, parentPageId, dbSpec);
  if (found) {
    await ensureDatabaseSchema({ accessToken, database: found, dbSpec });
    const databaseId = await cacheNotionManagedDatabaseId(kindId, found.id);
    return { databaseId, title: dbSpec.title, reused: true, database: found };
  }

  const created = await createDatabase(accessToken, { parentPageId, dbSpec });
  if (!created || !created.id) throw new Error('create database failed');
  const databaseId = await cacheNotionManagedDatabaseId(kindId, created.id);
  return { databaseId, title: dbSpec.title, reused: false, database: created };
}

export { ensureDatabase };
