import type { AddArticleCommentInput, ArticleComment } from '@services/comments/domain/models';
import { openDb as openSchemaDb } from '@platform/idb/schema';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { serializeArticleCommentDto } from '@services/comments/domain/comment-dto';
import { ArticleCommentInvariantError } from '@services/comments/domain/comment-errors';
import { LocalDataContractError } from '@services/local-data/contracts';
import { assertFactsOperationLease, type FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type {
  ArticleCommentsAddReplyInput,
  ArticleCommentsAddRootInput,
  ArticleCommentsDeleteInput,
  ArticleCommentsEnsureContextInput,
  ArticleCommentsFactsRepository,
  ArticleCommentsListInput,
  ArticleCommentsMigrateInput,
} from '@services/comments/data/storage';

export type ArticleCommentDeleteContext = {
  conversationId: number | null;
  canonicalUrl: string;
};

let cachedDb: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

async function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb;
  if (openingDb) return openingDb;
  openingDb = openSchemaDb()
    .then((db) => {
      cachedDb = db;
      return db;
    })
    .finally(() => {
      openingDb = null;
    });
  return openingDb;
}

export async function __closeDbForTests(): Promise<void> {
  try {
    const db = cachedDb || (openingDb ? await openingDb : null);
    db?.close?.();
  } catch (_e) {
    // ignore
  } finally {
    cachedDb = null;
    openingDb = null;
  }
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

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeCanonicalUrl(raw: unknown): string {
  return canonicalizeArticleUrl(raw);
}

function normalizeConversationId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function normalizeParentId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const t = Number(value);
  if (!Number.isFinite(t) || t <= 0) return fallback;
  return t;
}

function normalizeCommentText(value: unknown): string {
  return String(value || '').trim();
}

function toComment(row: any): ArticleComment {
  const comment: ArticleComment = {
    id: Number(row?.id),
    parentId: normalizeParentId(row?.parentId),
    conversationId: normalizeConversationId(row?.conversationId),
    canonicalUrl: normalizeCanonicalUrl(row?.canonicalUrl),
    authorName: safeString(row?.authorName) || null,
    quoteText: safeString(row?.quoteText),
    commentText: normalizeCommentText(row?.commentText),
    locator: normalizeArticleCommentLocator(row?.locator),
    createdAt: Number(row?.createdAt) || 0,
    updatedAt: Number(row?.updatedAt) || 0,
  };
  return serializeArticleCommentDto(comment);
}

export async function addArticleComment(input: AddArticleCommentInput): Promise<ArticleComment> {
  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readwrite');

  const now = Date.now();
  const canonicalUrl = normalizeCanonicalUrl(input?.canonicalUrl);
  const commentText = normalizeCommentText(input?.commentText);
  const quoteText = safeString(input?.quoteText);
  if (!canonicalUrl) throw new Error('canonicalUrl required');
  if (!commentText) throw new Error('commentText required');

  const createdAt = normalizeTimestamp(input?.createdAt, now);
  const updatedAt = normalizeTimestamp(input?.updatedAt, createdAt);
  const parentId = normalizeParentId(input?.parentId);
  const conversationId = normalizeConversationId(input?.conversationId);
  if (parentId != null) {
    const parent = await reqToPromise<any>(stores.article_comments.get(parentId));
    if (!parent) throw new ArticleCommentInvariantError('parent_not_found');
    if (normalizeParentId(parent.parentId) != null) throw new ArticleCommentInvariantError('parent_not_root');
    if (
      normalizeCanonicalUrl(parent.canonicalUrl) !== canonicalUrl ||
      normalizeConversationId(parent.conversationId) !== conversationId
    ) {
      throw new ArticleCommentInvariantError('parent_context_mismatch');
    }
  }

  const row: any = {
    parentId,
    conversationId,
    canonicalUrl,
    authorName: safeString(input?.authorName) || '',
    quoteText,
    commentText,
    locator: normalizeArticleCommentLocator(input?.locator),
    createdAt,
    updatedAt,
  };

  const id = await reqToPromise<number>(stores.article_comments.add(row) as any);
  await txDone(t);
  return toComment({ ...row, id });
}

