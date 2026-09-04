import type { Conversation, ConversationMessage } from '@services/conversations/domain/models';
import {
  hasReusableImageCachePayload,
  reusableImageCacheByteSize,
} from '@services/conversations/data/image-cache-record';
import {
  buildCanonicalWebArticleIdentity,
  normalizeWebArticleConversationKey,
  WEB_ARTICLE_SOURCE,
} from '@services/conversations/domain/article-identity';
import type { CaptureMessageMergePolicy } from '@services/shared/capture-integrity';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import {
  LIST_SITE_KEY_ALL,
  LIST_SOURCE_KEY_ALL,
  normalizeConversationListQuery,
  type ConversationListQueryInput,
} from '@services/conversations/domain/list-query';
import type {
  ConversationListCursor,
  ConversationListFacets,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListSummary,
} from '@services/conversations/domain/list-pagination';
import {
  buildGithubCleanupOutboxRecord,
  GITHUB_CLEANUP_OUTBOX_STORE,
} from '@platform/idb/github-cleanup-outbox-record';
import {
  deriveConversationListStoredSiteKeyFromUrl,
  normalizeConversationListRecord,
} from '@platform/idb/conversation-list-record';
import { openDb } from '@platform/idb/schema';
import {
  DATA_REVISION_RECORD_KEY,
  DATA_REVISION_STORE_BY_SCOPE,
  normalizeDataRevisionRecord,
} from '@platform/idb/data-revision-record';
import {
  areSyncMappingsBusinessEquivalent,
  mergeSyncMappingForIdentityMove,
  mergeSyncMappingPatch,
  readGithubContinuity,
} from '@platform/idb/sync-mapping-record';
import { computeArticleCommentThreadCount } from '@services/comments/domain/comment-metrics';
import { runTrackedTransaction } from '@services/data-revisions/transaction';
import { isGithubManagedPathOwnedByConversation } from '@services/sync/github/github-managed-path-ownership';

let conversationListStatsCacheKey: string | null = null;
let conversationListStatsCacheValue: { summary: ConversationListSummary; facets: ConversationListFacets } | null = null;

export function __resetConversationStorageStateForTests(): void {
  conversationListStatsCacheKey = null;
  conversationListStatsCacheValue = null;
}

function tx(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
): { t: IDBTransaction; stores: Record<string, IDBObjectStore> } {
  const t = db.transaction(storeNames, mode);
  const stores: Record<string, IDBObjectStore> = {};
  for (const name of storeNames) stores[name] = t.objectStore(name);
  return { t, stores };
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(t: IDBTransaction): Promise<true> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error('transaction failed'));
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

function withOptionalId<T extends Record<string, any>>(existingId: unknown, payload: T): T & { id?: number } {
  const id = Number(existingId);
  if (Number.isFinite(id) && id > 0) return { id, ...payload };
  return { ...payload };
}

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function storedValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => storedValueEqual(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return false;
    const key = leftKeys[index];
    if (!storedValueEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

function conversationRecordsEquivalent(left: unknown, right: unknown): boolean {
  const leftRecord = { ...((left && typeof left === 'object' ? left : {}) as Record<string, unknown>) };
  const rightRecord = { ...((right && typeof right === 'object' ? right : {}) as Record<string, unknown>) };
  delete leftRecord.id;
  delete rightRecord.id;
  return storedValueEqual(leftRecord, rightRecord);
}

type ResolvedMessageTimestamp = { present: false } | { present: true; value: unknown };

function resolveMessageTimestamp(
  existing: Record<string, unknown> | null | undefined,
  incoming: unknown,
  preserveExisting: boolean,
): ResolvedMessageTimestamp {
  const hasExistingTimestamp = !!existing && Object.prototype.hasOwnProperty.call(existing, 'updatedAt');
  if (preserveExisting && existing) {
    return hasExistingTimestamp ? { present: true, value: existing.updatedAt } : { present: false };
  }
  if (typeof incoming === 'number' && Number.isFinite(incoming)) return { present: true, value: incoming };
  if (existing) return hasExistingTimestamp ? { present: true, value: existing.updatedAt } : { present: false };
  return { present: true, value: Date.now() };
}

function messageRecordsEquivalent(left: unknown, right: unknown): boolean {
  const leftRecord = { ...((left && typeof left === 'object' ? left : {}) as Record<string, unknown>) };
  const rightRecord = { ...((right && typeof right === 'object' ? right : {}) as Record<string, unknown>) };
  delete leftRecord.id;
  delete rightRecord.id;
  return storedValueEqual(leftRecord, rightRecord);
}

function normalizeListKey(value: unknown, fallback: string): string {
  const text = safeString(value).toLowerCase();
  return text || fallback;
}

function toComparableCursor(cursor: ConversationListCursor | null | undefined): ConversationListCursor | null {
  if (!cursor) return null;
  const lastCapturedAt = Number(cursor.lastCapturedAt);
  const id = Number(cursor.id);
  if (!Number.isFinite(lastCapturedAt) || !Number.isFinite(id) || id <= 0) return null;
  return { lastCapturedAt, id };
}

function invalidateConversationListStatsCache(): void {
  conversationListStatsCacheKey = null;
  conversationListStatsCacheValue = null;
}

function sortFacetItems(items: Array<{ key: string; label: string; count: number }>): Array<{
  key: string;
  label: string;
  count: number;
}> {
  return items.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
}

function isArticlePayload(payload: any): boolean {
  return safeString(payload?.sourceType).toLowerCase() === 'article';
}

async function findExistingArticleConversationByUrl(
  conversationsStore: IDBObjectStore,
  rawUrl: unknown,
): Promise<any | null> {
  const normalizedUrl = canonicalizeArticleUrl(rawUrl);
  if (!normalizedUrl) return null;
  const siteKey = deriveConversationListStoredSiteKeyFromUrl(normalizedUrl);
  if (!siteKey || siteKey === 'unknown') return null;

  const index = conversationsStore.index('by_listSiteKey_lastCapturedAt_id');
  const range = globalThis.IDBKeyRange.bound(
    [siteKey, -Infinity, -Infinity] as any,
    [siteKey, Infinity, Infinity] as any,
  );
  let best: any | null = null;
  const cursorReq = index.openCursor(range);
  await new Promise<void>((resolve, reject) => {
    cursorReq.onerror = () => reject(cursorReq.error || new Error('article identity cursor failed'));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result as IDBCursorWithValue | null;
      if (!cursor) return resolve();
      const row = cursor.value as any;
      if (
        safeString(row?.sourceType).toLowerCase() === 'article' &&
        canonicalizeArticleUrl(row?.url) === normalizedUrl
      ) {
        const rowIdentity = buildCanonicalWebArticleIdentity(row?.url);
        const bestIdentity = best ? buildCanonicalWebArticleIdentity(best?.url) : null;
        const rowCanonical =
          safeString(row?.source) === WEB_ARTICLE_SOURCE && rowIdentity?.conversationKey === safeString(row?.conversationKey);
        const bestCanonical =
          !!best &&
          safeString(best?.source) === WEB_ARTICLE_SOURCE &&
          bestIdentity?.conversationKey === safeString(best?.conversationKey);
        const rowMapped = !!safeString(row?.notionPageId);
        const bestMapped = !!safeString(best?.notionPageId);
        const rowCapturedAt = Number(row?.lastCapturedAt) || 0;
        const bestCapturedAt = Number(best?.lastCapturedAt) || 0;
        const rowId = Number(row?.id) || 0;
        const bestId = Number(best?.id) || 0;

        if (
          !best ||
          (rowCanonical && !bestCanonical) ||
          (rowCanonical === bestCanonical && rowMapped && !bestMapped) ||
          (rowCanonical === bestCanonical && rowMapped === bestMapped && rowCapturedAt > bestCapturedAt) ||
          (rowCanonical === bestCanonical &&
            rowMapped === bestMapped &&
            rowCapturedAt === bestCapturedAt &&
            rowId > bestId)
        ) {
          best = row;
        }
      }
      cursor.continue();
    };
  });

  // ponytail: 同站点 fallback 仍是 O(site rows)；只有实测成为热点时才值得新增 canonical URL identity index。
  return best;
}

async function findExistingConversationForPayload(
  conversationsStore: IDBObjectStore,
  payload: any,
): Promise<any | null> {
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'id')) {
    const explicitId = Number(payload.id);
    if (!Number.isSafeInteger(explicitId) || explicitId <= 0) throw new Error('invalid conversation id');
    const explicit = await reqToPromise<any>(conversationsStore.get(explicitId));
    if (!explicit) throw new Error('conversation not found');
    return explicit;
  }

  const source = safeString(payload?.source);
  let conversationKey = safeString(payload?.conversationKey);
  if (!source) return null;

  if (isArticlePayload(payload) && source.toLowerCase() === WEB_ARTICLE_SOURCE) {
    const identity = buildCanonicalWebArticleIdentity(payload?.url);
    if (identity) conversationKey = identity.conversationKey;
    conversationKey = normalizeWebArticleConversationKey(conversationKey);
  }

  if (!conversationKey) return null;
  const idx = conversationsStore.index('by_source_conversationKey');
  let existing: any = await reqToPromise(idx.get([source, conversationKey]) as any);
  if (!existing && isArticlePayload(payload)) {
    existing = await findExistingArticleConversationByUrl(conversationsStore, payload?.url);
  }
  return existing || null;
}

function pickMaxFiniteNumber(...values: unknown[]): number | null {
  let max: number | null = null;
  for (const value of values) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) continue;
    if (max == null || numberValue > max) max = numberValue;
  }
  return max;
}

function mergeStringFallback(preferred: unknown, fallback: unknown): string {
  const a = safeString(preferred);
  if (a) return a;
  return safeString(fallback);
}

