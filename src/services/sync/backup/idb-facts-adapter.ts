import { openDb } from '@platform/idb/schema';
import { openTransaction, requestToPromise, transactionDone } from '@platform/idb/transactions';
import {
  buildArticleCommentArchiveBaseKey,
  buildArticleCommentArchiveFingerprint,
  prepareArticleCommentArchiveImport,
} from '@services/comments/domain/comment-archive';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import { parseExactMessageKey } from '@services/local-data/contracts';
import {
  mergeConversationRecord,
  mergeMessageRecord,
  mergeSyncMappingRecord,
  normalizeFallbackImageUrl,
  normalizeImageContentType,
  rewriteSyncnosAssetUrlsInMarkdown,
  SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC,
  uniqueConversationKey,
} from '@services/sync/backup/backup-utils';
import {
  backupBytesForBlob,
  buildPortableBackupFacts,
  createEmptyImportStats,
  normalizeBackupConversationRecord,
  normalizeBackupHttpUrl,
  type BackupFactsAdapter,
  type BackupPortableFacts,
  type BackupRawImageRow,
  type BackupRecord,
  type ImportProgress,
  type ImportStats,
} from '@services/sync/backup/local-data';

function base64ToBytes(base64: string): Uint8Array {
  const normalized = String(base64 || '').replace(/\s+/g, '');
  if (!normalized) return new Uint8Array();
  const atobFn = (globalThis as any).atob as ((input: string) => string) | undefined;
  if (typeof atobFn === 'function') {
    const binary = atobFn(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  const bufferApi = (globalThis as any).Buffer;
  if (bufferApi?.from) return Uint8Array.from(bufferApi.from(normalized, 'base64'));
  return new Uint8Array();
}

function dataUrlToBytes(dataUrl: unknown): Readonly<{ bytes: Uint8Array; contentType: string }> | null {
  const value = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (!value.toLowerCase().startsWith('data:image/')) return null;
  const commaAt = value.indexOf(',');
  if (commaAt <= 0) return null;
  const meta = value.slice('data:'.length, commaAt);
  const parts = meta
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const contentType = normalizeImageContentType(parts[0] || '');
  if (!contentType.startsWith('image/')) return null;
  try {
    const payload = value.slice(commaAt + 1);
    const bytes = parts.some((part) => part.toLowerCase() === 'base64')
      ? base64ToBytes(payload)
      : new TextEncoder().encode(decodeURIComponent(payload));
    return bytes.byteLength > 0 ? { bytes, contentType } : null;
  } catch {
    return null;
  }
}

async function readImageRows(rows: BackupRecord[]): Promise<BackupRawImageRow[]> {
  const out: BackupRawImageRow[] = [];
  for (const row of rows) {
    let bytes: Uint8Array | null = null;
    let contentType = normalizeImageContentType(row?.contentType || '');
    const blob = row?.blob;
    if (typeof Blob !== 'undefined' && blob instanceof Blob) {
      bytes = new Uint8Array(await blob.arrayBuffer());
      contentType = normalizeImageContentType(contentType || blob.type);
    } else {
      const decoded = dataUrlToBytes(row?.dataUrl);
      if (decoded) {
        bytes = decoded.bytes;
        contentType = decoded.contentType;
      }
    }
    if (!bytes || bytes.byteLength <= 0 || !contentType.startsWith('image/')) continue;
    out.push({ record: { ...row, contentType }, bytes });
  }
  return out;
}

function reportProgress(
  onProgress: ((progress: ImportProgress) => void) | undefined,
  progress: ImportProgress,
  delta: number,
  stage: string,
): void {
  progress.done += delta;
  progress.stage = stage;
  onProgress?.({ ...progress });
}

async function exportFacts(lease: FactsOperationLease) {
  assertFactsOperationLease(lease);
  const db = await openDb();
  try {
    assertFactsOperationLease(lease);
    const { t: transaction, stores } = openTransaction(
      db,
      ['conversations', 'messages', 'sync_mappings', 'image_cache', 'article_comments'],
      'readonly',
    );
    const conversationRequest = requestToPromise<BackupRecord[]>(stores.conversations.getAll() as any);
    const messageRequest = requestToPromise<BackupRecord[]>(stores.messages.getAll() as any);
    const mappingRequest = requestToPromise<BackupRecord[]>(stores.sync_mappings.getAll() as any);
    const imageRequest = requestToPromise<BackupRecord[]>(stores.image_cache.getAll() as any);
    const commentRequest = requestToPromise<BackupRecord[]>(stores.article_comments.getAll() as any);
    const [conversations, messages, syncMappings, rawImages, articleComments] = await Promise.all([
      conversationRequest,
      messageRequest,
      mappingRequest,
      imageRequest,
      commentRequest,
    ]);
    await transactionDone(transaction);
    assertFactsOperationLease(lease);
    const imageCache = await readImageRows(rawImages || []);
    assertFactsOperationLease(lease);
    return buildPortableBackupFacts({
      conversations: conversations || [],
      messages: messages || [],
      syncMappings: syncMappings || [],
      imageCache,
      articleComments: articleComments || [],
    });
  } finally {
    db.close();
  }
}

async function importFacts(
  lease: FactsOperationLease,
  facts: BackupPortableFacts,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportStats> {
  assertFactsOperationLease(lease);
  const stats = createEmptyImportStats();
  const bundles = facts.bundles.map((bundle) => ({
    ...bundle,
    conversation: { ...bundle.conversation },
    messages: bundle.messages.map((message) => ({ ...message })),
    syncMapping: bundle.syncMapping ? { ...bundle.syncMapping } : null,
  }));
  const totalMessages = bundles.reduce((count, bundle) => count + bundle.messages.length, 0);
  const mappings = [
    ...bundles.flatMap((bundle) => (bundle.syncMapping ? [{ ...bundle.syncMapping }] : [])),
    ...facts.looseMappings.map((mapping) => ({ ...mapping })),
  ];
  const mappingCount = mappings.length;
  const preparedComments = prepareArticleCommentArchiveImport(facts.articleComments);
  stats.commentWarnings.push(
    ...preparedComments.warnings.map((warning) => `${warning.code}:${warning.commentId ?? ''}`),
  );
  const progress: ImportProgress = {
    done: 0,
    total: bundles.length + totalMessages + mappingCount + facts.imageAssets.length + preparedComments.items.length,
    stage: '',
  };
  onProgress?.({ ...progress });

  const db = await openDb();
  const uniqueToLocalId = new Map<string, number>();
  try {
    assertFactsOperationLease(lease);
    {
      const { t: transaction, stores } = openTransaction(db, ['conversations'], 'readwrite');
      const index = stores.conversations.index('by_source_conversationKey');
      progress.stage = 'Conversations';
      onProgress?.({ ...progress });
      for (const bundle of bundles) {
        const incoming = bundle.conversation;
        const source = String(incoming?.source || '').trim();
        const conversationKey = String(incoming?.conversationKey || '').trim();
        if (!source || !conversationKey) {
          reportProgress(onProgress, progress, 1, 'Conversations');
          continue;
        }
        const existing = (await requestToPromise(index.get([source, conversationKey]) as any)) as
          | BackupRecord
          | undefined;
        const merged = normalizeBackupConversationRecord(mergeConversationRecord(existing || {}, incoming));
        merged.source = source;
        merged.conversationKey = conversationKey;
        const uniqueKey = uniqueConversationKey(merged);
        if (existing?.id) {
          merged.id = existing.id;
          await requestToPromise(stores.conversations.put(merged as any));
          uniqueToLocalId.set(uniqueKey, Number(existing.id));
          stats.conversationsUpdated += 1;
        } else {
          const id = Number(await requestToPromise(stores.conversations.add(merged as any) as any));
          if (Number.isSafeInteger(id) && id > 0) uniqueToLocalId.set(uniqueKey, id);
          stats.conversationsAdded += 1;
        }
        reportProgress(onProgress, progress, 1, 'Conversations');
      }
      await transactionDone(transaction);
    }

    assertFactsOperationLease(lease);
    if (preparedComments.items.length) {
      const canonicalUrls = new Set(preparedComments.items.map((item) => item.canonicalUrl));
      const localConversationIdByCanonicalUrl = new Map<string, number | null>();
      const uniqueKeyByLocalConversationId = new Map<number, string>(
        Array.from(uniqueToLocalId, ([uniqueKey, localId]) => [localId, uniqueKey]),
      );
      for (const bundle of bundles) {
        const uniqueKey = uniqueConversationKey(bundle.conversation);
        const localId = uniqueKey ? uniqueToLocalId.get(uniqueKey) : null;
        if (!localId) continue;
        const url = normalizeBackupHttpUrl(bundle.conversation.url);
        if (!url) continue;
        if (!localConversationIdByCanonicalUrl.has(url)) localConversationIdByCanonicalUrl.set(url, localId);
        else if (localConversationIdByCanonicalUrl.get(url) !== localId)
          localConversationIdByCanonicalUrl.set(url, null);
      }

      const { t: transaction, stores } = openTransaction(db, ['article_comments'], 'readwrite');
      const store = stores.article_comments;
      const index = store.index('by_canonicalUrl_createdAt');
      const existingByFingerprint = new Map<string, BackupRecord>();
      const existingBaseKeyById = new Map<number, string>();
      const existingRows: BackupRecord[] = [];
      progress.stage = 'Comments';
      onProgress?.({ ...progress });

      for (const canonicalUrl of canonicalUrls) {
        const range = globalThis.IDBKeyRange?.bound([canonicalUrl, -Infinity] as any, [canonicalUrl, Infinity] as any);
        const rows = range ? (await requestToPromise<BackupRecord[]>(index.getAll(range) as any)) || [] : [];
        for (const row of rows) {
          const id = Number(row?.id);
          const url = normalizeBackupHttpUrl(row?.canonicalUrl);
          const commentText = String(row?.commentText || '').trim();
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
      for (const item of preparedComments.items) {
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
          if (JSON.stringify(next) !== JSON.stringify(existing)) {
            await requestToPromise(store.put(next as any));
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
          const id = Number(await requestToPromise(store.add(record as any) as any));
          if (Number.isSafeInteger(id) && id > 0) incomingIdToLocalId.set(item.commentId, id);
          stats.commentsAdded += 1;
        }
        reportProgress(onProgress, progress, 1, 'Comments');
      }
      await transactionDone(transaction);
    }

    const assetIdRemap = new Map<number, number>();
    const fallbackUrlByOldId = new Map<number, string>();
    if (facts.imageCacheMode === 'missing-index') {
      for (const bundle of bundles) {
        for (const message of bundle.messages) {
          const markdown = String(message?.contentMarkdown || '');
          if (!markdown.trim()) continue;
          message.contentMarkdown = rewriteSyncnosAssetUrlsInMarkdown(markdown, {
            remap: assetIdRemap,
            fallbackUrlByOldId,
            defaultUrl: SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC,
          });
        }
      }
    }

    assertFactsOperationLease(lease);
    if (facts.imageAssets.length) {
      const { t: transaction, stores } = openTransaction(db, ['image_cache'], 'readwrite');
      const index = stores.image_cache.index('by_conversationId_url');
      const now = Date.now();
      progress.stage = 'Assets';
      onProgress?.({ ...progress });
      for (const asset of facts.imageAssets) {
        const localConversationId = uniqueToLocalId.get(asset.uniqueKey);
        if (!localConversationId || !asset.bytes) {
          fallbackUrlByOldId.set(asset.assetId, normalizeFallbackImageUrl(asset.url));
          reportProgress(onProgress, progress, 1, 'Assets');
          continue;
        }
        const existing = (await requestToPromise(index.get([localConversationId, asset.url]) as any)) as
          | BackupRecord
          | undefined;
        if (existing?.id) {
          const existingId = Number(existing.id);
          if (Number.isSafeInteger(existingId) && existingId > 0) assetIdRemap.set(asset.assetId, existingId);
          const existingBlob = existing.blob;
          const existingSize = Number(existing.byteSize) || (existingBlob instanceof Blob ? existingBlob.size : 0) || 0;
          if (existingBlob instanceof Blob && existingSize > 0) {
            reportProgress(onProgress, progress, 1, 'Assets');
            continue;
          }
          await requestToPromise(
            stores.image_cache.put({
              ...existing,
              conversationId: localConversationId,
              url: asset.url,
              blob: new Blob([backupBytesForBlob(asset.bytes)], { type: asset.contentType }),
              byteSize: asset.bytes.byteLength,
              contentType: asset.contentType,
              createdAt: Number(existing.createdAt) || asset.createdAt || now,
              updatedAt: now,
            } as any),
          );
        } else {
          const id = Number(
            await requestToPromise(
              stores.image_cache.add({
                conversationId: localConversationId,
                url: asset.url,
                blob: new Blob([backupBytesForBlob(asset.bytes)], { type: asset.contentType }),
                byteSize: asset.bytes.byteLength,
                contentType: asset.contentType,
                createdAt: asset.createdAt || now,
                updatedAt: now,
              } as any) as any,
            ),
          );
          if (Number.isSafeInteger(id) && id > 0) assetIdRemap.set(asset.assetId, id);
        }
        reportProgress(onProgress, progress, 1, 'Assets');
      }
      await transactionDone(transaction);
    }

    if (assetIdRemap.size || fallbackUrlByOldId.size) {
      for (const bundle of bundles) {
        for (const message of bundle.messages) {
          const markdown = String(message?.contentMarkdown || '');
          if (!markdown.trim()) continue;
          message.contentMarkdown = rewriteSyncnosAssetUrlsInMarkdown(markdown, {
            remap: assetIdRemap,
            fallbackUrlByOldId,
            defaultUrl: SYNCNOS_ASSET_MISSING_PLACEHOLDER_SRC,
          });
        }
      }
    }

    assertFactsOperationLease(lease);
    {
      const { t: transaction, stores } = openTransaction(db, ['messages'], 'readwrite');
      const index = stores.messages.index('by_conversationId_messageKey');
      progress.stage = 'Messages';
      onProgress?.({ ...progress });
      for (const bundle of bundles) {
        const uniqueKey = uniqueConversationKey(bundle.conversation);
        const localConversationId = uniqueToLocalId.get(uniqueKey);
        for (const incoming of bundle.messages) {
          const rawMessageKey = typeof incoming?.messageKey === 'string' ? incoming.messageKey : '';
          if (!localConversationId || !rawMessageKey.trim()) {
            stats.messagesSkipped += 1;
            reportProgress(onProgress, progress, 1, 'Messages');
            continue;
          }
          const messageKey = parseExactMessageKey(rawMessageKey);
          const existing = (await requestToPromise(index.get([localConversationId, messageKey]) as any)) as
            | BackupRecord
            | undefined;
          const merged = mergeMessageRecord(existing || {}, {
            ...incoming,
            conversationId: localConversationId,
            messageKey,
          });
          merged.conversationId = localConversationId;
          merged.messageKey = messageKey;
          if (existing?.id) {
            merged.id = existing.id;
            await requestToPromise(stores.messages.put(merged as any));
            stats.messagesUpdated += 1;
          } else {
            await requestToPromise(stores.messages.add(merged as any));
            stats.messagesAdded += 1;
          }
          reportProgress(onProgress, progress, 1, 'Messages');
        }
      }
      await transactionDone(transaction);
    }

    assertFactsOperationLease(lease);
    {
      const { t: transaction, stores } = openTransaction(db, ['sync_mappings', 'conversations'], 'readwrite');
      const mappingIndex = stores.sync_mappings.index('by_source_conversationKey');
      const conversationIndex = stores.conversations.index('by_source_conversationKey');
      progress.stage = 'Mappings';
      onProgress?.({ ...progress });
      for (const incoming of mappings) {
        const source = String(incoming.source || '').trim();
        const conversationKey = String(incoming.conversationKey || '').trim();
        if (!source || !conversationKey) {
          reportProgress(onProgress, progress, 1, 'Mappings');
          continue;
        }
        const existing = (await requestToPromise(mappingIndex.get([source, conversationKey]) as any)) as
          | BackupRecord
          | undefined;
        const merged = mergeSyncMappingRecord(existing || {}, incoming);
        merged.source = source;
        merged.conversationKey = conversationKey;
        if (existing?.id) {
          merged.id = existing.id;
          await requestToPromise(stores.sync_mappings.put(merged as any));
          stats.mappingsUpdated += 1;
        } else {
          await requestToPromise(stores.sync_mappings.add(merged as any));
          stats.mappingsAdded += 1;
        }
        const notionPageId = String(merged.notionPageId || '').trim();
        const feishuDocId = String(merged.feishuDocId || '').trim();
        if (notionPageId || feishuDocId) {
          const conversation = (await requestToPromise(conversationIndex.get([source, conversationKey]) as any)) as
            | BackupRecord
            | undefined;
          if (conversation?.id) {
            let changed = false;
            if (notionPageId && !String(conversation.notionPageId || '').trim()) {
              conversation.notionPageId = notionPageId;
              changed = true;
            }
            if (feishuDocId && !String(conversation.feishuDocId || '').trim()) {
              conversation.feishuDocId = feishuDocId;
              changed = true;
            }
            if (changed) await requestToPromise(stores.conversations.put(conversation as any));
          }
        }
        reportProgress(onProgress, progress, 1, 'Mappings');
      }
      await transactionDone(transaction);
    }

    assertFactsOperationLease(lease);
    return stats;
  } finally {
    db.close();
  }
}

export function createIdbBackupFactsAdapter(lease: FactsOperationLease): BackupFactsAdapter {
  assertFactsOperationLease(lease);
  return Object.freeze({
    exportFacts: async () => await exportFacts(lease),
    importFacts: async (facts, onProgress) => await importFacts(lease, facts, onProgress),
  });
}