export async function listArticleCommentsByCanonicalUrl(canonicalUrl: string): Promise<ArticleComment[]> {
  const normalized = normalizeCanonicalUrl(canonicalUrl);
  if (!normalized) return [];

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readonly');

  const idx = stores.article_comments.index('by_canonicalUrl_createdAt');
  const range = globalThis.IDBKeyRange?.bound
    ? globalThis.IDBKeyRange.bound([normalized, -Infinity] as any, [normalized, Infinity] as any)
    : null;
  const rows = range ? await reqToPromise<any[]>(idx.getAll(range) as any) : [];
  await txDone(t);
  return (Array.isArray(rows) ? rows : []).map(toComment);
}

export async function listArticleCommentsByConversationId(conversationId: number): Promise<ArticleComment[]> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readonly');

  const idx = stores.article_comments.index('by_conversationId_createdAt');
  const range = globalThis.IDBKeyRange?.bound
    ? globalThis.IDBKeyRange.bound([id, -Infinity] as any, [id, Infinity] as any)
    : null;
  const rows = range ? await reqToPromise<any[]>(idx.getAll(range) as any) : [];
  await txDone(t);
  return (Array.isArray(rows) ? rows : []).map(toComment);
}

function toDeleteContext(row: any): ArticleCommentDeleteContext {
  return {
    conversationId: normalizeConversationId(row?.conversationId),
    canonicalUrl: normalizeCanonicalUrl(row?.canonicalUrl),
  };
}

function deleteContextFromRows(rows: readonly any[], commentId: number): ArticleCommentDeleteContext | null {
  const byId = new Map<number, any>();
  for (const row of rows) {
    const rowId = Number(row?.id);
    if (!Number.isFinite(rowId) || rowId <= 0) continue;
    byId.set(rowId, row);
  }

  const target = byId.get(commentId);
  if (!target) {
    for (const row of rows) {
      if (normalizeParentId(row?.parentId) === commentId) return toDeleteContext(row);
    }
    return null;
  }

  const context = toDeleteContext(target);
  if (context.conversationId != null && context.canonicalUrl) return context;
  const parentId = normalizeParentId(target.parentId);
  const parent = parentId == null ? null : byId.get(parentId);
  if (!parent) return context;
  const parentContext = toDeleteContext(parent);
  return {
    conversationId: context.conversationId ?? parentContext.conversationId,
    canonicalUrl: context.canonicalUrl || parentContext.canonicalUrl,
  };
}

function descendantCommentIds(rows: readonly any[], commentId: number): number[] | null {
  if (!rows.some((row) => Number(row?.id) === commentId)) return null;
  const descendants = new Set<number>([commentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const rowId = Number(row?.id);
      const parentId = normalizeParentId(row?.parentId);
      if (!Number.isFinite(rowId) || rowId <= 0 || parentId == null) continue;
      if (!descendants.has(parentId) || descendants.has(rowId)) continue;
      descendants.add(rowId);
      changed = true;
    }
  }
  return [...descendants];
}

export async function getArticleCommentDeleteContextById(id: number): Promise<ArticleCommentDeleteContext | null> {
  const commentId = Number(id);
  if (!Number.isFinite(commentId) || commentId <= 0) return null;

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readonly');
  const rows = (await reqToPromise<any[]>(stores.article_comments.getAll() as any)) || [];
  await txDone(t);

  return deleteContextFromRows(rows, commentId);
}

export async function deleteArticleCommentById(id: number): Promise<boolean> {
  const commentId = Number(id);
  if (!Number.isFinite(commentId) || commentId <= 0) return false;

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readwrite');
  const rows = (await reqToPromise<any[]>(stores.article_comments.getAll() as any)) || [];
  const descendants = descendantCommentIds(rows, commentId);
  if (!descendants) {
    await txDone(t);
    return false;
  }
  for (const rowId of descendants) stores.article_comments.delete(rowId);
  await txDone(t);
  return true;
}

async function deleteArticleCommentByIdInContext(input: {
  canonicalUrl: string;
  commentId: number;
  conversationId: number | null;
}): Promise<boolean> {
  const commentId = normalizeParentId(input.commentId);
  const canonicalUrl = normalizeCanonicalUrl(input.canonicalUrl);
  const conversationId = input.conversationId == null ? null : normalizeConversationId(input.conversationId);
  if (!commentId || !canonicalUrl || (input.conversationId != null && !conversationId)) return false;

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readwrite');
  const rows = (await reqToPromise<any[]>(stores.article_comments.getAll() as any)) || [];
  const actual = deleteContextFromRows(rows, commentId);
  const descendants = descendantCommentIds(rows, commentId);
  if (!commentContextMatches({ actual, expected: { canonicalUrl, conversationId } }) || !descendants) {
    await txDone(t);
    return false;
  }
  for (const rowId of descendants) stores.article_comments.delete(rowId);
  await txDone(t);
  return true;
}

