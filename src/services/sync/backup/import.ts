import { storageSet } from '@platform/storage/local';
import {
  filterStorageForBackup,
  validateImageCacheIndexDocument,
  mergeConversationRecord,
  mergeMessageRecord,
  mergeSyncMappingRecord,
  normalizeFallbackImageUrl,
  normalizeImageContentType,
  rewriteSyncnosAssetUrlsInMarkdown,
  SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC,
  uniqueConversationKey,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
  validateStorageLocalDocument,
} from '@services/sync/backup/backup-utils';
import { openDb, reqToPromise, tx, txDone } from '@services/sync/backup/idb';
import {
  buildArticleCommentArchiveBaseKey,
  buildArticleCommentArchiveFingerprint,
  prepareArticleCommentArchiveImport,
  type PreparedArticleCommentArchiveItem,
} from '@services/comments/domain/comment-archive';

type AnyRecord = Record<string, any>;

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
  commentWarnings: string[];
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
    commentWarnings: [],
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

function deriveConversationListSourceKey(record: AnyRecord): string {
  const source = safeString(record?.source).toLowerCase();
  return source || 'unknown';
}

function deriveConversationListSiteKey(record: AnyRecord): string {
  const normalizedUrl = normalizeHttpUrl(record?.url);
  if (!normalizedUrl) return 'unknown';
  try {
    const host = safeString(new URL(normalizedUrl).hostname).toLowerCase();
    return host ? `domain:${host}` : 'unknown';
  } catch (_e) {
    return 'unknown';
  }
}

