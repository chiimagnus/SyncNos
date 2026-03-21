import { storageSet } from '../../platform/storage/local';
import {
  filterStorageForBackup,
  validateImageCacheIndexDocument,
  validateArticleCommentsIndexDocument,
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

const SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function isHttpUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  return /^https?:\/\//i.test(text);
}

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
}

function normalizeFallbackImageUrl(url: unknown): string {
  const text = String(url || '').trim();
  if (!text) return SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC;
  if (isHttpUrl(text) || isDataImageUrl(text)) return text;
  return SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC;
}

function rewriteSyncnosAssetUrlsInMarkdown(
  markdown: string,
  input: {
    remap: Map<number, number>;
    fallbackUrlByOldId: Map<number, string>;
    defaultUrl?: string;
  },
): string {
  const raw = String(markdown || '');
  if (!raw) return raw;
  if (!raw.includes('syncnos-asset://')) return raw;
  const remap = input.remap;
  const fallbackUrlByOldId = input.fallbackUrlByOldId;
  const defaultUrl = normalizeFallbackImageUrl(input.defaultUrl || SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC);
  return raw.replace(/syncnos-asset:\/\/(\d+)/gi, (full, idRaw) => {
    const oldId = Number(idRaw);
    if (!Number.isFinite(oldId) || oldId <= 0) return full;
    const nextId = remap.get(oldId);
    if (nextId) return `syncnos-asset://${nextId}`;
    const fallback = fallbackUrlByOldId.get(oldId);
    if (fallback) return fallback;
    return defaultUrl;
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
  commentsAdded: number;
  commentsUpdated: number;
  commentsSkipped: number;
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
    commentsAdded: 0,
    commentsUpdated: 0,
    commentsSkipped: 0,
    settingsApplied: 0,
  };
}

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function normalizeHttpUrl(raw: unknown): string {
  const text = safeString(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = safeString(url.protocol).toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function commentBaseKey(input: {
  canonicalUrl: string;
  createdAt: number;
  quoteText: string;
  commentText: string;
}): string {
  return [
    safeString(input.canonicalUrl),
    String(Number(input.createdAt) || 0),
    String(input.quoteText || ''),
    String(input.commentText || ''),
  ].join('||');
}

function commentFingerprint(input: { baseKey: string; parentBaseKey: string }): string {
  return `${input.baseKey}||parent=${input.parentBaseKey || ''}`;
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
  const imageCacheIndexDeclared = Boolean(imageCacheIndexPath);
  const imageCacheIndexMissing = imageCacheIndexDeclared && !entries.has(imageCacheIndexPath);
  const imageCacheIndexDoc =
    imageCacheIndexPath && !imageCacheIndexMissing ? readJsonEntry(entries, imageCacheIndexPath) : null;
  if (imageCacheIndexDoc) {
    const imageValidation = validateImageCacheIndexDocument(imageCacheIndexDoc);
    if (!imageValidation.ok) throw new Error(imageValidation.error || 'Invalid image cache index');
  }
  const imageCacheAssets: AnyRecord[] =
    imageCacheIndexDoc && Array.isArray((imageCacheIndexDoc as any).assets) ? (imageCacheIndexDoc as any).assets : [];

  const articleCommentsIndexPath =
    manifest && (manifest as any).assets ? String((manifest as any).assets.articleCommentsIndexPath || '').trim() : '';
  const articleCommentsDeclared = Boolean(articleCommentsIndexPath);
  const articleCommentsMissing = articleCommentsDeclared && !entries.has(articleCommentsIndexPath);
  const articleCommentsIndexDoc =
    articleCommentsIndexPath && !articleCommentsMissing ? readJsonEntry(entries, articleCommentsIndexPath) : null;
  if (articleCommentsIndexDoc) {
    const commentsValidation = validateArticleCommentsIndexDocument(articleCommentsIndexDoc);
    if (!commentsValidation.ok) throw new Error(commentsValidation.error || 'Invalid article comments index');
  }
  const articleCommentItems: AnyRecord[] =
    articleCommentsIndexDoc && Array.isArray((articleCommentsIndexDoc as any).comments)
      ? (articleCommentsIndexDoc as any).comments
      : [];

  const incomingConversations: AnyRecord[] = [];
  const messagesByUniqueKey = new Map<string, AnyRecord[]>();
  const incomingMappings: AnyRecord[] = [];
  const seenUnique = new Set<string>();
  let totalMessages = 0;

  const loadedBundleEntryNames = new Set<string>();
  const missingBundleEntryNames: string[] = [];

  for (const filePath of convoFiles) {
    if (!filePath) continue;
    // Resilience: some user-edited / corrupted zips may have a manifest that references missing bundles.
    // Prefer importing the rest of the backup instead of hard-failing the entire import.
    const bundleBytes = entries.get(filePath);
    if (!bundleBytes) {
      missingBundleEntryNames.push(filePath);
      continue;
    }
    loadedBundleEntryNames.add(filePath);
    const bundle = JSON.parse(decodeUtf8(bundleBytes));
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

  // Backward-compat resilience: older backup zips may have non-ASCII bundle filenames encoded without the UTF-8 flag,
  // which makes unzip libraries decode entry names as mojibake. In that case, manifest-declared paths won't match
  // the actual zip entry names, so we would incorrectly skip most bundles.
  //
  // If the manifest references missing bundles, fall back to scanning all `sources/**/*.json` entries that validate
  // as conversation bundles.
  if (missingBundleEntryNames.length) {
    const fallbackCandidates: string[] = [];
    for (const name of entries.keys()) {
      if (!name) continue;
      if (!name.startsWith('sources/')) continue;
      if (!name.endsWith('.json')) continue;
      if (loadedBundleEntryNames.has(name)) continue;
      fallbackCandidates.push(name);
    }

    for (const name of fallbackCandidates) {
      const bytes = entries.get(name);
      if (!bytes) continue;
      let bundle: any;
      try {
        bundle = JSON.parse(decodeUtf8(bytes));
      } catch (_e) {
        continue;
      }
      const bundleValidation = validateConversationBundle(bundle);
      if (!bundleValidation.ok) continue;

      const convo = bundle.conversation;
      const uk = uniqueConversationKey(convo);
      if (!uk) continue;
      if (seenUnique.has(uk)) throw new Error('Duplicate conversation key in zip');
      seenUnique.add(uk);

      const msgs = Array.isArray(bundle.messages) ? bundle.messages : [];
      messagesByUniqueKey.set(uk, msgs);
      totalMessages += msgs.length;

      incomingConversations.push(convo);
      if (bundle.syncMapping) incomingMappings.push(bundle.syncMapping);
    }
  }

  const stats = makeStats();
  const progress: ImportProgress = {
    done: 0,
    total:
      incomingConversations.length +
      totalMessages +
      incomingMappings.length +
      settingsKeys.length +
      imageCacheAssets.length +
      articleCommentItems.length,
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

  // 1.25) Restore article comments (merge-only, dedupe by fingerprint).
  if (articleCommentItems.length) {
    const normalizedIncoming: Array<{
      commentId: number;
      parentCommentId: number | null;
      uniqueKey: string;
      canonicalUrl: string;
      quoteText: string;
      commentText: string;
      createdAt: number;
      updatedAt: number;
      baseKey: string;
      parentBaseKey: string;
      fingerprint: string;
    }> = [];

    const incomingById = new Map<number, any>();
    const baseKeyByIncomingId = new Map<number, string>();
    const canonicalUrls = new Set<string>();
    let commentProgressTick = 0;

    for (const raw of articleCommentItems) {
      const commentId = Number(raw && (raw as any).commentId);
      if (!Number.isFinite(commentId) || commentId <= 0) {
        stats.commentsSkipped += 1;
        bump(1, 'Comments');
        commentProgressTick += 1;
        if (commentProgressTick % 40 === 0) report();
        continue;
      }
      const canonicalUrl = normalizeHttpUrl(raw && (raw as any).canonicalUrl);
      const commentText = safeString(raw && (raw as any).commentText);
      if (!canonicalUrl || !commentText) {
        stats.commentsSkipped += 1;
        bump(1, 'Comments');
        commentProgressTick += 1;
        if (commentProgressTick % 40 === 0) report();
        continue;
      }

      const parentRaw = raw && (raw as any).parentCommentId;
      const parentIdNum = parentRaw == null ? null : Number(parentRaw);
      const parentCommentId =
        parentIdNum != null && Number.isFinite(parentIdNum) && parentIdNum > 0 ? parentIdNum : null;

      const uniqueKey = safeString(raw && (raw as any).uniqueKey);
      const quoteText = raw && (raw as any).quoteText ? String((raw as any).quoteText) : '';
      const createdAt = Number(raw && (raw as any).createdAt) || 0;
      const updatedAt = Number(raw && (raw as any).updatedAt) || createdAt || 0;

      const baseKey = commentBaseKey({ canonicalUrl, createdAt, quoteText, commentText });
      baseKeyByIncomingId.set(commentId, baseKey);
      canonicalUrls.add(canonicalUrl);

      const item = {
        commentId,
        parentCommentId,
        uniqueKey,
        canonicalUrl,
        quoteText,
        commentText,
        createdAt,
        updatedAt,
        baseKey,
        parentBaseKey: '',
        fingerprint: '',
      };
      incomingById.set(commentId, item);
      normalizedIncoming.push(item);
    }

    for (const item of normalizedIncoming) {
      const parentBaseKey = item.parentCommentId ? baseKeyByIncomingId.get(item.parentCommentId) || '' : '';
      item.parentBaseKey = parentBaseKey;
      item.fingerprint = commentFingerprint({ baseKey: item.baseKey, parentBaseKey });
    }

    const localConversationIdByCanonicalUrl = new Map<string, number>();
    for (const convo of incomingConversations) {
      const uk = uniqueConversationKey(convo);
      const localId = uk ? uniqueToLocalId.get(uk) : null;
      if (!localId) continue;
      const url = normalizeHttpUrl(convo && (convo as any).url);
      if (!url) continue;
      if (!localConversationIdByCanonicalUrl.has(url)) localConversationIdByCanonicalUrl.set(url, localId);
    }

    const existingByFingerprint = new Map<string, AnyRecord>();
    const baseKeyByExistingId = new Map<number, string>();
    const existingRows: AnyRecord[] = [];

    const { t, stores: s } = tx(db, ['article_comments'], 'readwrite');
    const store = s.article_comments;
    const idx = store.index('by_canonicalUrl_createdAt');

    progress.stage = 'Comments';
    report();

    for (const canonicalUrl of canonicalUrls) {
      if (!canonicalUrl) continue;
      const range = globalThis.IDBKeyRange?.bound
        ? globalThis.IDBKeyRange.bound([canonicalUrl, -Infinity] as any, [canonicalUrl, Infinity] as any)
        : null;
      const rows = range ? ((await reqToPromise<any[]>(idx.getAll(range) as any)) || []) : [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const id = Number((row as any).id);
        if (!Number.isFinite(id) || id <= 0) continue;

        const url = normalizeHttpUrl((row as any).canonicalUrl);
        if (!url) continue;

        const createdAt = Number((row as any).createdAt) || 0;
        const quoteText = (row as any).quoteText ? String((row as any).quoteText) : '';
        const commentText = safeString((row as any).commentText);
        if (!commentText) continue;

        const baseKey = commentBaseKey({ canonicalUrl: url, createdAt, quoteText, commentText });
        baseKeyByExistingId.set(id, baseKey);
        existingRows.push(row);
      }
    }

    for (const row of existingRows) {
      const id = Number((row as any).id);
      const baseKey = baseKeyByExistingId.get(id) || '';
      if (!baseKey) continue;
      const parentIdRaw = Number((row as any).parentId);
      const parentBaseKey =
        Number.isFinite(parentIdRaw) && parentIdRaw > 0 ? baseKeyByExistingId.get(parentIdRaw) || '' : '';
      const fingerprint = commentFingerprint({ baseKey, parentBaseKey });
      if (!existingByFingerprint.has(fingerprint)) existingByFingerprint.set(fingerprint, row);
    }

    const ordered: typeof normalizedIncoming = [];
    const visited = new Set<number>();
    const visiting = new Set<number>();
    const visit = (id: number) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) return;
      visiting.add(id);
      const item = incomingById.get(id);
      if (item && item.parentCommentId) visit(item.parentCommentId);
      if (item) {
        visited.add(id);
        ordered.push(item);
      }
      visiting.delete(id);
    };
    for (const item of normalizedIncoming) visit(item.commentId);

    const incomingIdToLocalId = new Map<number, number>();
    const now = Date.now();

    for (const item of ordered) {
      const existing = existingByFingerprint.get(item.fingerprint) || null;
      const parentId =
        item.parentCommentId && incomingIdToLocalId.has(item.parentCommentId)
          ? incomingIdToLocalId.get(item.parentCommentId)!
          : null;

      const uniqueKey = safeString(item.uniqueKey);
      const mappedConversationId =
        uniqueKey && uniqueToLocalId.has(uniqueKey)
          ? uniqueToLocalId.get(uniqueKey)!
          : localConversationIdByCanonicalUrl.get(item.canonicalUrl) || null;

      if (existing && (existing as any).id) {
        const existingId = Number((existing as any).id);
        if (Number.isFinite(existingId) && existingId > 0) incomingIdToLocalId.set(item.commentId, existingId);

        const existingUpdatedAt = Number((existing as any).updatedAt) || 0;
        const incomingUpdatedAt = Number(item.updatedAt) || 0;
        const shouldUpdateText =
          incomingUpdatedAt > existingUpdatedAt &&
          (safeString((existing as any).commentText) !== item.commentText ||
            String((existing as any).quoteText || '') !== String(item.quoteText || ''));
        const shouldAttachConversation =
          mappedConversationId != null &&
          (!Number.isFinite(Number((existing as any).conversationId)) || Number((existing as any).conversationId) <= 0);
        const shouldAttachParent =
          parentId != null &&
          (!Number.isFinite(Number((existing as any).parentId)) || Number((existing as any).parentId) <= 0);

        if (shouldUpdateText || shouldAttachConversation || shouldAttachParent) {
          const next = {
            ...existing,
            canonicalUrl: item.canonicalUrl,
            quoteText: String(item.quoteText || ''),
            commentText: item.commentText,
            conversationId:
              shouldAttachConversation && mappedConversationId != null ? mappedConversationId : (existing as any).conversationId,
            parentId: shouldAttachParent && parentId != null ? parentId : (existing as any).parentId,
            createdAt: Number((existing as any).createdAt) || Number(item.createdAt) || now,
            updatedAt: Math.max(existingUpdatedAt, incomingUpdatedAt, now),
          };
          // eslint-disable-next-line no-await-in-loop
          await reqToPromise(store.put(next as any));
          stats.commentsUpdated += 1;
        }

        bump(1, 'Comments');
        commentProgressTick += 1;
        if (commentProgressTick % 40 === 0) report();
        continue;
      }

      const record = {
        parentId,
        conversationId: mappedConversationId,
        canonicalUrl: item.canonicalUrl,
        quoteText: String(item.quoteText || ''),
        commentText: item.commentText,
        createdAt: Number(item.createdAt) || now,
        updatedAt: Number(item.updatedAt) || Number(item.createdAt) || now,
      };
      // eslint-disable-next-line no-await-in-loop
      const newId = await reqToPromise(store.add(record as any) as any);
      const localId = Number(newId);
      if (Number.isFinite(localId) && localId > 0) incomingIdToLocalId.set(item.commentId, localId);
      stats.commentsAdded += 1;
      bump(1, 'Comments');
      commentProgressTick += 1;
      if (commentProgressTick % 40 === 0) report();
    }

    await txDone(t);
  }

  // 1.5) Restore image cache assets and rewrite incoming markdown asset urls.
  const assetIdRemap = new Map<number, number>();
  const fallbackUrlByOldId = new Map<number, string>();

  // If the manifest declares an image cache index but the zip does not contain it, treat this as a "text-only"
  // import: strip all `syncnos-asset://` references to a safe placeholder so we don't persist broken private URLs.
  if (imageCacheIndexMissing) {
    for (const [uk, list] of messagesByUniqueKey.entries()) {
      const msgs = Array.isArray(list) ? list : [];
      for (const msg of msgs) {
        if (!msg || typeof msg !== 'object') continue;
        const markdown = msg.contentMarkdown && String(msg.contentMarkdown).trim() ? String(msg.contentMarkdown) : '';
        if (!markdown) continue;
        const next = rewriteSyncnosAssetUrlsInMarkdown(markdown, {
          remap: assetIdRemap,
          fallbackUrlByOldId,
          defaultUrl: SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC,
        });
        if (next !== markdown) msg.contentMarkdown = next;
      }
      messagesByUniqueKey.set(uk, msgs);
    }
  }

  if (imageCacheAssets.length) {
    const { t, stores: s } = tx(db, ['image_cache'], 'readwrite');
    const idx = s.image_cache.index('by_conversationId_url');
    const now = Date.now();

    progress.stage = 'Assets';
    report();

    for (let i = 0; i < imageCacheAssets.length; i += 1) {
      const asset = imageCacheAssets[i];
      const assetId = Number(asset && asset.assetId);
      if (!Number.isFinite(assetId) || assetId <= 0) {
        if (i % 20 === 0) report();
        bump(1, 'Assets');
        continue;
      }
      const uniqueKey = asset && asset.uniqueKey ? String(asset.uniqueKey) : '';
      if (!uniqueKey.trim()) {
        if (i % 20 === 0) report();
        bump(1, 'Assets');
        continue;
      }
      const localConversationId = uniqueToLocalId.get(uniqueKey);
      if (!localConversationId) {
        if (i % 20 === 0) report();
        bump(1, 'Assets');
        continue;
      }

      const url = asset && asset.url ? String(asset.url) : '';
      const safeUrl = url.trim();
      if (!safeUrl) {
        if (i % 20 === 0) report();
        bump(1, 'Assets');
        continue;
      }

      const contentType = parseContentType(asset && asset.contentType ? asset.contentType : '');
      if (!contentType.startsWith('image/')) {
        if (i % 20 === 0) report();
        bump(1, 'Assets');
        continue;
      }

      const blobPath = asset && asset.blobPath ? String(asset.blobPath) : '';
      const bytes = blobPath ? entries.get(blobPath) : null;
      if (!bytes) {
        fallbackUrlByOldId.set(assetId, normalizeFallbackImageUrl(safeUrl));
        if (i % 20 === 0) report();
        bump(1, 'Assets');
        continue;
      }
      const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
      const byteSize = Number(asset.byteSize) || blob.size || 0;
      if (byteSize <= 0) {
        fallbackUrlByOldId.set(assetId, normalizeFallbackImageUrl(safeUrl));
        if (i % 20 === 0) report();
        bump(1, 'Assets');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, safeUrl]) as any);
      if (existing && existing.id) {
        const existingId = Number(existing.id);
        if (Number.isFinite(existingId) && existingId > 0) assetIdRemap.set(assetId, existingId);

        const existingBlob = (existing as any).blob as unknown;
        const existingSize =
          Number((existing as any).byteSize) ||
          (existingBlob instanceof Blob ? existingBlob.size : 0) ||
          0;
        if (existingBlob instanceof Blob && existingSize > 0) {
          if (i % 20 === 0) report();
          bump(1, 'Assets');
          continue;
        }

        const next = {
          ...existing,
          conversationId: localConversationId,
          url: safeUrl,
          blob,
          byteSize,
          contentType,
          createdAt: Number(existing.createdAt) || Number(asset.createdAt) || now,
          updatedAt: now,
        };
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(s.image_cache.put(next as any));
        if (i % 20 === 0) report();
        bump(1, 'Assets');
        continue;
      }

      const record = {
        conversationId: localConversationId,
        url: safeUrl,
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

      if (i % 20 === 0) report();
      bump(1, 'Assets');
    }

    await txDone(t);
  }

  // If we restored some assets, rewrite `syncnos-asset://<oldId>` references to the local asset ids.
  // If assets are missing (e.g. user intentionally removed blobs), fall back to the original http(s) image URL
  // when available, or a tiny placeholder image otherwise.
  if (assetIdRemap.size || fallbackUrlByOldId.size) {
    for (const [uk, list] of messagesByUniqueKey.entries()) {
      const msgs = Array.isArray(list) ? list : [];
      for (const msg of msgs) {
        if (!msg || typeof msg !== 'object') continue;
        const markdown = msg.contentMarkdown && String(msg.contentMarkdown).trim() ? String(msg.contentMarkdown) : '';
        if (!markdown) continue;
        const next = rewriteSyncnosAssetUrlsInMarkdown(markdown, {
          remap: assetIdRemap,
          fallbackUrlByOldId,
          defaultUrl: SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC,
        });
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
