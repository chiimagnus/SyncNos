import { storageSet } from '../../platform/storage/local';
import {
  filterStorageForBackup,
  validateImageCacheIndexDocument,
  mergeConversationRecord,
  mergeMessageRecord,
  mergeSyncMappingRecord,
  uniqueConversationKey,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
  validateStorageLocalDocument,
} from './backup-utils';
import { openDb, reqToPromise, tx, txDone } from './idb';

type AnyRecord = Record<string, any>;

function parseContentType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split(';')[0]!.trim().toLowerCase();
}

function rewriteSyncnosAssetUrlsInMarkdown(markdown: string, remap: Map<number, number>): string {
  const raw = String(markdown || '');
  if (!raw || !remap.size) return raw;
  if (!raw.includes('syncnos-asset://')) return raw;
  return raw.replace(/syncnos-asset:\/\/(\d+)/gi, (full, idRaw) => {
    const oldId = Number(idRaw);
    if (!Number.isFinite(oldId) || oldId <= 0) return full;
    const nextId = remap.get(oldId);
    if (!nextId) return full;
    return `syncnos-asset://${nextId}`;
  });
}

export type ImportProgress = { done: number; total: number; stage: string };

export type ImportStats = {
  conversationsAdded: number;
  conversationsUpdated: number;
  messagesAdded: number;
  messagesUpdated: number;
  messagesSkipped: number;
  mappingsAdded: number;
  mappingsUpdated: number;
  settingsApplied: number;
};

function decodeUtf8(bytes: Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  return new TextDecoder('utf-8').decode(arr);
}

function readJsonEntry(entries: Map<string, Uint8Array>, name: string) {
  const bytes = entries.get(name);
  if (!bytes) throw new Error(`Missing entry: ${name}`);
  const text = decodeUtf8(bytes);
  return JSON.parse(text);
}

function makeStats(): ImportStats {
  return {
    conversationsAdded: 0,
    conversationsUpdated: 0,
    messagesAdded: 0,
    messagesUpdated: 0,
    messagesSkipped: 0,
    mappingsAdded: 0,
    mappingsUpdated: 0,
    settingsApplied: 0,
  };
}