function mergeWarningFlags(preferred: unknown, fallback: unknown): string[] {
  const a = Array.isArray(preferred) ? preferred : [];
  const b = Array.isArray(fallback) ? fallback : [];
  const out: string[] = [];
  for (const item of [...a, ...b]) {
    const text = safeString(item);
    if (!text) continue;
    if (out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

function readOwnedGithubCleanupSnapshot(
  mapping: unknown,
  conversation: unknown,
): { remoteKey: string; paths: string[] } | null {
  const continuity = readGithubContinuity(mapping);
  const remoteKey = safeString(continuity.githubRemoteKey);
  const managedFiles =
    continuity.githubManagedFiles && typeof continuity.githubManagedFiles === 'object'
      ? (continuity.githubManagedFiles as Record<string, any>)
      : {};
  if (!remoteKey || !conversation) return null;
  const paths = Object.entries(managedFiles)
    .filter(([path, metadata]) => isGithubManagedPathOwnedByConversation(path, metadata?.kind, conversation))
    .map(([path]) => path);
  return paths.length ? { remoteKey, paths } : null;
}

async function enqueueGithubCleanupSnapshot(
  outboxStore: IDBObjectStore,
  snapshot: { remoteKey: string; paths: string[] } | null,
  input: { reason: 'delete' | 'identity_move'; createdAt: number; replacementConversationId?: number },
): Promise<void> {
  if (!snapshot) return;
  await reqToPromise(
    outboxStore.add(
      buildGithubCleanupOutboxRecord({
        remoteKey: snapshot.remoteKey,
        paths: snapshot.paths,
        reason: input.reason,
        createdAt: input.createdAt,
        ...(input.reason === 'identity_move' ? { replacementConversationId: input.replacementConversationId } : {}),
      }),
    ),
  );
}

async function migrateArticleCommentsForIdentityRewrite(
  commentsStore: IDBObjectStore,
  input: { conversationId: number; fromCanonicalUrl: string; toCanonicalUrl: string; updatedAt: number },
): Promise<number> {
  if (!input.fromCanonicalUrl || !input.toCanonicalUrl || input.fromCanonicalUrl === input.toCanonicalUrl) return 0;
  const index = commentsStore.index('by_canonicalUrl_createdAt');
  const range = globalThis.IDBKeyRange.bound(
    [input.fromCanonicalUrl, -Infinity] as any,
    [input.fromCanonicalUrl, Infinity] as any,
  );
  const rows = (await reqToPromise(index.getAll(range) as any)) as any[];
  let updated = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const currentConversationId = Number(row.conversationId);
    const isOrphan =
      row.conversationId == null || !Number.isFinite(currentConversationId) || currentConversationId <= 0;
    if (!isOrphan && currentConversationId !== input.conversationId) continue;
    await reqToPromise(commentsStore.put({ ...row, canonicalUrl: input.toCanonicalUrl, updatedAt: input.updatedAt }));
    updated += 1;
  }
  return updated;
}

async function migrateSyncMappingKey(
  syncMappingsStore: IDBObjectStore,
  outboxStore: IDBObjectStore,
  input: {
    legacySource: unknown;
    legacyConversationKey: unknown;
    nextSource: unknown;
    nextConversationKey: unknown;
    fallbackNotionPageId?: unknown;
    legacyConversation?: unknown;
    replacementConversationId?: number;
    createdAt: number;
  },
): Promise<{ syncMappingChanged: boolean }> {
  const legacySource = safeString(input.legacySource);
  const legacyConversationKey = safeString(input.legacyConversationKey);
  const nextSource = safeString(input.nextSource);
  const nextConversationKey = safeString(input.nextConversationKey);
  const fallbackNotionPageId = safeString(input.fallbackNotionPageId);

  if (!nextSource || !nextConversationKey) return { syncMappingChanged: false };
  const idx = syncMappingsStore.index('by_source_conversationKey');

  const target = (await reqToPromise(idx.get([nextSource, nextConversationKey]) as any)) as any;
  const identity = { source: nextSource, conversationKey: nextConversationKey, fallbackNotionPageId };
  const persistTargetFallback = async (): Promise<boolean> => {
    if (!target) return false;
    const merged = mergeSyncMappingForIdentityMove(target, null, identity) as any;
    if (areSyncMappingsBusinessEquivalent(merged, target)) return false;
    await reqToPromise(syncMappingsStore.put(merged));
    return true;
  };

  if (legacySource === nextSource && legacyConversationKey === nextConversationKey) {
    return { syncMappingChanged: await persistTargetFallback() };
  }

  if (!legacySource || !legacyConversationKey) {
    return { syncMappingChanged: await persistTargetFallback() };
  }

  const legacy = (await reqToPromise(idx.get([legacySource, legacyConversationKey]) as any)) as any;
  if (!legacy) {
    return { syncMappingChanged: await persistTargetFallback() };
  }

  const replacementConversationId = Number(input.replacementConversationId);
  if (Number.isSafeInteger(replacementConversationId) && replacementConversationId > 0) {
    await enqueueGithubCleanupSnapshot(outboxStore, readOwnedGithubCleanupSnapshot(legacy, input.legacyConversation), {
      reason: 'identity_move',
      replacementConversationId,
      createdAt: input.createdAt,
    });
  }

  if (!target) {
    const moved = mergeSyncMappingForIdentityMove(null, legacy, identity) as any;
    await reqToPromise(syncMappingsStore.put(moved));
    return { syncMappingChanged: true };
  }

  let syncMappingChanged = false;
  const merged = mergeSyncMappingForIdentityMove(target, legacy, identity) as any;
  if (!areSyncMappingsBusinessEquivalent(merged, target)) {
    await reqToPromise(syncMappingsStore.put(merged));
    syncMappingChanged = true;
  }

  const legacyId = Number(legacy.id);
  if (Number.isFinite(legacyId) && legacyId > 0 && legacyId !== Number(target.id)) {
    await reqToPromise(syncMappingsStore.delete(legacyId));
    syncMappingChanged = true;
  }
  return { syncMappingChanged };
}

export async function upsertConversation(payload: any): Promise<Conversation & { __isNew: boolean }> {
  const db = await openDb();
  const outcome = await runTrackedTransaction(
    {
      db,
      stores: ['conversations', 'sync_mappings', 'article_comments', GITHUB_CLEANUP_OUTBOX_STORE],
      revisionScopes: ['conversations', 'sync_mappings', 'article_comments'],
    },
    async ({ stores, markChanged }) => {
      const existing = await findExistingConversationForPayload(stores.conversations, payload);

      const now = Date.now();
      const nextSource = safeString(payload.source) || (existing ? safeString(existing.source) : '');
      const nextSourceType = payload.sourceType || (existing ? existing.sourceType || 'chat' : 'chat');
      const isArticleSource =
        safeString(nextSourceType).toLowerCase() === 'article' && nextSource.toLowerCase() === WEB_ARTICLE_SOURCE;

      const payloadUrl = payload.url && String(payload.url).trim() ? String(payload.url).trim() : '';
      const existingUrl = existing ? String(existing.url || '').trim() : '';
      const nextUrlCandidate = payloadUrl || existingUrl;
      const articleIdentity = isArticleSource ? buildCanonicalWebArticleIdentity(nextUrlCandidate) : null;
      const nextUrl = articleIdentity?.url || nextUrlCandidate;

      const payloadConversationKey = payload.conversationKey && String(payload.conversationKey).trim();
      const existingConversationKey = existing ? String(existing.conversationKey || '').trim() : '';
      const nextConversationKey = isArticleSource
        ? articleIdentity?.conversationKey ||
          normalizeWebArticleConversationKey(payloadConversationKey || existingConversationKey)
        : String(payloadConversationKey || existingConversationKey || '').trim();

      const nextTitle = payload.title && String(payload.title).trim() ? String(payload.title).trim() : '';
      const nextLastCapturedAt = payload.lastCapturedAt || (existing ? existing.lastCapturedAt || now : now);
      const existingBase = existing && typeof existing === 'object' ? { ...existing } : {};
      delete existingBase.id;
      const baseRecord = normalizeConversationListRecord({
        ...existingBase,
        sourceType: nextSourceType,
        source: nextSource,
        conversationKey: nextConversationKey,
        title: nextTitle || (existing ? existing.title || '' : ''),
        url: nextUrl || (existing ? existing.url || '' : ''),
        author: payload.author || (existing ? existing.author || '' : ''),
        publishedAt: payload.publishedAt || (existing ? existing.publishedAt || '' : ''),
        warningFlags: Array.isArray(payload.warningFlags)
          ? payload.warningFlags
          : existing
            ? existing.warningFlags || []
            : [],
        notionPageId: payload.notionPageId || (existing ? existing.notionPageId || '' : ''),
        feishuDocId: payload.feishuDocId || (existing ? existing.feishuDocId || '' : ''),
        lastCapturedAt: nextLastCapturedAt,
      });

      const record: any = withOptionalId(existing && existing.id, baseRecord);

      if (existing) {
        const replacementConversationId = Number(existing.id);
        const mappingMutation = await migrateSyncMappingKey(stores.sync_mappings, stores[GITHUB_CLEANUP_OUTBOX_STORE], {
          legacySource: existing.source,
          legacyConversationKey: existing.conversationKey,
          nextSource: record.source,
          nextConversationKey: record.conversationKey,
          fallbackNotionPageId: record.notionPageId,
          legacyConversation: existing,
          replacementConversationId,
          createdAt: now,
        });
        if (mappingMutation.syncMappingChanged) markChanged('sync_mappings');

        if (isArticleSource && Number.isSafeInteger(replacementConversationId) && replacementConversationId > 0) {
          const fromCanonicalUrl = canonicalizeArticleUrl(existingUrl);
          const toCanonicalUrl = canonicalizeArticleUrl(record.url);
          const updatedComments = await migrateArticleCommentsForIdentityRewrite(stores.article_comments, {
            conversationId: replacementConversationId,
            fromCanonicalUrl,
            toCanonicalUrl,
            updatedAt: now,
          });
          if (updatedComments > 0) markChanged('article_comments');
        }

        const conversationChanged = !conversationRecordsEquivalent(existing, record);
        if (conversationChanged) {
          await reqToPromise(stores.conversations.put(record));
          markChanged('conversations');
        }
        return { record, conversationChanged, isNew: false };
      }

      const id = await reqToPromise(stores.conversations.add(record));
      record.id = id as any;
      markChanged('conversations');
      return { record, conversationChanged: true, isNew: true };
    },
  );

  if (outcome.conversationChanged) invalidateConversationListStatsCache();
  return { ...outcome.record, __isNew: outcome.isNew };
}

export async function mergeConversationsByIds(input: {
  keepConversationId: number;
  removeConversationId: number;
}): Promise<{
  keptConversationId: number;
  removedConversationId: number;
  movedMessages: number;
  movedImageCache: number;
  merged: boolean;
}> {
  const keepConversationId = Number(input.keepConversationId);
  const removeConversationId = Number(input.removeConversationId);
  if (!Number.isFinite(keepConversationId) || keepConversationId <= 0) throw new Error('invalid keepConversationId');
  if (!Number.isFinite(removeConversationId) || removeConversationId <= 0)
    throw new Error('invalid removeConversationId');
  if (keepConversationId === removeConversationId) {
    return {
      keptConversationId: keepConversationId,
      removedConversationId: removeConversationId,
      movedMessages: 0,
      movedImageCache: 0,
      merged: false,
    };
  }

  const db = await openDb();
  const outcome = await runTrackedTransaction(
    {
      db,
      stores: [
        'conversations',
        'messages',
        'sync_mappings',
        'image_cache',
        'article_comments',
        GITHUB_CLEANUP_OUTBOX_STORE,
      ],
      revisionScopes: ['conversations', 'messages', 'sync_mappings', 'image_cache', 'article_comments'],
    },
    async ({ stores, markChanged }) => {
      const keep: any = await reqToPromise(stores.conversations.get(keepConversationId as any));
      const remove: any = await reqToPromise(stores.conversations.get(removeConversationId as any));
      if (!keep) throw new Error('keep conversation not found');
      if (!remove) {
        return {
          result: {
            keptConversationId: keepConversationId,
            removedConversationId: removeConversationId,
            movedMessages: 0,
            movedImageCache: 0,
            merged: false,
          },
          conversationChanged: false,
        };
      }

      const now = Date.now();
      const mergedConversation: any = normalizeConversationListRecord({
        ...keep,
        sourceType: mergeStringFallback(keep.sourceType, remove.sourceType) || 'chat',
        title: mergeStringFallback(keep.title, remove.title),
        url: mergeStringFallback(keep.url, remove.url),
        author: mergeStringFallback(keep.author, remove.author),
        publishedAt: mergeStringFallback(keep.publishedAt, remove.publishedAt),
        notionPageId: mergeStringFallback(keep.notionPageId, remove.notionPageId),
        feishuDocId: mergeStringFallback(keep.feishuDocId, remove.feishuDocId),
        warningFlags: mergeWarningFlags(keep.warningFlags, remove.warningFlags),
        lastCapturedAt: pickMaxFiniteNumber(keep.lastCapturedAt, remove.lastCapturedAt) || now,
      });

      const mappingMutation = await migrateSyncMappingKey(stores.sync_mappings, stores[GITHUB_CLEANUP_OUTBOX_STORE], {
        legacySource: remove.source,
        legacyConversationKey: remove.conversationKey,
        nextSource: keep.source,
        nextConversationKey: keep.conversationKey,
        fallbackNotionPageId: mergedConversation.notionPageId,
        legacyConversation: remove,
        replacementConversationId: keepConversationId,
        createdAt: now,
      });
      if (mappingMutation.syncMappingChanged) markChanged('sync_mappings');

      if (!conversationRecordsEquivalent(keep, mergedConversation)) {
        await reqToPromise(stores.conversations.put(mergedConversation));
        markChanged('conversations');
      }

      const msgSeqIdx = stores.messages.index('by_conversationId_sequence');
      const msgKeyIdx = stores.messages.index('by_conversationId_messageKey');
      const msgRange = globalThis.IDBKeyRange.bound(
        [removeConversationId, -Infinity] as any,
        [removeConversationId, Infinity] as any,
      );
      const msgRows = (await reqToPromise(msgSeqIdx.getAll(msgRange) as any)) as any[];
      let movedMessages = 0;
      for (const row of Array.isArray(msgRows) ? msgRows : []) {
        if (!row) continue;
        const rowId = Number(row.id);
        const key = safeString(row.messageKey);
        if (key) {
          const exists = (await reqToPromise(msgKeyIdx.get([keepConversationId, key] as any) as any)) as any;
          if (exists) {
            if (Number.isFinite(rowId) && rowId > 0) {
              await reqToPromise(stores.messages.delete(rowId));
              markChanged('messages');
            }
            continue;
          }
        }
        row.conversationId = keepConversationId;
        await reqToPromise(stores.messages.put(row));
        markChanged('messages');
        movedMessages += 1;
      }

      const imageByConversation = stores.image_cache.index('by_conversationId');
      const imageByIdentity = stores.image_cache.index('by_conversationId_url');
      const imgRange = globalThis.IDBKeyRange.only(removeConversationId);
      const imgRows = (await reqToPromise(imageByConversation.getAll(imgRange) as any)) as any[];
      let movedImageCache = 0;
      for (const row of Array.isArray(imgRows) ? imgRows : []) {
        if (!row) continue;
        const rowId = Number(row.id);
        const lookupUrl = typeof row.url === 'string' ? row.url : null;
        const keepSide =
          lookupUrl == null
            ? null
            : ((await reqToPromise(imageByIdentity.get([keepConversationId, lookupUrl] as any) as any)) as any);

        if (keepSide && Number(keepSide.id) !== rowId) {
          const keepValid = hasReusableImageCachePayload(keepSide);
          const removeValid = hasReusableImageCachePayload(row);
          if (!keepValid && removeValid) {
            const repaired: any = {
              ...keepSide,
              blob: row.blob,
              byteSize: reusableImageCacheByteSize(row),
              contentType:
                safeString(row.contentType) || safeString(row.blob?.type) || safeString(keepSide.contentType),
              updatedAt: pickMaxFiniteNumber(keepSide.updatedAt, row.updatedAt) || now,
            };
            if (Object.prototype.hasOwnProperty.call(row, 'dataUrl')) repaired.dataUrl = row.dataUrl;
            else delete repaired.dataUrl;
            await reqToPromise(stores.image_cache.put(repaired));
            markChanged('image_cache');
            movedImageCache += 1;
          }
          if (Number.isFinite(rowId) && rowId > 0) {
            await reqToPromise(stores.image_cache.delete(rowId));
            markChanged('image_cache');
          }
          continue;
        }

        row.conversationId = keepConversationId;
        await reqToPromise(stores.image_cache.put(row));
        markChanged('image_cache');
        movedImageCache += 1;
      }

      const mergedIsArticle = safeString(mergedConversation.sourceType).toLowerCase() === 'article';
      const mergedCanonicalUrl = mergedIsArticle ? canonicalizeArticleUrl(mergedConversation.url) : '';
      const commentsIndex = stores.article_comments.index('by_conversationId_createdAt');
      const commentRange = globalThis.IDBKeyRange.bound(
        [removeConversationId, -Infinity] as any,
        [removeConversationId, Infinity] as any,
      );
      const commentRows = (await reqToPromise(commentsIndex.getAll(commentRange) as any)) as any[];
      for (const row of Array.isArray(commentRows) ? commentRows : []) {
        if (!row) continue;
        await reqToPromise(
          stores.article_comments.put({
            ...row,
            conversationId: keepConversationId,
            ...(mergedCanonicalUrl ? { canonicalUrl: mergedCanonicalUrl } : {}),
            updatedAt: now,
          }),
        );
        markChanged('article_comments');
      }

      await reqToPromise(stores.conversations.delete(removeConversationId));
      markChanged('conversations');

      return {
        result: {
          keptConversationId: keepConversationId,
          removedConversationId: removeConversationId,
          movedMessages,
          movedImageCache,
          merged: true,
        },
        conversationChanged: true,
      };
    },
  );

  if (outcome.conversationChanged) invalidateConversationListStatsCache();
  return outcome.result;
}

function mergeAnchoredMessageOrder(
  storedRows: any[],
  incomingKeys: string[],
): { keys: string[]; anchored: boolean; changed: boolean } {
  const storedKeys = (Array.isArray(storedRows) ? storedRows : [])
    .map((row) => safeString(row?.messageKey))
    .filter(Boolean);
  const incoming: string[] = [];
  const incomingSeen = new Set<string>();
  for (const rawKey of incomingKeys) {
    const key = safeString(rawKey);
    if (!key || incomingSeen.has(key)) continue;
    incomingSeen.add(key);
    incoming.push(key);
  }
  if (!storedKeys.length) return { keys: incoming, anchored: true, changed: incoming.length > 0 };

  const storedPositions = new Map(storedKeys.map((key, index) => [key, index]));
  const knownIncoming = incoming.filter((key) => storedPositions.has(key));
  const appendUnknown = () => {
    const keys = storedKeys.slice();
    for (const key of incoming) {
      if (!storedPositions.has(key)) keys.push(key);
    }
    return { keys, anchored: false, changed: keys.length !== storedKeys.length };
  };
  if (!knownIncoming.length) return appendUnknown();

  const incomingKeySet = new Set(incoming);
  if (storedKeys.every((key) => incomingKeySet.has(key))) {
    const changed = incoming.length !== storedKeys.length || incoming.some((key, index) => key !== storedKeys[index]);
    return { keys: incoming, anchored: true, changed };
  }

  const knownPositions = knownIncoming.map((key) => storedPositions.get(key) as number);
  if (knownPositions.some((position, index) => index > 0 && position <= knownPositions[index - 1])) {
    return appendUnknown();
  }

  const merged = storedKeys.slice();
  const knownSet = new Set(storedKeys);
  let cursor = 0;
  while (cursor < incoming.length) {
    if (knownSet.has(incoming[cursor])) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < incoming.length && !knownSet.has(incoming[cursor])) cursor += 1;
    const unknownRun = incoming.slice(start, cursor);
    const previousKnown = start > 0 ? incoming[start - 1] : '';
    const nextKnown = cursor < incoming.length ? incoming[cursor] : '';
    let insertionIndex = merged.length;
    if (nextKnown) insertionIndex = merged.indexOf(nextKnown);
    else if (previousKnown) {
      const previousIndex = merged.indexOf(previousKnown);
      insertionIndex = previousIndex < 0 ? merged.length : previousIndex + 1;
    }
    merged.splice(insertionIndex, 0, ...unknownRun);
    for (const key of unknownRun) knownSet.add(key);
  }

  const changed = merged.length !== storedKeys.length || merged.some((key, index) => key !== storedKeys[index]);
  return { keys: merged, anchored: true, changed };
}

export type ConversationMessageMarkdownPatch = {
  messageKey: string;
  beforeMarkdown: string;
  afterMarkdown: string;
};

export async function patchConversationMessageMarkdownBatch(
  conversationId: number,
  patches: ConversationMessageMarkdownPatch[],
): Promise<{ updated: number; conflicts: number }> {
  const safeConversationId = Number(conversationId);
  if (!Number.isFinite(safeConversationId) || safeConversationId <= 0) throw new Error('invalid conversationId');

  const uniqueByKey = new Map<string, ConversationMessageMarkdownPatch>();
  for (const rawPatch of Array.isArray(patches) ? patches : []) {
    const messageKey = String(rawPatch?.messageKey || '');
    if (!messageKey.trim()) continue;
    const patch: ConversationMessageMarkdownPatch = {
      messageKey,
      beforeMarkdown: String(rawPatch?.beforeMarkdown ?? ''),
      afterMarkdown: String(rawPatch?.afterMarkdown ?? ''),
    };
    const previous = uniqueByKey.get(messageKey);
    if (previous) {
      if (previous.beforeMarkdown !== patch.beforeMarkdown || previous.afterMarkdown !== patch.afterMarkdown) {
        throw new Error(`conflicting Markdown patches for messageKey: ${messageKey}`);
      }
      continue;
    }
    uniqueByKey.set(messageKey, patch);
  }

  const effectivePatches = Array.from(uniqueByKey.values()).filter(
    (patch) => patch.beforeMarkdown !== patch.afterMarkdown,
  );
  if (!effectivePatches.length) return { updated: 0, conflicts: 0 };

  const db = await openDb();
  return runTrackedTransaction(
    { db, stores: ['messages'], revisionScopes: ['messages'] },
    async ({ stores, markChanged }) => {
      const idx = stores.messages.index('by_conversationId_messageKey');
      let updated = 0;
      let conflicts = 0;

      for (const patch of effectivePatches) {
        const latest = (await reqToPromise(idx.get([safeConversationId, patch.messageKey]) as any)) as any;
        if (!latest || String(latest.contentMarkdown || '') !== patch.beforeMarkdown) {
          conflicts += 1;
          continue;
        }
        await reqToPromise(stores.messages.put({ ...latest, contentMarkdown: patch.afterMarkdown }));
        markChanged('messages');
        updated += 1;
      }

      return { updated, conflicts };
    },
  );
}

export async function syncConversationMessages(
  conversationId: number,
  messages: any[],
  options?: {
    mode?: 'snapshot' | 'incremental' | 'append';
    diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null;
  },
): Promise<{ upserted: number; deleted: number }> {
  const requestedMode = options?.mode;
  if (requestedMode !== undefined && !['snapshot', 'incremental', 'append'].includes(String(requestedMode))) {
    throw new Error(`Unknown message persistence mode: ${String(requestedMode)}`);
  }
  const mode = requestedMode || 'snapshot';
  const db = await openDb();

  return runTrackedTransaction(
    { db, stores: ['messages'], revisionScopes: ['messages'] },
    async ({ stores, markChanged }) => {
      const idx = stores.messages.index('by_conversationId_messageKey');
      const diff = options?.diff || null;
      const normalizeKeys = (value: unknown): string[] => {
        if (!Array.isArray(value)) return [];
        return value.map((x) => String(x || '').trim()).filter(Boolean);
      };

      if (mode !== 'snapshot') {
        const byKey = new Map<string, any>();
        for (const m of messages || []) {
          const key = m && m.messageKey ? String(m.messageKey).trim() : '';
          if (!key) continue;
          byKey.set(key, m);
        }

        const requestedKeys = Array.from(new Set([...normalizeKeys(diff?.added), ...normalizeKeys(diff?.updated)]));
        const requestedKeySet = new Set(requestedKeys);
        const removedKeys = mode === 'incremental' ? normalizeKeys(diff?.removed) : [];
        const hasEffectiveDiff =
          !!diff && (mode === 'append' ? requestedKeys.length > 0 : requestedKeys.length > 0 || removedKeys.length > 0);
        if (!hasEffectiveDiff) return { upserted: 0, deleted: 0 };
        const upsertKeys = Array.from(byKey.keys()).filter((key) => requestedKeySet.has(key));

        const hasTailPolicy =
          mode === 'append' &&
          upsertKeys.some((key) => byKey.get(key)?.captureSequencePolicy === 'preserve-existing-tail');
        const reconcileKeys =
          mode === 'append'
            ? upsertKeys.filter((key) => byKey.get(key)?.captureSequencePolicy === 'reconcile-existing-order')
            : [];
        const sequenceOverrides = new Map<string, number>();
        let existingByKey: Map<unknown, any> | null = null;
        let nextTailSequence = 0;
        if (hasTailPolicy || reconcileKeys.length) {
          const seqIdx = stores.messages.index('by_conversationId_sequence');
          const range = IDBKeyRange.bound([conversationId, -Infinity] as any, [conversationId, Infinity] as any);
          const storedRows = (await reqToPromise(seqIdx.getAll(range) as any)) as any[];
          existingByKey = new Map<unknown, any>();
          for (const row of storedRows) {
            if (!row || !Object.prototype.hasOwnProperty.call(row, 'messageKey')) continue;
            existingByKey.set(row.messageKey, row);
          }
          const finiteSequences = storedRows
            .map((row) => Number(row?.sequence))
            .filter((sequence) => Number.isFinite(sequence));
          nextTailSequence = finiteSequences.length ? Math.max(...finiteSequences) + 1 : 0;

          if (reconcileKeys.length) {
            const reconciled = mergeAnchoredMessageOrder(storedRows, reconcileKeys);
            if (reconciled.anchored && reconciled.changed) {
              const sequenceByKey = new Map(reconciled.keys.map((key, index) => [key, index]));
              for (const key of reconcileKeys) {
                const sequence = sequenceByKey.get(key);
                if (sequence !== undefined) sequenceOverrides.set(key, sequence);
              }
              for (const row of storedRows) {
                const key = safeString(row?.messageKey);
                const sequence = sequenceByKey.get(key);
                if (sequence === undefined || Number(row?.sequence) === sequence) continue;
                const nextRow = { ...row, sequence };
                await reqToPromise(stores.messages.put(nextRow));
                existingByKey.set(row?.messageKey, nextRow);
                markChanged('messages');
              }
              nextTailSequence = reconciled.keys.length;
            }
          }
        }

        let upserted = 0;
        for (const key of upsertKeys) {
          const m = byKey.get(key);
          if (!m) continue;

          const existing: any = existingByKey
            ? existingByKey.get(key)
            : await reqToPromise(idx.get([conversationId, key]) as any);
          const reconcileSequence =
            mode === 'append' && m.captureSequencePolicy === 'reconcile-existing-order'
              ? sequenceOverrides.get(key)
              : undefined;
          const preserveSequence =
            mode === 'append' &&
            (m.captureSequencePolicy === 'preserve-existing-tail' ||
              m.captureSequencePolicy === 'reconcile-existing-order');
          const sequence =
            reconcileSequence !== undefined
              ? reconcileSequence
              : preserveSequence
                ? existing && Number.isFinite(existing.sequence)
                  ? existing.sequence
                  : nextTailSequence++
                : Number.isFinite(m.sequence)
                  ? m.sequence
                  : 0;
          const rawMergePolicy = String(m.captureMergePolicy || 'replace') as CaptureMessageMergePolicy;
          const mergePolicy: CaptureMessageMergePolicy =
            rawMergePolicy === 'preserve-existing-markdown' || rawMergePolicy === 'preserve-existing-content'
              ? rawMergePolicy
              : 'replace';
          const incomingMarkdown =
            m.contentMarkdown && String(m.contentMarkdown).trim() ? String(m.contentMarkdown) : '';
          const incomingAuthorName = m.authorName && String(m.authorName).trim() ? String(m.authorName).trim() : '';
          const preserveExistingContent = mergePolicy === 'preserve-existing-content' && !!existing;
          const preserveExistingMarkdown =
            !!existing &&
            (mergePolicy === 'preserve-existing-content' || mergePolicy === 'preserve-existing-markdown') &&
            !!String(existing.contentMarkdown || '').trim();
          const timestamp = resolveMessageTimestamp(existing, m.updatedAt, preserveExistingContent);
          const baseRecord: Record<string, unknown> = {
            conversationId,
            messageKey: key,
            role: m.role || 'assistant',
            authorName: incomingAuthorName || (existing ? existing.authorName || '' : ''),
            contentText: preserveExistingContent ? existing.contentText || '' : m.contentText || '',
            contentMarkdown: preserveExistingMarkdown ? existing.contentMarkdown || '' : incomingMarkdown,
            sequence,
            ...(timestamp.present ? { updatedAt: timestamp.value } : null),
          };
          const record: any = withOptionalId(existing && existing.id, baseRecord);
          if (existing) {
            if (!messageRecordsEquivalent(existing, record)) {
              await reqToPromise(stores.messages.put(record));
              markChanged('messages');
            }
          } else {
            const id = await reqToPromise(stores.messages.add(record));
            record.id = id as any;
            markChanged('messages');
          }
          existingByKey?.set(key, record);
          upserted += 1;
        }

        let deleted = 0;
        for (const key of removedKeys) {
          const existing: any = await reqToPromise(idx.get([conversationId, key]) as any);
          const id = Number(existing && existing.id);
          if (!Number.isFinite(id) || id <= 0) continue;
          await reqToPromise(stores.messages.delete(id));
          markChanged('messages');
          deleted += 1;
        }

        return { upserted, deleted };
      }

      const seqIdx = stores.messages.index('by_conversationId_sequence');
      const range = IDBKeyRange.bound([conversationId, -Infinity] as any, [conversationId, Infinity] as any);
      const storedRows = (await reqToPromise(seqIdx.getAll(range) as any)) as any[];
      const existingByKey = new Map<unknown, any>();
      for (const row of storedRows) {
        if (!row || !Object.prototype.hasOwnProperty.call(row, 'messageKey')) continue;
        existingByKey.set(row.messageKey, row);
      }

      const presentKeys = new Set<string>();
      let upserted = 0;

      for (const m of messages || []) {
        if (!m || !m.messageKey) continue;
        presentKeys.add(String(m.messageKey));

        const existing: any = existingByKey.get(m.messageKey);
        const incomingMarkdown = m.contentMarkdown && String(m.contentMarkdown).trim() ? String(m.contentMarkdown) : '';
        const incomingAuthorName = m.authorName && String(m.authorName).trim() ? String(m.authorName).trim() : '';
        const timestamp = resolveMessageTimestamp(existing, m.updatedAt, false);
        const baseRecord: Record<string, unknown> = {
          conversationId,
          messageKey: m.messageKey,
          role: m.role || 'assistant',
          authorName: incomingAuthorName || (existing ? existing.authorName || '' : ''),
          contentText: m.contentText || '',
          contentMarkdown: incomingMarkdown,
          sequence: Number.isFinite(m.sequence) ? m.sequence : 0,
          ...(timestamp.present ? { updatedAt: timestamp.value } : null),
        };
        const record: any = withOptionalId(existing && existing.id, baseRecord);
        if (existing) {
          if (!messageRecordsEquivalent(existing, record)) {
            await reqToPromise(stores.messages.put(record));
            markChanged('messages');
          }
        } else {
          const id = await reqToPromise(stores.messages.add(record));
          record.id = id as any;
          markChanged('messages');
        }
        existingByKey.set(m.messageKey, record);
        upserted += 1;
      }

      let deleted = 0;
      for (const row of Array.isArray(storedRows) ? storedRows : []) {
        if (!row?.messageKey || presentKeys.has(String(row.messageKey))) continue;
        const id = Number(row.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        await reqToPromise(stores.messages.delete(id));
        markChanged('messages');
        deleted += 1;
      }

      return { upserted, deleted };
    },
  );
}

function normalizeConversationListSiteFilterKey(value: unknown): string {
  const key = normalizeListKey(value, LIST_SITE_KEY_ALL);
  if (key === LIST_SITE_KEY_ALL || key === 'unknown') return key;
  return key.startsWith('domain:') ? key : `domain:${key}`;
}

function resolveConversationListQuery(
  queryInput?: ConversationListQueryInput | null,
  limit?: number | null,
): ReturnType<typeof normalizeConversationListQuery> {
  const fallbackLimit = Number(limit);
  const query = normalizeConversationListQuery({
    ...(queryInput || {}),
    ...(Number.isFinite(fallbackLimit) && fallbackLimit > 0 ? { limit: fallbackLimit } : null),
  });
  return {
    ...query,
    siteKey: normalizeConversationListSiteFilterKey(query.siteKey),
  };
}

function buildListPageRange(
  query: ReturnType<typeof normalizeConversationListQuery>,
  cursor: ConversationListCursor | null,
): {
  indexName:
    | 'by_lastCapturedAt_id'
    | 'by_listSourceKey_lastCapturedAt_id'
    | 'by_listSourceKey_listSiteKey_lastCapturedAt_id'
    | 'by_listSiteKey_lastCapturedAt_id';
  range: IDBKeyRange | null;
} {
  const sourceKey = normalizeListKey(query.sourceKey, LIST_SOURCE_KEY_ALL);
  const siteKey = normalizeConversationListSiteFilterKey(query.siteKey);
  const hasSourceFilter = sourceKey !== LIST_SOURCE_KEY_ALL;
  const hasSiteFilter = siteKey !== LIST_SITE_KEY_ALL;
  const MIN_KEY = 0;
  const MAX_KEY = Number.MAX_SAFE_INTEGER;

  const keyRangeApi = globalThis.IDBKeyRange;

  if (hasSourceFilter && hasSiteFilter) {
    if (!cursor) {
      return {
        indexName: 'by_listSourceKey_listSiteKey_lastCapturedAt_id',
        range: keyRangeApi.bound(
          [sourceKey, siteKey, MIN_KEY, MIN_KEY] as any,
          [sourceKey, siteKey, MAX_KEY, MAX_KEY] as any,
        ),
      };
    }
    return {
      indexName: 'by_listSourceKey_listSiteKey_lastCapturedAt_id',
      range: keyRangeApi.bound(
        [sourceKey, siteKey, MIN_KEY, MIN_KEY] as any,
        [sourceKey, siteKey, cursor.lastCapturedAt, cursor.id] as any,
        false,
        true,
      ),
    };
  }

  if (hasSourceFilter) {
    if (!cursor) {
      return {
        indexName: 'by_listSourceKey_lastCapturedAt_id',
        range: keyRangeApi.bound([sourceKey, MIN_KEY, MIN_KEY] as any, [sourceKey, MAX_KEY, MAX_KEY] as any),
      };
    }
    return {
      indexName: 'by_listSourceKey_lastCapturedAt_id',
      range: keyRangeApi.bound(
        [sourceKey, MIN_KEY, MIN_KEY] as any,
        [sourceKey, cursor.lastCapturedAt, cursor.id] as any,
        false,
        true,
      ),
    };
  }

  if (hasSiteFilter) {
    if (!cursor) {
      return {
        indexName: 'by_listSiteKey_lastCapturedAt_id',
        range: keyRangeApi.bound([siteKey, MIN_KEY, MIN_KEY] as any, [siteKey, MAX_KEY, MAX_KEY] as any),
      };
    }
    return {
      indexName: 'by_listSiteKey_lastCapturedAt_id',
      range: keyRangeApi.bound(
        [siteKey, MIN_KEY, MIN_KEY] as any,
        [siteKey, cursor.lastCapturedAt, cursor.id] as any,
        false,
        true,
      ),
    };
  }

  if (!cursor) {
    return { indexName: 'by_lastCapturedAt_id', range: null };
  }
  return {
    indexName: 'by_lastCapturedAt_id',
    range: keyRangeApi.upperBound([cursor.lastCapturedAt, cursor.id] as any, true),
  };
}

function buildListTimestampRange(
  query: ReturnType<typeof normalizeConversationListQuery>,
  indexName: ReturnType<typeof buildListPageRange>['indexName'],
  startInclusive: number,
  endExclusive: number,
): IDBKeyRange {
  const keyRangeApi = globalThis.IDBKeyRange;

  const sourceKey = normalizeListKey(query.sourceKey, LIST_SOURCE_KEY_ALL);
  const siteKey = normalizeConversationListSiteFilterKey(query.siteKey);
  const MIN_ID = 0;

  if (indexName === 'by_listSourceKey_listSiteKey_lastCapturedAt_id') {
    return keyRangeApi.bound(
      [sourceKey, siteKey, startInclusive, MIN_ID] as any,
      [sourceKey, siteKey, endExclusive, MIN_ID] as any,
      false,
      true,
    );
  }
  if (indexName === 'by_listSourceKey_lastCapturedAt_id') {
    return keyRangeApi.bound(
      [sourceKey, startInclusive, MIN_ID] as any,
      [sourceKey, endExclusive, MIN_ID] as any,
      false,
      true,
    );
  }
  if (indexName === 'by_listSiteKey_lastCapturedAt_id') {
    return keyRangeApi.bound(
      [siteKey, startInclusive, MIN_ID] as any,
      [siteKey, endExclusive, MIN_ID] as any,
      false,
      true,
    );
  }
  return keyRangeApi.bound([startInclusive, MIN_ID] as any, [endExclusive, MIN_ID] as any, false, true);
}

async function hydrateConversationListArticleCommentThreadCounts(
  items: Conversation[],
  articleCommentsStore: IDBObjectStore,
): Promise<void> {
  const keyRangeApi = globalThis.IDBKeyRange;
  const byConversation = articleCommentsStore.index('by_conversationId_createdAt');
  const byCanonicalUrl = articleCommentsStore.index('by_canonicalUrl_createdAt');
  const orphanRowsByCanonicalUrl = new Map<string, Promise<any[]>>();
  const reads: Array<{
    item: Conversation;
    linkedRows: Promise<any[]>;
    orphanRows: Promise<any[]>;
  }> = [];

  for (const item of items) {
    if (safeString((item as any).sourceType).toLowerCase() !== 'article') continue;

    const conversationId = Number((item as any).id);
    const canonicalUrl = canonicalizeArticleUrl((item as any).url);
    const linkedRows =
      Number.isSafeInteger(conversationId) && conversationId > 0
        ? reqToPromise<any[]>(
            byConversation.getAll(
              keyRangeApi.bound([conversationId, -Infinity] as any, [conversationId, Infinity] as any),
            ) as any,
          )
        : Promise.resolve([]);

    let orphanRows = Promise.resolve<any[]>([]);
    if (canonicalUrl) {
      orphanRows = orphanRowsByCanonicalUrl.get(canonicalUrl) || Promise.resolve([]);
      if (!orphanRowsByCanonicalUrl.has(canonicalUrl)) {
        orphanRows = reqToPromise<any[]>(
          byCanonicalUrl.getAll(
            keyRangeApi.bound([canonicalUrl, -Infinity] as any, [canonicalUrl, Infinity] as any),
          ) as any,
        );
        orphanRowsByCanonicalUrl.set(canonicalUrl, orphanRows);
      }
    }

    reads.push({ item, linkedRows, orphanRows });
  }

  await Promise.all(
    reads.map(async ({ item, linkedRows, orphanRows }) => {
      const [linked, byUrl] = await Promise.all([linkedRows, orphanRows]);
      const comments = [...(Array.isArray(linked) ? linked : [])];
      comments.push(...(Array.isArray(byUrl) ? byUrl.filter((row) => row?.conversationId == null) : []));
      (item as any).commentThreadCount = computeArticleCommentThreadCount(comments);
    }),
  );
}

async function readConversationListPageItems(input: {
  store: IDBObjectStore;
  articleCommentsStore: IDBObjectStore;
  query: ReturnType<typeof normalizeConversationListQuery>;
  cursor: ConversationListCursor | null;
}): Promise<{ items: Conversation[]; cursor: ConversationListCursor | null; hasMore: boolean }> {
  const { store, articleCommentsStore, query, cursor } = input;
  const safeLimit = Number.isFinite(query.limit) && query.limit > 0 ? Math.floor(query.limit) : 1;
  const rangeInput = buildListPageRange(query, cursor);
  const idx = store.index(rangeInput.indexName);
  const request = idx.openCursor((rangeInput.range || null) as any, 'prev');

  const page = await new Promise<{ pageItems: Conversation[]; hasMore: boolean; hydration: Promise<void> }>(
    (resolve, reject) => {
      const out: any[] = [];
      const finishPage = () => {
        const hasMore = out.length > safeLimit;
        const pageItems = (hasMore ? out.slice(0, safeLimit) : out) as Conversation[];
        const hydration = hydrateConversationListArticleCommentThreadCounts(pageItems, articleCommentsStore);
        resolve({ pageItems, hasMore, hydration });
      };

      request.onerror = () => reject(request.error || new Error('cursor failed'));
      request.onsuccess = () => {
        const c = request.result;
        if (!c) return finishPage();
        out.push(normalizeConversationListRecord(c.value || {}));
        if (out.length >= safeLimit + 1) return finishPage();
        c.continue();
      };
    },
  );

  await page.hydration;
  const { pageItems, hasMore } = page;

  const tail = pageItems.length ? pageItems[pageItems.length - 1] : null;
  const nextCursor =
    hasMore && tail
      ? toComparableCursor({
          lastCapturedAt: Number(tail.lastCapturedAt) || 0,
          id: Number(tail.id) || 0,
        })
      : null;
  return {
    items: pageItems as Conversation[],
    cursor: nextCursor,
    hasMore,
  };
}

async function readConversationListSummaryAndFacets(input: {
  store: IDBObjectStore;
  query: ReturnType<typeof normalizeConversationListQuery>;
}): Promise<{ summary: ConversationListSummary; facets: ConversationListFacets }> {
  const { store, query } = input;
  const sourceFilter = normalizeListKey(query.sourceKey, LIST_SOURCE_KEY_ALL);
  const siteFacetSourceScope = sourceFilter === LIST_SOURCE_KEY_ALL ? 'web' : sourceFilter;
  const sourceFacetMap = new Map<string, { key: string; label: string; count: number }>();
  const siteFacetMap = new Map<string, { key: string; label: string; count: number }>();

  const summaryRange = buildListPageRange(query, null);
  const summaryIndex = store.index(summaryRange.indexName);
  const totalCountPromise = reqToPromise<number>(summaryIndex.count((summaryRange.range || undefined) as any));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const todayRange = buildListTimestampRange(
    query,
    summaryRange.indexName,
    todayStart.getTime(),
    tomorrowStart.getTime(),
  );
  const todayCountPromise = reqToPromise<number>(summaryIndex.count(todayRange as any));

  const sourceFacetRequest = store.index('by_listSourceKey_lastCapturedAt_id').openKeyCursor();
  const sourceFacetsPromise = new Promise<void>((resolve, reject) => {
    sourceFacetRequest.onerror = () => reject(sourceFacetRequest.error || new Error('source facet cursor failed'));
    sourceFacetRequest.onsuccess = () => {
      const cursor = sourceFacetRequest.result;
      if (!cursor) return resolve();
      const key = Array.isArray(cursor.key) ? cursor.key : [];
      const rowSourceKey = typeof key[0] === 'string' ? key[0] : '';
      if (rowSourceKey) {
        const facet = sourceFacetMap.get(rowSourceKey) || { key: rowSourceKey, label: rowSourceKey, count: 0 };
        facet.count += 1;
        sourceFacetMap.set(rowSourceKey, facet);
      }
      cursor.continue();
    };
  });

  const siteFacetIndex = store.index('by_listSourceKey_listSiteKey_lastCapturedAt_id');
  const siteFacetRange = globalThis.IDBKeyRange.bound(
    [siteFacetSourceScope, '', 0, 0] as any,
    [siteFacetSourceScope, '\uffff', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] as any,
  );
  const siteFacetRequest = siteFacetIndex.openKeyCursor(siteFacetRange as any);
  const siteFacetsPromise = new Promise<void>((resolve, reject) => {
    siteFacetRequest.onerror = () => reject(siteFacetRequest.error || new Error('site facet cursor failed'));
    siteFacetRequest.onsuccess = () => {
      const cursor = siteFacetRequest.result;
      if (!cursor) return resolve();
      const key = Array.isArray(cursor.key) ? cursor.key : [];
      const rowSourceKey = typeof key[0] === 'string' ? key[0] : '';
      const rowSiteKey = typeof key[1] === 'string' ? key[1] : '';
      if (rowSourceKey === siteFacetSourceScope && rowSiteKey) {
        const rowSiteLabel = rowSiteKey.startsWith('domain:') ? rowSiteKey.slice('domain:'.length) : rowSiteKey;
        const facet = siteFacetMap.get(rowSiteKey) || { key: rowSiteKey, label: rowSiteLabel, count: 0 };
        facet.count += 1;
        siteFacetMap.set(rowSiteKey, facet);
      }
      cursor.continue();
    };
  });

  const [totalCount, todayCount] = await Promise.all([
    totalCountPromise,
    todayCountPromise,
    sourceFacetsPromise,
    siteFacetsPromise,
  ]);

  return {
    summary: {
      totalCount: Number(totalCount) || 0,
      todayCount: Number(todayCount) || 0,
    },
    facets: {
      sources: sortFacetItems(Array.from(sourceFacetMap.values())),
      sites: sortFacetItems(Array.from(siteFacetMap.values())),
    },
  };
}

async function readConversationListPage(input: {
  queryInput?: ConversationListQueryInput | null;
  cursor?: ConversationListCursor | null;
  limit?: number | null;
}): Promise<ConversationListPage<Conversation>> {
  const query = resolveConversationListQuery(input.queryInput, input.limit);
  const cursor = toComparableCursor(input.cursor);
  const statsKey = `${normalizeListKey(query.sourceKey, LIST_SOURCE_KEY_ALL)}::${normalizeConversationListSiteFilterKey(query.siteKey)}`;

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'article_comments'], 'readonly');
  const pagePromise = readConversationListPageItems({
    store: stores.conversations,
    articleCommentsStore: stores.article_comments,
    query,
    cursor,
  });
  const summaryPromise = (async () => {
    // A bootstrap starts a fresh list snapshot and must observe IndexedDB writes from other extension contexts
    // (for example backup import). Reuse cached stats only while continuing the same paginated snapshot.
    if (cursor && conversationListStatsCacheKey === statsKey && conversationListStatsCacheValue) {
      return conversationListStatsCacheValue;
    }
    const computed = await readConversationListSummaryAndFacets({ store: stores.conversations, query });
    conversationListStatsCacheKey = statsKey;
    conversationListStatsCacheValue = computed;
    return computed;
  })();
  const [page, summaryData] = await Promise.all([pagePromise, summaryPromise]);
  await txDone(t);
  return {
    items: page.items,
    cursor: page.cursor,
    hasMore: page.hasMore,
    summary: summaryData.summary,
    facets: summaryData.facets,
  };
}

