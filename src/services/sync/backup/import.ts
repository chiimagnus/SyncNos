import { normalizeConversationListRecord } from '@platform/idb/conversation-list-record';
import { mergeSyncMappingForImport } from '@platform/idb/sync-mapping-record';
import { storageSet } from '@platform/storage/local';
import {
  areBackupValuesEqual,
  filterStorageForBackup,
  validateImageCacheIndexDocument,
  mergeConversationRecord,
  mergeMessageRecord,
  uniqueConversationKey,
  validateBackupDocument,
  validateBackupManifest,
  validateConversationBundle,
  validateStorageLocalDocument,
} from '@services/sync/backup/backup-utils';
import { openDb } from '@platform/idb/schema';
import { reqToPromise } from '@services/sync/backup/idb';
import { runTrackedTransaction } from '@services/data-revisions/transaction';
import {
  buildArticleCommentArchiveBaseKey,
  buildArticleCommentArchiveFingerprint,
  prepareArticleCommentArchiveImport,
  type PreparedArticleCommentArchiveItem,
} from '@services/comments/domain/comment-archive';

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

function reportImportProgressBestEffort(
  onProgress: ((p: ImportProgress) => void) | undefined,
  progress: ImportProgress,
): void {
  try {
    void Promise.resolve(onProgress?.({ ...progress })).catch(() => undefined);
  } catch (_error) {
    // Progress reporting is best-effort and must never fail an import whose durable stage already committed.
  }
}

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

const CONVERSATION_MAPPING_MIRROR_FIELDS = [
  'notionPageId',
  'notionPageUrl',
  'notionWorkspaceSlug',
  'feishuDocId',
] as const;

