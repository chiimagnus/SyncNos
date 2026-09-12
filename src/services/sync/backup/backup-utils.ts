import { DATA_REVISION_WAKE_STORAGE_KEY } from '@services/data-revisions/wake';
import { normalizeLegacyMessageRecord } from '@platform/idb/message-record';
import {
  normalizeCanonicalVideoChapters,
  normalizeCanonicalVideoTranscriptCues,
} from '@services/conversations/domain/video-content';
import {
  canonicalizeInpageDisplayModeStorageRecord,
  INPAGE_DISPLAY_MODE_STORAGE_KEY,
} from '@services/shared/inpage-display-mode';
type UnknownRecord = Record<string, any>;

export const BACKUP_ZIP_SCHEMA_VERSION = 3;
export const LAST_BACKUP_EXPORT_AT_STORAGE_KEY = 'last_backup_export_at';
const IMAGE_CACHE_INDEX_SCHEMA_VERSION = 1;

const STORAGE_BACKUP_DENYLIST_EXACT = new Set<string>([
  // Never export tokens (explicit product constraint).
  'notion_oauth_token_v1',
  'feishu_oauth_token_v1',
  // Notion fixed client-id mirror and OAuth attempt session state are local runtime data, not portable settings.
  'notion_oauth_client_id',
  'notion_oauth_client_secret',
  'notion_oauth_pending_state',
  'notion_oauth_last_error',
  'feishu_oauth_client_secret',
  'feishu_oauth_pending_state',
  'feishu_oauth_last_error',
  // Removed feature: never carry the old Notion AI model preference through backups.
  'notion_ai_preferred_model_index',
  // Obsidian Local REST API key is a secret even though base URL is safe to export.
  'obsidian_api_key',
  // GitHub Device Flow/auth state contains access/refresh/device secrets.
  'github_auth_state_v1',
  // Runtime-only cross-context invalidation metadata.
  DATA_REVISION_WAKE_STORAGE_KEY,
]);

