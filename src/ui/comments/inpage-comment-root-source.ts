import type { ArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { restoreCommentRootFromDocumentPath } from '@services/comments/locator/comment-boundary-path';
import { isCommentRootEvidenceMatch } from '@services/comments/locator/comment-root-evidence';
import { captureCommentAnchor } from '@services/comments/locator/capture-comment-anchor';
import { toCanonicalCommentQuote } from '@services/comments/locator/comment-quote-policy';
import type { CommentLocatorSurfaceRoots } from '@ui/comments/types';

function asElement(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

function commonElement(start: Node, end: Node): Element | null {
  const startAncestors = new Set<Element>();
  let cursor: Element | null = asElement(start);
  while (cursor) {
    startAncestors.add(cursor);
    cursor = cursor.parentElement;
  }
  cursor = asElement(end);
  while (cursor) {
    if (startAncestors.has(cursor)) return cursor;
    cursor = cursor.parentElement;
  }
  return null;
}

function pickScrollRoot(root: Element): Element {
  let cursor: Element | null = root;
  while (cursor) {
    const style = cursor.ownerDocument.defaultView?.getComputedStyle?.(cursor);
    if (style && /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)) return cursor;
    cursor = cursor.parentElement;
  }
  return root.ownerDocument.documentElement;
}

function tightenBrowserBlockSelectionRange(range: Range, doc: Document): Range {
  const rawRoot = commonElement(range.startContainer, range.endContainer);
  if (rawRoot && rawRoot !== doc.body && rawRoot !== doc.documentElement) return range;

  const expected = toCanonicalCommentQuote(range.toString());
  if (!expected.trim()) return range;

  let candidate = asElement(range.startContainer);
  while (candidate && candidate !== doc.body && candidate !== doc.documentElement) {
    const tightened = range.cloneRange();
    try {
      tightened.setEnd(candidate, candidate.childNodes.length);
      if (!tightened.collapsed && toCanonicalCommentQuote(tightened.toString()).trimEnd() === expected.trimEnd()) {
        return tightened;
      }
    } catch (_error) {
      // Try the next ancestor.
    }
    candidate = candidate.parentElement;
  }

  candidate = asElement(range.endContainer);
  while (candidate && candidate !== doc.body && candidate !== doc.documentElement) {
    const tightened = range.cloneRange();
    try {
      tightened.setStart(candidate, 0);
      if (!tightened.collapsed && toCanonicalCommentQuote(tightened.toString()).trimStart() === expected.trimStart()) {
        return tightened;
      }
    } catch (_error) {
      // Try the next ancestor.
    }
    candidate = candidate.parentElement;
  }

  return range;
}

export function createInpageCommentRootSource(input: {
  document: Document;
  getPanelRoot?: () => Element | null;
  maxCandidates?: number;
}) {
  const doc = input.document;
  const maxCandidates = Math.max(1, Math.floor(Number(input.maxCandidates ?? 8) || 1));
  const maxCandidateTextLength = 200_000;

  const captureSelection = (
    selection: Selection | null | undefined,
  ): { range: Range; roots: CommentLocatorSurfaceRoots } | null => {
    if (!selection || selection.rangeCount !== 1) return null;
    let rawRange: Range;
    try {
      rawRange = selection.getRangeAt(0);
    } catch (_error) {
      return null;
    }
    if (
      !rawRange ||
      rawRange.collapsed ||
      rawRange.startContainer.ownerDocument !== doc ||
      rawRange.endContainer.ownerDocument !== doc
    )
      return null;

    const panel = input.getPanelRoot?.();
    if (panel && (panel.contains(rawRange.startContainer) || panel.contains(rawRange.endContainer))) return null;

    const range = tightenBrowserBlockSelectionRange(rawRange, doc);
    const root = commonElement(range.startContainer, range.endContainer);
    if (!root || root === doc.body || root === doc.documentElement) return null;
    return { range, roots: { sourceRoot: root, scrollRoot: pickScrollRoot(root) } };
  };

  const capture = (selection: Selection | null | undefined): CommentLocatorSurfaceRoots | null =>
    captureSelection(selection)?.roots ?? null;

  const captureAnchor = (selection: Selection | null | undefined) => {
    const captured = captureSelection(selection);
    if (!captured) return null;
    try {
      return captureCommentAnchor({
        root: captured.roots.sourceRoot,
        range: captured.range,
        surfaceHint: 'inpage',
        documentRoot: doc.documentElement,
      });
    } catch (_error) {
      return null;
    }
  };

  const locate = (locator: ArticleCommentLocator): Element[] => {
    const results: Element[] = [];
    const add = (candidate: Element | null) => {
      if (!candidate || candidate === doc.body || candidate === doc.documentElement) return;
      if (results.includes(candidate)) return;
      if (locator.v === 2 && !isCommentRootEvidenceMatch(candidate, locator.rootEvidence)) return;
      results.push(candidate);
    };

    if (locator.v === 2 && locator.documentRelativeRootPath) {
      add(
        restoreCommentRootFromDocumentPath({
          documentRoot: doc.documentElement,
          path: locator.documentRelativeRootPath,
          expectedEvidence: locator.rootEvidence,
          validateEvidence: isCommentRootEvidenceMatch,
        }),
      );
    }

    const candidates = doc.querySelectorAll(
      'article, main, [role="main"], [data-testid], [data-message-id], [data-node-id]',
    );
    let checkedCandidates = 0;
    let checkedTextLength = 0;
    for (let index = 0; index < candidates.length && checkedCandidates < maxCandidates; index += 1) {
      const candidate = candidates.item(index);
      const textLength = String(candidate.textContent ?? '').length;
      if (checkedTextLength + textLength > maxCandidateTextLength) break;
      checkedCandidates += 1;
      checkedTextLength += textLength;
      add(candidate);
    }
    return results.slice(0, maxCandidates);
  };

  return { capture, captureAnchor, locate };
}
