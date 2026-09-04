import type { ArticleCommentLocator } from '@services/comments/domain/comment-locator';
import type {
  CommentAnchorResolutionBudget,
  ResolveCommentAnchorResult,
} from '@services/comments/locator/resolve-comment-anchor';
import type { CommentRangeMarkerRegistry } from '@ui/comments/range-marker-registry';

export type CommentAnchorItem = { commentId: number; locator: ArticleCommentLocator | null | undefined };

export function createCommentAnchorController(input: {
  getRoots: (locator: ArticleCommentLocator) => readonly Element[];
  resolve: (request: {
    locator: ArticleCommentLocator;
    roots: readonly Element[];
    signal: AbortSignal;
    generation: number;
    budget: CommentAnchorResolutionBudget;
  }) => Promise<ResolveCommentAnchorResult> | ResolveCommentAnchorResult;
  registry: CommentRangeMarkerRegistry;
  maxItems?: number;
  maxTotalTextLength?: number;
}) {
  let generation = 0;
  let abortController: AbortController | null = null;
  let locateAbortController: AbortController | null = null;
  let locateRequestId = 0;
  let activeCommentId: number | null = null;
  let disposed = false;
  const trackedCommentIds = new Set<number>();

  const nextGeneration = () => {
    generation += 1;
    abortController?.abort();
    locateAbortController?.abort();
    locateAbortController = null;
    locateRequestId += 1;
    abortController = new AbortController();
    return { generation, signal: abortController.signal };
  };

  const currentGeneration = () => {
    if (!abortController || abortController.signal.aborted) return nextGeneration();
    return { generation, signal: abortController.signal };
  };

  const removeTrackedMarkers = () => {
    for (const commentId of trackedCommentIds) input.registry.remove(commentId);
    trackedCommentIds.clear();
  };

  const sync = async (items: readonly CommentAnchorItem[], nextActiveId?: number | null) => {
    if (disposed) return;
    if (nextActiveId !== undefined) activeCommentId = nextActiveId;
    const run = nextGeneration();
    const budget = {
      remainingTextLength: Math.max(0, Math.floor(Number(input.maxTotalTextLength ?? 400_000) || 0)),
    };
    const limited = items
      .filter((item) => !!item.locator)
      .sort((left, right) => Number(right.commentId === activeCommentId) - Number(left.commentId === activeCommentId))
      .slice(0, Math.max(1, Math.floor(Number(input.maxItems ?? 100) || 1)));
    const nextIds = new Set(limited.map((item) => item.commentId));

    for (const commentId of trackedCommentIds) {
      if (nextIds.has(commentId)) continue;
      input.registry.remove(commentId);
      trackedCommentIds.delete(commentId);
    }

    for (const item of limited) {
      if (run.signal.aborted || run.generation !== generation || disposed) return;
      const locator = item.locator!;
      const result = await input.resolve({
        locator,
        roots: input.getRoots(locator),
        signal: run.signal,
        generation: run.generation,
        budget,
      });
      if (run.signal.aborted || run.generation !== generation || disposed) return;
      if (result.ok) {
        input.registry.replace(
          item.commentId,
          result.range,
          result.root,
          item.commentId === activeCommentId ? 'active' : 'passive',
        );
        trackedCommentIds.add(item.commentId);
      } else {
        input.registry.remove(item.commentId);
        trackedCommentIds.delete(item.commentId);
      }
    }
    input.registry.setActive(activeCommentId);
  };

  const locate = async (item: CommentAnchorItem): Promise<ResolveCommentAnchorResult> => {
    if (disposed) return { ok: false, reason: 'aborted' };
    if (!item.locator) return { ok: false, reason: 'missing_locator' };
    activeCommentId = item.commentId;
    const run = currentGeneration();
    locateAbortController?.abort();
    locateAbortController = new AbortController();
    const locateSignal = locateAbortController.signal;
    const requestId = ++locateRequestId;
    const budget = {
      remainingTextLength: Math.max(0, Math.floor(Number(input.maxTotalTextLength ?? 400_000) || 0)),
    };
    const result = await input.resolve({
      locator: item.locator,
      roots: input.getRoots(item.locator),
      signal: locateSignal,
      generation: run.generation,
      budget,
    });
    if (
      locateSignal.aborted ||
      run.signal.aborted ||
      run.generation !== generation ||
      requestId !== locateRequestId ||
      activeCommentId !== item.commentId ||
      disposed
    ) {
      return { ok: false, reason: 'aborted' };
    }
    if (!result.ok) {
      input.registry.remove(item.commentId);
      trackedCommentIds.delete(item.commentId);
      return result;
    }
    input.registry.replace(item.commentId, result.range, result.root, 'active');
    trackedCommentIds.add(item.commentId);
    input.registry.setActive(item.commentId);
    return result;
  };

  return {
    sync,
    locate,
    setActive(commentId: number | null) {
      activeCommentId = commentId;
      input.registry.setActive(commentId);
    },
    reset() {
      nextGeneration();
      activeCommentId = null;
      removeTrackedMarkers();
      input.registry.setActive(null);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      nextGeneration();
      removeTrackedMarkers();
      input.registry.dispose();
    },
    getGeneration: () => generation,
  };
}