export async function getConversationListBootstrap(
  queryInput?: ConversationListQueryInput | null,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  return await readConversationListPage({ queryInput, cursor: null, limit });
}

export async function getConversationListPage(
  queryInput: ConversationListQueryInput | null | undefined,
  cursor: ConversationListCursor,
  limit?: number | null,
): Promise<ConversationListPage<Conversation>> {
  return await readConversationListPage({ queryInput, cursor, limit });
}

export async function getConversationBySourceConversationKey(
  source: string,
  conversationKey: string,
): Promise<Conversation | null> {
  const normalizedSource = safeString(source);
  const normalizedKey = safeString(conversationKey);
  if (!normalizedSource || !normalizedKey) return null;

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations'], 'readonly');
  const idx = stores.conversations.index('by_source_conversationKey');
  const item = (await reqToPromise(idx.get([normalizedSource, normalizedKey]) as any)) as any;
  await txDone(t);
  return item ? normalizeConversationListRecord(item) : null;
}

export async function getConversationTailWindowBySourceAndKey(
  source: string,
  conversationKey: string,
  limit: number,
): Promise<{ conversation: Conversation | null; messages: ConversationMessage[] }> {
  const conversation = await getConversationBySourceConversationKey(source, conversationKey);
  if (!conversation) return { conversation: null, messages: [] };
  const conversationId = Number(conversation.id);
  if (!Number.isFinite(conversationId) || conversationId <= 0) return { conversation, messages: [] };
  const messages = await getMessagesTailByConversationId(conversationId, limit);
  return { conversation, messages };
}

