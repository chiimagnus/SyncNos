import type { AddArticleCommentInput, ArticleComment } from '@services/comments/domain/models';
import { openDb as openSchemaDb } from '@platform/idb/schema';

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
  return {
    id: Number(row?.id),
    parentId: normalizeParentId(row?.parentId),
    conversationId: normalizeConversationId(row?.conversationId),
    canonicalUrl: normalizeHttpUrl(row?.canonicalUrl),
    quoteText: safeString(row?.quoteText),
    commentText: normalizeCommentText(row?.commentText),
    createdAt: Number(row?.createdAt) || 0,
    updatedAt: Number(row?.updatedAt) || 0,
  };
}

export async function addArticleComment(input: AddArticleCommentInput): Promise<ArticleComment> {
  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readwrite');

  const now = Date.now();
  const canonicalUrl = normalizeHttpUrl(input?.canonicalUrl);
  const commentText = normalizeCommentText(input?.commentText);
  const quoteText = safeString(input?.quoteText);
  if (!canonicalUrl) throw new Error('canonicalUrl required');
  if (!commentText) throw new Error('commentText required');

  const createdAt = normalizeTimestamp(input?.createdAt, now);
  const updatedAt = normalizeTimestamp(input?.updatedAt, createdAt);

  const row: any = {
    parentId: normalizeParentId(input?.parentId),
    conversationId: normalizeConversationId(input?.conversationId),
    canonicalUrl,
    quoteText,
    commentText,
    createdAt,
    updatedAt,
  };

  const id = await reqToPromise<number>(stores.article_comments.add(row) as any);
  await txDone(t);
  return toComment({ ...row, id });
}

export async function listArticleCommentsByCanonicalUrl(canonicalUrl: string): Promise<ArticleComment[]> {
  const normalized = normalizeHttpUrl(canonicalUrl);
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

export async function deleteArticleCommentById(id: number): Promise<boolean> {
  const commentId = Number(id);
  if (!Number.isFinite(commentId) || commentId <= 0) return false;

  const db = await openDb();
  const { t, stores } = tx(db, ['article_comments'], 'readwrite');

  await new Promise<void>((resolve, reject) => {
    try {
      const req = stores.article_comments.openCursor();
      req.onerror = () => reject(req.error || new Error('cursor failed'));
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null;
        if (!cursor) return resolve();
        const value: any = cursor.value;
        const rowId = Number(value?.id);
        const parentId = normalizeParentId(value?.parentId);
        if ((Number.isFinite(rowId) && rowId === commentId) || parentId === commentId) {
          try {
            cursor.delete();
          } catch (_e) {
            // ignore and continue
          }
        }
        cursor.continue();
      };
    } catch (e) {
      reject(e);
    }
  });

  await txDone(t);
  return true;
}

export async function hasAnyArticleCommentsForCanonicalUrl(canonicalUrl: string): Promise<boolean> {
  const normalized = normalizeHttpUrl(canonicalUrl);
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
  const normalizedUrl = normalizeHttpUrl(canonicalUrl);
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
    // eslint-disable-next-line no-await-in-loop
    await reqToPromise(store.put(row));
    updated += 1;
  }

  await txDone(t);
  return { updated };
}
