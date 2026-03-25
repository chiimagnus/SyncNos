import TextPositionAnchor from 'dom-anchor-text-position';
import TextQuoteAnchor from 'dom-anchor-text-quote';

import type { ArticleCommentLocator, ArticleCommentLocatorEnv } from '@services/comments/domain/models';

export function buildArticleCommentLocatorFromRange(input: {
  env: ArticleCommentLocatorEnv;
  root: Element;
  range: Range;
}): ArticleCommentLocator | null {
  const env = input.env;
  const root = input.root;
  const range = input.range;

  if (!root || typeof (root as any).querySelector !== 'function') return null;
  if (!range || typeof (range as any).cloneRange !== 'function') return null;

  try {
    const quote = TextQuoteAnchor.fromRange(root, range).toSelector?.();
    const position =
      TextPositionAnchor.fromRange?.(root, range)?.toSelector?.() ??
      TextQuoteAnchor.fromRange(root, range).toPositionAnchor?.()?.toSelector?.();

    if (!quote || typeof quote !== 'object') return null;
    if (!position || typeof position !== 'object') return null;

    return {
      v: 1,
      env,
      quote: quote as any,
      position: position as any,
    };
  } catch (_e) {
    return null;
  }
}

export function restoreRangeFromArticleCommentLocator(input: {
  root: Element;
  locator: ArticleCommentLocator;
}): Range | null {
  const root = input.root;
  const locator = input.locator;

  if (!root || typeof (root as any).querySelector !== 'function') return null;
  if (!locator || typeof locator !== 'object') return null;

  const positionSelector = (locator as any).position;
  if (positionSelector && typeof positionSelector === 'object') {
    try {
      const range = (TextPositionAnchor as any).toRange?.(root, positionSelector);
      if (range) return range as Range;
    } catch (_e) {
      // fallback to quote anchor
    }
  }

  const quoteSelector = (locator as any).quote;
  if (!quoteSelector || typeof quoteSelector !== 'object') return null;

  const hint = Number((locator as any)?.position?.start);

  try {
    const anchor = (TextQuoteAnchor as any).fromSelector(root, quoteSelector);
    const range = (anchor as any).toRange?.(Number.isFinite(hint) ? { hint } : undefined);
    return range || null;
  } catch (_e) {
    return null;
  }
}