function toConversationListOpenTarget(input: any): ConversationListOpenTarget | null {
  if (!input || typeof input !== 'object') return null;
  const id = Number(input.id);
  const source = safeString(input.source);
  const conversationKey = safeString(input.conversationKey);
  if (!Number.isFinite(id) || id <= 0 || !source || !conversationKey) return null;
  return {
    id,
    source,
    conversationKey,
    title: safeString(input.title) || undefined,
    url: safeString(input.url) || undefined,
    sourceType: safeString(input.sourceType) || undefined,
    lastCapturedAt: Number(input.lastCapturedAt) || 0,
  };
}

export async function findConversationBySourceAndKey(
  source: string,
  conversationKey: string,
): Promise<ConversationListOpenTarget | null> {
  const row = await getConversationBySourceConversationKey(source, conversationKey);
  return toConversationListOpenTarget(row);
}

export async function getMessagesByConversationId(conversationId: number): Promise<ConversationMessage[]> {
  const db = await openDb();
  const { t, stores } = tx(db, ['messages'], 'readonly');
  const idx = stores.messages.index('by_conversationId_sequence');
  const items = (await reqToPromise(
    idx.getAll(IDBKeyRange.bound([conversationId, -Infinity] as any, [conversationId, Infinity] as any)) as any,
  )) as any[];
  await txDone(t);
  items.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return items as any;
}

