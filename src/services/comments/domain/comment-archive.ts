import { parseArticleCommentLocator, type ArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { parseArticleCommentDto, type ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { normalizeCommentThreadGraph } from '@services/comments/domain/comment-thread-graph';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

export const ARTICLE_COMMENT_ARCHIVE_SCHEMA_V1 = 1;
export const ARTICLE_COMMENT_ARCHIVE_SCHEMA_V2 = 2;
export const ARTICLE_COMMENT_ARCHIVE_CURRENT_SCHEMA = ARTICLE_COMMENT_ARCHIVE_SCHEMA_V2;

export const COMMENT_ARCHIVE_BUDGET = Object.freeze({
  items: 100_000,
  text: 200_000,
  quote: 20_000,
  author: 512,
  uniqueKey: 2_048,
  importSource: 128,
  importKey: 2_048,
  url: 16_384,
});

export type ArticleCommentArchiveItem = {
  commentId: number;
  parentCommentId: number | null;
  uniqueKey: string;
  canonicalUrl: string;
  authorName: string | null;
  importSource?: string;
  importKey?: string;
  quoteText: string;
  commentText: string;
  locator: ArticleCommentLocator | null;
  createdAt: number;
  updatedAt: number;
};

export type ArticleCommentsArchiveDocument = {
  schemaVersion: 1 | 2;
  comments: ArticleCommentArchiveItem[];
};

export type CommentArchiveSerializationWarning = {
  code:
    | 'invalid_row'
    | 'invalid_locator'
    | 'duplicate_id'
    | 'orphan_promoted'
    | 'cycle_normalized'
    | 'cross_context_promoted';
  commentId?: number;
};

export type ArticleCommentArchiveSerialization = {
  document: ArticleCommentsArchiveDocument;
  warnings: CommentArchiveSerializationWarning[];
};

export type CommentArchiveWarning = {
  code: 'v1_missing_author' | 'v1_missing_locator' | 'orphan_parent' | 'duplicate_comment_id';
  commentId?: number;
};

export type ArticleCommentArchiveValidation =
  | { ok: true; error: ''; document: ArticleCommentsArchiveDocument; warnings: CommentArchiveWarning[] }
  | { ok: false; error: string; document: null; warnings: CommentArchiveWarning[] };

function own(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function positiveInt(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function finiteTimestamp(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function boundedString(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || value.length > limit) return null;
  return value;
}

function fail(error: string, warnings: CommentArchiveWarning[]): ArticleCommentArchiveValidation {
  return { ok: false, error, document: null, warnings };
}

export function validateArticleCommentArchiveDocument(value: unknown): ArticleCommentArchiveValidation {
  const warnings: CommentArchiveWarning[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('Article comments index is not an object', warnings);
  const input = value as Record<string, unknown>;
  const schemaVersion = Number(input.schemaVersion);
  if (schemaVersion !== ARTICLE_COMMENT_ARCHIVE_SCHEMA_V1 && schemaVersion !== ARTICLE_COMMENT_ARCHIVE_SCHEMA_V2) {
    return fail('Unsupported article comments schemaVersion', warnings);
  }
  if (!Array.isArray(input.comments)) return fail('Missing article comments list', warnings);
  if (input.comments.length > COMMENT_ARCHIVE_BUDGET.items)
    return fail('Article comments list exceeds budget', warnings);

  const comments: ArticleCommentArchiveItem[] = [];
  const byId = new Map<number, ArticleCommentArchiveItem>();
  for (const raw of input.comments) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Invalid article comment item', warnings);
    const row = raw as Record<string, unknown>;
    const commentId = positiveInt(row.commentId);
    if (!commentId) return fail('Invalid article commentId', warnings);
    if (byId.has(commentId)) {
      warnings.push({ code: 'duplicate_comment_id', commentId });
      return fail('Duplicate article commentId', warnings);
    }
    const parentCommentId = row.parentCommentId == null ? null : positiveInt(row.parentCommentId);
    if (row.parentCommentId != null && !parentCommentId) return fail('Invalid article parentCommentId', warnings);

    const uniqueKeyRaw = boundedString(row.uniqueKey ?? '', COMMENT_ARCHIVE_BUDGET.uniqueKey);
    if (uniqueKeyRaw == null) return fail('Invalid article comment uniqueKey', warnings);
    const uniqueKey = uniqueKeyRaw.trim();
    if (uniqueKey && !uniqueKey.includes('||')) return fail('Invalid article comment uniqueKey', warnings);

    const canonicalRaw = boundedString(row.canonicalUrl, COMMENT_ARCHIVE_BUDGET.url);
    const canonicalUrl = canonicalRaw == null ? '' : canonicalizeArticleUrl(canonicalRaw);
    if (!canonicalUrl) return fail('Invalid article comment canonicalUrl', warnings);

    const quoteText = boundedString(row.quoteText ?? '', COMMENT_ARCHIVE_BUDGET.quote);
    if (quoteText == null) return fail('Invalid article comment quoteText', warnings);
    const commentRaw = boundedString(row.commentText, COMMENT_ARCHIVE_BUDGET.text);
    const commentText = commentRaw?.trim() ?? '';
    if (!commentText) return fail('Invalid article comment commentText', warnings);

    const createdAt = finiteTimestamp(row.createdAt);
    const updatedAt = finiteTimestamp(row.updatedAt);
    if (createdAt == null) return fail('Invalid article comment createdAt', warnings);
    if (updatedAt == null) return fail('Invalid article comment updatedAt', warnings);

    let authorName: string | null = null;
    if (schemaVersion === ARTICLE_COMMENT_ARCHIVE_SCHEMA_V1 && !own(row, 'authorName')) {
      warnings.push({ code: 'v1_missing_author', commentId });
    } else if (row.authorName != null) {
      const author = boundedString(row.authorName, COMMENT_ARCHIVE_BUDGET.author);
      if (author == null) return fail('Invalid article comment authorName', warnings);
      authorName = author.trim() || null;
    }

    const importSourceRaw = boundedString(row.importSource ?? '', COMMENT_ARCHIVE_BUDGET.importSource);
    const importKeyRaw = boundedString(row.importKey ?? '', COMMENT_ARCHIVE_BUDGET.importKey);
    if (importSourceRaw == null || importKeyRaw == null)
      return fail('Invalid article comment import identity', warnings);
    const importSource = importSourceRaw.trim();
    const importKey = importKeyRaw.trim();
    if (Boolean(importSource) !== Boolean(importKey)) return fail('Invalid article comment import identity', warnings);

    let locator: ArticleCommentLocator | null = null;
    if (schemaVersion === ARTICLE_COMMENT_ARCHIVE_SCHEMA_V1 && !own(row, 'locator')) {
      warnings.push({ code: 'v1_missing_locator', commentId });
    } else if (row.locator != null) {
      const parsed = parseArticleCommentLocator(row.locator);
      if (!parsed.ok) return fail(`Invalid article comment locator: ${parsed.reason}`, warnings);
      locator = parsed.value;
    }

    const item: ArticleCommentArchiveItem = {
      commentId,
      parentCommentId,
      uniqueKey,
      canonicalUrl,
      authorName,
      ...(importSource && importKey ? { importSource, importKey } : {}),
      quoteText,
      commentText,
      locator,
      createdAt,
      updatedAt,
    };
    byId.set(commentId, item);
    comments.push(item);
  }

  for (const item of comments) {
    if (item.parentCommentId == null) continue;
    const parent = byId.get(item.parentCommentId);
    if (!parent) {
      warnings.push({ code: 'orphan_parent', commentId: item.commentId });
      continue;
    }
    if (parent.parentCommentId != null) return fail('Article comment parent must be a root', warnings);
    if (parent.canonicalUrl !== item.canonicalUrl || parent.uniqueKey !== item.uniqueKey) {
      return fail('Article comment parent context mismatch', warnings);
    }
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (id: number): boolean => {
    if (visited.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    const parentId = byId.get(id)?.parentCommentId;
    if (parentId != null && byId.has(parentId) && !visit(parentId)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const id of byId.keys()) {
    if (!visit(id)) return fail('Article comment graph contains a cycle', warnings);
  }

  return {
    ok: true,
    error: '',
    document: { schemaVersion: schemaVersion as 1 | 2, comments },
    warnings,
  };
}

function archiveItemFromDto(
  dto: ArticleCommentDto,
  parentCommentId: number | null,
  uniqueKeyByConversationId: ReadonlyMap<number, string>,
): ArticleCommentArchiveItem {
  return {
    commentId: dto.id,
    parentCommentId,
    uniqueKey: dto.conversationId == null ? '' : (uniqueKeyByConversationId.get(dto.conversationId) ?? ''),
    canonicalUrl: dto.canonicalUrl,
    authorName: dto.authorName ?? null,
    ...(dto.importSource && dto.importKey ? { importSource: dto.importSource, importKey: dto.importKey } : {}),
    quoteText: dto.quoteText,
    commentText: dto.commentText,
    locator: dto.locator ?? null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/** Serializes raw IDB rows into the current, deterministic archive graph. */
export function serializeArticleCommentArchive(
  rows: readonly unknown[] | null | undefined,
  uniqueKeyByConversationId: ReadonlyMap<number, string>,
): ArticleCommentArchiveSerialization {
  const warnings: CommentArchiveSerializationWarning[] = [];
  const parsed: ArticleCommentDto[] = [];
  for (const raw of rows ?? []) {
    const dto = parseArticleCommentDto(raw);
    if (!dto) {
      warnings.push({ code: 'invalid_row' });
      continue;
    }
    if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).locator != null) {
      const locatorResult = parseArticleCommentLocator((raw as Record<string, unknown>).locator);
      if (!locatorResult.ok) warnings.push({ code: 'invalid_locator', commentId: dto.id });
    }
    parsed.push(dto);
  }

  const graph = normalizeCommentThreadGraph(parsed);
  for (const id of graph.duplicateIds) warnings.push({ code: 'duplicate_id', commentId: id });
  for (const id of graph.orphanIds) warnings.push({ code: 'orphan_promoted', commentId: id });
  for (const id of graph.cycleIds) warnings.push({ code: 'cycle_normalized', commentId: id });

  const comments: ArticleCommentArchiveItem[] = [];
  for (const thread of graph.threads) {
    const rootItem = archiveItemFromDto(thread.root, null, uniqueKeyByConversationId);
    comments.push(rootItem);
    for (const reply of thread.replies) {
      const replyItem = archiveItemFromDto(reply, thread.root.id, uniqueKeyByConversationId);
      if (replyItem.canonicalUrl !== rootItem.canonicalUrl || replyItem.uniqueKey !== rootItem.uniqueKey) {
        replyItem.parentCommentId = null;
        warnings.push({ code: 'cross_context_promoted', commentId: reply.id });
      }
      comments.push(replyItem);
    }
  }

  return {
    document: { schemaVersion: ARTICLE_COMMENT_ARCHIVE_CURRENT_SCHEMA, comments },
    warnings,
  };
}

export type PreparedArticleCommentArchiveItem = ArticleCommentArchiveItem & {
  baseKey: string;
  parentBaseKey: string;
  fingerprint: string;
};

export type PreparedArticleCommentArchiveImport = {
  items: PreparedArticleCommentArchiveItem[];
  warnings: CommentArchiveWarning[];
};

export function buildArticleCommentArchiveBaseKey(
  input: Pick<ArticleCommentArchiveItem, 'uniqueKey' | 'canonicalUrl' | 'createdAt' | 'quoteText' | 'commentText'>,
): string {
  return [
    input.uniqueKey.trim(),
    input.canonicalUrl.trim(),
    String(input.createdAt),
    input.quoteText,
    input.commentText,
  ].join('||');
}

export function buildArticleCommentArchiveFingerprint(baseKey: string, parentBaseKey: string): string {
  return `${baseKey}||parent=${parentBaseKey}`;
}

/** Validates and orders archive rows roots-first for a deterministic merge. */
export function prepareArticleCommentArchiveImport(value: unknown): PreparedArticleCommentArchiveImport {
  const validation = validateArticleCommentArchiveDocument(value);
  if (!validation.ok) throw new Error(validation.error);
  const byId = new Map(validation.document.comments.map((item) => [item.commentId, item]));
  const roots: ArticleCommentArchiveItem[] = [];
  const repliesByRoot = new Map<number, ArticleCommentArchiveItem[]>();

  for (const item of validation.document.comments) {
    const parent = item.parentCommentId == null ? null : (byId.get(item.parentCommentId) ?? null);
    if (!parent) {
      roots.push({ ...item, parentCommentId: null });
      continue;
    }
    const replies = repliesByRoot.get(parent.commentId) ?? [];
    replies.push(item);
    repliesByRoot.set(parent.commentId, replies);
  }

  roots.sort((a, b) => b.createdAt - a.createdAt || b.commentId - a.commentId);
  const items: PreparedArticleCommentArchiveItem[] = [];
  for (const root of roots) {
    const baseKey = buildArticleCommentArchiveBaseKey(root);
    items.push({
      ...root,
      baseKey,
      parentBaseKey: '',
      fingerprint: buildArticleCommentArchiveFingerprint(baseKey, ''),
    });
    const replies = (repliesByRoot.get(root.commentId) ?? []).sort(
      (a, b) => a.createdAt - b.createdAt || a.commentId - b.commentId,
    );
    for (const reply of replies) {
      const replyBaseKey = buildArticleCommentArchiveBaseKey(reply);
      items.push({
        ...reply,
        baseKey: replyBaseKey,
        parentBaseKey: baseKey,
        fingerprint: buildArticleCommentArchiveFingerprint(replyBaseKey, baseKey),
      });
    }
  }
  return { items, warnings: validation.warnings };
}
