export const DATA_REVISION_SCOPES = [
  'conversations',
  'messages',
  'sync_mappings',
  'article_comments',
  'image_cache',
] as const;

export type DataRevisionScope = (typeof DATA_REVISION_SCOPES)[number];

export const DATA_REVISION_STORE_BY_SCOPE: Readonly<Record<DataRevisionScope, string>> = Object.freeze({
  conversations: 'data_revision_conversations',
  messages: 'data_revision_messages',
  sync_mappings: 'data_revision_sync_mappings',
  article_comments: 'data_revision_article_comments',
  image_cache: 'data_revision_image_cache',
});

export const DATA_REVISION_RECORD_KEY = 'current' as const;

export type DataRevisionRecord = {
  revision: number;
  updatedAt: number;
};

export type DataRevisionSnapshot = Record<DataRevisionScope, number>;

export function normalizeDataRevisionRecord(value: unknown): DataRevisionRecord {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const revision =
    typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0;
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0 ? raw.updatedAt : 0;
  return { revision, updatedAt };
}
