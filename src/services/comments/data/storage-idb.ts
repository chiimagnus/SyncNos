import type { AddArticleCommentInput, ArticleComment } from '@services/comments/domain/models';
import { openDb } from '@platform/idb/schema';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { hasValidArticleCommentContent } from '@services/comments/domain/comment-content';
import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { toCanonicalCommentQuote } from '@services/comments/locator/comment-quote-policy';
import { runTrackedTransaction } from '@services/data-revisions/transaction';

export type ImportedArticleCommentInput = {
  importSource: string;
  importKey: string;
  conversationId: number;
  canonicalUrl: string;
  authorName?: string | null;
  quoteText?: string | null;
  commentText: string;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export class ArticleCommentInvariantError extends Error {
  constructor(
    public readonly code: 'parent_not_found' | 'parent_not_root' | 'parent_context_mismatch' | 'conversation_not_found',
  ) {
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

function normalizeActivityTimestamp(value: unknown): number {
  const t = Number(value);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function normalizeCommentText(value: unknown): string {
  return String(value || '').trim();
}

function toComment(row: any): ArticleComment {
  const importSource = safeString(row?.importSource);
  const importKey = safeString(row?.importKey);
  const comment: ArticleComment = {
    id: Number(row?.id),
    parentId: normalizeParentId(row?.parentId),
    conversationId: normalizeConversationId(row?.conversationId),
    canonicalUrl: normalizeCanonicalUrl(row?.canonicalUrl),
    authorName: safeString(row?.authorName) || null,
    quoteText: toCanonicalCommentQuote(row?.quoteText),
    commentText: normalizeCommentText(row?.commentText),
    locator: normalizeArticleCommentLocator(row?.locator),
    ...(importSource && importKey ? { importSource, importKey } : {}),
    createdAt: Number(row?.createdAt) || 0,
    updatedAt: Number(row?.updatedAt) || 0,
  };
  return comment;
}

export async function addArticleComment(input: AddArticleCommentInput): Promise<ArticleComment> {
  const now = Date.now();
  const canonicalUrl = normalizeCanonicalUrl(input?.canonicalUrl);
  const commentText = normalizeCommentText(input?.commentText);
  const quoteText = toCanonicalCommentQuote(input?.quoteText);
  const parentId = normalizeParentId(input?.parentId);
  const locator = normalizeArticleCommentLocator(input?.locator);
  if (!canonicalUrl) throw new Error('canonicalUrl required');
  if (parentId != null && quoteText.trim()) throw new Error('reply quote is not allowed');
  if (!hasValidArticleCommentContent({ parentId, quoteText, commentText, locator })) {
    throw new Error('commentText or anchored quote required');
  }

  const splitQuoteAndComment = parentId == null && !!quoteText.trim() && !!commentText;
  if (splitQuoteAndComment && !hasValidArticleCommentContent({ parentId: null, quoteText, commentText: '', locator })) {
    throw new Error('anchored quote required when saving quote with comment');
  }

  const createdAt = normalizeTimestamp(input?.createdAt, now);
  const updatedAt = normalizeTimestamp(input?.updatedAt, createdAt);
  const conversationId = normalizeConversationId(input?.conversationId);
  const row: any = {
    parentId,
    conversationId,
    canonicalUrl,
    authorName: safeString(input?.authorName) || '',
    quoteText,
    commentText: splitQuoteAndComment ? '' : commentText,
    locator,
    createdAt,
    updatedAt,
  };

  const db = await openDb();
  return runTrackedTransaction(
    { db, stores: ['article_comments', 'conversations'], revisionScopes: ['article_comments', 'conversations'] },
    async ({ stores, markChanged }) => {
      const conversation =
        conversationId == null ? null : await reqToPromise<any>(stores.conversations.get(conversationId as any));
      if (conversationId != null && !conversation) throw new ArticleCommentInvariantError('conversation_not_found');

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
      if (splitQuoteAndComment) {
        await reqToPromise(
          stores.article_comments.add({
            parentId: id,
            conversationId,
            canonicalUrl,
            authorName: row.authorName,
            quoteText: '',
            commentText,
            locator: null,
            createdAt,
            updatedAt,
          }) as any,
        );
      }
      markChanged('article_comments');
      if (conversation) {
        const currentActivityAt = normalizeActivityTimestamp(conversation.lastActivityAt);
        if (createdAt > currentActivityAt) {
          await reqToPromise(stores.conversations.put({ ...conversation, lastActivityAt: createdAt }));
          markChanged('conversations');
        }
      }
      return toComment({ ...row, id });
    },
  );
}

export async function syncImportedArticleComments(
  items: ImportedArticleCommentInput[],
): Promise<{ created: number; updated: number }> {
  const normalized = items
    .map((item) => {
      const importSource = safeString(item.importSource);
      const importKey = safeString(item.importKey);
      const conversationId = normalizeConversationId(item.conversationId);
      const canonicalUrl = normalizeCanonicalUrl(item.canonicalUrl);
      const quoteText = toCanonicalCommentQuote(item.quoteText);
      const commentText = normalizeCommentText(item.commentText);
      if (
        !importSource ||
        !importKey ||
        !conversationId ||
        !canonicalUrl ||
        !hasValidArticleCommentContent({
          parentId: null,
          quoteText,
          commentText,
          importSource,
          importKey,
        })
      )
        return null;
      const createdAt = normalizeTimestamp(item.createdAt, Date.now());
      return {
        importSource,
        importKey,
        conversationId,
        canonicalUrl,
        authorName: safeString(item.authorName),
        quoteText,
        commentText,
        createdAt,
        updatedAt: normalizeTimestamp(item.updatedAt, createdAt),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (!normalized.length) return { created: 0, updated: 0 };

  const conversationId = normalized[0].conversationId;
  const canonicalUrl = normalized[0].canonicalUrl;
  if (normalized.some((item) => item.conversationId !== conversationId || item.canonicalUrl !== canonicalUrl)) {
    throw new Error('imported article comments must share one article context');
  }

  const db = await openDb();
  return runTrackedTransaction(
    { db, stores: ['article_comments', 'conversations'], revisionScopes: ['article_comments', 'conversations'] },
    async ({ stores, markChanged }) => {
      const conversation = await reqToPromise<any>(stores.conversations.get(conversationId as any));
      if (!conversation) throw new ArticleCommentInvariantError('conversation_not_found');

      const index = stores.article_comments.index('by_conversationId_createdAt');
      const range = globalThis.IDBKeyRange.bound([conversationId, -Infinity] as any, [conversationId, Infinity] as any);
      const existingRows = (await reqToPromise<any[]>(index.getAll(range) as any)) || [];
      const rootsByImportIdentity = new Map<string, any>();
      const commentsByImportIdentity = new Map<string, any>();
      for (const row of existingRows) {
        const source = safeString(row?.importSource);
        const key = safeString(row?.importKey);
        if (!source || !key) continue;
        const identity = `${source}\u0000${key}`;
        const target = normalizeParentId(row?.parentId) == null ? rootsByImportIdentity : commentsByImportIdentity;
        if (!target.has(identity)) target.set(identity, row);
      }

      let created = 0;
      let updated = 0;
      let latestHistoricalActivityAt = 0;
      for (const item of normalized) {
        const identity = `${item.importSource}\u0000${item.importKey}`;
        const existingRoot = rootsByImportIdentity.get(identity) || null;
        latestHistoricalActivityAt = Math.max(latestHistoricalActivityAt, item.createdAt);
        const hasQuote = !!item.quoteText.trim();
        const rootQuoteText = hasQuote ? item.quoteText : '';
        const rootCommentText = hasQuote ? '' : item.commentText;
        let root = existingRoot;
        let changed = false;

        const desiredRoot = {
          ...(existingRoot || {}),
          parentId: null,
          conversationId,
          canonicalUrl,
          authorName: item.authorName,
          quoteText: rootQuoteText,
          commentText: rootCommentText,
          locator: null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          importSource: item.importSource,
          importKey: item.importKey,
        };
        if (!existingRoot) {
          const id = await reqToPromise<number>(stores.article_comments.add(desiredRoot) as any);
          root = { ...desiredRoot, id };
          rootsByImportIdentity.set(identity, root);
          created += 1;
          changed = true;
        } else {
          const rootChanged =
            safeString(existingRoot.authorName) !== desiredRoot.authorName ||
            toCanonicalCommentQuote(existingRoot.quoteText) !== desiredRoot.quoteText ||
            normalizeCommentText(existingRoot.commentText) !== desiredRoot.commentText ||
            normalizeCanonicalUrl(existingRoot.canonicalUrl) !== desiredRoot.canonicalUrl ||
            Number(existingRoot.createdAt) !== desiredRoot.createdAt ||
            Number(existingRoot.updatedAt) !== desiredRoot.updatedAt ||
            normalizeParentId(existingRoot.parentId) !== null ||
            existingRoot.locator != null;
          if (rootChanged) {
            await reqToPromise(stores.article_comments.put(desiredRoot));
            root = desiredRoot;
            rootsByImportIdentity.set(identity, root);
            changed = true;
          }
        }

        const desiredChildText = hasQuote ? item.commentText : '';
        const existingChild = commentsByImportIdentity.get(identity) || null;
        if (desiredChildText) {
          const desiredChild = {
            ...(existingChild || {}),
            parentId: Number(root.id),
            conversationId,
            canonicalUrl,
            authorName: item.authorName,
            quoteText: '',
            commentText: desiredChildText,
            locator: null,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            importSource: item.importSource,
            importKey: item.importKey,
          };
          const childChanged =
            !existingChild ||
            normalizeParentId(existingChild.parentId) !== Number(root.id) ||
            safeString(existingChild.authorName) !== desiredChild.authorName ||
            toCanonicalCommentQuote(existingChild.quoteText) !== '' ||
            normalizeCommentText(existingChild.commentText) !== desiredChild.commentText ||
            normalizeCanonicalUrl(existingChild.canonicalUrl) !== desiredChild.canonicalUrl ||
            Number(existingChild.createdAt) !== desiredChild.createdAt ||
            Number(existingChild.updatedAt) !== desiredChild.updatedAt ||
            existingChild.locator != null;
          if (childChanged) {
            if (existingChild) {
              await reqToPromise(stores.article_comments.put(desiredChild));
              commentsByImportIdentity.set(identity, desiredChild);
            } else {
              const id = await reqToPromise<number>(stores.article_comments.add(desiredChild) as any);
              commentsByImportIdentity.set(identity, { ...desiredChild, id });
            }
            changed = true;
          }
        } else if (existingChild) {
          await reqToPromise(stores.article_comments.delete(Number(existingChild.id)) as any);
          commentsByImportIdentity.delete(identity);
          changed = true;
        }

        if (existingRoot && changed) updated += 1;
      }

      if (created > 0 || updated > 0) markChanged('article_comments');
      const currentActivityAt = normalizeActivityTimestamp(conversation.lastActivityAt);
      if (latestHistoricalActivityAt > currentActivityAt) {
        await reqToPromise(stores.conversations.put({ ...conversation, lastActivityAt: latestHistoricalActivityAt }));
        markChanged('conversations');
      }
      return { created, updated };
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
    { db, stores: ['article_comments', 'conversations'], revisionScopes: ['article_comments', 'conversations'] },
    async ({ stores, markChanged }) => {
      const store = stores.article_comments;
      const rows = (await reqToPromise<any[]>(store.getAll() as any)) || [];
      const byId = new Map<number, any>();
      for (const row of rows) {
        const rowId = Number(row?.id);
        if (Number.isSafeInteger(rowId) && rowId > 0) byId.set(rowId, row);
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

      if (normalizeParentId(target?.parentId) == null) {
        const childrenByParentId = new Map<number, number[]>();
        for (const row of rows) {
          const rowId = Number(row?.id);
          const parentId = normalizeParentId(row?.parentId);
          if (!Number.isSafeInteger(rowId) || rowId <= 0 || parentId == null) continue;
          const children = childrenByParentId.get(parentId) ?? [];
          children.push(rowId);
          childrenByParentId.set(parentId, children);
        }
        const deleteIds = new Set<number>();
        const pending = [commentId];
        while (pending.length) {
          const rowId = pending.pop();
          if (rowId == null || deleteIds.has(rowId)) continue;
          deleteIds.add(rowId);
          for (const childId of childrenByParentId.get(rowId) ?? []) pending.push(childId);
        }
        await Promise.all([...deleteIds].map((rowId) => reqToPromise(store.delete(rowId) as any)));
      } else {
        await reqToPromise(store.delete(commentId) as any);
      }
      markChanged('article_comments');
      if (conversationId != null) {
        const conversation = await reqToPromise<any>(stores.conversations.get(conversationId as any));
        if (conversation) {
          const deletedAt = Date.now();
          const currentActivityAt = normalizeActivityTimestamp(conversation.lastActivityAt);
          if (deletedAt > currentActivityAt) {
            await reqToPromise(stores.conversations.put({ ...conversation, lastActivityAt: deletedAt }));
            markChanged('conversations');
          }
        }
      }
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
    { db, stores: ['article_comments', 'conversations'], revisionScopes: ['article_comments', 'conversations'] },
    async ({ stores, markChanged }) => {
      const conversation = await reqToPromise<any>(stores.conversations.get(normalizedConversationId as any));
      if (!conversation) throw new ArticleCommentInvariantError('conversation_not_found');
      const store = stores.article_comments;
      const idx = store.index('by_canonicalUrl_createdAt');
      const range = globalThis.IDBKeyRange.bound([normalizedUrl, -Infinity] as any, [normalizedUrl, Infinity] as any);
      const rows = (await reqToPromise<any[]>(idx.getAll(range) as any)) || [];
      let updated = 0;
      let latestHistoricalActivityAt = 0;
      const now = Date.now();
      for (const row of rows) {
        if (!row) continue;
        const current = normalizeConversationId(row?.conversationId);
        if (current) continue;
        latestHistoricalActivityAt = Math.max(latestHistoricalActivityAt, normalizeActivityTimestamp(row.createdAt));
        row.conversationId = normalizedConversationId;
        row.updatedAt = now;
        await reqToPromise(store.put(row));
        updated += 1;
      }
      if (updated > 0) {
        markChanged('article_comments');
        const currentActivityAt = normalizeActivityTimestamp(conversation.lastActivityAt);
        if (latestHistoricalActivityAt > currentActivityAt) {
          await reqToPromise(stores.conversations.put({ ...conversation, lastActivityAt: latestHistoricalActivityAt }));
          markChanged('conversations');
        }
      }
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
