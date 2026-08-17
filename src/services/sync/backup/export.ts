import { DB_NAME, DB_VERSION } from '@platform/idb/schema';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import type { CommentArchiveSerializationWarning } from '@services/comments/domain/comment-archive';
import { LocalDataContractError, MAX_ZIP_STREAM_BYTES } from '@services/local-data/contracts';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import { BACKUP_ZIP_SCHEMA_VERSION, filterStorageForBackup } from '@services/sync/backup/backup-utils';
import { backupBytesForBlob, type BackupPortableFacts } from '@services/sync/backup/local-data';
import { createZipBlob } from '@services/sync/backup/zip-utils';

const IMAGE_CACHE_INDEX_PATH = 'assets/image-cache/index.json';
const IMAGE_CACHE_BLOBS_PREFIX = 'assets/image-cache/blobs/';
const ARTICLE_COMMENTS_INDEX_PATH = 'assets/article-comments/index.json';

type AnyRecord = Record<string, any>;

function sanitizeZipPathPart(input: unknown, fallback: string): string {
  const text = String(input || '').trim();
  if (!text) return fallback;
  const cleaned = text
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return !cleaned || cleaned === '.' || cleaned === '..' ? fallback : cleaned;
}

function csvCell(raw: unknown): string {
  const text = raw == null ? '' : String(raw);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function backupPayloadTooLarge(actualBytes: number): never {
  throw new LocalDataContractError('PAYLOAD_TOO_LARGE', {
    actualBytes,
    declaredBytes: actualBytes,
    limitBytes: MAX_ZIP_STREAM_BYTES,
    operation: 'zip-backup',
  });
}

function zipEntryDataByteLength(data: unknown): number {
  if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
  if (data instanceof Uint8Array) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  return new TextEncoder().encode(String(data == null ? '' : data)).byteLength;
}

function assertZipInputWithinLimit(files: readonly Readonly<{ data: unknown }>[]): void {
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += zipEntryDataByteLength(file.data);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ZIP_STREAM_BYTES) backupPayloadTooLarge(totalBytes);
  }
}

function extFromImageContentType(contentType: string): string {
  const value = String(contentType || '')
    .trim()
    .toLowerCase();
  if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
  if (value === 'image/png') return 'png';
  if (value === 'image/webp') return 'webp';
  if (value === 'image/gif') return 'gif';
  if (value === 'image/svg+xml') return 'svg';
  if (!value.startsWith('image/')) return 'bin';
  return value.slice('image/'.length).replace(/[^a-z0-9.+-]/g, '') || 'bin';
}

export type BackupZipV2ExportResult = {
  filename: string;
  blob: Blob;
  exportedAt: string;
  counts: {
    conversations: number;
    messages: number;
    sync_mappings: number;
    image_cache: number;
    article_comments: number;
  };
  warnings: CommentArchiveSerializationWarning[];
};

export type BackupZipV2ExportProgress = {
  stage: 'assemble_files' | 'zip' | 'finalize';
};