function shouldIncludeStorageKeyInBackup(key: string): boolean {
  const k = String(key || '').trim();
  if (!k) return false;
  if (STORAGE_BACKUP_DENYLIST_EXACT.has(k)) return false;
  // Forward-compat: if token key changes versions, keep excluding it.
  if (k.startsWith('notion_oauth_token')) return false;
  if (k.startsWith('feishu_oauth_token_v')) return false;
  if (k.startsWith('github_auth_')) return false;
  // Inpage settings are canonical-only; do not perpetuate retired inpage_* storage residue through backups.
  if (k.startsWith('inpage_') && k !== INPAGE_DISPLAY_MODE_STORAGE_KEY) return false;
  return true;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function areBackupValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => areBackupValuesEqual(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;

  const leftRecord = left as UnknownRecord;
  const rightRecord = right as UnknownRecord;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key !== rightKeys[index] || !areBackupValuesEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

export function uniqueConversationKey(conversation: UnknownRecord): string {
  const source = conversation && conversation.source ? String(conversation.source) : '';
  const conversationKey = conversation && conversation.conversationKey ? String(conversation.conversationKey) : '';
  if (!source || !conversationKey) return '';
  return `${source}||${conversationKey}`;
}

function pickStringPreferExisting(existing: unknown, incoming: unknown) {
  const a = existing == null ? '' : String(existing);
  if (isNonEmptyString(a)) return a.trim();
  const b = incoming == null ? '' : String(incoming);
  return isNonEmptyString(b) ? b.trim() : '';
}

function mergeWarningFlags(existing: unknown, incoming: unknown): string[] {
  const a = Array.isArray(existing) ? existing : [];
  const b = Array.isArray(incoming) ? incoming : [];
  const set = new Set<string>();
  for (const x of a) {
    if (isNonEmptyString(x)) set.add(String(x).trim());
  }
  for (const x of b) {
    if (isNonEmptyString(x)) set.add(String(x).trim());
  }
  return Array.from(set);
}

export function mergeConversationRecord(
  existing: UnknownRecord,
  incoming: UnknownRecord,
  options: { allowLegacyLastCapturedAt?: boolean } = {},
): UnknownRecord {
  const a = existing && typeof existing === 'object' ? existing : {};
  const b = incoming && typeof incoming === 'object' ? incoming : {};

  const next: UnknownRecord = { ...a };
  next.sourceType = pickStringPreferExisting(a.sourceType, b.sourceType) || 'chat';
  next.source = pickStringPreferExisting(a.source, b.source);
  next.conversationKey = pickStringPreferExisting(a.conversationKey, b.conversationKey);

  next.title = pickStringPreferExisting(a.title, b.title);
  next.url = pickStringPreferExisting(a.url, b.url);
  next.author = pickStringPreferExisting(a.author, b.author);
  next.publishedAt = pickStringPreferExisting(a.publishedAt, b.publishedAt);
  next.warningFlags = mergeWarningFlags(a.warningFlags, b.warningFlags);

  if (
    String(next.sourceType || '')
      .trim()
      .toLowerCase() === 'video'
  ) {
    const existingPlatform = String(a.platform || '')
      .trim()
      .toLowerCase();
    const incomingPlatform = String(b.platform || '')
      .trim()
      .toLowerCase();
    const platform =
      existingPlatform === 'youtube' || existingPlatform === 'bilibili'
        ? existingPlatform
        : incomingPlatform === 'youtube' || incomingPlatform === 'bilibili'
          ? incomingPlatform
          : '';
    if (platform) next.platform = platform;
    else delete next.platform;

    const validDuration = (value: unknown) => {
      if (value == null || (typeof value === 'string' && !value.trim())) return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
    };
    const durationSeconds = validDuration(a.durationSeconds) ?? validDuration(b.durationSeconds);
    if (durationSeconds != null) next.durationSeconds = durationSeconds;
    else delete next.durationSeconds;

    const thumbnailUrl = pickStringPreferExisting(a.thumbnailUrl, b.thumbnailUrl);
    if (thumbnailUrl) next.thumbnailUrl = thumbnailUrl;
    else delete next.thumbnailUrl;
    const videoDescription = pickStringPreferExisting(a.videoDescription, b.videoDescription);
    if (videoDescription) next.videoDescription = videoDescription;
    else delete next.videoDescription;

    delete next.transcriptSource;
    delete next.hasTimestamps;
    delete next.description;
  }

  // notionPageId: never overwrite a non-empty local mapping.
  const notionPageId = pickStringPreferExisting(a.notionPageId, b.notionPageId);
  const hasExplicitEmptyNotionPageId = [a, b].some(
    (record) =>
      Object.prototype.hasOwnProperty.call(record, 'notionPageId') &&
      !pickStringPreferExisting(record.notionPageId, ''),
  );
  if (notionPageId || hasExplicitEmptyNotionPageId) next.notionPageId = notionPageId;
  else delete next.notionPageId;

  next.lastActivityAt = Math.max(
    validTimestamp(a.lastActivityAt) ?? 0,
    validTimestamp(b.lastActivityAt) ?? 0,
    options.allowLegacyLastCapturedAt ? (validTimestamp(b.lastCapturedAt) ?? 0) : 0,
  );
  delete next.lastCapturedAt;

  return next;
}

function shouldPreferIncomingMessage(existing: UnknownRecord, incoming: UnknownRecord) {
  const aUpdated = validTimestamp(existing.updatedAt) ?? 0;
  const bUpdated = validTimestamp(incoming.updatedAt) ?? 0;
  return bUpdated > aUpdated;
}

export function mergeMessageRecord(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  const hasExisting = !!existing && typeof existing === 'object';
  const a = hasExisting ? normalizeLegacyMessageRecord(existing) : {};
  const b = normalizeLegacyMessageRecord(incoming);

  const preferIncoming = !hasExisting || shouldPreferIncomingMessage(a, b);
  const winner = preferIncoming ? b : a;
  const next = preferIncoming ? { ...a, ...b } : { ...b, ...a };
  next.role = pickStringPreferExisting(next.role, 'assistant') || 'assistant';

  const aUpdated = validTimestamp(a.updatedAt);
  const bUpdated = validTimestamp(b.updatedAt);
  const maxUpdated = Math.max(aUpdated ?? 0, bUpdated ?? 0);
  if (maxUpdated > 0) next.updatedAt = maxUpdated;
  else delete next.updatedAt;

  const aSeq = Number(a.sequence);
  const bSeq = Number(b.sequence);
  if (Number.isFinite(bSeq)) next.sequence = bSeq;
  else if (Number.isFinite(aSeq)) next.sequence = aSeq;
  else next.sequence = 0;

  if (String(next.messageKey || '') === 'video_transcript') {
    if (Object.prototype.hasOwnProperty.call(winner, 'transcriptCues')) {
      next.transcriptCues = normalizeCanonicalVideoTranscriptCues(winner.transcriptCues);
    } else {
      delete next.transcriptCues;
    }
    if (Object.prototype.hasOwnProperty.call(winner, 'videoChapters')) {
      next.videoChapters = normalizeCanonicalVideoChapters(winner.videoChapters);
    } else {
      delete next.videoChapters;
    }
  } else {
    delete next.transcriptCues;
    delete next.videoChapters;
  }

  return next;
}

export function filterStorageForBackup(storageLocal: unknown): Record<string, unknown> {
  const input = storageLocal && typeof storageLocal === 'object' ? (storageLocal as any) : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!shouldIncludeStorageKeyInBackup(key)) continue;
    out[key] = value;
  }
  return canonicalizeInpageDisplayModeStorageRecord(out);
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

export function validateBackupManifest(doc: unknown): { ok: boolean; error: string } {
  const d: any = doc;
  if (!d || typeof d !== 'object') return { ok: false, error: 'Manifest is not an object' };
  const backupSchemaVersion = Number(d.backupSchemaVersion);
  if (backupSchemaVersion !== 2 && backupSchemaVersion !== BACKUP_ZIP_SCHEMA_VERSION) {
    return { ok: false, error: 'Unsupported backupSchemaVersion' };
  }
  const isCurrent = backupSchemaVersion === BACKUP_ZIP_SCHEMA_VERSION;
  if (!isNonEmptyString(d.exportedAt)) return { ok: false, error: 'Missing exportedAt' };
  if (!d.db || typeof d.db !== 'object') return { ok: false, error: 'Missing db' };
  if (!isNonEmptyString(d.db.name)) return { ok: false, error: 'Missing db.name' };
  if (!Number.isFinite(Number(d.db.version))) return { ok: false, error: 'Missing db.version' };

  if (!d.counts || typeof d.counts !== 'object') return { ok: false, error: 'Missing counts' };
  const requiredCounts = isCurrent
    ? ['conversations', 'messages', 'sync_mappings', 'image_cache', 'article_comments']
    : ['conversations', 'messages', 'sync_mappings'];
  for (const k of requiredCounts) {
    if (!Number.isFinite(Number(d.counts[k])) || Number(d.counts[k]) < 0) {
      return { ok: false, error: `Invalid counts.${k}` };
    }
  }
  for (const k of ['image_cache', 'article_comments']) {
    if (!isCurrent && d.counts[k] != null && (!Number.isFinite(Number(d.counts[k])) || Number(d.counts[k]) < 0)) {
      return { ok: false, error: `Invalid counts.${k}` };
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

  if (isCurrent && (!d.assets || typeof d.assets !== 'object')) {
    return { ok: false, error: 'Missing assets' };
  }
  if (d.assets != null) {
    if (!d.assets || typeof d.assets !== 'object') return { ok: false, error: 'Invalid assets' };
    for (const [key, label] of [
      ['imageCacheIndexPath', 'assets.imageCacheIndexPath'],
      ['articleCommentsIndexPath', 'assets.articleCommentsIndexPath'],
    ] as const) {
      const pathValue = (d.assets as any)[key];
      if (isCurrent && pathValue == null) return { ok: false, error: `Missing ${label}` };
      if (pathValue != null) {
        if (!isNonEmptyString(pathValue) || !isSafeZipPath(pathValue)) {
          return { ok: false, error: `Invalid ${label}` };
        }
        if (!String(pathValue).endsWith('.json')) {
          return { ok: false, error: `Invalid ${label} extension` };
        }
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
