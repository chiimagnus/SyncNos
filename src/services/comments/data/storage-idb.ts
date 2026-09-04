import type { AddArticleCommentInput, ArticleComment } from '@services/comments/domain/models';
import { openDb } from '@platform/idb/schema';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { runTrackedTransaction } from '@services/data-revisions/transaction';

export class ArticleCommentInvariantError extends Error {
  constructor(public readonly code: 'parent_not_found' | 'parent_not_root' | 'parent_context_mismatch') {
    super(code);
    this.name = 'ArticleCommentInvariantError';
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
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeParentId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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
  return comment;
}

export async function addArticleComment(input: AddArticleCommentInput): Promise<ArticleComment> {
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

  const db = await openDb();
  return runTrackedTransaction(
    { db, stores: ['article_comments'], revisionScopes: ['article_comments'] },
    async ({ stores, markChanged }) => {
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

      const id = await reqToPromise<number>(stores.article_comments.add(row) as any);
      markChanged('article_comments');
      return toComment({ ...row, id });
    },
  );
}

export async function listArticleCommentsByCanonicalUrl(canonicalUrl: string): Promise<ArticleComment[]> {
  const normalized = normalizeCanonicalUrl(canonicalUrl);
  if (!normalized) return [];

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readonly');

  const idx = stores.article_comments.index('by_canonicalUrl_createdAt');
  const range = globalThis.IDBKeyRange.bound([normalized, -Infinity] as any, [normalized, Infinity] as any);
  const rows = await reqToPromise<any[]>(idx.getAll(range) as any);
  await txDone(t);
  return (Array.isArray(rows) ? rows : []).map(toComment);
}

export async function listArticleCommentsByConversationId(conversationId: number): Promise<ArticleComment[]> {
  const id = normalizeConversationId(conversationId);
  if (id == null) return [];

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readonly');

  const idx = stores.article_comments.index('by_conversationId_createdAt');
  const range = globalThis.IDBKeyRange.bound([id, -Infinity] as any, [id, Infinity] as any);
  const rows = await reqToPromise<any[]>(idx.getAll(range) as any);
  await txDone(t);
  return (Array.isArray(rows) ? rows : []).map(toComment);
}

type ArticleCommentDeleteResult = {
  deleted: boolean;
  conversationId: number | null;
};

export async function deleteArticleCommentById(id: number): Promise<ArticleCommentDeleteResult> {
  const commentId = Number(id);
  if (!Number.isSafeInteger(commentId) || commentId <= 0) return { deleted: false, conversationId: null };

  const db = await openDb();
  return runTrackedTransaction(
    { db, stores: ['article_comments'], revisionScopes: ['article_comments'] },
    async ({ stores, markChanged }) => {
      const store = stores.article_comments;
      const rows = (await reqToPromise<any[]>(store.getAll() as any)) || [];
      const byId = new Map<number, any>();
      const childrenByParentId = new Map<number, number[]>();

      for (const row of rows) {
        const rowId = Number(row?.id);
        if (!Number.isSafeInteger(rowId) || rowId <= 0) continue;
        byId.set(rowId, row);

        const parentId = normalizeParentId(row?.parentId);
        if (parentId == null) continue;
        const children = childrenByParentId.get(parentId) || [];
        children.push(rowId);
        childrenByParentId.set(parentId, children);
      }

      const target = byId.get(commentId);
      if (!target) return { deleted: false, conversationId: null };

      let conversationId = normalizeConversationId(target?.conversationId);
      if (conversationId == null) {
        const visitedAncestors = new Set<number>([commentId]);
        let parentId = normalizeParentId(target?.parentId);
        while (parentId != null && !visitedAncestors.has(parentId)) {
          visitedAncestors.add(parentId);
          const parent = byId.get(parentId);
          if (!parent) break;
          conversationId = normalizeConversationId(parent?.conversationId);
          if (conversationId != null) break;
          parentId = normalizeParentId(parent?.parentId);
        }
      }

      const descendants = new Set<number>();
      const pending = [commentId];
      while (pending.length) {
        const rowId = pending.pop();
        if (rowId == null || descendants.has(rowId)) continue;
        descendants.add(rowId);
        for (const childId of childrenByParentId.get(rowId) || []) {
          if (!descendants.has(childId)) pending.push(childId);
        }
      }

      await Promise.all([...descendants].map((rowId) => reqToPromise(store.delete(rowId) as any)));
      markChanged('article_comments');
      return { deleted: true, conversationId };
    },
  );
}

export async function attachOrphanCommentsToConversation(
  canonicalUrl: string,
  conversationId: number,
): Promise<{ updated: number }> {
  const normalizedUrl = normalizeCanonicalUrl(canonicalUrl);
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedUrl || !normalizedConversationId) return { updated: 0 };

  const db = await openDb();
  return runTrackedTransaction(
    { db, stores: ['article_comments'], revisionScopes: ['article_comments'] },
    async ({ stores, markChanged }) => {
      const store = stores.article_comments;
      const idx = store.index('by_canonicalUrl_createdAt');
      const range = globalThis.IDBKeyRange.bound([normalizedUrl, -Infinity] as any, [normalizedUrl, Infinity] as any);
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
      if (updated > 0) markChanged('article_comments');
      return { updated };
    },
  );
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
  return runTrackedTransaction(
    { db, stores: ['article_comments'], revisionScopes: ['article_comments'] },
    async ({ stores, markChanged }) => {
      const store = stores.article_comments;
      const idx = store.index('by_canonicalUrl_createdAt');
      const range = globalThis.IDBKeyRange.bound([from, -Infinity] as any, [from, Infinity] as any);
      const rows = (await reqToPromise<any[]>(idx.getAll(range) as any)) || [];
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
      if (updated > 0) markChanged('article_comments');
      return { updated };
    },
  );
}
