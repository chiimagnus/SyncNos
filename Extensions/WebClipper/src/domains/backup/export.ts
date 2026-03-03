import { storageGetAll } from '../../platform/storage/local';
import {
  BACKUP_ZIP_SCHEMA_VERSION,
  filterStorageForBackup,
  uniqueConversationKey,
} from './backup-utils';
import { buildConversationBasename } from '../conversations/file-naming';
import { openDb, reqToPromise, tx, txDone } from './idb';
import { createZipBlob } from './zip-utils';
import runtimeContext from '../../runtime-context.ts';

type AnyRecord = Record<string, any>;

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

export type BackupZipV2ExportResult = {
  filename: string;
  blob: Blob;
  exportedAt: string;
  counts: { conversations: number; messages: number; sync_mappings: number };
};

export async function exportBackupZipV2(): Promise<BackupZipV2ExportResult> {
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'messages', 'sync_mappings'], 'readonly');
  const conversations = (await reqToPromise(stores.conversations.getAll() as any)) as AnyRecord[];
  const messages = (await reqToPromise(stores.messages.getAll() as any)) as AnyRecord[];
  const syncMappings = (await reqToPromise(stores.sync_mappings.getAll() as any)) as AnyRecord[];
  await txDone(t);

  const rawStorage = await storageGetAll();
  const storageLocal = filterStorageForBackup(rawStorage);

  const exportedAt = new Date().toISOString();

  const allConversations = Array.isArray(conversations) ? conversations : [];
  const allMessages = Array.isArray(messages) ? messages : [];
  const allMappings = Array.isArray(syncMappings) ? syncMappings : [];

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
          csvCell(entryPath),
        ].join(','),
      );
    }

    manifestSources.push({
      source,
      conversationCount: groupFiles.length,
      files: groupFiles,
    });
  }

  const schema = runtimeContext.storageSchema || {};

  const storageDoc = { schemaVersion: 1, storageLocal };
  files.push({
    name: 'config/storage-local.json',
    data: JSON.stringify(storageDoc, null, 2),
    lastModified: exportedAt,
  });
  files.push({
    name: 'index/conversations.csv',
    data: indexLines.join('\n'),
    lastModified: exportedAt,
  });

  const manifest = {
    backupSchemaVersion: BACKUP_ZIP_SCHEMA_VERSION,
    exportedAt,
    db: { name: schema.DB_NAME || 'webclipper', version: schema.DB_VERSION || 3 },
    counts: {
      conversations: allConversations.length,
      messages: allMessages.length,
      sync_mappings: allMappings.length,
    },
    config: { storageLocalPath: 'config/storage-local.json' },
    index: { conversationsCsvPath: 'index/conversations.csv' },
    sources: manifestSources,
  };
  files.unshift({
    name: 'manifest.json',
    data: JSON.stringify(manifest, null, 2),
    lastModified: exportedAt,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `webclipper-db-backup-${stamp}.zip`;
  const blob = await createZipBlob(files);

  return {
    filename,
    blob,
    exportedAt,
    counts: manifest.counts,
  };
}
