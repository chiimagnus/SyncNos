import type { ArticleComment } from '@services/comments/domain/models';

type ArticleCommentThreadCandidate = Pick<ArticleComment, 'id' | 'parentId'>;

function normalizePositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function computeArticleCommentThreadCount(comments: unknown): number {
  const list = Array.isArray(comments) ? (comments as ArticleCommentThreadCandidate[]) : [];
  if (!list.length) return 0;

  const existingIds = new Set<number>();
  for (const comment of list) {
    const id = normalizePositiveNumber(comment?.id);
    if (id != null) existingIds.add(id);
  }

  const seenIds = new Set<number>();
  let roots = 0;

  for (const comment of list) {
    const id = normalizePositiveNumber(comment?.id);
    if (id != null) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }

    const parentId = normalizePositiveNumber(comment?.parentId);
    const isRoot = parentId == null || !existingIds.has(parentId);
    if (isRoot) roots += 1;
  }

  return roots;
}
