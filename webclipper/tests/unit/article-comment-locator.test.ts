import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import { buildArticleCommentLocatorFromRange, restoreRangeFromArticleCommentLocator } from '../../src/services/comments/locator';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'NodeFilter', { configurable: true, value: dom.window.NodeFilter });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  // Keep the minimal NodeFilter polyfill from setup-nodefilter.ts.
}

describe('article-comment-locator', () => {
  beforeEach(() => setupDom());
  afterEach(() => cleanupDom());

  it('builds locator from Range', () => {
    document.body.innerHTML = '<div id="root">Hello world</div>';
    const root = document.getElementById('root') as HTMLElement;
    const textNode = root.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);

    const locator = buildArticleCommentLocatorFromRange({
      env: 'inpage',
      root,
      range,
    });

    expect(locator?.v).toBe(1);
    expect(locator?.env).toBe('inpage');
    expect(locator?.quote?.exact).toBe('world');
    expect(typeof (locator as any)?.position?.start).toBe('number');
    expect(typeof (locator as any)?.position?.end).toBe('number');
    expect(Number((locator as any).position.end)).toBeGreaterThan(Number((locator as any).position.start));

    const restored = locator ? restoreRangeFromArticleCommentLocator({ root, locator }) : null;
    expect(restored?.toString()).toBe('world');
  });
});
