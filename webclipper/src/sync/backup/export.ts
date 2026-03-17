import { storageGetAll, storageSet } from '../../platform/storage/local';
import {
  BACKUP_ZIP_SCHEMA_VERSION,
  filterStorageForBackup,
  LAST_BACKUP_EXPORT_AT_STORAGE_KEY,
  uniqueConversationKey,
} from './backup-utils';
import { buildConversationBasename } from '../../conversations/domain/file-naming';
import { openDb, reqToPromise, tx, txDone } from './idb';
import { createZipBlob } from './zip-utils';
import { DB_NAME, DB_VERSION } from '../../platform/idb/schema.ts';
import { buildLocalTimestampForFilename } from '../../shared/file-timestamp';

type AnyRecord = Record<string, any>;

const IMAGE_CACHE_INDEX_PATH = 'assets/image-cache/index.json';
const IMAGE_CACHE_BLOBS_PREFIX = 'assets/image-cache/blobs/';

function sanitizeZipPathPart(input: unknown, fallback: string) {
  const text = String(input || '').trim();
  if (!text) return fallback;
  const cleaned = text
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned;
}

function csvCell(raw: unknown) {
  const text = raw == null ? '' : String(raw);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function stripLocalConversation(conversation: AnyRecord) {
  const c = conversation && typeof conversation === 'object' ? { ...conversation } : {};
  delete (c as any).id;
  return c;
}

function stripLocalMessage(message: AnyRecord) {
  const m = message && typeof message === 'object' ? { ...message } : {};
  delete (m as any).id;
  delete (m as any).conversationId;
  return m;
}

function stripLocalMapping(mapping: AnyRecord) {
  const m = mapping && typeof mapping === 'object' ? { ...mapping } : {};
  delete (m as any).id;
  return m;
}

function compareMessages(a: AnyRecord, b: AnyRecord) {
  const aSeq = Number(a && a.sequence);
  const bSeq = Number(b && b.sequence);
  if (Number.isFinite(aSeq) && Number.isFinite(bSeq) && aSeq !== bSeq) return aSeq - bSeq;
  const aAt = Number(a && a.updatedAt) || 0;
  const bAt = Number(b && b.updatedAt) || 0;
  if (aAt !== bAt) return aAt - bAt;
  const aKey = a && a.messageKey ? String(a.messageKey) : '';
  const bKey = b && b.messageKey ? String(b.messageKey) : '';
  return aKey.localeCompare(bKey);
}

function parseContentType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split(';')[0]!.trim().toLowerCase();
}

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
}

