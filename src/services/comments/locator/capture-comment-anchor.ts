import type { ArticleCommentLocatorV2, ArticleCommentSurfaceHint } from '@services/comments/domain/comment-locator';
import { captureCommentBoundaryPath, encodeCommentNodePath } from '@services/comments/locator/comment-boundary-path';
import { toCanonicalCommentQuote } from '@services/comments/locator/comment-quote-policy';
import { captureCommentRootSnapshot } from '@services/comments/locator/comment-root-snapshot';
import { createCommentDomTextIndex, type CommentDomTextIndex } from '@services/comments/locator/dom-text-index';

const CONTEXT_LENGTH = 64;

export function captureCommentAnchor(input: {
  root: Element;
  range: Range;
  surfaceHint: ArticleCommentSurfaceHint;
  documentRoot?: Element | null;
  index?: CommentDomTextIndex;
}): ArticleCommentLocatorV2 | null {
  const { root, range } = input;
  const index = input.index?.root === root ? input.index : createCommentDomTextIndex(root);
  const offsets = index.rangeToOffsets(range);
  if (!offsets || offsets.end <= offsets.start) return null;

  const exact = toCanonicalCommentQuote(range.toString());
  if (!exact || index.text.slice(offsets.start, offsets.end) !== exact) return null;

  const boundaryPath = captureCommentBoundaryPath(root, range);
  const rootEvidence = captureCommentRootSnapshot(root, { index });
  if (!boundaryPath || !rootEvidence) return null;

  const prefix = index.text.slice(Math.max(0, offsets.start - CONTEXT_LENGTH), offsets.start);
  const suffix = index.text.slice(offsets.end, offsets.end + CONTEXT_LENGTH);
  const documentRelativeRootPath = input.documentRoot ? encodeCommentNodePath(input.documentRoot, root) : null;

  return {
    v: 2,
    textModelVersion: 'dom-text-v2',
    surfaceHint: input.surfaceHint,
    quote: {
      type: 'TextQuoteSelector',
      exact,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
    },
    position: { type: 'TextPositionSelector', start: offsets.start, end: offsets.end },
    boundaryPath,
    rootEvidence,
    ...(documentRelativeRootPath ? { documentRelativeRootPath } : {}),
  };
}

export function captureUniqueExactCommentAnchor(input: {
  index: CommentDomTextIndex;
  exact: unknown;
  surfaceHint: ArticleCommentSurfaceHint;
  documentRoot?: Element | null;
}): ArticleCommentLocatorV2 | null {
  const exact = toCanonicalCommentQuote(input.exact);
  if (!exact) return null;

  const index = input.index;
  const start = index.text.indexOf(exact);
  if (start < 0) return null;
  if (index.text.indexOf(exact, start + exact.length) >= 0) return null;

  const range = index.offsetsToRange(start, start + exact.length);
  if (!range) return null;
  return captureCommentAnchor({
    root: index.root,
    range,
    surfaceHint: input.surfaceHint,
    documentRoot: input.documentRoot,
    index,
  });
}
