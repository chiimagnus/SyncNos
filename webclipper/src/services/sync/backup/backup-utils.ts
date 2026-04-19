type UnknownRecord = Record<string, any>;

export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_ZIP_SCHEMA_VERSION = 2;
export const LAST_BACKUP_EXPORT_AT_STORAGE_KEY = 'last_backup_export_at';
export const IMAGE_CACHE_INDEX_SCHEMA_VERSION = 1;
export const ARTICLE_COMMENTS_INDEX_SCHEMA_VERSION = 1;

// Legacy export: previously we only backed up an allowlist of keys.
// Now we back up all chrome.storage.local keys except a small sensitive denylist.
export const STORAGE_ALLOWLIST = Object.freeze([] as string[]);

const STORAGE_BACKUP_DENYLIST_EXACT = new Set<string>([
  // Never export tokens (explicit product constraint).
  'notion_oauth_token_v1',
  // Not used by default (ensureDefaultNotionOAuthClientId removes it), but keep it out of backups.
  'notion_oauth_client_secret',
]);

function shouldIncludeStorageKeyInBackup(key: string): boolean {
  const k = String(key || '').trim();
  if (!k) return false;
  if (STORAGE_BACKUP_DENYLIST_EXACT.has(k)) return false;
  // Forward-compat: if token key changes versions, keep excluding it.
  if (k.startsWith('notion_oauth_token')) return false;
  return true;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFinitePositiveInt(v: unknown) {
  return Number.isFinite(v) && Number(v) > 0 && Math.floor(Number(v)) === Number(v);
}

function safeBoolean(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
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

function deriveStoredAutoTitle(record: UnknownRecord): string {
  const autoTitle = record && isNonEmptyString(record.autoTitle) ? String(record.autoTitle).trim() : '';
  if (autoTitle) return autoTitle;
  if (safeBoolean(record?.titleManuallyEdited) === true) return '';
  return record && isNonEmptyString(record.title) ? String(record.title).trim() : '';
}

function pickStringByRecency(
  existing: unknown,
  existingCapturedAt: unknown,
  incoming: unknown,
  incomingCapturedAt: unknown,
) {
  const a = existing == null ? '' : String(existing).trim();
  const b = incoming == null ? '' : String(incoming).trim();
  if (isNonEmptyString(a) && !isNonEmptyString(b)) return a;
  if (isNonEmptyString(b) && !isNonEmptyString(a)) return b;
  if (!isNonEmptyString(a) && !isNonEmptyString(b)) return '';
  const aCaptured = Number(existingCapturedAt) || 0;
  const bCaptured = Number(incomingCapturedAt) || 0;
  if (bCaptured > aCaptured) return b;
  return a || b;
}

function mergeConversationTitleFields(existing: UnknownRecord, incoming: UnknownRecord) {
  const a = existing && typeof existing === 'object' ? existing : {};
  const b = incoming && typeof incoming === 'object' ? incoming : {};
  const existingManual = safeBoolean(a.titleManuallyEdited) === true;
  const incomingManual = safeBoolean(b.titleManuallyEdited) === true;
  const existingTitle = isNonEmptyString(a.title) ? String(a.title).trim() : '';
  const incomingTitle = isNonEmptyString(b.title) ? String(b.title).trim() : '';
  const existingAutoTitle = deriveStoredAutoTitle(a);
  const incomingAutoTitle = deriveStoredAutoTitle(b);

  const titleManuallyEdited = existingManual || incomingManual;
  const autoTitle = pickStringByRecency(existingAutoTitle, a.lastCapturedAt, incomingAutoTitle, b.lastCapturedAt);

  let title = '';
  if (existingManual) title = existingTitle;
  else if (incomingManual) title = incomingTitle;
  else title = pickStringPreferExisting(existingTitle, incomingTitle);
  if (!title) title = autoTitle;

  return { title, autoTitle, titleManuallyEdited };
}

function safeFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

export function mergeConversationRecord(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  const a = existing && typeof existing === 'object' ? existing : {};
  const b = incoming && typeof incoming === 'object' ? incoming : {};
  const titleFields = mergeConversationTitleFields(a, b);

  const next: UnknownRecord = { ...a };
  next.sourceType = pickStringPreferExisting(a.sourceType, b.sourceType) || 'chat';
  next.source = pickStringPreferExisting(a.source, b.source);
  next.conversationKey = pickStringPreferExisting(a.conversationKey, b.conversationKey);

  next.title = titleFields.title;
  if (titleFields.autoTitle) next.autoTitle = titleFields.autoTitle;
  else delete next.autoTitle;
  next.titleManuallyEdited = titleFields.titleManuallyEdited;
  next.url = pickStringPreferExisting(a.url, b.url);
  next.author = pickStringPreferExisting(a.author, b.author);
  next.publishedAt = pickStringPreferExisting(a.publishedAt, b.publishedAt);
  next.warningFlags = mergeWarningFlags(a.warningFlags, b.warningFlags);

  // notionPageId: never overwrite a non-empty local mapping.
  next.notionPageId = pickStringPreferExisting(a.notionPageId, b.notionPageId);

  const aCaptured = Number(a.lastCapturedAt) || 0;
  const bCaptured = Number(b.lastCapturedAt) || 0;
  next.lastCapturedAt = Math.max(aCaptured, bCaptured, 0);

  return next;
}

function shouldPreferIncomingMessage(existing: UnknownRecord, incoming: UnknownRecord) {
  const a = existing && typeof existing === 'object' ? existing : {};
  const b = incoming && typeof incoming === 'object' ? incoming : {};
  const aUpdated = Number(a.updatedAt) || 0;
  const bUpdated = Number(b.updatedAt) || 0;
  if (bUpdated && bUpdated > aUpdated) return true;

  const aMd = a.contentMarkdown && String(a.contentMarkdown).trim() ? String(a.contentMarkdown) : '';
  const bMd = b.contentMarkdown && String(b.contentMarkdown).trim() ? String(b.contentMarkdown) : '';
  if (!aMd && bMd) return true;
  return false;
}

export function mergeMessageRecord(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  const a = existing && typeof existing === 'object' ? existing : {};
  const b = incoming && typeof incoming === 'object' ? incoming : {};

  const preferIncoming = shouldPreferIncomingMessage(a, b);
  const base = preferIncoming ? { ...a, ...b } : { ...b, ...a };

  const next: UnknownRecord = { ...base };
  next.role = pickStringPreferExisting(base.role, 'assistant') || 'assistant';
  next.contentText = String(next.contentText || '');
  next.contentMarkdown = String(next.contentMarkdown || '');

  const aUpdated = Number(a.updatedAt) || 0;
  const bUpdated = Number(b.updatedAt) || 0;
  const maxUpdated = Math.max(aUpdated, bUpdated, 0);
  next.updatedAt = maxUpdated || Date.now();

  const aSeq = Number(a.sequence);
  const bSeq = Number(b.sequence);
  if (Number.isFinite(bSeq)) next.sequence = bSeq;
  else if (Number.isFinite(aSeq)) next.sequence = aSeq;
  else next.sequence = 0;

  return next;
}

export function mergeSyncMappingRecord(existing: UnknownRecord, incoming: UnknownRecord): UnknownRecord {
  const a = existing && typeof existing === 'object' ? existing : {};
  const b = incoming && typeof incoming === 'object' ? incoming : {};

  const next: UnknownRecord = { ...a };
  next.source = pickStringPreferExisting(a.source, b.source);
  next.conversationKey = pickStringPreferExisting(a.conversationKey, b.conversationKey);

  // notionPageId: only fill when missing locally.
  next.notionPageId = pickStringPreferExisting(a.notionPageId, b.notionPageId);

  // cursor: prefer existing local value; only fill when missing locally.
  next.lastSyncedMessageKey = pickStringPreferExisting(a.lastSyncedMessageKey, b.lastSyncedMessageKey);
  const aSeq = Number(a.lastSyncedSequence);
  const bSeq = Number(b.lastSyncedSequence);
  if (Number.isFinite(aSeq)) next.lastSyncedSequence = aSeq;
  else if (Number.isFinite(bSeq)) next.lastSyncedSequence = bSeq;

  const chosenKey = pickStringPreferExisting(next.lastSyncedMessageKey, '');
  const chosenSeq = safeFiniteNumber(next.lastSyncedSequence);
  const existingKey = pickStringPreferExisting(a.lastSyncedMessageKey, '');
  const incomingKey = pickStringPreferExisting(b.lastSyncedMessageKey, '');
  const existingMatchesChosen = chosenKey
    ? existingKey === chosenKey
    : chosenSeq != null && Number.isFinite(aSeq) && aSeq === chosenSeq;
  const incomingMatchesChosen = chosenKey
    ? incomingKey === chosenKey
    : chosenSeq != null && Number.isFinite(bSeq) && bSeq === chosenSeq;

  const aAt = Number(a.lastSyncedAt);
  const bAt = Number(b.lastSyncedAt);
  if (Number.isFinite(aAt)) next.lastSyncedAt = aAt;
  else if (Number.isFinite(bAt)) next.lastSyncedAt = bAt;

  const aMessageUpdatedAt = safeFiniteNumber(a.lastSyncedMessageUpdatedAt);
  const bMessageUpdatedAt = safeFiniteNumber(b.lastSyncedMessageUpdatedAt);
  if (existingMatchesChosen && aMessageUpdatedAt != null) next.lastSyncedMessageUpdatedAt = aMessageUpdatedAt;
  else if (incomingMatchesChosen && bMessageUpdatedAt != null) next.lastSyncedMessageUpdatedAt = bMessageUpdatedAt;

  const aUpdated = Number(a.updatedAt) || 0;
  const bUpdated = Number(b.updatedAt) || 0;
  next.updatedAt = Math.max(aUpdated, bUpdated, 0);

  return next;
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
  const d: any = doc;
  if (!d || typeof d !== 'object') return { ok: false, error: 'Article comments index is not an object' };
  if (Number(d.schemaVersion) !== ARTICLE_COMMENTS_INDEX_SCHEMA_VERSION) {
    return { ok: false, error: 'Unsupported article comments schemaVersion' };
  }
  const comments = Array.isArray(d.comments) ? d.comments : null;
  if (!comments) return { ok: false, error: 'Missing article comments list' };

  for (const c of comments) {
    if (!c || typeof c !== 'object') return { ok: false, error: 'Invalid article comment item' };
    const commentId = Number(c.commentId);
    if (!Number.isFinite(commentId) || commentId <= 0) return { ok: false, error: 'Invalid article commentId' };

    const parentId = c.parentCommentId == null ? null : Number(c.parentCommentId);
    if (parentId != null && (!Number.isFinite(parentId) || parentId <= 0)) {
      return { ok: false, error: 'Invalid article parentCommentId' };
    }

    const uk = c.uniqueKey == null ? '' : String(c.uniqueKey || '').trim();
    if (uk && (!isNonEmptyString(uk) || !uk.includes('||'))) {
      return { ok: false, error: 'Invalid article comment uniqueKey' };
    }

    const canonicalUrl = String(c.canonicalUrl || '').trim();
    if (!isNonEmptyString(canonicalUrl)) return { ok: false, error: 'Invalid article comment canonicalUrl' };

    const commentText = String(c.commentText || '').trim();
    if (!isNonEmptyString(commentText)) return { ok: false, error: 'Invalid article comment commentText' };

    const createdAt = Number(c.createdAt);
    const updatedAt = Number(c.updatedAt);
    if (!Number.isFinite(createdAt) || createdAt < 0) return { ok: false, error: 'Invalid article comment createdAt' };
    if (!Number.isFinite(updatedAt) || updatedAt < 0) return { ok: false, error: 'Invalid article comment updatedAt' };
  }

  return { ok: true, error: '' };
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