async function applyImportedSyncMappings(input: {
  stores: { sync_mappings: IDBObjectStore; conversations: IDBObjectStore };
  mappings: AnyRecord[];
  stats: ImportStats;
}): Promise<{ processed: number; syncMappingsChanged: boolean; conversationRowsChanged: boolean }> {
  const mappingIndex = input.stores.sync_mappings.index('by_source_conversationKey');
  const conversationIndex = input.stores.conversations.index('by_source_conversationKey');
  let processed = 0;
  let syncMappingsChanged = false;
  let conversationRowsChanged = false;

  for (const incoming of input.mappings) {
    processed += 1;
    const source = safeString(incoming?.source);
    const conversationKey = safeString(incoming?.conversationKey);
    if (!source || !conversationKey) continue;

    const existing = (await reqToPromise(mappingIndex.get([source, conversationKey]) as any)) as AnyRecord;
    const merged = mergeSyncMappingForImport(existing, incoming) as AnyRecord;
    merged.source = source;
    merged.conversationKey = conversationKey;

    if (existing?.id) {
      merged.id = existing.id;
      if (!areBackupValuesEqual(merged, existing)) {
        await reqToPromise(input.stores.sync_mappings.put(merged as any));
        input.stats.mappingsUpdated += 1;
        syncMappingsChanged = true;
      }
    } else {
      delete merged.id;
      await reqToPromise(input.stores.sync_mappings.add(merged as any));
      input.stats.mappingsAdded += 1;
      syncMappingsChanged = true;
    }

    const conversation = (await reqToPromise(conversationIndex.get([source, conversationKey]) as any)) as AnyRecord;
    if (conversation?.id) {
      let changed = false;
      for (const field of CONVERSATION_MAPPING_MIRROR_FIELDS) {
        const value = safeString(merged[field]);
        if (!value || safeString(conversation[field]) === value) continue;
        conversation[field] = value;
        changed = true;
      }
      if (changed) {
        await reqToPromise(input.stores.conversations.put(conversation));
        conversationRowsChanged = true;
      }
    }
  }

  return { processed, syncMappingsChanged, conversationRowsChanged };
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
  const report = () => reportImportProgressBestEffort(onProgress, progress);
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
    progress.stage = 'conversations';
    report();
    await runTrackedTransaction(
      { db, stores: ['conversations'], revisionScopes: ['conversations'] },
      async ({ stores: s, markChanged }) => {
        const idx = s.conversations.index('by_source_conversationKey');
        let stageChanged = false;

        for (const incoming of backupConversations) {
          if (!incoming) continue;
          const source = incoming.source ? String(incoming.source) : '';
          const conversationKey = incoming.conversationKey ? String(incoming.conversationKey) : '';
          if (!source || !conversationKey) continue;

          const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
          const merged = normalizeConversationListRecord(mergeConversationRecord(existing, incoming));
          merged.source = source;
          merged.conversationKey = conversationKey;
          const uk = uniqueConversationKey(merged);

          if (existing?.id) {
            const localId = Number(existing.id);
            merged.id = localId;
            uniqueToLocalId.set(uk, localId);
            if (areBackupValuesEqual(merged, existing)) continue;

            await reqToPromise(s.conversations.put(merged as any));
            stats.conversationsUpdated += 1;
            stageChanged = true;
            continue;
          }

          const id = Number(await reqToPromise(s.conversations.add(merged as any) as any));
          uniqueToLocalId.set(uk, id);
          stats.conversationsAdded += 1;
          stageChanged = true;
        }

        if (stageChanged) markChanged('conversations');
      },
    );
    bump(backupConversations.length, 'conversations');
  }

  // 2) Upsert messages by (localConversationId, messageKey).
  {
    progress.stage = 'messages';
    report();
    const stageNow = Date.now();
    await runTrackedTransaction(
      { db, stores: ['messages'], revisionScopes: ['messages'] },
      async ({ stores: s, markChanged }) => {
        const idx = s.messages.index('by_conversationId_messageKey');

        for (const incoming of backupMessages) {
          if (!incoming) continue;
          const backupConversationId = Number(incoming.conversationId);
          const messageKey = incoming.messageKey ? String(incoming.messageKey) : '';
          if (!Number.isFinite(backupConversationId) || backupConversationId <= 0 || !messageKey) {
            stats.messagesSkipped += 1;
            continue;
          }
          const uk = backupConvoIdToUnique.get(backupConversationId) || '';
          const localConversationId = uk ? uniqueToLocalId.get(uk) : null;
          if (!localConversationId) {
            stats.messagesSkipped += 1;
            continue;
          }

          const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, messageKey]) as any);
          const base = {
            ...(incoming || {}),
            conversationId: localConversationId,
            messageKey,
            ...(existing?.id ? { id: existing.id } : {}),
          };
          const merged = mergeMessageRecord(existing, base);
          merged.conversationId = localConversationId;
          merged.messageKey = messageKey;

          if (existing?.id) {
            merged.id = existing.id;
            if (areBackupValuesEqual(merged, existing)) continue;
            if (!(Number.isFinite(Number(merged.updatedAt)) && Number(merged.updatedAt) > 0))
              merged.updatedAt = stageNow;

            await reqToPromise(s.messages.put(merged as any));
            stats.messagesUpdated += 1;
            markChanged('messages');
            continue;
          }

          delete merged.id;
          if (!(Number.isFinite(Number(merged.updatedAt)) && Number(merged.updatedAt) > 0)) merged.updatedAt = stageNow;
          await reqToPromise(s.messages.add(merged as any));
          stats.messagesAdded += 1;
          markChanged('messages');
        }
      },
    );
    bump(backupMessages.length, 'messages');
  }

  progress.stage = 'mappings';
  report();
  const mappingResult = await runTrackedTransaction(
    { db, stores: ['sync_mappings', 'conversations'], revisionScopes: ['sync_mappings', 'conversations'] },
    async ({ stores: s, markChanged }) => {
      const result = await applyImportedSyncMappings({
        stores: { sync_mappings: s.sync_mappings, conversations: s.conversations },
        mappings: backupMappings,
        stats,
      });
      if (result.syncMappingsChanged) markChanged('sync_mappings');
      if (result.conversationRowsChanged) markChanged('conversations');
      return result;
    },
  );
  bump(mappingResult.processed, 'mappings');

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
  const report = () => reportImportProgressBestEffort(onProgress, progress);
  const bump = (delta: number, stage?: string) => {
    progress.done += delta;
    if (stage) progress.stage = stage;
  };
  const reportCommittedStage = (delta: number, stage: string) => {
    bump(delta, stage);
    report();
  };

  const db = await openDb();
  const uniqueToLocalId = new Map<string, number>();

  // 1) Upsert conversations by (source, conversationKey).
  {
    progress.stage = 'Conversations';
    report();
    await runTrackedTransaction(
      { db, stores: ['conversations'], revisionScopes: ['conversations'] },
      async ({ stores: s, markChanged }) => {
        const idx = s.conversations.index('by_source_conversationKey');
        let stageChanged = false;

        for (const incoming of incomingConversations) {
          const source = incoming?.source ? String(incoming.source) : '';
          const conversationKey = incoming?.conversationKey ? String(incoming.conversationKey) : '';
          if (!source || !conversationKey) continue;

          const existing: AnyRecord = await reqToPromise(idx.get([source, conversationKey]) as any);
          const normalizedMerged = normalizeConversationListRecord(mergeConversationRecord(existing, incoming));
          normalizedMerged.source = source;
          normalizedMerged.conversationKey = conversationKey;
          const uk = uniqueConversationKey(normalizedMerged);

          if (existing?.id) {
            const localId = Number(existing.id);
            normalizedMerged.id = localId;
            uniqueToLocalId.set(uk, localId);
            if (areBackupValuesEqual(normalizedMerged, existing)) continue;

            await reqToPromise(s.conversations.put(normalizedMerged as any));
            stats.conversationsUpdated += 1;
            stageChanged = true;
            continue;
          }

          delete normalizedMerged.id;
          const localId = Number(await reqToPromise(s.conversations.add(normalizedMerged as any) as any));
          uniqueToLocalId.set(uk, localId);
          stats.conversationsAdded += 1;
          stageChanged = true;
        }

        if (stageChanged) markChanged('conversations');
      },
    );
    reportCommittedStage(incomingConversations.length, 'Conversations');
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

    progress.stage = 'Comments';
    report();
    await runTrackedTransaction(
      { db, stores: ['article_comments'], revisionScopes: ['article_comments'] },
      async ({ stores: s, markChanged }) => {
        const store = s.article_comments;
        const index = store.index('by_canonicalUrl_createdAt');
        const existingByFingerprint = new Map<string, AnyRecord>();
        const existingBaseKeyById = new Map<number, string>();
        const existingRows: AnyRecord[] = [];

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
        for (const item of articleCommentItems) {
          const parentId =
            item.parentCommentId == null ? null : (incomingIdToLocalId.get(item.parentCommentId) ?? null);
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
              commentText:
                incomingUpdatedAt >= existingUpdatedAt ? item.commentText : String(existing.commentText || ''),
              locator: incomingUpdatedAt >= existingUpdatedAt ? item.locator : existing.locator,
              createdAt: Number(existing.createdAt) || item.createdAt || now,
              updatedAt: Math.max(existingUpdatedAt, incomingUpdatedAt),
            };
            if (areBackupValuesEqual(next, existing)) {
              stats.commentsSkipped += 1;
              continue;
            }

            await reqToPromise(store.put(next as any));
            stats.commentsUpdated += 1;
            markChanged('article_comments');
            continue;
          }

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
          markChanged('article_comments');
        }
      },
    );
    reportCommittedStage(articleCommentItems.length, 'Comments');
  }

  // 1.5) Restore image cache assets and rewrite incoming markdown asset urls.
  const assetIdRemap = new Map<number, number>();
  const fallbackUrlByOldId = new Map<number, string>();
  const rewrittenAssetMarkdownByMessage = new Map<string, string>();

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
        if (next !== markdown) {
          msg.contentMarkdown = next;
          const messageKey = safeString(msg.messageKey);
          if (messageKey) rewrittenAssetMarkdownByMessage.set(`${uk}\u0000${messageKey}`, next);
        }
      }
      messagesByUniqueKey.set(uk, msgs);
    }
  }

  if (imageCacheAssets.length) {
    progress.stage = 'Assets';
    report();
    await runTrackedTransaction(
      { db, stores: ['image_cache'], revisionScopes: ['image_cache'] },
      async ({ stores: s, markChanged }) => {
        const idx = s.image_cache.index('by_conversationId_url');
        const now = Date.now();

        for (const asset of imageCacheAssets) {
          const assetId = Number(asset?.assetId);
          if (!Number.isFinite(assetId) || assetId <= 0) continue;
          const uniqueKey = asset?.uniqueKey ? String(asset.uniqueKey) : '';
          if (!uniqueKey.trim()) continue;
          const localConversationId = uniqueToLocalId.get(uniqueKey);
          if (!localConversationId) continue;

          const safeUrl = asset?.url ? String(asset.url).trim() : '';
          if (!safeUrl) continue;
          const contentType = parseContentType(asset?.contentType);
          if (!contentType.startsWith('image/')) continue;

          const blobPath = asset?.blobPath ? String(asset.blobPath) : '';
          const bytes = blobPath ? entries.get(blobPath) : null;
          if (!bytes) {
            fallbackUrlByOldId.set(assetId, normalizeFallbackImageUrl(safeUrl));
            continue;
          }
          const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
          const byteSize = Number(asset.byteSize) || blob.size || 0;
          if (byteSize <= 0) {
            fallbackUrlByOldId.set(assetId, normalizeFallbackImageUrl(safeUrl));
            continue;
          }

          const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, safeUrl]) as any);
          if (existing?.id) {
            const existingId = Number(existing.id);
            if (Number.isFinite(existingId) && existingId > 0) assetIdRemap.set(assetId, existingId);

            const existingBlob = existing.blob as unknown;
            const existingSize =
              Number(existing.byteSize) || (existingBlob instanceof Blob ? existingBlob.size : 0) || 0;
            if (existingBlob instanceof Blob && existingSize > 0) continue;

            await reqToPromise(
              s.image_cache.put({
                ...existing,
                conversationId: localConversationId,
                url: safeUrl,
                blob,
                byteSize,
                contentType,
                createdAt: Number(existing.createdAt) || Number(asset.createdAt) || now,
                updatedAt: now,
              } as any),
            );
            markChanged('image_cache');
            continue;
          }

          const nextId = Number(
            await reqToPromise(
              s.image_cache.add({
                conversationId: localConversationId,
                url: safeUrl,
                blob,
                byteSize,
                contentType,
                createdAt: Number(asset.createdAt) || now,
                updatedAt: now,
              } as any) as any,
            ),
          );
          if (Number.isFinite(nextId) && nextId > 0) assetIdRemap.set(assetId, nextId);
          markChanged('image_cache');
        }
      },
    );
    reportCommittedStage(imageCacheAssets.length, 'Assets');
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
        if (next !== markdown) {
          msg.contentMarkdown = next;
          const messageKey = safeString(msg.messageKey);
          if (messageKey) rewrittenAssetMarkdownByMessage.set(`${uk}\u0000${messageKey}`, next);
        }
      }
      messagesByUniqueKey.set(uk, msgs);
    }
  }

  // 2) Upsert messages by (localConversationId, messageKey).
  {
    progress.stage = 'Messages';
    report();
    const stageNow = Date.now();
    await runTrackedTransaction(
      { db, stores: ['messages'], revisionScopes: ['messages'] },
      async ({ stores: s, markChanged }) => {
        const idx = s.messages.index('by_conversationId_messageKey');

        for (const [uk, list] of messagesByUniqueKey.entries()) {
          const localConversationId = uniqueToLocalId.get(uk);
          if (!localConversationId) {
            stats.messagesSkipped += Array.isArray(list) ? list.length : 0;
            continue;
          }

          for (const incoming of Array.isArray(list) ? list : []) {
            const messageKey = incoming?.messageKey ? String(incoming.messageKey) : '';
            if (!messageKey) {
              stats.messagesSkipped += 1;
              continue;
            }

            const existing: AnyRecord = await reqToPromise(idx.get([localConversationId, messageKey]) as any);
            const base = {
              ...(incoming || {}),
              conversationId: localConversationId,
              messageKey,
              ...(existing?.id ? { id: existing.id } : {}),
            };
            const merged = mergeMessageRecord(existing, base);
            const rewrittenAssetMarkdown = rewrittenAssetMarkdownByMessage.get(`${uk}\u0000${messageKey}`);
            if (rewrittenAssetMarkdown != null) merged.contentMarkdown = rewrittenAssetMarkdown;
            merged.conversationId = localConversationId;
            merged.messageKey = messageKey;

            if (existing?.id) {
              merged.id = existing.id;
              if (areBackupValuesEqual(merged, existing)) continue;
              if (!(Number.isFinite(Number(merged.updatedAt)) && Number(merged.updatedAt) > 0))
                merged.updatedAt = stageNow;

              await reqToPromise(s.messages.put(merged as any));
              stats.messagesUpdated += 1;
              markChanged('messages');
              continue;
            }

            delete merged.id;
            if (!(Number.isFinite(Number(merged.updatedAt)) && Number(merged.updatedAt) > 0))
              merged.updatedAt = stageNow;
            await reqToPromise(s.messages.add(merged as any));
            stats.messagesAdded += 1;
            markChanged('messages');
          }
        }
      },
    );
    reportCommittedStage(totalMessages, 'Messages');
  }

  progress.stage = 'Mappings';
  report();
  const mappingResult = await runTrackedTransaction(
    { db, stores: ['sync_mappings', 'conversations'], revisionScopes: ['sync_mappings', 'conversations'] },
    async ({ stores: s, markChanged }) => {
      const result = await applyImportedSyncMappings({
        stores: { sync_mappings: s.sync_mappings, conversations: s.conversations },
        mappings: incomingMappings,
        stats,
      });
      if (result.syncMappingsChanged) markChanged('sync_mappings');
      if (result.conversationRowsChanged) markChanged('conversations');
      return result;
    },
  );
  reportCommittedStage(mappingResult.processed, 'Mappings');

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