export async function getMessagesTailByConversationId(
  conversationId: number,
  limit: number,
): Promise<ConversationMessage[]> {
  const normalizedConversationId = Number(conversationId);
  const normalizedLimit = Number(limit);
  if (!Number.isFinite(normalizedConversationId) || normalizedConversationId <= 0) return [];
  if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) return [];

  const tailLimit = Math.floor(normalizedLimit);
  const db = await openDb();
  const { t, stores } = tx(db, ['messages'], 'readonly');
  const idx = stores.messages.index('by_conversationId_sequence');
  const range = IDBKeyRange.bound(
    [normalizedConversationId, -Infinity] as any,
    [normalizedConversationId, Infinity] as any,
  );
  const cursorReq = idx.openCursor(range, 'prev');
  const items: any[] = [];
  await new Promise<void>((resolve, reject) => {
    cursorReq.onerror = () => reject(cursorReq.error || new Error('cursor failed'));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result as IDBCursorWithValue | null;
      if (!cursor) return resolve();
      items.push(cursor.value);
      if (items.length >= tailLimit) return resolve();
      cursor.continue();
    };
  });
  await txDone(t);
  items.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return items as any;
}

export async function deleteConversationsByIds(conversationIds: any[]): Promise<{
  deletedConversations: number;
  deletedMessages: number;
  deletedMappings: number;
  deletedImageCache: number;
}> {
  const ids = Array.isArray(conversationIds)
    ? conversationIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
    : [];
  if (!ids.length) {
    return { deletedConversations: 0, deletedMessages: 0, deletedMappings: 0, deletedImageCache: 0 };
  }

  const db = await openDb();
  const outcome = await runTrackedTransaction(
    {
      db,
      stores: [
        'conversations',
        'messages',
        'sync_mappings',
        'image_cache',
        'article_comments',
        GITHUB_CLEANUP_OUTBOX_STORE,
      ],
      revisionScopes: ['conversations', 'messages', 'sync_mappings', 'image_cache', 'article_comments'],
    },
    async ({ stores, markChanged }) => {
      let deletedConversations = 0;
      let deletedMessages = 0;
      let deletedMappings = 0;
      let deletedImageCache = 0;

      const msgIdx = stores.messages.index('by_conversationId_sequence');
      const mappingIdx = stores.sync_mappings.index('by_source_conversationKey');
      const imageCacheIdx = stores.image_cache.index('by_conversationId');
      const articleCommentsIdx = stores.article_comments.index('by_conversationId_createdAt');
      const now = Date.now();

      for (const id of ids) {
        const convo: any = await reqToPromise(stores.conversations.get(id));
        if (!convo) continue;

        const source = safeString(convo.source);
        const conversationKey = safeString(convo.conversationKey);
        if (source && conversationKey) {
          const mapping: any = await reqToPromise(mappingIdx.get([source, conversationKey]) as any);
          if (mapping && mapping.id) {
            await enqueueGithubCleanupSnapshot(
              stores[GITHUB_CLEANUP_OUTBOX_STORE],
              readOwnedGithubCleanupSnapshot(mapping, convo),
              { reason: 'delete', createdAt: now },
            );
            await reqToPromise(stores.sync_mappings.delete(mapping.id));
            markChanged('sync_mappings');
            deletedMappings += 1;
          }
        }

        if (safeString(convo.sourceType).toLowerCase() === 'article') {
          const commentRange = globalThis.IDBKeyRange.bound([id, -Infinity] as any, [id, Infinity] as any);
          const commentRows = (await reqToPromise(articleCommentsIdx.getAll(commentRange) as any)) as any[];
          for (const row of Array.isArray(commentRows) ? commentRows : []) {
            if (!row || row.conversationId == null) continue;
            await reqToPromise(stores.article_comments.put({ ...row, conversationId: null }));
            markChanged('article_comments');
          }
        }

        const range = globalThis.IDBKeyRange.bound([id, -Infinity] as any, [id, Infinity] as any);
        const messageRows = (await reqToPromise(msgIdx.getAll(range) as any)) as any[];
        for (const row of Array.isArray(messageRows) ? messageRows : []) {
          const rowId = Number(row?.id);
          if (!Number.isFinite(rowId) || rowId <= 0) continue;
          await reqToPromise(stores.messages.delete(rowId));
          markChanged('messages');
          deletedMessages += 1;
        }

        const imgRange = globalThis.IDBKeyRange.only(id);
        const imageRows = (await reqToPromise(imageCacheIdx.getAll(imgRange) as any)) as any[];
        for (const row of Array.isArray(imageRows) ? imageRows : []) {
          const rowId = Number(row?.id);
          if (!Number.isFinite(rowId) || rowId <= 0) continue;
          await reqToPromise(stores.image_cache.delete(rowId));
          markChanged('image_cache');
          deletedImageCache += 1;
        }

        await reqToPromise(stores.conversations.delete(id));
        markChanged('conversations');
        deletedConversations += 1;
      }

      return {
        result: { deletedConversations, deletedMessages, deletedMappings, deletedImageCache },
        conversationChanged: deletedConversations > 0,
      };
    },
  );

  if (outcome.conversationChanged) invalidateConversationListStatsCache();
  return outcome.result;
}