export async function importBackupLegacyJsonMerge(
  doc: unknown,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportStats> {
  const validation = validateBackupDocument(doc);
  if (!validation.ok) throw new Error(validation.error || 'Invalid backup file.');

  const d: any = doc;
  const stores = d.stores || {};
  const backupConversations = Array.isArray(stores.conversations) ? stores.conversations : [];
  const backupMessages = Array.isArray(stores.messages) ? stores.messages : [];
  const backupMappings = Array.isArray(stores.sync_mappings) ? stores.sync_mappings : [];

  const filteredSettings = filterStorageForBackup(d.storageLocal || {});
  const settingsKeys = Object.keys(filteredSettings);

  const stats = makeStats();

  const totalWork =
    backupConversations.length +
    backupMessages.length +
    backupMappings.length +
    settingsKeys.length;
  const progress: ImportProgress = { done: 0, total: totalWork, stage: '' };
  const report = () => onProgress?.({ ...progress });
  const bump = (n: number, stage: string) => {
    progress.done += Number(n) || 0;
    if (stage) progress.stage = stage;
    report();
  };
  report();

  const backupConvoIdToUnique = new Map<number, string>();
  for (const c of backupConversations) {
    if (!c) continue;
    const uk = uniqueConversationKey(c);
    if (!uk) continue;
    const id = Number((c as any).id);
    if (Number.isFinite(id) && id > 0) backupConvoIdToUnique.set(id, uk);
  }

  const db = await openDb();
  const uniqueToLocalId = new Map<string, number>();

  // 1) Upsert conversations by (source, conversationKey).
  {
    const { t, stores: s } = tx(db, ['conversations'], 'readwrite');
    const idx = s.conversations.index('by_source_conversationKey');

    progress.stage = 'conversations';
    report();
    for (let i = 0; i < backupConversations.length; i += 1) {
      const incoming = backupConversations[i];
      if (!incoming) {
        bump(1, 'conversations');
        continue;
      }
      const source = incoming.source ? String(incoming.source) : '';
      const conversationKey = incoming.conversationKey ? String(incoming.conversationKey) : '';
      if (!source || !conversationKey) {
        bump(1, 'conversations');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
      const merged = mergeConversationRecord(existing, incoming);

      if (existing && existing.id) {
        merged.id = existing.id;
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.conversations.put(merged as any));
        stats.conversationsUpdated += 1;
        uniqueToLocalId.set(`${source}||${conversationKey}`, Number(existing.id));
      } else {
        // eslint-disable-next-line no-await-in-loop
        const id = await reqToPromise(s.conversations.add(merged as any) as any);
        stats.conversationsAdded += 1;
        uniqueToLocalId.set(`${source}||${conversationKey}`, Number(id));
      }

      bump(1, 'conversations');
    }

    await txDone(t);
  }

  // 2) Upsert messages by (localConversationId, messageKey).
  {
    const { t, stores: s } = tx(db, ['messages'], 'readwrite');
    const idx = s.messages.index('by_conversationId_messageKey');

    progress.stage = 'messages';
    report();
    for (let i = 0; i < backupMessages.length; i += 1) {
      const incoming = backupMessages[i];
      if (!incoming) {
        bump(1, 'messages');
        continue;
      }
      const backupConversationId = Number(incoming.conversationId);
      const messageKey = incoming.messageKey ? String(incoming.messageKey) : '';
      if (!Number.isFinite(backupConversationId) || backupConversationId <= 0 || !messageKey) {
        stats.messagesSkipped += 1;
        bump(1, 'messages');
        continue;
      }
      const uk = backupConvoIdToUnique.get(backupConversationId) || '';
      const localConversationId = uk ? uniqueToLocalId.get(uk) : null;
      if (!localConversationId) {
        stats.messagesSkipped += 1;
        bump(1, 'messages');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, messageKey]) as any);
      const base = { ...(incoming || {}), conversationId: localConversationId, messageKey };
      const merged = mergeMessageRecord(existing, base);
      merged.conversationId = localConversationId;
      merged.messageKey = messageKey;

      if (existing && existing.id) {
        merged.id = existing.id;
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.messages.put(merged as any));
        stats.messagesUpdated += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.messages.add(merged as any));
        stats.messagesAdded += 1;
      }

      if (i % 25 === 0) report();
      bump(1, 'messages');
    }

    await txDone(t);
  }

  // 3) Upsert sync mappings by (source, conversationKey) and fill missing convo.notionPageId.
  {
    const { t, stores: s } = tx(db, ['sync_mappings', 'conversations'], 'readwrite');
    const idx = s.sync_mappings.index('by_source_conversationKey');
    const convoIdx = s.conversations.index('by_source_conversationKey');

    progress.stage = 'mappings';
    report();
    for (let i = 0; i < backupMappings.length; i += 1) {
      const incoming = backupMappings[i];
      if (!incoming) {
        bump(1, 'mappings');
        continue;
      }
      const source = incoming.source ? String(incoming.source) : '';
      const conversationKey = incoming.conversationKey ? String(incoming.conversationKey) : '';
      if (!source || !conversationKey) {
        bump(1, 'mappings');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
      const merged = mergeSyncMappingRecord(existing, incoming);

      if (existing && existing.id) {
        merged.id = existing.id;
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.sync_mappings.put(merged as any));
        stats.mappingsUpdated += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.sync_mappings.add(merged as any));
        stats.mappingsAdded += 1;
      }

      const notionPageId = merged.notionPageId ? String(merged.notionPageId) : '';
      if (notionPageId) {
        // eslint-disable-next-line no-await-in-loop
        const convo: AnyRecord = await reqToPromise<AnyRecord>(convoIdx.get([source, conversationKey]) as any);
        if (convo && convo.id && (!convo.notionPageId || !String(convo.notionPageId).trim())) {
          convo.notionPageId = notionPageId;
          // eslint-disable-next-line no-await-in-loop
          await reqToPromise(s.conversations.put(convo));
        }
      }

      bump(1, 'mappings');
    }

    await txDone(t);
  }

  // 4) Apply non-sensitive chrome.storage.local settings (merge-only).
  progress.stage = 'settings';
  report();
  if (settingsKeys.length) {
    await storageSet(filteredSettings);
    stats.settingsApplied = settingsKeys.length;
    bump(settingsKeys.length, 'settings');
  }

  return stats;
}

