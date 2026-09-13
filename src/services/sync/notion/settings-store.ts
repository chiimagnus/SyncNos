import { conversationKinds } from '@services/protocols/conversation-kinds';
import { normalizeNotionDatabaseIdInput } from '@services/sync/notion/notion-id-utils';
import { storageGet, storageRemove, storageSet } from '@platform/storage/local';

export const NOTION_PARENT_PAGE_ID_STORAGE_KEY = 'notion_parent_page_id';
export const NOTION_PARENT_PAGE_TITLE_STORAGE_KEY = 'notion_parent_page_title';

export const NOTION_DATABASE_KIND_IDS = ['chat', 'article', 'video'] as const;
export type NotionDatabaseKindId = (typeof NOTION_DATABASE_KIND_IDS)[number];

export type NotionSettingsConfig = {
  parentPageId: string;
  parentPageTitle: string;
  databaseIds: Record<NotionDatabaseKindId, string>;
};

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function notionSettingsError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function normalizeKindId(value: unknown): NotionDatabaseKindId {
  const kindId = safeString(value);
  if ((NOTION_DATABASE_KIND_IDS as readonly string[]).includes(kindId)) return kindId as NotionDatabaseKindId;
  throw notionSettingsError('invalid_notion_database_kind', 'invalid Notion database kind');
}

function getDatabaseSpec(kindIdInput: unknown) {
  const kindId = normalizeKindId(kindIdInput);
  const spec = conversationKinds.getNotionDbSpecByKindId(kindId);
  const storageKey = safeString(spec?.storageKey);
  if (!storageKey) throw notionSettingsError('missing_notion_database_spec', `missing Notion database spec: ${kindId}`);
  return { kindId, storageKey };
}

function getDatabaseStorageKeys(): string[] {
  return NOTION_DATABASE_KIND_IDS.map((kindId) => getDatabaseSpec(kindId).storageKey);
}

export async function getNotionSettingsConfig(): Promise<NotionSettingsConfig> {
  const specs = NOTION_DATABASE_KIND_IDS.map((kindId) => getDatabaseSpec(kindId));
  const values = await storageGet([
    NOTION_PARENT_PAGE_ID_STORAGE_KEY,
    NOTION_PARENT_PAGE_TITLE_STORAGE_KEY,
    ...specs.map((spec) => spec.storageKey),
  ]);
  return {
    parentPageId: safeString(values[NOTION_PARENT_PAGE_ID_STORAGE_KEY]),
    parentPageTitle: safeString(values[NOTION_PARENT_PAGE_TITLE_STORAGE_KEY]),
    databaseIds: {
      chat: safeString(values[specs[0].storageKey]),
      article: safeString(values[specs[1].storageKey]),
      video: safeString(values[specs[2].storageKey]),
    },
  };
}

export async function getNotionParentPage(): Promise<{ id: string; title: string }> {
  const values = await storageGet([NOTION_PARENT_PAGE_ID_STORAGE_KEY, NOTION_PARENT_PAGE_TITLE_STORAGE_KEY]);
  return {
    id: safeString(values[NOTION_PARENT_PAGE_ID_STORAGE_KEY]),
    title: safeString(values[NOTION_PARENT_PAGE_TITLE_STORAGE_KEY]),
  };
}

export async function setNotionParentPage(input: { id?: unknown; title?: unknown }): Promise<NotionSettingsConfig> {
  const nextId = safeString(input?.id);
  const nextTitle = safeString(input?.title);
  const current = await getNotionParentPage();

  if (current.id !== nextId) await storageRemove(getDatabaseStorageKeys());

  if (!nextId) {
    await storageRemove([NOTION_PARENT_PAGE_ID_STORAGE_KEY, NOTION_PARENT_PAGE_TITLE_STORAGE_KEY]);
  } else {
    await storageSet({
      [NOTION_PARENT_PAGE_ID_STORAGE_KEY]: nextId,
      [NOTION_PARENT_PAGE_TITLE_STORAGE_KEY]: nextTitle,
    });
  }
  return getNotionSettingsConfig();
}

export async function getNotionDatabaseId(kindIdInput: unknown): Promise<string> {
  const spec = getDatabaseSpec(kindIdInput);
  const values = await storageGet([spec.storageKey]);
  return safeString(values[spec.storageKey]);
}

export async function setNotionDatabaseId(kindIdInput: unknown, input: unknown): Promise<string> {
  const spec = getDatabaseSpec(kindIdInput);
  const raw = safeString(input);
  if (!raw) {
    await storageRemove([spec.storageKey]);
    return '';
  }
  const databaseId = normalizeNotionDatabaseIdInput(raw);
  if (!databaseId) throw notionSettingsError('invalid_notion_database_id', 'invalid Notion database id');
  await storageSet({ [spec.storageKey]: databaseId });
  return databaseId;
}

export async function cacheNotionManagedDatabaseId(kindIdInput: unknown, input: unknown): Promise<string> {
  const spec = getDatabaseSpec(kindIdInput);
  const databaseId = normalizeNotionDatabaseIdInput(safeString(input));
  if (!databaseId) throw notionSettingsError('invalid_notion_database_id', 'invalid Notion database id');
  await storageSet({ [spec.storageKey]: databaseId });
  return databaseId;
}

export async function resetNotionDatabaseId(kindIdInput: unknown): Promise<void> {
  const spec = getDatabaseSpec(kindIdInput);
  await storageRemove([spec.storageKey]);
}

export async function clearAllNotionSettings(): Promise<void> {
  await storageRemove([
    NOTION_PARENT_PAGE_ID_STORAGE_KEY,
    NOTION_PARENT_PAGE_TITLE_STORAGE_KEY,
    ...getDatabaseStorageKeys(),
  ]);
}