export async function getConversationById(conversationId: number): Promise<Conversation | null> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations'], 'readonly');
  const row = (await reqToPromise(stores.conversations.get(id as any))) as any;
  await txDone(t);
  return row ? (normalizeConversationListRecord(row) as Conversation) : null;
}

function stripDomainPrefix(listSiteKey: string): string {
  const text = safeString(listSiteKey).toLowerCase();
  if (!text.startsWith('domain:')) return '';
  return text.slice('domain:'.length);
}

export async function readConversationMentionCandidatePool(input?: {
  maxScan?: number;
  maxDurationMs?: number;
}): Promise<{
  candidates: Array<{
    conversationId: number;
    title: string;
    source: string;
    url: string;
    domain: string;
    sourceType: string;
    lastCapturedAt: number;
  }>;
  scannedCount: number;
  truncatedByScanLimit: boolean;
  revision: number;
}> {
  // ponytail: Item Mention intentionally searches only a bounded recent pool; FTS/global indexing stays out of scope.
  const maxScan =
    Number.isFinite(input?.maxScan) && (input?.maxScan as number) > 0 ? Math.floor(input!.maxScan!) : 2000;
  const maxDurationMs =
    Number.isFinite(input?.maxDurationMs) && (input?.maxDurationMs as number) > 0
      ? Math.floor(input!.maxDurationMs!)
      : 300;

  const db = await openDb();
  const revisionStoreName = DATA_REVISION_STORE_BY_SCOPE.conversations;
  const { t, stores } = tx(db, ['conversations', revisionStoreName], 'readonly');
  const done = txDone(t);
  const revisionPromise = reqToPromise(stores[revisionStoreName].get(DATA_REVISION_RECORD_KEY));
  const idx = stores.conversations.index('by_lastCapturedAt_id');

  const candidates: Array<{
    conversationId: number;
    title: string;
    source: string;
    url: string;
    domain: string;
    sourceType: string;
    lastCapturedAt: number;
  }> = [];
  let scannedCount = 0;
  let truncatedByScanLimit = false;
  const startedAt = Date.now();

  const cursorReq = idx.openCursor(null, 'prev');
  const cursorDone = new Promise<void>((resolve, reject) => {
    cursorReq.onerror = () => reject(cursorReq.error || new Error('cursor failed'));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result as IDBCursorWithValue | null;
      if (!cursor) return resolve();

      scannedCount += 1;
      const record = cursor.value as any;
      const conversationId = Number(record?.id);
      if (Number.isFinite(conversationId) && conversationId > 0) {
        candidates.push({
          conversationId,
          title: safeString(record?.title),
          source: safeString(record?.source),
          url: safeString(record?.url),
          domain: stripDomainPrefix(safeString(record?.listSiteKey)),
          sourceType: safeString(record?.sourceType) || 'chat',
          lastCapturedAt: Number(record?.lastCapturedAt) || 0,
        });
      }

      const elapsed = Date.now() - startedAt;
      if (scannedCount >= maxScan || elapsed >= maxDurationMs) {
        truncatedByScanLimit = true;
        return resolve();
      }

      cursor.continue();
    };
  });

  try {
    await cursorDone;
    const revision = normalizeDataRevisionRecord(await revisionPromise).revision;
    await done;
    return { candidates, scannedCount, truncatedByScanLimit, revision };
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

export async function getSyncMappingByConversation(
  conversationId: number,
): Promise<{ conversation: Conversation; mapping: any | null } | null> {
  const conversation = await getConversationById(conversationId);
  if (!conversation) return null;

  const source = String((conversation as any).source || '').trim();
  const conversationKey = String((conversation as any).conversationKey || '').trim();
  if (!source || !conversationKey) {
    return { conversation, mapping: null };
  }

  const db = await openDb();
  const { t, stores } = tx(db, ['sync_mappings'], 'readonly');
  const idx = stores.sync_mappings.index('by_source_conversationKey');
  const mapping = (await reqToPromise(idx.get([source, conversationKey]) as any)) as any;
  await txDone(t);
  return { conversation, mapping: mapping || null };
}

async function patchSyncMappingInternal(
  conversationId: number,
  patch: Record<string, unknown>,
  options: { generateNotionBaseline?: boolean } = {},
): Promise<true> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid conversationId');
  if (!patch || typeof patch !== 'object') throw new Error('invalid patch');

  const db = await openDb();
  return runTrackedTransaction(
    { db, stores: ['conversations', 'sync_mappings'], revisionScopes: ['conversations', 'sync_mappings'] },
    async ({ stores, markChanged }) => {
      const conversation = (await reqToPromise(stores.conversations.get(id as any))) as any;
      if (!conversation) throw new Error('conversation not found');

      const source = safeString(conversation.source);
      const conversationKey = safeString(conversation.conversationKey);
      if (!source || !conversationKey) throw new Error('missing source or conversationKey');

      const idx = stores.sync_mappings.index('by_source_conversationKey');
      const existing = (await reqToPromise(idx.get([source, conversationKey]) as any)) as any;
      const existingForPatch = { ...(existing && typeof existing === 'object' ? existing : {}) } as any;
      const conversationNotionPageId = safeString(conversation.notionPageId);
      const conversationFeishuDocId = safeString(conversation.feishuDocId);
      if (!Object.prototype.hasOwnProperty.call(existingForPatch, 'notionPageId') && conversationNotionPageId) {
        existingForPatch.notionPageId = conversationNotionPageId;
      }
      if (!Object.prototype.hasOwnProperty.call(existingForPatch, 'feishuDocId') && conversationFeishuDocId) {
        existingForPatch.feishuDocId = conversationFeishuDocId;
      }

      const effectivePatch = { ...patch } as Record<string, unknown>;
      if (options.generateNotionBaseline) {
        const previous = Number(existingForPatch.lastSyncedAt);
        effectivePatch.lastSyncedAt = Math.max(
          Date.now(),
          Number.isFinite(previous) && previous >= 0 ? previous + 1 : 0,
        );
      }

      const merged = mergeSyncMappingPatch(existingForPatch, effectivePatch) as any;
      const hasNotionPagePatch = Object.prototype.hasOwnProperty.call(patch, 'notionPageId');
      const hasFeishuDocPatch = Object.prototype.hasOwnProperty.call(patch, 'feishuDocId');
      const previousNotionPageId = safeString(existingForPatch.notionPageId);
      const nextNotionPageId = safeString(merged.notionPageId);
      const nextFeishuDocId = safeString(merged.feishuDocId);
      const notionTargetChanged = hasNotionPagePatch && previousNotionPageId !== nextNotionPageId;
      const conversationNotionTargetChanged =
        (hasNotionPagePatch || !!nextNotionPageId) && conversationNotionPageId !== nextNotionPageId;
      const candidate = { ...merged, source, conversationKey } as any;

      if (!areSyncMappingsBusinessEquivalent(candidate, existing)) {
        const payload: any = withOptionalId(existing && existing.id, { ...candidate, updatedAt: Date.now() });
        if (existing) await reqToPromise(stores.sync_mappings.put(payload));
        else await reqToPromise(stores.sync_mappings.add(payload));
        markChanged('sync_mappings');
      }

      let conversationChanged = false;
      if (conversationNotionTargetChanged) {
        conversation.notionPageId = nextNotionPageId;
        conversationChanged = true;
      }
      for (const field of ['notionPageUrl', 'notionWorkspaceSlug'] as const) {
        if (
          !notionTargetChanged &&
          !conversationNotionTargetChanged &&
          !Object.prototype.hasOwnProperty.call(patch, field)
        ) {
          continue;
        }
        const value = safeString(candidate[field]);
        if (safeString(conversation[field]) === value) continue;
        conversation[field] = value;
        conversationChanged = true;
      }

      if ((hasFeishuDocPatch || !!nextFeishuDocId) && conversationFeishuDocId !== nextFeishuDocId) {
        conversation.feishuDocId = nextFeishuDocId;
        conversationChanged = true;
      }
      if (conversationChanged) {
        await reqToPromise(stores.conversations.put(conversation));
        markChanged('conversations');
      }

      return true as const;
    },
  );
}