export async function hasAnyArticleCommentsForCanonicalUrl(canonicalUrl: string): Promise<boolean> {
  const normalized = normalizeCanonicalUrl(canonicalUrl);
  if (!normalized) return false;

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readonly');
  const idx = stores.article_comments.index('by_canonicalUrl_createdAt');

  const range = globalThis.IDBKeyRange?.bound
    ? globalThis.IDBKeyRange.bound([normalized, -Infinity] as any, [normalized, Infinity] as any)
    : null;
  if (!range) {
    await txDone(t);
    return false;
  }

  const count = await reqToPromise<number>(idx.count(range) as any);
  await txDone(t);
  return Number(count) > 0;
}

export async function attachOrphanCommentsToConversation(
  canonicalUrl: string,
  conversationId: number,
): Promise<{ updated: number }> {
  const normalizedUrl = normalizeCanonicalUrl(canonicalUrl);
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedUrl || !normalizedConversationId) return { updated: 0 };

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readwrite');
  const store = stores.article_comments;

  const idx = store.index('by_canonicalUrl_createdAt');
  const range = globalThis.IDBKeyRange?.bound
    ? globalThis.IDBKeyRange.bound([normalizedUrl, -Infinity] as any, [normalizedUrl, Infinity] as any)
    : null;
  if (!range) {
    await txDone(t);
    return { updated: 0 };
  }

  const rows = (await reqToPromise<any[]>(idx.getAll(range) as any)) || [];
  let updated = 0;
  const now = Date.now();

  for (const row of rows) {
    if (!row) continue;
    const current = normalizeConversationId(row?.conversationId);
    if (current) continue;
    row.conversationId = normalizedConversationId;
    row.updatedAt = now;

    await reqToPromise(store.put(row));
    updated += 1;
  }

  await txDone(t);
  return { updated };
}

export async function migrateArticleCommentsCanonicalUrl(input: {
  fromCanonicalUrl: string;
  toCanonicalUrl: string;
  conversationId: number | null;
}): Promise<{ updated: number }> {
  const from = normalizeCanonicalUrl(input?.fromCanonicalUrl);
  const to = normalizeCanonicalUrl(input?.toCanonicalUrl);
  const conversationId = normalizeConversationId(input?.conversationId);
  if (!from) throw new Error('fromCanonicalUrl required');
  if (!to) throw new Error('toCanonicalUrl required');
  if (!conversationId) throw new Error('conversationId required');
  if (from === to) return { updated: 0 };

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readwrite');
  const store = stores.article_comments;

  const idx = store.index('by_canonicalUrl_createdAt');
  const range = globalThis.IDBKeyRange?.bound
    ? globalThis.IDBKeyRange.bound([from, -Infinity] as any, [from, Infinity] as any)
    : null;
  if (!range) {
    await txDone(t);
    return { updated: 0 };
  }

  const rows = (await reqToPromise<any[]>(idx.getAll(range) as any)) || [];
  if (!rows.length) {
    await txDone(t);
    return { updated: 0 };
  }

  const now = Date.now();
  let updated = 0;
  for (const row of rows) {
    if (!row) continue;
    const rowConversationId = normalizeConversationId(row.conversationId);
    if (rowConversationId != null && rowConversationId !== conversationId) continue;
    row.canonicalUrl = to;
    row.updatedAt = now;
    await reqToPromise(store.put(row));
    updated += 1;
  }

  await txDone(t);
  return { updated };
}

function mergeArticleCommentsByIdentity(...groups: ArticleComment[][]): ArticleComment[] {
  const byId = new Map<number, ArticleComment>();
  for (const group of groups) {
    for (const comment of group) {
      const id = normalizeParentId(comment?.id);
      if (!id || byId.has(id)) continue;
      byId.set(id, comment);
    }
  }
  return [...byId.values()].sort((left, right) => left.createdAt - right.createdAt || left.id - right.id);
}

