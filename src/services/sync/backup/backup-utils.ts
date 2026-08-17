import {
  ARTICLE_COMMENT_ARCHIVE_CURRENT_SCHEMA,
  validateArticleCommentArchiveDocument,
} from '@services/comments/domain/comment-archive';
import { MIGRATION_JOURNAL_STORAGE_KEY } from '@platform/local-data/migration-journal';
import { uniqueConversationKey } from '@services/local-data/facts-archive';
import { AUTO_SYNC_QUEUE_STORAGE_KEYS } from '@services/sync/auto-sync/auto-sync-keys';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-keys';

export {
  mergeConversationRecord,
  mergeMessageRecord,
  mergeSyncMappingRecord,
  isDataImageUrl,
  normalizeFallbackImageUrl,
  normalizeImageContentType,
  rewriteSyncnosAssetUrlsInMarkdown,
  SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC,
  uniqueConversationKey,
} from '@services/local-data/facts-archive';

export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_ZIP_SCHEMA_VERSION = 2;
export const LAST_BACKUP_EXPORT_AT_STORAGE_KEY = 'last_backup_export_at';
export const IMAGE_CACHE_INDEX_SCHEMA_VERSION = 1;
export const ARTICLE_COMMENTS_INDEX_SCHEMA_VERSION = ARTICLE_COMMENT_ARCHIVE_CURRENT_SCHEMA;

const STORAGE_BACKUP_DENYLIST_EXACT = new Set<string>([
  ...Object.values(AUTO_SYNC_QUEUE_STORAGE_KEYS),
  ...Object.values(SYNC_JOB_STORAGE_KEYS),
  // Never export tokens (explicit product constraint).
  'notion_oauth_token_v1',
  'feishu_oauth_token_v1',
  // Not used by default (ensureDefaultNotionOAuthClientId removes it), but keep it out of backups.
  'notion_oauth_client_secret',
  'feishu_oauth_client_secret',
  // Removed feature: never carry the old Notion AI model preference through backups.
  'notion_ai_preferred_model_index',
  // Obsidian Local REST API key is a secret even though base URL is safe to export.
  'obsidian_api_key',
]);

