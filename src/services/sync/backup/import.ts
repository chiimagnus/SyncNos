import {
  ARTICLE_COMMENT_ARCHIVE_CURRENT_SCHEMA,
  validateArticleCommentArchiveDocument,
  type ArticleCommentsArchiveDocument,
} from '@services/comments/domain/comment-archive';
import {
  filterStorageForBackupImport,
  mergeSyncMappingRecord,
  normalizeImageContentType,
  uniqueConversationKey,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
  validateImageCacheIndexDocument,
  validateStorageLocalDocument,
} from '@services/sync/backup/backup-utils';
import {
  BACKUP_PORTABLE_FACTS_VERSION,
  type BackupPortableBundle,
  type BackupPortableFacts,
  type BackupPortableImageAsset,
  type BackupRecord,
} from '@services/sync/backup/local-data';

export type { ImportProgress, ImportStats } from '@services/sync/backup/local-data';

export type ParsedBackupImport = Readonly<{
  facts: BackupPortableFacts;
  storageLocal: Record<string, unknown>;
  preSkippedMessages: number;
}>;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes instanceof Uint8Array ? bytes : new Uint8Array());
}

function readJsonEntry(entries: Map<string, Uint8Array>, name: string): unknown {
  const bytes = entries.get(name);
  if (!bytes) throw new Error(`Missing entry: ${name}`);
  return JSON.parse(decodeUtf8(bytes));
}

function stripLocalConversation(record: BackupRecord): BackupRecord {
  const value = { ...record };
  delete value.id;
  return value;
}

function stripLocalMessage(record: BackupRecord): BackupRecord {
  const value = { ...record };
  delete value.id;
  delete value.conversationId;
  return value;
}

function stripLocalMapping(record: BackupRecord): BackupRecord {
  const value = { ...record };
  delete value.id;
  return value;
}

function emptyComments(): ArticleCommentsArchiveDocument {
  return { schemaVersion: ARTICLE_COMMENT_ARCHIVE_CURRENT_SCHEMA, comments: [] };
}

export function parseBackupLegacyJson(doc: unknown): ParsedBackupImport {
  const validation = validateBackupDocument(doc);
  if (!validation.ok) throw new Error(validation.error || 'Invalid backup file.');
  const input = doc as any;
  const stores = input.stores || {};
  const conversations: BackupRecord[] = Array.isArray(stores.conversations) ? stores.conversations : [];
  const messages: BackupRecord[] = Array.isArray(stores.messages) ? stores.messages : [];
  const mappings: BackupRecord[] = Array.isArray(stores.sync_mappings) ? stores.sync_mappings : [];

  const uniqueKeyByLegacyId = new Map<number, string>();
  const bundleByUniqueKey = new Map<string, BackupPortableBundle>();
  for (const conversation of conversations) {
    const uniqueKey = uniqueConversationKey(conversation);
    if (!uniqueKey) continue;
    const id = Number(conversation.id);
    if (Number.isSafeInteger(id) && id > 0) uniqueKeyByLegacyId.set(id, uniqueKey);
    bundleByUniqueKey.set(uniqueKey, {
      schemaVersion: 1,
      conversation: stripLocalConversation(conversation),
      messages: [],
      syncMapping: null,
    });
  }

  let preSkippedMessages = 0;
  for (const message of messages) {
    const uniqueKey = uniqueKeyByLegacyId.get(Number(message?.conversationId));
    const bundle = uniqueKey ? bundleByUniqueKey.get(uniqueKey) : null;
    if (!bundle) {
      preSkippedMessages += 1;
      continue;
    }
    bundle.messages.push(stripLocalMessage(message));
  }

  const looseMappings: BackupRecord[] = [];
  for (const mapping of mappings) {
    const uniqueKey = uniqueConversationKey(mapping);
    if (!uniqueKey) continue;
    const bundle = bundleByUniqueKey.get(uniqueKey);
    if (!bundle) {
      looseMappings.push(stripLocalMapping(mapping));
      continue;
    }
    const incoming = stripLocalMapping(mapping);
    (bundle as { syncMapping: BackupRecord | null }).syncMapping = bundle.syncMapping
      ? (mergeSyncMappingRecord(bundle.syncMapping, incoming) as BackupRecord)
      : incoming;
  }

  const bundles = [...bundleByUniqueKey.values()];
  for (const bundle of bundles) {
    const bundleValidation = validateConversationBundle(bundle);
    if (!bundleValidation.ok) throw new Error(bundleValidation.error || 'Invalid legacy conversation bundle');
  }

  return {
    facts: {
      version: BACKUP_PORTABLE_FACTS_VERSION,
      bundles,
      looseMappings,
      imageCacheMode: 'absent',
      imageAssets: [],
      articleComments: emptyComments(),
    },
    storageLocal: filterStorageForBackupImport(input.storageLocal || {}),
    preSkippedMessages,
  };
}