function commentContextMatches(input: {
  actual: ArticleCommentDeleteContext | null;
  expected: { canonicalUrl: string; conversationId: number | null };
}): boolean {
  return (
    !!input.actual &&
    input.actual.canonicalUrl === input.expected.canonicalUrl &&
    input.actual.conversationId === input.expected.conversationId
  );
}

function resolvedConversationId(input: { conversation: { conversationId: number } | null }): number | null {
  return input.conversation?.conversationId ?? null;
}

function assertBoundContext(input: { canonicalUrl: string; conversation: { conversationId: number } | null }) {
  const canonicalUrl = normalizeCanonicalUrl(input.canonicalUrl);
  if (!canonicalUrl) throw new LocalDataContractError('INVALID_ARGUMENT');
  const conversationId = resolvedConversationId(input);
  if (conversationId != null && !normalizeConversationId(conversationId)) {
    throw new LocalDataContractError('STALE_REFERENCE');
  }
  return { canonicalUrl, conversationId };
}

/** Lease-bound IndexedDB implementation; direct exports above remain only for isolated legacy/provider callers. */
export function createIdbArticleCommentsRepository(lease: FactsOperationLease): ArticleCommentsFactsRepository {
  const assertLease = () => assertFactsOperationLease(lease);
  const list = async ({ context, fallbackPolicy }: ArticleCommentsListInput) => {
    assertLease();
    const bound = assertBoundContext(context);
    const byConversation = bound.conversationId ? await listArticleCommentsByConversationId(bound.conversationId) : [];
    assertLease();
    if (fallbackPolicy === 'none') return byConversation;
    const byCanonicalUrl = (await listArticleCommentsByCanonicalUrl(bound.canonicalUrl)).filter((comment) => {
      const commentConversationId = normalizeConversationId(comment.conversationId);
      return bound.conversationId
        ? commentConversationId == null || commentConversationId === bound.conversationId
        : commentConversationId == null;
    });
    assertLease();
    return mergeArticleCommentsByIdentity(byConversation, byCanonicalUrl);
  };
  const addRoot = async ({ context, authorName, quoteText, commentText, locator }: ArticleCommentsAddRootInput) => {
    assertLease();
    const bound = assertBoundContext(context);
    const comment = await addArticleComment({
      canonicalUrl: bound.canonicalUrl,
      conversationId: bound.conversationId,
      authorName,
      quoteText,
      commentText,
      locator: locator ?? null,
      parentId: null,
    });
    assertLease();
    return comment;
  };
  const addReply = async ({ context, authorName, commentText, parentId }: ArticleCommentsAddReplyInput) => {
    assertLease();
    const bound = assertBoundContext(context);
    const comment = await addArticleComment({
      canonicalUrl: bound.canonicalUrl,
      conversationId: bound.conversationId,
      authorName,
      quoteText: '',
      commentText,
      locator: null,
      parentId,
    });
    assertLease();
    return comment;
  };
  const remove = async ({ context, commentId }: ArticleCommentsDeleteInput) => {
    assertLease();
    const bound = assertBoundContext(context);
    const deleted = await deleteArticleCommentByIdInContext({ ...bound, commentId });
    assertLease();
    if (!deleted) throw new LocalDataContractError('STALE_REFERENCE');
    return true;
  };
  const ensureContext = async ({ context }: ArticleCommentsEnsureContextInput) => {
    assertLease();
    const bound = assertBoundContext(context);
    if (!bound.conversationId) throw new LocalDataContractError('STALE_REFERENCE');
    const result = await attachOrphanCommentsToConversation(bound.canonicalUrl, bound.conversationId);
    assertLease();
    return result;
  };
  const migrateCanonicalUrl = async ({ context, fromCanonicalUrl, toCanonicalUrl }: ArticleCommentsMigrateInput) => {
    assertLease();
    const bound = assertBoundContext(context);
    if (!bound.conversationId) throw new LocalDataContractError('STALE_REFERENCE');
    const result = await migrateArticleCommentsCanonicalUrl({
      fromCanonicalUrl,
      toCanonicalUrl,
      conversationId: bound.conversationId,
    });
    assertLease();
    return result;
  };
  return Object.freeze({ addReply, addRoot, delete: remove, ensureContext, list, migrateCanonicalUrl });
}
