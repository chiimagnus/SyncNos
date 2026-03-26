import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

import { mountThreadedCommentsPanel } from '@ui/comments/threaded-comments-panel';

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
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: dom.window.MutationObserver });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).getComputedStyle;
}

describe('Threaded comments panel ordering', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    cleanupDom();
  });

  it('orders root threads and replies by createdAt descending', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    mounted.api.setComments([
      { id: 1, parentId: null, createdAt: 1000, authorName: 'You', quoteText: '', commentText: 'root-old' },
      { id: 2, parentId: null, createdAt: 2000, authorName: 'You', quoteText: '', commentText: 'root-new' },
      { id: 3, parentId: 2, createdAt: 1500, authorName: 'You', quoteText: '', commentText: 'reply-old' },
      { id: 4, parentId: 2, createdAt: 2500, authorName: 'You', quoteText: '', commentText: 'reply-new' },
      { id: 5, parentId: 1, createdAt: 3000, authorName: 'You', quoteText: '', commentText: 'reply-root1-new' },
    ]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel?.shadowRoot;
    expect(shadow).toBeTruthy();

    const threads = Array.from(shadow!.querySelectorAll('.webclipper-inpage-comments-panel__thread'));
    expect(threads.length).toBe(2);

    const rootBodies = threads.map((t) =>
      t.querySelector('.webclipper-inpage-comments-panel__comment-body')?.textContent?.trim(),
    );
    expect(rootBodies).toEqual(['root-new', 'root-old']);

    const replies = Array.from(
      threads[0].querySelectorAll('.webclipper-inpage-comments-panel__comment-body.is-reply'),
    ).map((x) => x.textContent?.trim());
    expect(replies).toEqual(['reply-new', 'reply-old']);

    mounted.cleanup();
  });
});