export async function importBackupZipV2Merge(
  entries: Map<string, Uint8Array>,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportStats> {
  const manifest = readJsonEntry(entries, 'manifest.json');
  const manifestValidation = validateBackupManifest(manifest);
  if (!manifestValidation.ok) throw new Error(manifestValidation.error || 'Invalid manifest.json');

  const configPath = manifest && manifest.config ? String(manifest.config.storageLocalPath || '') : '';
  const configDoc = configPath ? readJsonEntry(entries, configPath) : null;
  if (!configDoc) throw new Error('Missing config/storage-local.json');
  const configValidation = validateStorageLocalDocument(configDoc);
  if (!configValidation.ok) throw new Error(configValidation.error || 'Invalid storage-local.json');

  const filteredSettings = filterStorageForBackup((configDoc as any).storageLocal || {});
  const settingsKeys = Object.keys(filteredSettings);

  const convoFiles: string[] = [];
  const sources = Array.isArray((manifest as any).sources) ? (manifest as any).sources : [];
  for (const group of sources) {
    const files = group && Array.isArray(group.files) ? group.files : [];
    for (const p of files) convoFiles.push(String(p || '').trim());
  }

  const imageCacheIndexPath =
    manifest && (manifest as any).assets ? String((manifest as any).assets.imageCacheIndexPath || '').trim() : '';
  const imageCacheIndexDoc =
    imageCacheIndexPath && entries.has(imageCacheIndexPath) ? readJsonEntry(entries, imageCacheIndexPath) : null;
  if (imageCacheIndexDoc) {
    const imageValidation = validateImageCacheIndexDocument(imageCacheIndexDoc);
    if (!imageValidation.ok) throw new Error(imageValidation.error || 'Invalid image cache index');
  }
  const imageCacheAssets: AnyRecord[] =
    imageCacheIndexDoc && Array.isArray((imageCacheIndexDoc as any).assets) ? (imageCacheIndexDoc as any).assets : [];

  const incomingConversations: AnyRecord[] = [];
  const messagesByUniqueKey = new Map<string, AnyRecord[]>();
  const incomingMappings: AnyRecord[] = [];
  const seenUnique = new Set<string>();
  let totalMessages = 0;

  for (const filePath of convoFiles) {
    if (!filePath) continue;
    const bundle = readJsonEntry(entries, filePath);
    const bundleValidation = validateConversationBundle(bundle);
    if (!bundleValidation.ok) {
      throw new Error(bundleValidation.error || `Invalid conversation bundle: ${filePath}`);
    }

    const convo = (bundle as any).conversation;
    const uk = uniqueConversationKey(convo);
    if (!uk) throw new Error(`Invalid conversation key: ${filePath}`);
    if (seenUnique.has(uk)) throw new Error('Duplicate conversation key in zip');
    seenUnique.add(uk);

    const msgs = Array.isArray((bundle as any).messages) ? (bundle as any).messages : [];
    messagesByUniqueKey.set(uk, msgs);
    totalMessages += msgs.length;

    incomingConversations.push(convo);
    if ((bundle as any).syncMapping) incomingMappings.push((bundle as any).syncMapping);
  }

  const stats = makeStats();
  const progress: ImportProgress = {
    done: 0,
    total: convoFiles.length + totalMessages + incomingMappings.length + settingsKeys.length,
    stage: '',
  };
  const report = () => onProgress?.({ ...progress });
  const bump = (delta: number, stage?: string) => {
    progress.done += delta;
    if (stage) progress.stage = stage;
  };

  const db = await openDb();
  const uniqueToLocalId = new Map<string, number>();

  // 1) Upsert conversations by (source, conversationKey).
  {
    const { t, stores: s } = tx(db, ['conversations'], 'readwrite');
    const idx = s.conversations.index('by_source_conversationKey');

    progress.stage = 'Conversations';
    report();
    for (let i = 0; i < incomingConversations.length; i += 1) {
      const incoming = incomingConversations[i];
      const source = incoming && incoming.source ? String(incoming.source) : '';
      const conversationKey = incoming && incoming.conversationKey ? String(incoming.conversationKey) : '';
      if (!source || !conversationKey) {
        bump(1, 'Conversations');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
      const merged = mergeConversationRecord(existing, incoming);
      merged.source = source;
      merged.conversationKey = conversationKey;

      const uk = uniqueConversationKey(merged);
      if (existing && existing.id) {
        merged.id = existing.id;
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.conversations.put(merged as any));
        uniqueToLocalId.set(uk, Number(existing.id));
        stats.conversationsUpdated += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        const id = await reqToPromise(s.conversations.add(merged as any) as any);
        uniqueToLocalId.set(uk, Number(id));
        stats.conversationsAdded += 1;
      }

      if (i % 20 === 0) report();
      bump(1, 'Conversations');
    }

    await txDone(t);
  }

  // 1.5) Restore image cache assets and rewrite incoming markdown asset urls.
  const assetIdRemap = new Map<number, number>();
  if (imageCacheAssets.length) {
    const { t, stores: s } = tx(db, ['image_cache'], 'readwrite');
    const idx = s.image_cache.index('by_conversationId_url');
    const now = Date.now();

    for (const asset of imageCacheAssets) {
      const assetId = Number(asset && asset.assetId);
      if (!Number.isFinite(assetId) || assetId <= 0) continue;
      const uniqueKey = asset && asset.uniqueKey ? String(asset.uniqueKey) : '';
      if (!uniqueKey.trim()) continue;
      const localConversationId = uniqueToLocalId.get(uniqueKey);
      if (!localConversationId) continue;

      const url = asset && asset.url ? String(asset.url) : '';
      if (!url.trim()) continue;

      const contentType = parseContentType(asset && asset.contentType ? asset.contentType : '');
      if (!contentType.startsWith('image/')) continue;

      const blobPath = asset && asset.blobPath ? String(asset.blobPath) : '';
      const bytes = blobPath ? entries.get(blobPath) : null;
      if (!bytes) continue;
      const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
      const byteSize = Number(asset.byteSize) || blob.size || 0;
      if (byteSize <= 0) continue;

      // eslint-disable-next-line no-await-in-loop
      const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, url.trim()]) as any);
      if (existing && existing.id) {
        const existingId = Number(existing.id);
        if (Number.isFinite(existingId) && existingId > 0) assetIdRemap.set(assetId, existingId);

        const existingBlob = (existing as any).blob as unknown;
        const existingSize =
          Number((existing as any).byteSize) ||
          (existingBlob instanceof Blob ? existingBlob.size : 0) ||
          0;
        if (existingBlob instanceof Blob && existingSize > 0) continue;

        const next = {
          ...existing,
          conversationId: localConversationId,
          url: url.trim(),
          blob,
          byteSize,
          contentType,
          createdAt: Number(existing.createdAt) || Number(asset.createdAt) || now,
          updatedAt: now,
        };
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.image_cache.put(next as any));
        continue;
      }

      const record = {
        conversationId: localConversationId,
        url: url.trim(),
        blob,
        byteSize,
        contentType,
        createdAt: Number(asset.createdAt) || now,
        updatedAt: now,
      };
      // eslint-disable-next-line no-await-in-loop
      const newId = await reqToPromise(s.image_cache.add(record as any) as any);
      const nextId = Number(newId);
      if (Number.isFinite(nextId) && nextId > 0) assetIdRemap.set(assetId, nextId);
    }

    await txDone(t);
  }

  if (assetIdRemap.size) {
    for (const [uk, list] of messagesByUniqueKey.entries()) {
      const msgs = Array.isArray(list) ? list : [];
      for (const msg of msgs) {
        if (!msg || typeof msg !== 'object') continue;
        const markdown = msg.contentMarkdown && String(msg.contentMarkdown).trim() ? String(msg.contentMarkdown) : '';
        if (!markdown) continue;
        const next = rewriteSyncnosAssetUrlsInMarkdown(markdown, assetIdRemap);
        if (next !== markdown) msg.contentMarkdown = next;
      }
      messagesByUniqueKey.set(uk, msgs);
    }
  }

  // 2) Upsert messages by (localConversationId, messageKey).
  {
    const { t, stores: s } = tx(db, ['messages'], 'readwrite');
    const idx = s.messages.index('by_conversationId_messageKey');

    progress.stage = 'Messages';
    report();
    let i = 0;
    for (const [uk, list] of messagesByUniqueKey.entries()) {
      const localConversationId = uniqueToLocalId.get(uk);
      if (!localConversationId) {
        i += Array.isArray(list) ? list.length : 0;
        bump(Array.isArray(list) ? list.length : 0, 'Messages');
        continue;
      }

      const msgs = Array.isArray(list) ? list : [];
      for (const incoming of msgs) {
        const messageKey = incoming && incoming.messageKey ? String(incoming.messageKey) : '';
        if (!messageKey) {
          stats.messagesSkipped += 1;
          bump(1, 'Messages');
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, messageKey]) as any);
        const base = { ...(incoming || {}), conversationId: localConversationId, messageKey };
        const merged = mergeMessageRecord(existing, base);
        merged.conversationId = localConversationId;
        merged.messageKey = messageKey;

        if (existing && existing.id) {
          merged.id = existing.id;
          // eslint-disable-next-line no-await-in-loop
          await reqToPromise(s.messages.put(merged as any));
          stats.messagesUpdated += 1;
        } else {
          // eslint-disable-next-line no-await-in-loop
          await reqToPromise(s.messages.add(merged as any));
          stats.messagesAdded += 1;
        }

        if (i % 40 === 0) report();
        i += 1;
        bump(1, 'Messages');
      }
    }

    await txDone(t);
  }

  // 3) Upsert sync mappings by (source, conversationKey) and fill missing convo.notionPageId.
  {
    const { t, stores: s } = tx(db, ['sync_mappings', 'conversations'], 'readwrite');
    const idx = s.sync_mappings.index('by_source_conversationKey');
    const convoIdx = s.conversations.index('by_source_conversationKey');

    progress.stage = 'Mappings';
    report();
    for (let i = 0; i < incomingMappings.length; i += 1) {
      const incoming = incomingMappings[i];
      const source = incoming && incoming.source ? String(incoming.source) : '';
      const conversationKey = incoming && incoming.conversationKey ? String(incoming.conversationKey) : '';
      if (!source || !conversationKey) {
        bump(1, 'Mappings');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
      const merged = mergeSyncMappingRecord(existing, incoming);
      merged.source = source;
      merged.conversationKey = conversationKey;

      if (existing && existing.id) {
        merged.id = existing.id;
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.sync_mappings.put(merged as any));
        stats.mappingsUpdated += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.sync_mappings.add(merged as any));
        stats.mappingsAdded += 1;
      }

      const notionPageId = merged.notionPageId ? String(merged.notionPageId) : '';
      if (notionPageId) {
        // eslint-disable-next-line no-await-in-loop
        const convo: AnyRecord = await reqToPromise<AnyRecord>(convoIdx.get([source, conversationKey]) as any);
        if (convo && convo.id && (!convo.notionPageId || !String(convo.notionPageId).trim())) {
          convo.notionPageId = notionPageId;
          // eslint-disable-next-line no-await-in-loop
          await reqToPromise(s.conversations.put(convo));
        }
      }

      bump(1, 'Mappings');
    }

    await txDone(t);
  }

  // 4) Apply non-sensitive chrome.storage.local settings (merge-only).
  progress.stage = 'Settings';
  report();
  if (settingsKeys.length) {
    await storageSet(filteredSettings);
    stats.settingsApplied = settingsKeys.length;
    bump(settingsKeys.length, 'Settings');
  }

  return stats;
}