export async function recordObsidianRemoteWrite(input: {
  source: unknown;
  conversationKey: unknown;
}): Promise<{ generation: number }> {
  const source = safeString(input?.source);
  const conversationKey = safeString(input?.conversationKey);
  if (!source || !conversationKey) throw new Error('invalid obsidian remote write identity');

  const db = await openDb();
  return runTrackedTransaction(
    { db, stores: ['sync_mappings'], revisionScopes: ['sync_mappings'] },
    async ({ stores, markChanged }) => {
      const idx = stores.sync_mappings.index('by_source_conversationKey');
      const existing = (await reqToPromise(idx.get([source, conversationKey]) as any)) as any;
      const rawGeneration = existing?.obsidianRemoteWriteGeneration;
      const currentGeneration =
        typeof rawGeneration === 'number' && Number.isSafeInteger(rawGeneration) && rawGeneration >= 0
          ? rawGeneration
          : 0;
      if (currentGeneration >= Number.MAX_SAFE_INTEGER) {
        throw Object.assign(new Error('obsidian_remote_write_generation_overflow'), {
          code: 'obsidian_remote_write_generation_overflow',
        });
      }

      const generation = currentGeneration + 1;
      const next = {
        ...(existing && typeof existing === 'object' ? existing : {}),
        source,
        conversationKey,
        obsidianRemoteWriteGeneration: generation,
        updatedAt: Date.now(),
      };
      if (existing) await reqToPromise(stores.sync_mappings.put(next));
      else await reqToPromise(stores.sync_mappings.add(next));
      markChanged('sync_mappings');
      return { generation };
    },
  );
}