function base64ToBytes(base64: string): Uint8Array {
  const normalized = String(base64 || '').replace(/\s+/g, '');
  if (!normalized) return new Uint8Array();

  const atobFn = (globalThis as any).atob as ((input: string) => string) | undefined;
  if (typeof atobFn === 'function') {
    const binary = atobFn(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const bufferApi = (globalThis as any).Buffer as any;
  if (bufferApi && typeof bufferApi.from === 'function') {
    const nodeBuffer = bufferApi.from(normalized, 'base64');
    return new Uint8Array(nodeBuffer);
  }

  throw new Error('base64 decoder unavailable');
}

function utf8ToBytes(text: string): Uint8Array {
  const encoder = (globalThis as any).TextEncoder as (new () => TextEncoder) | undefined;
  if (encoder) {
    return new encoder().encode(String(text || ''));
  }
  const bufferApi = (globalThis as any).Buffer as any;
  if (bufferApi && typeof bufferApi.from === 'function') {
    const nodeBuffer = bufferApi.from(String(text || ''), 'utf8');
    return new Uint8Array(nodeBuffer);
  }
  const raw = String(text || '');
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i) & 0xff;
  return out;
}

function decodeDataImageUrlToBlob(dataUrl: string): Blob | null {
  const safeDataUrl = String(dataUrl || '').trim();
  if (!isDataImageUrl(safeDataUrl)) return null;

  const commaAt = safeDataUrl.indexOf(',');
  if (commaAt <= 0) return null;

  const meta = safeDataUrl.slice('data:'.length, commaAt).trim();
  const payload = safeDataUrl.slice(commaAt + 1);
  const metaParts = meta
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const contentType = parseContentType(metaParts[0] || '');
  if (!contentType.startsWith('image/')) return null;

  const isBase64 = metaParts.some((part) => part.toLowerCase() === 'base64');
  let bytes: Uint8Array;
  try {
    bytes = isBase64 ? base64ToBytes(payload) : utf8ToBytes(decodeURIComponent(payload));
  } catch (_e) {
    return null;
  }

  if ((bytes.byteLength || 0) <= 0) return null;
  return new Blob([Uint8Array.from(bytes)], { type: contentType });
}

function extFromImageContentType(contentType: string): string {
  const ct = String(contentType || '').trim().toLowerCase();
  if (!ct.startsWith('image/')) return 'bin';
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/jpg') return 'jpg';
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/svg+xml') return 'svg';
  const raw = ct.slice('image/'.length);
  const cleaned = raw.replace(/[^a-z0-9.+-]/g, '');
  return cleaned || 'bin';
}

export type BackupZipV2ExportResult = {
  filename: string;
  blob: Blob;
  exportedAt: string;
  counts: { conversations: number; messages: number; sync_mappings: number };
};

export async function exportBackupZipV2(): Promise<BackupZipV2ExportResult> {
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'messages', 'sync_mappings', 'image_cache'], 'readonly');
  const conversations = (await reqToPromise(stores.conversations.getAll() as any)) as AnyRecord[];
  const messages = (await reqToPromise(stores.messages.getAll() as any)) as AnyRecord[];
  const syncMappings = (await reqToPromise(stores.sync_mappings.getAll() as any)) as AnyRecord[];
  const imageCache = (await reqToPromise(stores.image_cache.getAll() as any)) as AnyRecord[];
  await txDone(t);

  const rawStorage = await storageGetAll();
  const storageLocal = filterStorageForBackup(rawStorage);

  const exportedAtMs = Date.now();
  const exportedAt = new Date(exportedAtMs).toISOString();

  const allConversations = Array.isArray(conversations) ? conversations : [];
  const allMessages = Array.isArray(messages) ? messages : [];
  const allMappings = Array.isArray(syncMappings) ? syncMappings : [];
  const allImageCache = Array.isArray(imageCache) ? imageCache : [];

  const messagesByConversationId = new Map<number, AnyRecord[]>();
  for (const m of allMessages) {
    const cid = Number(m && m.conversationId);
    if (!Number.isFinite(cid) || cid <= 0) continue;
    const list = messagesByConversationId.get(cid) || [];
    list.push(m);
    messagesByConversationId.set(cid, list);
  }

  const mappingByUniqueKey = new Map<string, AnyRecord>();
  for (const m of allMappings) {
    if (!m || typeof m !== 'object') continue;
    const uk = uniqueConversationKey(m);
    if (!uk) continue;
    const existing = mappingByUniqueKey.get(uk) || null;
    if (!existing) {
      mappingByUniqueKey.set(uk, m);
      continue;
    }
    const aUpdated = Number(existing.updatedAt) || 0;
    const bUpdated = Number(m.updatedAt) || 0;
    if (bUpdated > aUpdated) mappingByUniqueKey.set(uk, m);
  }

  const sources = new Map<string, AnyRecord[]>();
  for (const c of allConversations) {
    if (!c || typeof c !== 'object') continue;
    const source = c.source ? String(c.source) : '';
    if (!source) continue;
    const list = sources.get(source) || [];
    list.push(c);
    sources.set(source, list);
  }

  const files: { name: string; data: unknown; lastModified?: unknown }[] = [];
  const manifestSources: { source: string; conversationCount: number; files: string[] }[] = [];

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

  const uniqueKeyByConversationId = new Map<number, string>();
  for (const c of allConversations) {
    const cid = Number(c && c.id);
    if (!Number.isFinite(cid) || cid <= 0) continue;
    const uk = uniqueConversationKey(c);
    if (!uk) continue;
    uniqueKeyByConversationId.set(cid, uk);
  }

  for (const [source, convos] of sources.entries()) {
    const safeSource = sanitizeZipPathPart(source.toLowerCase(), 'unknown');
    const used = usedPathsBySource.get(safeSource) || new Set<string>();
    usedPathsBySource.set(safeSource, used);

    const groupFiles: string[] = [];
    for (const c of convos) {
      const conversationKey = c && c.conversationKey ? String(c.conversationKey) : '';
      if (!conversationKey) continue;

      const basename = buildConversationBasename(c);
      const safeKeyBase = sanitizeZipPathPart(basename, 'conversation').slice(0, 140);
      let safeKey = safeKeyBase;
      let suffix = 2;
      let entryPath = `sources/${safeSource}/${safeKey}.json`;
      while (used.has(entryPath)) {
        safeKey = `${safeKeyBase}-${suffix}`;
        entryPath = `sources/${safeSource}/${safeKey}.json`;
        suffix += 1;
      }
      used.add(entryPath);

      const cid = Number(c && c.id);
      const rawMsgs = Number.isFinite(cid) && cid > 0 ? messagesByConversationId.get(cid) || [] : [];
      const msgs = rawMsgs.slice().sort(compareMessages).map(stripLocalMessage);

      const uk = uniqueConversationKey(c);
      const mapping = uk ? mappingByUniqueKey.get(uk) || null : null;
      const safeConversation = stripLocalConversation(c);
      const safeMapping = mapping ? stripLocalMapping(mapping) : null;

      const bundle = {
        schemaVersion: 1,
        conversation: safeConversation,
        messages: msgs,
        syncMapping: safeMapping,
      };

      files.push({ name: entryPath, data: JSON.stringify(bundle, null, 2), lastModified: exportedAt });
      groupFiles.push(entryPath);

      const notionPageId =
        safeMapping && safeMapping.notionPageId
          ? String(safeMapping.notionPageId)
          : safeConversation.notionPageId
            ? String(safeConversation.notionPageId)
            : '';
      const hasNotionPageId = notionPageId ? 'true' : 'false';

      indexLines.push(
        [
          csvCell(source),
          csvCell(conversationKey),
          csvCell(safeConversation.title || ''),
          csvCell(safeConversation.url || ''),
          csvCell(safeConversation.lastCapturedAt || ''),
          csvCell(msgs.length),
          csvCell(notionPageId),
          csvCell(hasNotionPageId),
          csvCell(entryPath.replace(/^sources\//, '')),
        ].join(','),
      );
    }

    manifestSources.push({
      source,
      conversationCount: groupFiles.length,
      files: groupFiles,
    });
  }

  const storageDoc = { schemaVersion: 1, storageLocal };
  files.push({
    name: 'config/storage-local.json',
    data: JSON.stringify(storageDoc, null, 2),
    lastModified: exportedAt,
  });
  files.push({
    name: 'sources/conversations.csv',
    data: indexLines.join('\n'),
    lastModified: exportedAt,
  });

  const imageCacheAssets: AnyRecord[] = [];
  for (const row of allImageCache) {
    const assetId = Number(row && row.id);
    if (!Number.isFinite(assetId) || assetId <= 0) continue;
    const conversationId = Number(row && row.conversationId);
    if (!Number.isFinite(conversationId) || conversationId <= 0) continue;
    const uniqueKey = uniqueKeyByConversationId.get(conversationId) || '';
    if (!uniqueKey) continue;

    const url = row && row.url ? String(row.url) : '';
    if (!url.trim()) continue;

    let blob: Blob | null = null;
    if (row && row.blob instanceof Blob) blob = row.blob;
    else if (row && typeof row.dataUrl === 'string') blob = decodeDataImageUrlToBlob(row.dataUrl);
    if (!blob) continue;

    const contentType = parseContentType(row.contentType || blob.type);
    if (!contentType.startsWith('image/')) continue;

    const byteSize = Number(row.byteSize) || blob.size || 0;
    if (byteSize <= 0) continue;

    const ext = extFromImageContentType(contentType);
    const blobPath = `${IMAGE_CACHE_BLOBS_PREFIX}${assetId}.${ext}`;

    files.push({ name: blobPath, data: blob, lastModified: exportedAt });
    imageCacheAssets.push({
      assetId,
      uniqueKey,
      url,
      contentType,
      byteSize,
      createdAt: Number(row.createdAt) || 0,
      updatedAt: Number(row.updatedAt) || 0,
      blobPath,
    });
  }

  const imageCacheIndexDoc = { schemaVersion: 1, assets: imageCacheAssets };
  files.push({
    name: IMAGE_CACHE_INDEX_PATH,
    data: JSON.stringify(imageCacheIndexDoc, null, 2),
    lastModified: exportedAt,
  });

  const manifest = {
    backupSchemaVersion: BACKUP_ZIP_SCHEMA_VERSION,
    exportedAt,
    db: { name: DB_NAME, version: DB_VERSION },
    counts: {
      conversations: allConversations.length,
      messages: allMessages.length,
      sync_mappings: allMappings.length,
      image_cache: imageCacheAssets.length,
    },
    config: { storageLocalPath: 'config/storage-local.json' },
    index: { conversationsCsvPath: 'sources/conversations.csv' },
    sources: manifestSources,
    assets: { imageCacheIndexPath: IMAGE_CACHE_INDEX_PATH },
  };
  files.unshift({
    name: 'manifest.json',
    data: JSON.stringify(manifest, null, 2),
    lastModified: exportedAt,
  });

  const stamp = buildLocalTimestampForFilename();
  const filename = `SyncNos-Backup-${stamp}.zip`;
  const blob = await createZipBlob(files);

  try {
    await storageSet({ [LAST_BACKUP_EXPORT_AT_STORAGE_KEY]: exportedAtMs });
  } catch (_e) {
    // non-fatal
  }

  return {
    filename,
    blob,
    exportedAt,
    counts: manifest.counts,
  };
}
