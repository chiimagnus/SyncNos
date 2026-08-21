import type { ArticleCommentDto } from '@services/comments/domain/comment-dto';

export type CommentThread<T extends ArticleCommentDto = ArticleCommentDto> = { root: T; replies: T[] };
export type CommentThreadGraph<T extends ArticleCommentDto = ArticleCommentDto> = {
  threads: CommentThread<T>[];
  orderedItems: T[];
  orphanIds: number[];
  cycleIds: number[];
  duplicateIds: number[];
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((out, key) => {
      out[key] = stableValue(record[key]);
      return out;
    }, {});
}

function stableCommentTieKey(comment: ArticleCommentDto): string {
  return JSON.stringify({
    createdAt: Number(comment.createdAt) || 0,
    updatedAt: Number(comment.updatedAt) || 0,
    canonicalUrl: String(comment.canonicalUrl || ''),
    authorName: String(comment.authorName || ''),
    quoteText: String(comment.quoteText || ''),
    commentText: String(comment.commentText || ''),
    locator: stableValue(comment.locator ?? null),
  });
}

function stableCommentTieCompare(a: ArticleCommentDto, b: ArticleCommentDto): number {
  const aKey = stableCommentTieKey(a);
  const bKey = stableCommentTieKey(b);
  if (aKey < bKey) return -1;
  if (aKey > bKey) return 1;
  // Semantically indistinguishable rows may use the local id only as a final in-database tiebreaker.
  return a.id - b.id;
}

function stableThreadTieCompare(a: CommentThread, b: CommentThread): number {
  const aKey = JSON.stringify({
    root: stableCommentTieKey(a.root),
    replies: a.replies.map(stableCommentTieKey),
  });
  const bKey = JSON.stringify({
    root: stableCommentTieKey(b.root),
    replies: b.replies.map(stableCommentTieKey),
  });
  if (aKey < bKey) return -1;
  if (aKey > bKey) return 1;
  return a.root.id - b.root.id;
}

function timeAsc(a: ArticleCommentDto, b: ArticleCommentDto): number {
  return a.createdAt - b.createdAt || stableCommentTieCompare(a, b);
}

type RootResolution = { rootId: number };

/**
 * Builds the single canonical discussion graph consumed by metrics, list summaries,
 * UI snapshots, archive code and remote projections.
 *
 * Malformed historical data is retained deterministically:
 * - a chain whose top-most existing node points at a missing parent is rooted there;
 * - a cycle is collapsed under the oldest member of that cycle;
 * - the first row wins for duplicate IDs, while duplicates are reported separately.
 */
export function normalizeCommentThreadGraph<T extends ArticleCommentDto>(
  input: readonly T[] | null | undefined,
): CommentThreadGraph<T> {
  const byId = new Map<number, T>();
  const duplicateIds = new Set<number>();
  for (const item of input ?? []) {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0) continue;
    if (byId.has(item.id)) {
      duplicateIds.add(item.id);
      continue;
    }
    byId.set(item.id, item);
  }

  const resolutions = new Map<number, RootResolution>();
  const orphanIds = new Set<number>();
  const cycleIds = new Set<number>();

  const resolveRoot = (startId: number): RootResolution => {
    const cached = resolutions.get(startId);
    if (cached) return cached;

    const path: number[] = [];
    const pathIndex = new Map<number, number>();
    let cursorId = startId;
    let rootId = startId;

    while (true) {
      const known = resolutions.get(cursorId);
      if (known) {
        rootId = known.rootId;
        break;
      }

      const cursor = byId.get(cursorId);
      if (!cursor) {
        // This can only be reached through a malformed parent reference. The
        // previous existing node is the deterministic orphan root.
        rootId = path[path.length - 1] ?? startId;
        orphanIds.add(rootId);
        break;
      }

      pathIndex.set(cursorId, path.length);
      path.push(cursorId);

      if (cursor.parentId == null) {
        rootId = cursor.id;
        break;
      }

      const parentId = Number(cursor.parentId);
      if (!Number.isSafeInteger(parentId) || parentId <= 0 || !byId.has(parentId)) {
        rootId = cursor.id;
        orphanIds.add(cursor.id);
        break;
      }

      const cycleStart = pathIndex.get(parentId);
      if (cycleStart != null) {
        const component = path.slice(cycleStart);
        for (const id of component) cycleIds.add(id);
        rootId = component.map((id) => byId.get(id)!).sort(timeAsc)[0]?.id ?? parentId;
        break;
      }

      cursorId = parentId;
    }

    const resolution = { rootId };
    for (const id of path) resolutions.set(id, resolution);
    return resolution;
  };

  const rootIds = new Set<number>();
  const repliesByRoot = new Map<number, T[]>();
  for (const item of byId.values()) {
    const { rootId } = resolveRoot(item.id);
    rootIds.add(rootId);
    if (item.id === rootId) continue;
    const replies = repliesByRoot.get(rootId) ?? [];
    replies.push(item);
    repliesByRoot.set(rootId, replies);
  }

  const threads = [...rootIds]
    .map((id) => byId.get(id))
    .filter((item): item is T => Boolean(item))
    .map((root) => ({
      root,
      replies: (repliesByRoot.get(root.id) ?? []).sort(timeAsc),
    }))
    .sort((a, b) => b.root.createdAt - a.root.createdAt || stableThreadTieCompare(a, b));

  return {
    threads,
    orderedItems: threads.flatMap((thread) => [thread.root, ...thread.replies]),
    orphanIds: [...orphanIds].sort((a, b) => a - b),
    cycleIds: [...cycleIds].sort((a, b) => a - b),
    duplicateIds: [...duplicateIds].sort((a, b) => a - b),
  };
}
