import { openDb as openSchemaDb } from '@platform/idb/schema';
import {
  invalidateConversationListStatsCache,
  mergeStringFallback,
  mergeWarningFlags,
  migrateSyncMappingKey,
  normalizeConversationListRecord,
  pickMaxFiniteNumber,
} from '@services/conversations/data/storage-idb';
import type {
  ArticleUrlOperation,
  ArticleUrlOperationInput,
  ArticleUrlOperationResult,
} from '@services/conversations/data/article-url-operation';
import type { ResolvedConversationReference } from '@services/conversations/data/storage-native';
import { LocalDataContractError } from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

const ARTICLE_URL_STORES = ['conversations', 'messages', 'sync_mappings', 'image_cache', 'article_comments'] as const;

type ArticleUrlStores = Readonly<{
  article_comments: IDBObjectStore;
  conversations: IDBObjectStore;
  image_cache: IDBObjectStore;
  messages: IDBObjectStore;
  sync_mappings: IDBObjectStore;
}>;

function staleReference(): never {
  throw new LocalDataContractError('STALE_REFERENCE');
}

function invalidArgument(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error || new Error('indexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('indexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('indexedDB transaction aborted'));
  });
}

function stores(transaction: IDBTransaction): ArticleUrlStores {
  return {
    article_comments: transaction.objectStore('article_comments'),
    conversations: transaction.objectStore('conversations'),
    image_cache: transaction.objectStore('image_cache'),
    messages: transaction.objectStore('messages'),
    sync_mappings: transaction.objectStore('sync_mappings'),
  };
}

function resolvedReference(value: ResolvedConversationReference): ResolvedConversationReference {
  const source = String(value?.source || '').trim();
  const conversationKey = String(value?.conversationKey || '').trim();
  const conversationId = Number(value?.conversationId);
  if (!source || !conversationKey || !Number.isSafeInteger(conversationId) || conversationId <= 0) staleReference();
  return { source, conversationKey, conversationId };
}

function conversationIdentity(row: any): ResolvedConversationReference {
  const source = String(row?.source || '').trim();
  const conversationKey = String(row?.conversationKey || '').trim();
  const conversationId = Number(row?.id);
  if (!source || !conversationKey || !Number.isSafeInteger(conversationId) || conversationId <= 0) staleReference();
  return { source, conversationKey, conversationId };
}

async function resolveConversation(
  store: IDBObjectStore,
  value: ResolvedConversationReference,
): Promise<{ reference: ResolvedConversationReference; row: any }> {
  const expected = resolvedReference(value);
  const row = await request<any>(
    store.index('by_source_conversationKey').get([expected.source, expected.conversationKey]),
  );
  if (!row) staleReference();
  const actual = conversationIdentity(row);
  if (actual.conversationId !== expected.conversationId) staleReference();
  return { reference: actual, row };
}

function articleCanonicalUrl(row: any): string {
  return canonicalizeArticleUrl(row?.url);
}

function articleTargetKey(canonicalUrl: string): string {
  return `article:${canonicalUrl}`;
}

function assertCurrentArticle(row: any, fromCanonicalUrl: string): void {
  if (
    String(row?.source || '')
      .trim()
      .toLowerCase() !== 'web' ||
    String(row?.sourceType || '')
      .trim()
      .toLowerCase() !== 'article' ||
    articleCanonicalUrl(row) !== fromCanonicalUrl
  ) {
    staleReference();
  }
}

async function moveMessages(input: {
  keepConversationId: number;
  removeConversationId: number;
  store: IDBObjectStore;
}): Promise<number> {
  const sequence = input.store.index('by_conversationId_sequence');
  const byKey = input.store.index('by_conversationId_messageKey');
  const rows =
    (await request<any[]>(
      sequence.getAll(
        IDBKeyRange.bound(
          [input.removeConversationId, -Infinity] as IDBValidKey,
          [input.removeConversationId, Infinity] as IDBValidKey,
        ),
      ),
    )) || [];
  let moved = 0;
  for (const row of rows) {
    const messageKey = String(row?.messageKey || '').trim();
    if (messageKey) {
      const duplicate = await request<any>(byKey.get([input.keepConversationId, messageKey]));
      if (duplicate) {
        await request(input.store.delete(row.id));
        continue;
      }
    }
    await request(input.store.put({ ...row, conversationId: input.keepConversationId }));
    moved += 1;
  }
  return moved;
}