function shouldIncludeStorageKeyInBackup(key: string): boolean {
  const k = String(key || '').trim();
  if (!k) return false;
  if (STORAGE_BACKUP_DENYLIST_EXACT.has(k)) return false;
  // Forward-compat: if token key changes versions, keep excluding it.
  if (k.startsWith('notion_oauth_token')) return false;
  if (k.startsWith('feishu_oauth_token')) return false;
  return true;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFinitePositiveInt(v: unknown) {
  return Number.isFinite(v) && Number(v) > 0 && Math.floor(Number(v)) === Number(v);
}

export function filterStorageForBackup(storageLocal: unknown): Record<string, unknown> {
  const input = storageLocal && typeof storageLocal === 'object' ? (storageLocal as any) : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!shouldIncludeStorageKeyInBackup(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Import-only guard: Local mode ownership is never a cross-profile user setting. */
export function filterStorageForBackupImport(storageLocal: unknown): Record<string, unknown> {
  const out = filterStorageForBackup(storageLocal);
  delete out[MIGRATION_JOURNAL_STORAGE_KEY];
  return out;
}

export function validateBackupDocument(doc: unknown): { ok: boolean; error: string } {
  const d: any = doc;
  if (!d || typeof d !== 'object') return { ok: false, error: 'Backup is not an object' };
  if (Number(d.schemaVersion) !== BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: 'Unsupported backup schemaVersion' };
  }
  if (!d.stores || typeof d.stores !== 'object') return { ok: false, error: 'Missing stores' };
  const stores = d.stores;
  for (const name of ['conversations', 'messages', 'sync_mappings']) {
    if (!Array.isArray(stores[name])) return { ok: false, error: `Invalid store: ${name}` };
  }
  const storageLocal = d.storageLocal;
  if (storageLocal != null && typeof storageLocal !== 'object') {
    return { ok: false, error: 'Invalid storageLocal' };
  }

  const seen = new Set<string>();
  for (const c of stores.conversations) {
    const uk = uniqueConversationKey(c);
    if (!uk) continue;
    if (seen.has(uk)) return { ok: false, error: 'Duplicate conversation key in backup' };
    seen.add(uk);
  }

  for (const m of stores.messages) {
    if (!m || !isNonEmptyString(m.messageKey)) {
      return { ok: false, error: 'Backup contains messages without messageKey' };
    }
    if (!isFinitePositiveInt(Number(m.conversationId))) {
      return { ok: false, error: 'Backup contains messages without valid conversationId' };
    }
  }

  return { ok: true, error: '' };
}

function isSafeZipPath(pathValue: unknown) {
  const raw = String(pathValue || '').trim();
  if (!raw) return false;
  if (raw.includes('\0')) return false;
  if (raw.startsWith('/') || raw.startsWith('\\')) return false;
  if (raw.includes('\\')) return false;
  if (/(^|\/)\.\.(\/|$)/.test(raw)) return false;
  return true;
}

export function validateImageCacheIndexDocument(doc: unknown): { ok: boolean; error: string } {
  const d: any = doc;
  if (!d || typeof d !== 'object') return { ok: false, error: 'Image cache index is not an object' };
  if (Number(d.schemaVersion) !== IMAGE_CACHE_INDEX_SCHEMA_VERSION) {
    return { ok: false, error: 'Unsupported image cache schemaVersion' };
  }
  const assets = Array.isArray(d.assets) ? d.assets : null;
  if (!assets) return { ok: false, error: 'Missing image cache assets' };

  for (const a of assets) {
    if (!a || typeof a !== 'object') return { ok: false, error: 'Invalid image cache asset item' };
    const assetId = Number(a.assetId);
    if (!Number.isFinite(assetId) || assetId <= 0) return { ok: false, error: 'Invalid image cache assetId' };

    const uk = String(a.uniqueKey || '').trim();
    if (!isNonEmptyString(uk) || !uk.includes('||')) return { ok: false, error: 'Invalid image cache uniqueKey' };

    const url = String(a.url || '').trim();
    if (!isNonEmptyString(url)) return { ok: false, error: 'Invalid image cache url' };

    const contentType = String(a.contentType || '')
      .trim()
      .toLowerCase();
    if (!isNonEmptyString(contentType) || !contentType.startsWith('image/')) {
      return { ok: false, error: 'Invalid image cache contentType' };
    }

    const byteSize = Number(a.byteSize);
    if (!Number.isFinite(byteSize) || byteSize <= 0) return { ok: false, error: 'Invalid image cache byteSize' };

    const blobPath = String(a.blobPath || '').trim();
    if (!isNonEmptyString(blobPath) || !isSafeZipPath(blobPath)) {
      return { ok: false, error: 'Invalid image cache blobPath' };
    }
    if (!blobPath.startsWith('assets/image-cache/blobs/')) {
      return { ok: false, error: 'Invalid image cache blobPath prefix' };
    }
  }

  return { ok: true, error: '' };
}

export function validateArticleCommentsIndexDocument(doc: unknown): { ok: boolean; error: string } {
  const result = validateArticleCommentArchiveDocument(doc);
  return { ok: result.ok, error: result.error };
}

export function validateBackupManifest(doc: unknown): { ok: boolean; error: string } {
  const d: any = doc;
  if (!d || typeof d !== 'object') return { ok: false, error: 'Manifest is not an object' };
  if (Number(d.backupSchemaVersion) !== BACKUP_ZIP_SCHEMA_VERSION) {
    return { ok: false, error: 'Unsupported backupSchemaVersion' };
  }
  if (!isNonEmptyString(d.exportedAt)) return { ok: false, error: 'Missing exportedAt' };
  if (!d.db || typeof d.db !== 'object') return { ok: false, error: 'Missing db' };
  if (!isNonEmptyString(d.db.name)) return { ok: false, error: 'Missing db.name' };
  if (!Number.isFinite(Number(d.db.version))) return { ok: false, error: 'Missing db.version' };

  if (!d.counts || typeof d.counts !== 'object') return { ok: false, error: 'Missing counts' };
  for (const k of ['conversations', 'messages', 'sync_mappings']) {
    if (!Number.isFinite(Number(d.counts[k])) || Number(d.counts[k]) < 0) {
      return { ok: false, error: `Invalid counts.${k}` };
    }
  }
  if ((d.counts as any).image_cache != null) {
    if (!Number.isFinite(Number((d.counts as any).image_cache)) || Number((d.counts as any).image_cache) < 0) {
      return { ok: false, error: 'Invalid counts.image_cache' };
    }
  }
  if ((d.counts as any).article_comments != null) {
    if (
      !Number.isFinite(Number((d.counts as any).article_comments)) ||
      Number((d.counts as any).article_comments) < 0
    ) {
      return { ok: false, error: 'Invalid counts.article_comments' };
    }
  }

  const config = d.config;
  if (!config || typeof config !== 'object') return { ok: false, error: 'Missing config' };
  const storageLocalPath = config.storageLocalPath;
  if (!isNonEmptyString(storageLocalPath) || !isSafeZipPath(storageLocalPath)) {
    return { ok: false, error: 'Invalid config.storageLocalPath' };
  }
  if (!String(storageLocalPath).endsWith('.json')) {
    return { ok: false, error: 'Invalid config.storageLocalPath extension' };
  }

  const index = d.index;
  if (!index || typeof index !== 'object') return { ok: false, error: 'Missing index' };
  const conversationsCsvPath = index.conversationsCsvPath;
  if (!isNonEmptyString(conversationsCsvPath) || !isSafeZipPath(conversationsCsvPath)) {
    return { ok: false, error: 'Invalid index.conversationsCsvPath' };
  }
  if (!String(conversationsCsvPath).endsWith('.csv')) {
    return { ok: false, error: 'Invalid index.conversationsCsvPath extension' };
  }

  if (!Array.isArray(d.sources)) return { ok: false, error: 'Missing sources' };
  const seenFiles = new Set<string>();
  for (const group of d.sources) {
    if (!group || typeof group !== 'object') return { ok: false, error: 'Invalid sources item' };
    if (!isNonEmptyString(group.source)) return { ok: false, error: 'Invalid sources[].source' };
    const files = Array.isArray(group.files) ? group.files : null;
    if (!files) return { ok: false, error: 'Invalid sources[].files' };
    const expectedCount = Number(group.conversationCount);
    if (!Number.isFinite(expectedCount) || expectedCount < 0) {
      return { ok: false, error: 'Invalid sources[].conversationCount' };
    }
    if (expectedCount !== files.length) return { ok: false, error: 'sources[].conversationCount mismatch' };
    for (const filePath of files) {
      const p = String(filePath || '').trim();
      if (!p || !isSafeZipPath(p)) return { ok: false, error: 'Invalid sources file path' };
      if (!p.startsWith('sources/')) return { ok: false, error: 'Invalid sources file prefix' };
      if (!p.endsWith('.json')) return { ok: false, error: 'Invalid sources file extension' };
      if (seenFiles.has(p)) return { ok: false, error: 'Duplicate sources file path' };
      seenFiles.add(p);
    }
  }

  if (d.assets != null) {
    if (!d.assets || typeof d.assets !== 'object') return { ok: false, error: 'Invalid assets' };
    const imageCacheIndexPath = (d.assets as any).imageCacheIndexPath;
    if (imageCacheIndexPath != null) {
      if (!isNonEmptyString(imageCacheIndexPath) || !isSafeZipPath(imageCacheIndexPath)) {
        return { ok: false, error: 'Invalid assets.imageCacheIndexPath' };
      }
      if (!String(imageCacheIndexPath).endsWith('.json')) {
        return { ok: false, error: 'Invalid assets.imageCacheIndexPath extension' };
      }
    }
    const articleCommentsIndexPath = (d.assets as any).articleCommentsIndexPath;
    if (articleCommentsIndexPath != null) {
      if (!isNonEmptyString(articleCommentsIndexPath) || !isSafeZipPath(articleCommentsIndexPath)) {
        return { ok: false, error: 'Invalid assets.articleCommentsIndexPath' };
      }
      if (!String(articleCommentsIndexPath).endsWith('.json')) {
        return { ok: false, error: 'Invalid assets.articleCommentsIndexPath extension' };
      }
    }
  }

  return { ok: true, error: '' };
}

export function validateConversationBundle(doc: unknown): { ok: boolean; error: string } {
  const d: any = doc;
  if (!d || typeof d !== 'object') return { ok: false, error: 'Bundle is not an object' };
  if (Number(d.schemaVersion) !== 1) return { ok: false, error: 'Unsupported bundle schemaVersion' };
  if (!d.conversation || typeof d.conversation !== 'object') {
    return { ok: false, error: 'Missing conversation' };
  }
  const conversation = d.conversation;
  const source = conversation.source ? String(conversation.source) : '';
  const conversationKey = conversation.conversationKey ? String(conversation.conversationKey) : '';
  if (!isNonEmptyString(source) || !isNonEmptyString(conversationKey)) {
    return { ok: false, error: 'Missing conversation.source or conversation.conversationKey' };
  }

  const messages = Array.isArray(d.messages) ? d.messages : null;
  if (!messages) return { ok: false, error: 'Missing messages' };
  for (const m of messages) {
    if (!m || typeof m !== 'object') return { ok: false, error: 'Invalid message item' };
    if (!isNonEmptyString(m.messageKey)) return { ok: false, error: 'Message missing messageKey' };
  }

  if (d.syncMapping != null) {
    if (!d.syncMapping || typeof d.syncMapping !== 'object') {
      return { ok: false, error: 'Invalid syncMapping' };
    }
    const mappingSource = d.syncMapping.source ? String(d.syncMapping.source) : '';
    const mappingKey = d.syncMapping.conversationKey ? String(d.syncMapping.conversationKey) : '';
    if (!isNonEmptyString(mappingSource) || !isNonEmptyString(mappingKey)) {
      return { ok: false, error: 'syncMapping missing source or conversationKey' };
    }
    if (mappingSource !== source || mappingKey !== conversationKey) {
      return { ok: false, error: 'syncMapping does not match conversation' };
    }
  }

  return { ok: true, error: '' };
}

export function validateStorageLocalDocument(doc: unknown): { ok: boolean; error: string } {
  const d: any = doc;
  if (!d || typeof d !== 'object') return { ok: false, error: 'Storage backup is not an object' };
  if (Number(d.schemaVersion) !== 1) return { ok: false, error: 'Unsupported storage schemaVersion' };
  if (d.storageLocal != null && typeof d.storageLocal !== 'object') {
    return { ok: false, error: 'Invalid storageLocal' };
  }
  return { ok: true, error: '' };
}