export async function patchSyncMapping(conversationId: number, patch: Record<string, unknown>): Promise<true> {
  return patchSyncMappingInternal(conversationId, patch);
}

export async function setConversationNotionPageId(
  conversationId: number,
  notionPageId: string,
  meta?: { notionPageUrl?: string; notionWorkspaceSlug?: string },
): Promise<true> {
  const notionPageUrl = meta && typeof meta === 'object' ? safeString(meta.notionPageUrl) : '';
  const notionWorkspaceSlug = meta && typeof meta === 'object' ? safeString(meta.notionWorkspaceSlug) : '';
  return patchSyncMapping(conversationId, {
    notionPageId: safeString(notionPageId),
    ...(notionPageUrl ? { notionPageUrl } : null),
    ...(notionWorkspaceSlug ? { notionWorkspaceSlug } : null),
  });
}

export async function setSyncCursor(
  conversationId: number,
  input: {
    lastSyncedMessageKey?: string;
    lastSyncedSequence?: number | null;
    lastSyncedAt?: number | null;
    lastSyncedMessageUpdatedAt?: number | null;
    notionSectionCursors?: Record<string, unknown>;
    notionSectionDigests?: Record<string, unknown>;
    notionSections?: Record<string, unknown>;
  },
): Promise<true> {
  const finiteOrNull = (value: unknown): number | null => {
    if (value == null) return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  };
  const lastSyncedAt = finiteOrNull(input?.lastSyncedAt);

  return patchSyncMappingInternal(
    conversationId,
    {
      lastSyncedMessageKey: safeString(input?.lastSyncedMessageKey),
      lastSyncedSequence: finiteOrNull(input?.lastSyncedSequence),
      ...(lastSyncedAt != null ? { lastSyncedAt } : null),
      lastSyncedMessageUpdatedAt: finiteOrNull(input?.lastSyncedMessageUpdatedAt),
      ...(input?.notionSectionCursors !== undefined ? { notionSectionCursors: input.notionSectionCursors } : null),
      ...(input?.notionSectionDigests !== undefined ? { notionSectionDigests: input.notionSectionDigests } : null),
      ...(input?.notionSections !== undefined ? { notionSections: input.notionSections } : null),
    },
    { generateNotionBaseline: lastSyncedAt == null },
  );
}
