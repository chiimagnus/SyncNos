import type { CommentLocatorSurfaceRoots } from '@ui/comments/types';
import { captureCommentAnchor } from '@services/comments/locator/capture-comment-anchor';
import { toCanonicalCommentQuote } from '@services/comments/locator/comment-quote-policy';
import { validateCommentSelectionBoundary } from '@services/comments/locator/comment-selection-boundary';

export type AppCommentSelectionPayload = {
  selectionText: string;
  locator: ReturnType<typeof captureCommentAnchor>;
};

export function createAppCommentSelectionSource(input: {
  getSurfaceRoots: () => CommentLocatorSurfaceRoots | null;
  getSelection?: () => Selection | null;
  getExcludedRoots?: () => readonly Element[];
}) {
  return (): AppCommentSelectionPayload => {
    const roots = input.getSurfaceRoots();
    if (!roots) return { selectionText: '', locator: null };
    const selection = input.getSelection ? input.getSelection() : roots.sourceRoot.ownerDocument.getSelection();
    const boundary = validateCommentSelectionBoundary({
      selection,
      root: roots.sourceRoot,
      excludedRoots: input.getExcludedRoots?.(),
    });
    if (!boundary.ok) return { selectionText: '', locator: null };
    const locator = captureCommentAnchor({ root: roots.sourceRoot, range: boundary.range, surfaceHint: 'app' });
    const selectionText = locator?.quote.exact ?? toCanonicalCommentQuote(boundary.range.toString());
    if (!selectionText) return { selectionText: '', locator: null };
    return { selectionText, locator };
  };
}