function normalizeListDerivedKeys(record: AnyRecord): AnyRecord {
  if (!record || typeof record !== 'object') return record;
  const existingListSourceKey = safeString(record?.listSourceKey);
  const existingListSiteKey = safeString(record?.listSiteKey);

  const derivedSourceKey = deriveConversationListSourceKey(record);
  const nextListSourceKey = derivedSourceKey !== 'unknown' ? derivedSourceKey : existingListSourceKey || 'unknown';

  const derivedSiteKey = deriveConversationListSiteKey(record);
  const nextListSiteKey = derivedSiteKey !== 'unknown' ? derivedSiteKey : existingListSiteKey || 'unknown';

  if (existingListSourceKey === nextListSourceKey && existingListSiteKey === nextListSiteKey) return record;
  return {
    ...(record as any),
    listSourceKey: nextListSourceKey,
    listSiteKey: nextListSiteKey,
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

  const totalWork = backupConversations.length + backupMessages.length + backupMappings.length + settingsKeys.length;
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

      const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
      const merged = normalizeListDerivedKeys(mergeConversationRecord(existing, incoming));

      if (existing && existing.id) {
        merged.id = existing.id;

        await reqToPromise(s.conversations.put(merged as any));
        stats.conversationsUpdated += 1;
        uniqueToLocalId.set(`${source}||${conversationKey}`, Number(existing.id));
      } else {
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

      const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, messageKey]) as any);
      const base = { ...(incoming || {}), conversationId: localConversationId, messageKey };
      const merged = mergeMessageRecord(existing, base);
      merged.conversationId = localConversationId;
      merged.messageKey = messageKey;

      if (existing && existing.id) {
        merged.id = existing.id;

        await reqToPromise(s.messages.put(merged as any));
        stats.messagesUpdated += 1;
      } else {
        await reqToPromise(s.messages.add(merged as any));
        stats.messagesAdded += 1;
      }

      if (i % 25 === 0) report();
      bump(1, 'messages');
    }

    await txDone(t);
  }

  // 3) Upsert sync mappings by (source, conversationKey) and fill missing convo.notionPageId (also preserves feishuDocId).
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

      const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
      const merged = mergeSyncMappingRecord(existing, incoming);

      if (existing && existing.id) {
        merged.id = existing.id;

        await reqToPromise(s.sync_mappings.put(merged as any));
        stats.mappingsUpdated += 1;
      } else {
        await reqToPromise(s.sync_mappings.add(merged as any));
        stats.mappingsAdded += 1;
      }

      const notionPageId = merged.notionPageId ? String(merged.notionPageId) : '';
      const feishuDocId = merged.feishuDocId ? String(merged.feishuDocId) : '';
      if (notionPageId) {
        const convo: AnyRecord = await reqToPromise<AnyRecord>(convoIdx.get([source, conversationKey]) as any);
        if (convo && convo.id) {
          let changed = false;
          if (!convo.notionPageId || !String(convo.notionPageId).trim()) {
            convo.notionPageId = notionPageId;
            changed = true;
          }
          if (feishuDocId && (!convo.feishuDocId || !String(convo.feishuDocId).trim())) {
            convo.feishuDocId = feishuDocId;
            changed = true;
          }
          if (changed) await reqToPromise(s.conversations.put(convo));
        }
      } else if (feishuDocId) {
        const convo: AnyRecord = await reqToPromise<AnyRecord>(convoIdx.get([source, conversationKey]) as any);
        if (convo && convo.id && (!convo.feishuDocId || !String(convo.feishuDocId).trim())) {
          convo.feishuDocId = feishuDocId;
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
  const articleCommentsIndexDoc =
    articleCommentsIndexPath && entries.has(articleCommentsIndexPath)
      ? readJsonEntry(entries, articleCommentsIndexPath)
      : null;
  const preparedArticleComments = articleCommentsIndexDoc
    ? prepareArticleCommentArchiveImport(articleCommentsIndexDoc)
    : { items: [] as PreparedArticleCommentArchiveItem[], warnings: [] };
  const articleCommentItems = preparedArticleComments.items;

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
  stats.commentWarnings.push(
    ...preparedArticleComments.warnings.map((warning) => `${warning.code}:${warning.commentId ?? ''}`),
  );
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

      const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
      const merged = mergeConversationRecord(existing, incoming);
      merged.source = source;
      merged.conversationKey = conversationKey;
      const normalizedMerged = normalizeListDerivedKeys(merged);

      const uk = uniqueConversationKey(normalizedMerged);
      if (existing && existing.id) {
        normalizedMerged.id = existing.id;

        await reqToPromise(s.conversations.put(normalizedMerged as any));
        uniqueToLocalId.set(uk, Number(existing.id));
        stats.conversationsUpdated += 1;
      } else {
        const id = await reqToPromise(s.conversations.add(normalizedMerged as any) as any);
        uniqueToLocalId.set(uk, Number(id));
        stats.conversationsAdded += 1;
      }

      if (i % 20 === 0) report();
      bump(1, 'Conversations');
    }

    await txDone(t);
  }

  // 1.25) Restore article comments (validated graph, roots before replies, idempotent merge).
  if (articleCommentItems.length) {
    const canonicalUrls = new Set(articleCommentItems.map((item) => item.canonicalUrl));
    const localConversationIdByCanonicalUrl = new Map<string, number | null>();
    const uniqueKeyByLocalConversationId = new Map<number, string>(
      Array.from(uniqueToLocalId, ([uniqueKey, localId]) => [localId, uniqueKey]),
    );
    for (const convo of incomingConversations) {
      const uk = uniqueConversationKey(convo);
      const localId = uk ? uniqueToLocalId.get(uk) : null;
      if (!localId) continue;
      const url = normalizeHttpUrl(convo && (convo as any).url);
      if (!url) continue;
      if (!localConversationIdByCanonicalUrl.has(url)) {
        localConversationIdByCanonicalUrl.set(url, localId);
      } else if (localConversationIdByCanonicalUrl.get(url) !== localId) {
        localConversationIdByCanonicalUrl.set(url, null);
      }
    }

    const { t, stores: s } = tx(db, ['article_comments'], 'readwrite');
    const store = s.article_comments;
    const index = store.index('by_canonicalUrl_createdAt');
    const existingByFingerprint = new Map<string, AnyRecord>();
    const existingBaseKeyById = new Map<number, string>();
    const existingRows: AnyRecord[] = [];

    progress.stage = 'Comments';
    report();
    for (const canonicalUrl of canonicalUrls) {
      const range = globalThis.IDBKeyRange?.bound
        ? globalThis.IDBKeyRange.bound([canonicalUrl, -Infinity] as any, [canonicalUrl, Infinity] as any)
        : null;
      const rows = range ? (await reqToPromise<any[]>(index.getAll(range) as any)) || [] : [];
      for (const row of rows) {
        const id = Number(row?.id);
        const url = normalizeHttpUrl(row?.canonicalUrl);
        const commentText = safeString(row?.commentText);
        if (!Number.isSafeInteger(id) || id <= 0 || !url || !commentText) continue;
        const baseKey = buildArticleCommentArchiveBaseKey({
          uniqueKey: uniqueKeyByLocalConversationId.get(Number(row?.conversationId)) ?? '',
          canonicalUrl: url,
          createdAt: Number(row?.createdAt) || 0,
          quoteText: String(row?.quoteText || ''),
          commentText,
        });
        existingBaseKeyById.set(id, baseKey);
        existingRows.push(row);
      }
    }
    for (const row of existingRows) {
      const id = Number(row.id);
      const baseKey = existingBaseKeyById.get(id) ?? '';
      const parentId = Number(row.parentId);
      const parentBaseKey =
        Number.isSafeInteger(parentId) && parentId > 0 ? (existingBaseKeyById.get(parentId) ?? '') : '';
      const fingerprint = buildArticleCommentArchiveFingerprint(baseKey, parentBaseKey);
      if (!existingByFingerprint.has(fingerprint)) existingByFingerprint.set(fingerprint, row);
    }

    const incomingIdToLocalId = new Map<number, number>();
    const now = Date.now();
    let tick = 0;
    for (const item of articleCommentItems) {
      const parentId = item.parentCommentId == null ? null : (incomingIdToLocalId.get(item.parentCommentId) ?? null);
      const mappedConversationId =
        item.uniqueKey && uniqueToLocalId.has(item.uniqueKey)
          ? uniqueToLocalId.get(item.uniqueKey)!
          : (localConversationIdByCanonicalUrl.get(item.canonicalUrl) ?? null);
      const existing = existingByFingerprint.get(item.fingerprint) ?? null;

      if (existing?.id) {
        const existingId = Number(existing.id);
        incomingIdToLocalId.set(item.commentId, existingId);
        const incomingUpdatedAt = Number(item.updatedAt) || 0;
        const existingUpdatedAt = Number(existing.updatedAt) || 0;
        const next = {
          ...existing,
          parentId: existing.parentId == null && parentId != null ? parentId : existing.parentId,
          conversationId:
            existing.conversationId == null && mappedConversationId != null
              ? mappedConversationId
              : existing.conversationId,
          canonicalUrl: item.canonicalUrl,
          authorName: incomingUpdatedAt >= existingUpdatedAt ? (item.authorName ?? '') : existing.authorName,
          quoteText: incomingUpdatedAt >= existingUpdatedAt ? item.quoteText : String(existing.quoteText || ''),
          commentText: incomingUpdatedAt >= existingUpdatedAt ? item.commentText : String(existing.commentText || ''),
          locator: incomingUpdatedAt >= existingUpdatedAt ? item.locator : existing.locator,
          createdAt: Number(existing.createdAt) || item.createdAt || now,
          updatedAt: Math.max(existingUpdatedAt, incomingUpdatedAt),
        };
        const changed = JSON.stringify(next) !== JSON.stringify(existing);
        if (changed) {
          await reqToPromise(store.put(next as any));
          stats.commentsUpdated += 1;
        } else {
          stats.commentsSkipped += 1;
        }
      } else {
        const record = {
          parentId,
          conversationId: mappedConversationId,
          canonicalUrl: item.canonicalUrl,
          authorName: item.authorName ?? '',
          quoteText: item.quoteText,
          commentText: item.commentText,
          locator: item.locator,
          createdAt: item.createdAt || now,
          updatedAt: item.updatedAt || item.createdAt || now,
        };
        const newId = Number(await reqToPromise(store.add(record as any) as any));
        if (Number.isSafeInteger(newId) && newId > 0) incomingIdToLocalId.set(item.commentId, newId);
        stats.commentsAdded += 1;
      }
      bump(1, 'Comments');
      tick += 1;
      if (tick % 40 === 0) report();
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

      const contentType = normalizeImageContentType(asset && asset.contentType ? asset.contentType : '');
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

      const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, safeUrl]) as any);
      if (existing && existing.id) {
        const existingId = Number(existing.id);
        if (Number.isFinite(existingId) && existingId > 0) assetIdRemap.set(assetId, existingId);

        const existingBlob = (existing as any).blob as unknown;
        const existingSize =
          Number((existing as any).byteSize) || (existingBlob instanceof Blob ? existingBlob.size : 0) || 0;
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

        const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, messageKey]) as any);
        const base = { ...(incoming || {}), conversationId: localConversationId, messageKey };
        const merged = mergeMessageRecord(existing, base);
        merged.conversationId = localConversationId;
        merged.messageKey = messageKey;

        if (existing && existing.id) {
          merged.id = existing.id;

          await reqToPromise(s.messages.put(merged as any));
          stats.messagesUpdated += 1;
        } else {
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

  // 3) Upsert sync mappings by (source, conversationKey) and fill missing convo.notionPageId (also preserves feishuDocId).
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

      const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
      const merged = mergeSyncMappingRecord(existing, incoming);
      merged.source = source;
      merged.conversationKey = conversationKey;

      if (existing && existing.id) {
        merged.id = existing.id;

        await reqToPromise(s.sync_mappings.put(merged as any));
        stats.mappingsUpdated += 1;
      } else {
        await reqToPromise(s.sync_mappings.add(merged as any));
        stats.mappingsAdded += 1;
      }

      const notionPageId = merged.notionPageId ? String(merged.notionPageId) : '';
      if (notionPageId) {
        const convo: AnyRecord = await reqToPromise<AnyRecord>(convoIdx.get([source, conversationKey]) as any);
        if (convo && convo.id && (!convo.notionPageId || !String(convo.notionPageId).trim())) {
          convo.notionPageId = notionPageId;

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