async function moveImages(input: {
  keepConversationId: number;
  removeConversationId: number;
  store: IDBObjectStore;
}): Promise<number> {
  const byConversation = input.store.index('by_conversationId');
  const byUrl = input.store.index('by_conversationId_url');
  const rows = (await request<any[]>(byConversation.getAll(IDBKeyRange.only(input.removeConversationId)))) || [];
  let moved = 0;
  for (const row of rows) {
    const url = String(row?.url || '').trim();
    if (!url) invalidArgument();
    const duplicate = await request<any>(byUrl.get([input.keepConversationId, url]));
    if (duplicate) {
      await request(input.store.delete(row.id));
      continue;
    }
    await request(input.store.put({ ...row, conversationId: input.keepConversationId }));
    moved += 1;
  }
  return moved;
}

async function moveAttachedComments(input: {
  keepConversationId: number;
  removeConversationId: number;
  store: IDBObjectStore;
}): Promise<void> {
  const index = input.store.index('by_conversationId_createdAt');
  const rows =
    (await request<any[]>(
      index.getAll(
        IDBKeyRange.bound(
          [input.removeConversationId, -Infinity] as IDBValidKey,
          [input.removeConversationId, Infinity] as IDBValidKey,
        ),
      ),
    )) || [];
  if (!rows.length) return;
  const now = Date.now();
  for (const row of rows) {
    await request(input.store.put({ ...row, conversationId: input.keepConversationId, updatedAt: now }));
  }
}

async function migrateCommentsCanonicalUrl(input: {
  conversationId: number;
  fromCanonicalUrl: string;
  store: IDBObjectStore;
  toCanonicalUrl: string;
}): Promise<number> {
  if (input.fromCanonicalUrl === input.toCanonicalUrl) return 0;
  const index = input.store.index('by_canonicalUrl_createdAt');
  const rows =
    (await request<any[]>(
      index.getAll(
        IDBKeyRange.bound(
          [input.fromCanonicalUrl, -Infinity] as IDBValidKey,
          [input.fromCanonicalUrl, Infinity] as IDBValidKey,
        ),
      ),
    )) || [];
  const now = Date.now();
  let updated = 0;
  for (const row of rows) {
    const rowConversationId = Number(row?.conversationId);
    if (Number.isFinite(rowConversationId) && rowConversationId > 0 && rowConversationId !== input.conversationId) {
      continue;
    }
    await request(input.store.put({ ...row, canonicalUrl: input.toCanonicalUrl, updatedAt: now }));
    updated += 1;
  }
  return updated;
}

function mergedConversation(keep: any, remove: any, toCanonicalUrl: string): any {
  return normalizeConversationListRecord({
    ...keep,
    sourceType: mergeStringFallback(keep?.sourceType, remove?.sourceType) || 'article',
    source: 'web',
    conversationKey: articleTargetKey(toCanonicalUrl),
    title: mergeStringFallback(keep?.title, remove?.title),
    url: toCanonicalUrl,
    author: mergeStringFallback(keep?.author, remove?.author),
    publishedAt: mergeStringFallback(keep?.publishedAt, remove?.publishedAt),
    notionPageId: mergeStringFallback(keep?.notionPageId, remove?.notionPageId),
    feishuDocId: mergeStringFallback(keep?.feishuDocId, remove?.feishuDocId),
    warningFlags: mergeWarningFlags(keep?.warningFlags, remove?.warningFlags),
    lastCapturedAt: pickMaxFiniteNumber(keep?.lastCapturedAt, remove?.lastCapturedAt) || Date.now(),
  });
}