export async function buildBackupZipV2(
  input: Readonly<{
    facts: BackupPortableFacts;
    storageLocal: Record<string, unknown>;
    warnings?: readonly CommentArchiveSerializationWarning[];
    exportedAtMs?: number;
    onProgress?: (progress: BackupZipV2ExportProgress) => void;
  }>,
): Promise<BackupZipV2ExportResult> {
  const facts = input.facts;
  const storageLocal = filterStorageForBackup(input.storageLocal);
  const exportedAtMs = Number.isFinite(input.exportedAtMs) ? Number(input.exportedAtMs) : Date.now();
  const exportedAt = new Date(exportedAtMs).toISOString();
  const files: { name: string; data: unknown; lastModified?: unknown }[] = [];
  const manifestSources: { source: string; conversationCount: number; files: string[] }[] = [];
  const sourceBundles = new Map<string, typeof facts.bundles>();

  for (const bundle of facts.bundles) {
    const source = String(bundle.conversation?.source || '').trim();
    if (!source) continue;
    const list = sourceBundles.get(source) || [];
    list.push(bundle);
    sourceBundles.set(source, list);
  }

  const indexHeader = [
    'source',
    'conversationKey',
    'title',
    'url',
    'lastCapturedAt',
    'messageCount',
    'notionPageId',
    'hasNotionPageId',
    'filePath',
  ];
  const indexLines = [indexHeader.map(csvCell).join(',')];
  const usedPathsBySource = new Map<string, Set<string>>();

  input.onProgress?.({ stage: 'assemble_files' });
  for (const [source, bundles] of sourceBundles.entries()) {
    const safeSource = sanitizeZipPathPart(source.toLowerCase(), 'unknown');
    const used = usedPathsBySource.get(safeSource) || new Set<string>();
    usedPathsBySource.set(safeSource, used);
    const groupFiles: string[] = [];

    for (const bundle of bundles) {
      const conversation = bundle.conversation;
      const conversationKey = String(conversation?.conversationKey || '').trim();
      if (!conversationKey) continue;
      const basename = buildConversationBasename(conversation);
      const safeKeyBase = sanitizeZipPathPart(basename, 'conversation').slice(0, 140);
      let safeKey = safeKeyBase;
      let suffix = 2;
      let entryPath = `sources/${safeSource}/${safeKey}.json`;
      while (used.has(entryPath)) {
        safeKey = `${safeKeyBase}-${suffix++}`;
        entryPath = `sources/${safeSource}/${safeKey}.json`;
      }
      used.add(entryPath);

      files.push({ name: entryPath, data: JSON.stringify(bundle, null, 2), lastModified: exportedAt });
      groupFiles.push(entryPath);
      const mapping = bundle.syncMapping;
      const notionPageId = String(mapping?.notionPageId || conversation?.notionPageId || '');
      indexLines.push(
        [
          csvCell(source),
          csvCell(conversationKey),
          csvCell(conversation?.title || ''),
          csvCell(conversation?.url || ''),
          csvCell(conversation?.lastCapturedAt || ''),
          csvCell(bundle.messages.length),
          csvCell(notionPageId),
          csvCell(notionPageId ? 'true' : 'false'),
          csvCell(entryPath.replace(/^sources\//, '')),
        ].join(','),
      );
    }

    manifestSources.push({ source, conversationCount: groupFiles.length, files: groupFiles });
  }

  files.push({
    name: 'config/storage-local.json',
    data: JSON.stringify({ schemaVersion: 1, storageLocal }, null, 2),
    lastModified: exportedAt,
  });
  files.push({
    name: 'sources/conversations.csv',
    data: indexLines.join('\n'),
    lastModified: exportedAt,
  });

  const imageCacheAssets: AnyRecord[] = [];
  for (const asset of facts.imageAssets) {
    if (!asset.bytes || asset.bytes.byteLength <= 0) continue;
    const blobPath = `${IMAGE_CACHE_BLOBS_PREFIX}${asset.assetId}.${extFromImageContentType(asset.contentType)}`;
    files.push({
      name: blobPath,
      data: new Blob([backupBytesForBlob(asset.bytes)], { type: asset.contentType }),
      lastModified: exportedAt,
    });
    imageCacheAssets.push({
      assetId: asset.assetId,
      uniqueKey: asset.uniqueKey,
      url: asset.url,
      contentType: asset.contentType,
      byteSize: asset.bytes.byteLength,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      blobPath,
    });
  }

  files.push({
    name: IMAGE_CACHE_INDEX_PATH,
    data: JSON.stringify({ schemaVersion: 1, assets: imageCacheAssets }, null, 2),
    lastModified: exportedAt,
  });
  files.push({
    name: ARTICLE_COMMENTS_INDEX_PATH,
    data: JSON.stringify(facts.articleComments, null, 2),
    lastModified: exportedAt,
  });

  const counts = {
    conversations: facts.bundles.length,
    messages: facts.bundles.reduce((count, bundle) => count + bundle.messages.length, 0),
    sync_mappings: facts.bundles.reduce((count, bundle) => count + (bundle.syncMapping ? 1 : 0), 0),
    image_cache: imageCacheAssets.length,
    article_comments: facts.articleComments.comments.length,
  };
  const manifest = {
    backupSchemaVersion: BACKUP_ZIP_SCHEMA_VERSION,
    exportedAt,
    db: { name: DB_NAME, version: DB_VERSION },
    counts,
    config: { storageLocalPath: 'config/storage-local.json' },
    index: { conversationsCsvPath: 'sources/conversations.csv' },
    sources: manifestSources,
    assets: {
      imageCacheIndexPath: IMAGE_CACHE_INDEX_PATH,
      articleCommentsIndexPath: ARTICLE_COMMENTS_INDEX_PATH,
    },
  };
  files.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2), lastModified: exportedAt });
  assertZipInputWithinLimit(files);

  input.onProgress?.({ stage: 'zip' });
  const blob = await createZipBlob(files);
  if (blob.size > MAX_ZIP_STREAM_BYTES) backupPayloadTooLarge(blob.size);
  input.onProgress?.({ stage: 'finalize' });
  return {
    filename: `SyncNos-Backup-${buildLocalTimestampForFilename()}.zip`,
    blob,
    exportedAt,
    counts,
    warnings: [...(input.warnings || [])],
  };
}