export function parseBackupZipV2(entries: Map<string, Uint8Array>): ParsedBackupImport {
  const manifest = readJsonEntry(entries, 'manifest.json') as any;
  const manifestValidation = validateBackupManifest(manifest);
  if (!manifestValidation.ok) throw new Error(manifestValidation.error || 'Invalid manifest.json');

  const configPath = manifest?.config ? String(manifest.config.storageLocalPath || '') : '';
  const configDoc = configPath ? (readJsonEntry(entries, configPath) as any) : null;
  if (!configDoc) throw new Error('Missing config/storage-local.json');
  const configValidation = validateStorageLocalDocument(configDoc);
  if (!configValidation.ok) throw new Error(configValidation.error || 'Invalid storage-local.json');
  const storageLocal = filterStorageForBackupImport(configDoc.storageLocal || {});

  const declaredBundlePaths: string[] = [];
  for (const group of Array.isArray(manifest.sources) ? manifest.sources : []) {
    for (const path of Array.isArray(group?.files) ? group.files : [])
      declaredBundlePaths.push(String(path || '').trim());
  }

  const bundles: BackupPortableBundle[] = [];
  const seenUniqueKeys = new Set<string>();
  const loadedBundleEntryNames = new Set<string>();
  const missingBundleEntryNames: string[] = [];

  const addBundle = (bundle: any, path: string) => {
    const validation = validateConversationBundle(bundle);
    if (!validation.ok) throw new Error(validation.error || `Invalid conversation bundle: ${path}`);
    const uniqueKey = uniqueConversationKey(bundle.conversation);
    if (!uniqueKey) throw new Error(`Invalid conversation key: ${path}`);
    if (seenUniqueKeys.has(uniqueKey)) throw new Error('Duplicate conversation key in zip');
    seenUniqueKeys.add(uniqueKey);
    bundles.push({
      schemaVersion: 1,
      conversation: { ...bundle.conversation },
      messages: bundle.messages.map((message: BackupRecord) => ({ ...message })),
      syncMapping: bundle.syncMapping ? { ...bundle.syncMapping } : null,
    });
  };

  for (const filePath of declaredBundlePaths) {
    if (!filePath) continue;
    const bytes = entries.get(filePath);
    if (!bytes) {
      missingBundleEntryNames.push(filePath);
      continue;
    }
    loadedBundleEntryNames.add(filePath);
    addBundle(JSON.parse(decodeUtf8(bytes)), filePath);
  }

  if (missingBundleEntryNames.length) {
    const candidates = [...entries.keys()].filter(
      (name) => name.startsWith('sources/') && name.endsWith('.json') && !loadedBundleEntryNames.has(name),
    );
    for (const name of candidates) {
      const bytes = entries.get(name);
      if (!bytes) continue;
      let bundle: any;
      try {
        bundle = JSON.parse(decodeUtf8(bytes));
      } catch {
        continue;
      }
      const validation = validateConversationBundle(bundle);
      if (!validation.ok) continue;
      addBundle(bundle, name);
    }
  }

  const imageCacheIndexPath = manifest?.assets ? String(manifest.assets.imageCacheIndexPath || '').trim() : '';
  const imageIndexDeclared = Boolean(imageCacheIndexPath);
  const imageIndexMissing = imageIndexDeclared && !entries.has(imageCacheIndexPath);
  const imageAssets: BackupPortableImageAsset[] = [];
  if (imageIndexDeclared && !imageIndexMissing) {
    const imageIndexDoc = readJsonEntry(entries, imageCacheIndexPath) as any;
    const imageValidation = validateImageCacheIndexDocument(imageIndexDoc);
    if (!imageValidation.ok) throw new Error(imageValidation.error || 'Invalid image cache index');
    for (const asset of Array.isArray(imageIndexDoc.assets) ? imageIndexDoc.assets : []) {
      const bytes = entries.get(String(asset.blobPath || '')) || null;
      const contentType = normalizeImageContentType(asset.contentType || '');
      imageAssets.push({
        assetId: Number(asset.assetId),
        uniqueKey: String(asset.uniqueKey || ''),
        url: String(asset.url || ''),
        contentType,
        byteSize: bytes ? bytes.byteLength : Number(asset.byteSize) || 0,
        createdAt: Number(asset.createdAt) || 0,
        updatedAt: Number(asset.updatedAt) || 0,
        bytes,
      });
    }
  }

  const articleCommentsIndexPath = manifest?.assets
    ? String(manifest.assets.articleCommentsIndexPath || '').trim()
    : '';
  const articleCommentsDoc =
    articleCommentsIndexPath && entries.has(articleCommentsIndexPath)
      ? readJsonEntry(entries, articleCommentsIndexPath)
      : emptyComments();
  const commentValidation = validateArticleCommentArchiveDocument(articleCommentsDoc);
  if (!commentValidation.ok || !commentValidation.document) {
    throw new Error(commentValidation.error || 'Invalid article comments index');
  }

  return {
    facts: {
      version: BACKUP_PORTABLE_FACTS_VERSION,
      bundles,
      looseMappings: [],
      imageCacheMode: imageIndexMissing ? 'missing-index' : imageIndexDeclared ? 'indexed' : 'absent',
      imageAssets,
      articleComments: commentValidation.document,
    },
    storageLocal,
    preSkippedMessages: 0,
  };
}