async function updateWithinTransaction(
  currentStores: ArticleUrlStores,
  input: ArticleUrlOperationInput,
): Promise<ArticleUrlOperationResult> {
  const fromCanonicalUrl = canonicalizeArticleUrl(input.fromCanonicalUrl);
  const toCanonicalUrl = canonicalizeArticleUrl(input.toCanonicalUrl);
  if (!fromCanonicalUrl || !toCanonicalUrl) invalidArgument();

  const current = await resolveConversation(currentStores.conversations, input.conversation);
  assertCurrentArticle(current.row, fromCanonicalUrl);
  if (fromCanonicalUrl === toCanonicalUrl) {
    if (input.confirmedConflict) staleReference();
    return Object.freeze({ commentsUpdated: 0, conversation: current.reference, merged: false });
  }

  const targetKey = articleTargetKey(toCanonicalUrl);
  const conflictRow = await request<any>(
    currentStores.conversations.index('by_source_conversationKey').get(['web', targetKey]),
  );
  const conflict = conflictRow ? conversationIdentity(conflictRow) : null;

  if (conflict && conflict.conversationId !== current.reference.conversationId) {
    if (!input.confirmedConflict) staleReference();
    const confirmed = await resolveConversation(currentStores.conversations, input.confirmedConflict);
    if (confirmed.reference.conversationId !== conflict.conversationId) staleReference();

    const merged = mergedConversation(conflictRow, current.row, toCanonicalUrl);
    await moveMessages({
      keepConversationId: conflict.conversationId,
      removeConversationId: current.reference.conversationId,
      store: currentStores.messages,
    });
    await moveImages({
      keepConversationId: conflict.conversationId,
      removeConversationId: current.reference.conversationId,
      store: currentStores.image_cache,
    });
    await moveAttachedComments({
      keepConversationId: conflict.conversationId,
      removeConversationId: current.reference.conversationId,
      store: currentStores.article_comments,
    });
    await migrateSyncMappingKey(currentStores.sync_mappings, {
      legacySource: current.reference.source,
      legacyConversationKey: current.reference.conversationKey,
      nextSource: conflict.source,
      nextConversationKey: conflict.conversationKey,
      fallbackNotionPageId: merged.notionPageId,
    });
    await request(currentStores.conversations.put(merged));
    await request(currentStores.conversations.delete(current.reference.conversationId));
    const commentsUpdated = await migrateCommentsCanonicalUrl({
      conversationId: conflict.conversationId,
      fromCanonicalUrl,
      toCanonicalUrl,
      store: currentStores.article_comments,
    });
    return Object.freeze({
      commentsUpdated,
      conversation: conflict,
      merged: true,
      removedConversationId: current.reference.conversationId,
    });
  }

  if (input.confirmedConflict) staleReference();
  const nextRow = normalizeConversationListRecord({
    ...current.row,
    source: 'web',
    sourceType: 'article',
    conversationKey: targetKey,
    url: toCanonicalUrl,
  });
  await migrateSyncMappingKey(currentStores.sync_mappings, {
    legacySource: current.reference.source,
    legacyConversationKey: current.reference.conversationKey,
    nextSource: 'web',
    nextConversationKey: targetKey,
    fallbackNotionPageId: nextRow.notionPageId,
  });
  await request(currentStores.conversations.put(nextRow));
  const commentsUpdated = await migrateCommentsCanonicalUrl({
    conversationId: current.reference.conversationId,
    fromCanonicalUrl,
    toCanonicalUrl,
    store: currentStores.article_comments,
  });
  return Object.freeze({
    commentsUpdated,
    conversation: { source: 'web', conversationKey: targetKey, conversationId: current.reference.conversationId },
    merged: false,
  });
}

export function createIdbArticleUrlOperation(lease: FactsOperationLease): ArticleUrlOperation {
  return Object.freeze({
    async update(input) {
      assertFactsOperationLease(lease);
      const db = await openSchemaDb();
      assertFactsOperationLease(lease);
      const transaction = db.transaction([...ARTICLE_URL_STORES], 'readwrite');
      const completion = transactionDone(transaction);
      try {
        const result = await updateWithinTransaction(stores(transaction), input);
        await completion;
        assertFactsOperationLease(lease);
        if (canonicalizeArticleUrl(input.fromCanonicalUrl) !== canonicalizeArticleUrl(input.toCanonicalUrl)) {
          invalidateConversationListStatsCache();
        }
        return result;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have aborted because an IndexedDB request failed.
        }
        await completion.catch(() => {});
        throw error;
      } finally {
        db.close();
      }
    },
  });
}
